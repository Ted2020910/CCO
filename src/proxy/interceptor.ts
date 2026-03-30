import type { Request, Response } from 'express';
import { generateId } from '../shared/utils.js';
import type {
  RequestRecord,
  TokenUsage,
  AnthropicMessage,
  AnthropicContentBlock,
  ClassificationType,
  SessionHistoryEntry,
} from '../shared/types.js';
import { SessionManager, classifyRequest, getFullMessageText } from '../session/index.js';
import type { RequestForClassification } from '../session/index.js';
import { saveSession } from '../storage/session-store.js';

// SessionManager 单例（由 server.ts 注入）
let sessionManager: SessionManager;

export function setSessionManager(manager: SessionManager): void {
  sessionManager = manager;
}

export function getSessionManager(): SessionManager {
  return sessionManager;
}

/**
 * 拦截请求：分类请求 → 转发 → 解析响应 → 更新 Session 状态 → 持久化
 */
export async function interceptRequest(
  req: Request,
  res: Response,
  sessionId: string,
  targetUrl: string,
): Promise<void> {
  const startTime = Date.now();

  const endpoint = targetUrl.replace('https://api.anthropic.com/', '');
  const model: string = req.body?.model ?? 'unknown';

  // ── 内部记录（不再持久化，仅用于流转） ────────────────────────────────────
  const record: RequestRecord = {
    id: generateId(),
    sessionId,
    timestamp: new Date().toISOString(),
    model,
    endpoint,
    request: req.body ?? {},
    status: 'pending',
  };

  // ── 分类请求 ────────────────────────────────────────────────────────────────
  let classificationType: ClassificationType = 'unclassified';

  // 本次请求对应的 active agent 引用，用于响应阶段追加 assistant 消息
  let activeAgent: import('../shared/types.js').AgentBase | null = null;

  if (sessionManager && req.body?.messages) {
    try {
      const requestBody: RequestForClassification = {
        system: req.body.system,
        messages: req.body.messages as AnthropicMessage[],
        tools: req.body.tools,
      };

      const session = sessionManager.getSession(sessionId);
      const classification = classifyRequest(session, requestBody, sessionManager, sessionId);
      classificationType = classification.type;
      record.classification = classificationType;

      // DEBUG: 输出分类结果和关键状态（递归收集所有 agent 的 pending Agent 调用）
      function collectAgentCalls(
        agent: import('../shared/types.js').AgentBase,
        depth = 0,
      ): string[] {
        const prefix = depth > 0 ? `${'  '.repeat(depth)}↳` : '';
        const calls = Object.entries(agent.tools_call_result_map)
          .filter(([, v]) => v.tool_name === 'Agent')
          .map(([k, v]) => `${prefix}${k.slice(-8)}(${v.is_finished ? 'done' : 'pending'})`);
        if ('sub_agents' in agent) {
          for (const sub of (agent as import('../shared/types.js').MainAgent | import('../shared/types.js').SubAgent).sub_agents) {
            calls.push(...collectAgentCalls(sub, depth + 1));
          }
        }
        return calls;
      }
      const agentCallSummary = session ? collectAgentCalls(session.main_agent) : [];
      console.log(`[CCO] classify: ${classificationType} | reason: ${classification.reason} | session: ${session ? 'yes' : 'no'} | msgs: ${requestBody.messages.length} | tools: ${requestBody.tools?.length ?? 0} | agent_calls: [${agentCallSummary.join(',')}]`);

      // ── 请求阶段：根据分类更新 Session 状态 ───────────────────────────────
      activeAgent = processRequestClassification(sessionId, classification.type, requestBody, classification);
    } catch (err) {
      console.error('[CCO] Classification error:', err);
    }
  }

  // ── 构造转发请求头 ─────────────────────────────────────────────────────────
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': (req.headers['anthropic-version'] as string) || '2023-06-01',
  };

  // 统一将认证信息转换为 Authorization: Bearer 格式：
  //   - Claude Code 原生发送 x-api-key: sk-...（Anthropic 标准）
  //   - 部分中转服务只接受 Authorization: Bearer sk-...（OpenAI 标准）
  // 优先级：已有 authorization 头 > x-api-key 头
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const authHeader = req.headers['authorization'] as string | undefined;

  if (authHeader) {
    // 已有 Authorization 头，直接透传
    headers['authorization'] = authHeader;
  } else if (apiKey) {
    // x-api-key 转换为 Authorization: Bearer
    const token = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
    headers['authorization'] = token;
    // 同时保留 x-api-key，兼容原生 Anthropic API
    headers['x-api-key'] = apiKey;
  }

  if (req.headers['anthropic-beta']) {
    headers['anthropic-beta'] = req.headers['anthropic-beta'] as string;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method:  'POST',
      headers,
      body:    JSON.stringify(req.body),
    });

    const contentType = upstream.headers.get('content-type') ?? '';
    res.status(upstream.status);

    // 转发响应头，但跳过 hop-by-hop 头（由代理自身管理）
    const skipHeaders = new Set(['content-encoding', 'content-length', 'transfer-encoding']);
    upstream.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (contentType.includes('text/event-stream')) {
      await handleStreamResponse(upstream, res, record, startTime, sessionId, classificationType, activeAgent);
    } else {
      await handleJsonResponse(upstream, res, record, startTime, sessionId, classificationType, activeAgent);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    record.status = 'error';
    record.error  = error;

    if (!res.headersSent) {
      res.status(502).json({ error: 'Upstream request failed', detail: error });
    }
  }
}

// ============================================================================
// 补偿历史子智能体 — 为 tools_call_result_map 中的 Agent 调用创建占位 SubAgent
// 处理 CCO 中途启动 / 历史数据缺失的场景
// ============================================================================

function backfillSubAgents(agent: import('../shared/types.js').AgentBase & { sub_agents?: import('../shared/types.js').SubAgent[] }): void {
  if (!('sub_agents' in agent)) return;
  const typedAgent = agent as import('../shared/types.js').MainAgent | import('../shared/types.js').SubAgent;

  // 收集已有 sub_agents 的 agent_id（= tool_call_id）
  const existingIds = new Set(typedAgent.sub_agents.map(s => s.agent_id));

  // 扫描所有 Agent 工具调用
  for (const [callId, entry] of Object.entries(agent.tools_call_result_map)) {
    if (entry.tool_name !== 'Agent') continue;
    if (existingIds.has(callId)) continue;

    // 创建占位 SubAgent，agent_id = callId，填充 prompt 和 is_finished
    const args = entry.arguments as Record<string, unknown>;
    const prompt = typeof args.prompt === 'string' ? args.prompt : '';
    const placeholderSub: import('../shared/types.js').SubAgent = {
      agent_id: callId,
      prompt,
      is_finished: entry.is_finished,
      current_sys_prompt: null,
      current_messages: [],
      tools: [],
      tools_call_result_map: {},
      sub_agents: [],
    };

    typedAgent.sub_agents.push(placeholderSub);
  }
}

// ============================================================================
// 从全量 messages 重建 tools_call_result_map
// ============================================================================

/**
 * 扫描所有 messages 中的 tool_use 和 tool_result，重建 tools_call_result_map
 * 每次请求的 messages 包含完整历史，所以直接全量重建
 * 同时同步子智能体的 is_finished 状态
 */
function syncToolCallMap(
  agent: import('../shared/types.js').AgentBase,
  messages: import('../shared/types.js').AnthropicMessage[],
): void {
  const map: Record<string, import('../shared/types.js').ToolCallEntry> = {};

  // 第一遍：收集所有 tool_use
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content as AnthropicContentBlock[]) {
        if (block.type === 'tool_use' && block.id && block.name) {
          map[block.id] = {
            tool_name: block.name,
            arguments: (block.input ?? {}) as Record<string, unknown>,
            is_finished: false,
            result: null,
          };
        }
      }
    }
  }

  // 第二遍：匹配 tool_result
  for (const msg of messages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content as AnthropicContentBlock[]) {
        if (block.type === 'tool_result' && block.tool_use_id && map[block.tool_use_id]) {
          map[block.tool_use_id].is_finished = true;
          map[block.tool_use_id].result = block.content ?? null;
        }
      }
    }
  }

  agent.tools_call_result_map = map;

  // 同步子智能体的 is_finished 状态：
  // 当 tool_result 返回时意味着对应子智能体已完成任务
  if (sessionManager && 'sub_agents' in agent) {
    for (const [callId, entry] of Object.entries(map)) {
      if (entry.tool_name === 'Agent' && entry.is_finished) {
        sessionManager.markSubAgentFinished(agent, callId);
      }
    }
  }
}

// ============================================================================
// 请求阶段：根据分类更新 Session 状态
// ============================================================================

function processRequestClassification(
  sessionId: string,
  type: ClassificationType,
  requestBody: RequestForClassification,
  classification: { agent?: unknown; parentAgent?: unknown; toolCallId?: string },
): import('../shared/types.js').AgentBase | null {
  if (!sessionManager) return null;

  const { system: sysPrompt, messages, tools } = requestBody;
  // 存储时去掉 cache_control，避免后续比较不一致
  const cleanMessages = JSON.parse(JSON.stringify(messages, (k, v) => k === 'cache_control' ? undefined : v)) as AnthropicMessage[];

  switch (type) {
    case 'main_agent': {
      let session = sessionManager.getSession(sessionId);
      if (!session) {
        session = sessionManager.createSession(sessionId, sysPrompt, messages, tools ?? []);
      }
      const mainAgent = session.main_agent;

      // 压缩恢复：更新 sys_prompt（压缩后 sys_prompt 已清空，需要用新请求的 sys_prompt 恢复）
      if (session.pending_compression_summary) {
        mainAgent.current_sys_prompt = sysPrompt;
        delete session.pending_compression_summary;
        console.log('[CCO] Compression recovery: sys_prompt updated, pending flag cleared');
      }

      mainAgent.current_messages = cleanMessages;
      mainAgent._synced_message_count = cleanMessages.length;
      syncToolCallMap(mainAgent, cleanMessages);
      // 补偿历史子智能体：tools_call_result_map 中有 Agent 调用但 sub_agents 里没有对应节点
      backfillSubAgents(mainAgent);
      return mainAgent;
    }

    case 'sub_agent_continue': {
      const agent = classification.agent;
      if (agent && typeof agent === 'object' && 'current_messages' in agent) {
        const typedAgent = agent as import('../shared/types.js').AgentBase;
        typedAgent.current_messages = cleanMessages;
        typedAgent._synced_message_count = cleanMessages.length;
        syncToolCallMap(typedAgent, cleanMessages);
        backfillSubAgents(typedAgent);
        return typedAgent;
      }
      return null;
    }

    case 'sub_agent_new': {
      const session = sessionManager.getSession(sessionId);
      if (!session) return null;

      const parentAgent = classification.parentAgent as import('../shared/types.js').AgentBase | undefined;
      const parent = parentAgent ?? session.main_agent;
      const toolCallId = classification.toolCallId ?? 'unknown';

      // 先查找响应阶段已创建的占位 SubAgent
      const existingPlaceholder = sessionManager.findSubAgentByToolCallId(parent, toolCallId);

      let subAgent: import('../shared/types.js').SubAgent;
      if (existingPlaceholder) {
        // 填充占位节点：更新 sys_prompt、tools
        existingPlaceholder.current_sys_prompt = sysPrompt;
        existingPlaceholder.tools = tools ?? [];
        subAgent = existingPlaceholder;
      } else {
        // 没有占位节点（CCO 中途启动等情况），创建新的
        const args = parent.tools_call_result_map[toolCallId]?.arguments as Record<string, unknown> | undefined;
        const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
        subAgent = sessionManager.createSubAgent(
          parent,
          toolCallId,
          prompt,
          sysPrompt,
          messages,
          tools ?? [],
        );
      }
      subAgent.current_messages = cleanMessages;
      subAgent._synced_message_count = cleanMessages.length;
      syncToolCallMap(subAgent, cleanMessages);
      return subAgent;
    }

    case 'compression': {
      // 压缩请求阶段：确保 session 存在，并同步压缩前的历史消息
      // 这处理两种情况：
      //   1. 正常情况：session 已存在（Step 1 之前已创建）
      //   2. CCO 中途启动：首个请求就是压缩，session 尚不存在，需要先创建
      let session = sessionManager.getSession(sessionId);
      if (!session) {
        // CCO 中途启动场景：用压缩前的历史消息初始化 session
        // messages[:-1] 是对话历史，messages[-1] 是压缩指令（不归入历史）
        const preCompressionMessages = messages.slice(0, -1);
        session = sessionManager.createSession(sessionId, sysPrompt, preCompressionMessages, tools ?? []);
        console.log(`[CCO] Compression: session created on-the-fly (CCO started mid-session), msgs: ${preCompressionMessages.length}`);

        // 同步工具调用历史，补建历史子智能体
        const cleanPreMsgs = JSON.parse(JSON.stringify(preCompressionMessages, (k, v) => k === 'cache_control' ? undefined : v)) as AnthropicMessage[];
        const mainAgent = session.main_agent;
        mainAgent.current_messages = cleanPreMsgs;
        mainAgent._synced_message_count = cleanPreMsgs.length;
        syncToolCallMap(mainAgent, cleanPreMsgs);
        backfillSubAgents(mainAgent);
      }
      // session 已存在：不需要额外操作，响应阶段会执行归档
      return null;
    }

    case 'unclassified':
      // 未分类请求完全忽略
      return null;
  }
}

// ============================================================================
// 响应阶段：解析响应并更新 Session 状态
// ============================================================================

function processResponseClassification(
  sessionId: string,
  type: ClassificationType,
  responseContent: AnthropicContentBlock[],
  model: string,
  activeAgent: import('../shared/types.js').AgentBase | null,
): void {
  if (!sessionManager) return;

  const session = sessionManager.getSession(sessionId);
  if (!session) return;

  // 更新统计信息（除了 unclassified）
  if (type !== 'unclassified') {
    sessionManager.updateStats(session, model);
  }

  // 更新时间戳
  sessionManager.touch(session);

  // ── 压缩响应处理：归档当前对话 + 重置主智能体状态 ─────────────────────────
  if (type === 'compression' && responseContent.length > 0) {
    // 1. 归档当前状态到 session_history_list
    const mainAgent = session.main_agent;
    const archiveEntry: SessionHistoryEntry = {
      sys_prompt: mainAgent.current_sys_prompt,
      messages: [...mainAgent.current_messages],
      sub_agents: mainAgent.sub_agents,                // 快照本轮全部子智能体
      tools_call_result_map: { ...mainAgent.tools_call_result_map }, // 用于重建标签
      archived_at: new Date().toISOString(),
    };
    mainAgent.session_history_list.push(archiveEntry);

    // 2. 清空当前状态（sys_prompt + messages + sub_agents）
    //    压缩后 CC 会发送全新的 sys_prompt（含摘要），旧的已无法匹配
    //    全部置空后，下一个带 tools 的请求会自然匹配为主智能体（matchesAgent 空状态逻辑）
    mainAgent.current_sys_prompt = null;
    mainAgent.current_messages = [];
    mainAgent.sub_agents = [];
    mainAgent.tools_call_result_map = {};

    // 3. 标记压缩后待恢复状态
    session.pending_compression_summary = true;

    console.log(`[CCO] Compression archived: ${mainAgent.session_history_list.length} entries`);
  }

  // 将本轮 assistant 响应追加到 current_messages，确保子 agent 完整对话可被查看
  // 下一次请求到来时，cleanMessages 会重新全量覆盖，不会产生重复
  if (activeAgent && responseContent.length > 0 && type !== 'unclassified') {
    const assistantMsg: AnthropicMessage = {
      role: 'assistant',
      content: responseContent,
    };
    activeAgent.current_messages.push(assistantMsg);

    // 立即将响应中的 tool_use 写入 tools_call_result_map
    // 这样在子智能体的请求到达时（Step 4），能找到 pending 的 Agent 条目
    // 下次请求到来时 syncToolCallMap 会全量重建，不会重复
    for (const block of responseContent) {
      if (block.type === 'tool_use' && block.id && block.name) {
        activeAgent.tools_call_result_map[block.id] = {
          tool_name: block.name,
          arguments: (block.input ?? {}) as Record<string, unknown>,
          is_finished: false,
          result: null,
        };

        // 对 Agent 工具调用，立即创建占位子智能体
        // 这样 Dashboard 能第一时间看到子智能体节点，无需等待子智能体首次请求
        if (block.name === 'Agent') {
          const args = (block.input ?? {}) as Record<string, unknown>;
          const prompt = typeof args.prompt === 'string' ? args.prompt : '';
          // 检查是否已有对应的 sub_agent（避免重复创建）
          const existing = sessionManager.findSubAgentByToolCallId(activeAgent, block.id);
          if (!existing) {
            sessionManager.createPlaceholderSubAgent(activeAgent, block.id, prompt);
          }
        }
      }
    }
  }

  // ── 持久化 Session 到磁盘 ──────────────────────────────────────────────────
  try {
    saveSession(session);
    sessionManager.markPersisted(session.session_id);
  } catch (err) {
    console.error('[CCO] Failed to save session:', err);
  }
}

// ============================================================================
// 流式响应处理
// ============================================================================

async function handleStreamResponse(
  upstream: globalThis.Response,
  res: Response,
  record: RequestRecord,
  startTime: number,
  sessionId: string,
  classificationType: ClassificationType,
  activeAgent: import('../shared/types.js').AgentBase | null,
): Promise<void> {
  if (!upstream.body) throw new Error('No response body for streaming');

  // SSE 必须立刻发送 headers，不能等 buffer 满
  res.flushHeaders();

  const reader  = upstream.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  // ── 流式预处理：在转发给 Claude Code 之前即时处理 Agent tool_use ─────────────
  // 目的：消除 race condition
  //   Claude Code 在收到 content_block_stop 事件后立即 spawn sub-agent
  //   而 CCO 原来在流结束后才更新 tools_call_result_map
  //   导致 sub-agent 的首个请求到达时 map 里还没有父条目 → unclassified
  //
  // 修复方案：在每个 chunk 转发给 Claude Code 之前先扫描 SSE 事件，
  //   发现 Agent tool_use 完成时立即写入 map 并创建占位 sub-agent
  interface StreamBlockInfo {
    id: string;
    name: string;
    inputParts: string[];
  }
  const streamBlocks = new Map<number, StreamBlockInfo>();
  let lineBuffer = ''; // 处理跨 chunk 的不完整行

  function processChunkEvents(chunk: string): void {
    if (!activeAgent || !sessionManager) return;

    lineBuffer += chunk;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? ''; // 保留不完整的最后一行

    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      let evt: Record<string, unknown>;
      try { evt = JSON.parse(line.slice(6)) as Record<string, unknown>; }
      catch { continue; }

      const evtType = evt['type'] as string | undefined;
      const idx = typeof evt['index'] === 'number' ? evt['index'] : 0;

      if (evtType === 'content_block_start') {
        const block = evt['content_block'] as Record<string, unknown> | undefined;
        if (block?.['type'] === 'tool_use') {
          streamBlocks.set(idx, {
            id: (block['id'] as string) ?? '',
            name: (block['name'] as string) ?? '',
            inputParts: [],
          });
        }
      } else if (evtType === 'content_block_delta') {
        const delta = evt['delta'] as Record<string, unknown> | undefined;
        if (delta?.['type'] === 'input_json_delta' && typeof delta['partial_json'] === 'string') {
          streamBlocks.get(idx)?.inputParts.push(delta['partial_json'] as string);
        }
      } else if (evtType === 'content_block_stop') {
        const info = streamBlocks.get(idx);
        if (info?.name === 'Agent' && info.id) {
          // Agent tool_use 已完成 → 在转发给 Claude Code 之前立即注册
          try {
            const args = JSON.parse(info.inputParts.join('')) as Record<string, unknown>;
            const prompt = typeof args['prompt'] === 'string' ? args['prompt'] : '';
            // 写入父 agent 的 map（如果已存在则跳过，避免覆盖更完整的数据）
            if (!activeAgent.tools_call_result_map[info.id]) {
              activeAgent.tools_call_result_map[info.id] = {
                tool_name: 'Agent',
                arguments: args,
                is_finished: false,
                result: null,
              };
            }
            // 创建占位 sub-agent（如果还没有）
            if (!sessionManager.findSubAgentByToolCallId(activeAgent, info.id)) {
              sessionManager.createPlaceholderSubAgent(activeAgent, info.id, prompt);
            }
          } catch { /* JSON 解析失败，忽略；流结束后 processResponseClassification 会重建 */ }
        }
        streamBlocks.delete(idx);
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      chunks.push(chunk);
      // ① 先扫描 Agent tool_use 完成事件并立即注册（消除 race condition）
      processChunkEvents(chunk);
      // ② 再转发给 Claude Code（此时 map 已包含最新条目）
      res.write(chunk);
    }
  } finally {
    // 无论成功还是出错，都要关闭响应
    res.end();

    const fullText = chunks.join('');
    const { contentBlocks } = parseSSEResponse(fullText);

    record.status = upstream.ok ? 'completed' : 'error';

    // ── 更新 Session 状态 ─────────────────────────────────────────────────
    if (upstream.ok) {
      try {
        processResponseClassification(
          sessionId,
          classificationType,
          contentBlocks,
          record.model,
          activeAgent,
        );
      } catch (err) {
        console.error('[CCO] Response classification error:', err);
      }
    }
  }
}

// ============================================================================
// 非流式响应处理
// ============================================================================

async function handleJsonResponse(
  upstream: globalThis.Response,
  res: Response,
  record: RequestRecord,
  startTime: number,
  sessionId: string,
  classificationType: ClassificationType,
  activeAgent: import('../shared/types.js').AgentBase | null,
): Promise<void> {
  // 先读原始文本，完全透传给 Claude Code，不做任何修改
  const rawText = await upstream.text();
  res.status(upstream.status).send(rawText);

  record.status = upstream.ok ? 'completed' : 'error';

  // 仅用于内部 session 状态更新，解析失败不影响透传
  if (upstream.ok) {
    try {
      const data = JSON.parse(rawText) as Record<string, unknown>;
      const contentBlocks = (data['content'] as AnthropicContentBlock[]) ?? [];
      processResponseClassification(
        sessionId,
        classificationType,
        contentBlocks,
        record.model,
        activeAgent,
      );
    } catch (err) {
      console.error('[CCO] Response classification error:', err);
    }
  }
}

// ============================================================================
// SSE 解析（提取所有 content block 类型）
// ============================================================================

interface ParsedSSE {
  response: Record<string, unknown>;
  contentBlocks: AnthropicContentBlock[];
}

function parseSSEResponse(raw: string): ParsedSSE {
  const lines  = raw.split('\n');
  const events: Record<string, unknown>[] = [];

  for (const line of lines) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch { /* ignore malformed */ }
  }

  const msgStart = events.find(e => e['type'] === 'message_start');
  const message  = (msgStart?.['message'] ?? {}) as Record<string, unknown>;

  // ── 提取所有 content blocks（text + thinking + tool_use）────────────────────
  const contentBlocks: AnthropicContentBlock[] = [];
  const blockMap = new Map<number, AnthropicContentBlock>();
  const toolInputBuffers = new Map<number, string[]>();

  for (const evt of events) {
    const evtType = evt['type'] as string;
    const index = evt['index'] as number;

    if (evtType === 'content_block_start') {
      const block = evt['content_block'] as AnthropicContentBlock;
      if (block) {
        blockMap.set(index, { ...block });
        if (block.type === 'tool_use') {
          toolInputBuffers.set(index, []);
        }
      }
    }

    if (evtType === 'content_block_delta') {
      const delta = evt['delta'] as Record<string, unknown>;
      if (!delta) continue;

      const block = blockMap.get(index);
      if (!block) continue;

      const deltaType = delta['type'] as string;

      if (deltaType === 'text_delta' && block.type === 'text') {
        block.text = (block.text ?? '') + (delta['text'] as string ?? '');
      }

      if (deltaType === 'thinking_delta' && block.type === 'thinking') {
        block.thinking = (block.thinking ?? '') + (delta['thinking'] as string ?? '');
      }

      if (deltaType === 'input_json_delta' && block.type === 'tool_use') {
        const buffer = toolInputBuffers.get(index);
        if (buffer) {
          buffer.push(delta['partial_json'] as string ?? '');
        }
      }
    }

    if (evtType === 'content_block_stop') {
      const block = blockMap.get(index);
      if (block) {
        if (block.type === 'tool_use') {
          const buffer = toolInputBuffers.get(index);
          if (buffer && buffer.length > 0) {
            try {
              block.input = JSON.parse(buffer.join(''));
            } catch {
              block.input = {};
            }
          }
          toolInputBuffers.delete(index);
        }
        contentBlocks.push(block);
      }
    }
  }

  return {
    response: { ...message, content: contentBlocks },
    contentBlocks,
  };
}
