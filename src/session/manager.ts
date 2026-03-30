import { generateId } from '../shared/utils.js';
import type {
  Session,
  SessionStats,
  MainAgent,
  SubAgent,
  AgentBase,
  AnthropicMessage,
  ToolCallEntry,
} from '../shared/types.js';

// ============================================================================
// SessionManager - 内存中维护所有活跃 Session，提供查找/创建/更新接口
// ============================================================================

// ── Agent 匹配诊断结果 ─────────────────────────────────────────────────────

export interface MatchResult {
  matched: boolean;
  reason: string;     // 匹配/失败的详细原因
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  /** 已经至少落盘一次的 sessionId 集合，防止 syncWithDisk 误删还在流式处理中的新 session */
  private persistedIds = new Set<string>();

  // ── 查询 ────────────────────────────────────────────────────────────────────

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): Session[] {
    return [...this.sessions.values()];
  }

  // ── 创建 Session ─────────────────────────────────────────────────────────────

  /**
   * 创建新 Session + MainAgent
   * 首次请求时调用
   */
  createSession(
    sessionId: string,
    sysPrompt: unknown,
    messages: AnthropicMessage[],
    tools: unknown[],
  ): Session {
    const now = new Date().toISOString();

    // 提取首条 user message 的最后一个 text block 作为默认 session_name
    const firstUserMsg = messages.find(m => m.role === 'user');
    let defaultName = 'Untitled Session';
    if (firstUserMsg) {
      if (typeof firstUserMsg.content === 'string') {
        defaultName = firstUserMsg.content;
      } else if (Array.isArray(firstUserMsg.content)) {
        const textBlocks = firstUserMsg.content.filter(b => b.type === 'text' && b.text);
        if (textBlocks.length > 0) {
          defaultName = (textBlocks[textBlocks.length - 1].text as string) || 'Untitled Session';
        }
      }
    }
    // session_name 最多 10 个字符
    if (defaultName.length > 10) {
      defaultName = defaultName.slice(0, 10);
    }

    const mainAgent: MainAgent = {
      agent_id: generateId(),
      current_sys_prompt: sysPrompt,
      current_messages: [],       // 由每次请求全量同步
      tools,
      tools_call_result_map: {},
      session_history_list: [],
      sub_agents: [],
    };

    const session: Session = {
      session_id: sessionId,
      session_name: defaultName,
      main_agent: mainAgent,
      created_at: now,
      updated_at: now,
      stats: createEmptyStats(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * 从持久化数据加载 Session（服务器重启时）
   */
  loadSession(session: Session): void {
    this.sessions.set(session.session_id, session);
    this.persistedIds.add(session.session_id);
  }

  // ── Agent 匹配 ──────────────────────────────────────────────────────────────

  /**
   * 在 session 中查找与 (sysPrompt, messageHistory) 匹配的 agent
   * messageHistory = request.messages[:-1]（去掉最后一条消息）
   * 返回匹配到的 agent + 原因，或 null + 失败原因
   */
  findMatchingAgent(
    session: Session,
    sysPrompt: unknown,
    messageHistory: AnthropicMessage[],
  ): { agent: AgentBase | null; reason: string } {
    // 先检查主智能体
    const mainResult = matchesAgent(session.main_agent, sysPrompt, messageHistory);
    if (mainResult.matched) {
      return { agent: session.main_agent, reason: `main(${mainResult.reason})` };
    }

    // 递归检查所有子智能体
    const subResult = findInSubAgents(session.main_agent.sub_agents, sysPrompt, messageHistory);
    if (subResult.agent) {
      return subResult;
    }

    // 全部不匹配，汇总原因
    const reasons: string[] = [`main(${mainResult.reason})`];
    if (subResult.reason) {
      reasons.push(subResult.reason);
    }
    return { agent: null, reason: reasons.join(', ') };
  }

  /**
   * 判断请求是否匹配主智能体，返回带诊断信息的结果
   */
  matchesMainAgent(
    session: Session,
    sysPrompt: unknown,
    messageHistory: AnthropicMessage[],
  ): MatchResult {
    return matchesAgent(session.main_agent, sysPrompt, messageHistory);
  }

  // ── 子智能体 ────────────────────────────────────────────────────────────────

  /**
   * 查找能关联到新子智能体的父 agent
   * 遍历所有 agent 的 tools_call_result_map，找到：
   *   tool_name == "Agent" && is_finished == false && arguments.prompt IN userMessage
   * 返回匹配结果 + 诊断原因
   */
  findParentForSubAgent(
    session: Session,
    firstUserMessageContent: string,
  ): { parentAgent: AgentBase; toolCallId: string; reason: string } | { parentAgent: null; reason: string } {
    // 检查主智能体
    const mainResult = findAgentToolCall(session.main_agent, firstUserMessageContent);
    if (mainResult) return mainResult;

    // 递归检查所有子智能体
    const subResult = findAgentToolCallInSubAgents(session.main_agent.sub_agents, firstUserMessageContent);
    if (subResult) return subResult;

    // 全部未匹配，收集诊断信息
    const totalAgentCalls = countPendingAgentCalls(session.main_agent);
    if (totalAgentCalls === 0) {
      return { parentAgent: null, reason: 'no_pending_agent_calls' };
    }
    return { parentAgent: null, reason: `no_prompt_match(pending=${totalAgentCalls})` };
  }

  /**
   * 创建子智能体并挂载到父 agent
   * agent_id 直接使用 toolCallId（父 agent 的 Agent tool_use id）
   */
  createSubAgent(
    parentAgent: AgentBase,
    toolCallId: string,
    prompt: string,
    sysPrompt: unknown,
    messages: AnthropicMessage[],
    tools: unknown[],
  ): SubAgent {
    const subAgent: SubAgent = {
      agent_id: toolCallId,
      prompt,
      is_finished: false,
      current_sys_prompt: sysPrompt,
      current_messages: [],
      tools,
      tools_call_result_map: {},
      sub_agents: [],
    };

    // 挂载到父 agent
    if ('sub_agents' in parentAgent) {
      (parentAgent as MainAgent | SubAgent).sub_agents.push(subAgent);
    }

    return subAgent;
  }

  /**
   * 在响应阶段检测到 Agent tool_use 时，立即创建占位子智能体
   * agent_id = toolCallId，占位节点 messages/tools/sys_prompt 为空
   */
  createPlaceholderSubAgent(
    parentAgent: AgentBase,
    toolCallId: string,
    prompt: string,
  ): SubAgent {
    const subAgent: SubAgent = {
      agent_id: toolCallId,
      prompt,
      is_finished: false,
      current_sys_prompt: null,
      current_messages: [],
      tools: [],
      tools_call_result_map: {},
      sub_agents: [],
    };

    if ('sub_agents' in parentAgent) {
      (parentAgent as MainAgent | SubAgent).sub_agents.push(subAgent);
    }

    return subAgent;
  }

  /**
   * 在 agent 的直接 sub_agents 中按 agent_id（= tool_call_id）查找
   * 用于将已有占位节点与后续到达的真实请求关联
   */
  findSubAgentByToolCallId(
    parentAgent: AgentBase,
    toolCallId: string,
  ): SubAgent | null {
    if (!('sub_agents' in parentAgent)) return null;
    const subs = (parentAgent as MainAgent | SubAgent).sub_agents;
    return subs.find(s => s.agent_id === toolCallId) ?? null;
  }

  /**
   * 标记子智能体为已完成
   * 在 agent 的 sub_agents 中按 agent_id（= tool_call_id）查找并更新
   */
  markSubAgentFinished(agent: AgentBase, toolCallId: string): void {
    if (!('sub_agents' in agent)) return;
    const subs = (agent as MainAgent | SubAgent).sub_agents;
    const sub = subs.find(s => s.agent_id === toolCallId);
    if (sub) {
      sub.is_finished = true;
    }
  }

  // ── 重命名 Session ──────────────────────────────────────────────────────────

  renameSession(sessionId: string, newName: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    // session_name 最多 10 个字符
    session.session_name = newName.length > 10 ? newName.slice(0, 10) : newName;
    session.updated_at = new Date().toISOString();
    return true;
  }

  // ── 删除 Session（内存） ──────────────────────────────────────────────────────

  removeSession(sessionId: string): boolean {
    this.persistedIds.delete(sessionId);
    return this.sessions.delete(sessionId);
  }

  // ── 磁盘同步 ────────────────────────────────────────────────────────────────

  /**
   * 将内存中的 session 列表与磁盘上实际存在的文件同步。
   * 移除内存中已不存在于磁盘的 session（用户手动删除了 JSON 文件）。
   * 跳过尚未落盘的 session（正在流式处理中，还没来得及 saveSession）。
   * @param diskSessionIds 当前磁盘上存在的 session ID 列表
   * @returns 被移除的 session ID 列表
   */
  syncWithDisk(diskSessionIds: Set<string>): string[] {
    const removed: string[] = [];
    for (const sessionId of this.sessions.keys()) {
      // 跳过从未落盘的 session —— 可能是刚创建还在流式处理中
      if (!this.persistedIds.has(sessionId)) continue;
      if (!diskSessionIds.has(sessionId)) {
        this.sessions.delete(sessionId);
        this.persistedIds.delete(sessionId);
        removed.push(sessionId);
      }
    }
    return removed;
  }

  /**
   * 标记 session 已落盘（在 saveSession 之后调用）
   */
  markPersisted(sessionId: string): void {
    this.persistedIds.add(sessionId);
  }

  // ── 更新时间戳 ──────────────────────────────────────────────────────────────

  touch(session: Session): void {
    session.updated_at = new Date().toISOString();
  }

  // ── 统计更新 ─────────────────────────────────────────────────────────────────

  updateStats(
    session: Session,
    model: string,
  ): void {
    const s = session.stats;
    s.total_requests++;
    s.models_used[model] = (s.models_used[model] ?? 0) + 1;
  }
}

// ============================================================================
// 内部工具函数
// ============================================================================

function createEmptyStats(): SessionStats {
  return {
    total_requests: 0,
    models_used: {},
  };
}

/**
 * 匹配用的头部消息数量上限
 *
 * 只比较 sys_prompt + 第 1 条消息即可唯一确定 agent：
 *   - sys_prompt 区分主智能体与各子智能体（CC 为每个 agent 生成独立 system）
 *   - 第 1 条消息是对话的起始"指纹"，整个会话生命周期内不变
 *   - 比较更多消息反而引入风险（SSE 重建的 assistant 可能与 CC 版本不一致）
 */
const HEAD_MATCH_COUNT = 1;

/**
 * 判断 agent 是否与 (sysPrompt, messageHistory) 匹配
 *
 * 匹配逻辑：
 *   1. sys_prompt 必须一致（忽略 cache_control）
 *   2. 比较第 1 条消息（HEAD_MATCH_COUNT = 1）
 *      —— syncedLen = _synced_message_count ?? stored.length
 *      —— 只比较全量同步过的消息，忽略响应阶段 append 的 assistant 消息
 *   3. 至少有 1 条消息能比较，或者双方都为空
 *
 * 注意：Claude Code 会动态给消息 block 加 cache_control 字段，
 *       同一条消息在不同请求中 cache_control 位置不同，
 *       所以比较时必须忽略 cache_control
 */
function matchesAgent(
  agent: AgentBase,
  sysPrompt: unknown,
  messageHistory: AnthropicMessage[],
): MatchResult {
  // Step 1: sys_prompt 必须一致
  if (!deepEqualIgnoreCache(agent.current_sys_prompt, sysPrompt)) {
    return { matched: false, reason: 'sys✗' };
  }

  // 使用全量同步时的消息数量，忽略响应阶段 append 的 assistant 消息
  const syncedLen = agent._synced_message_count ?? agent.current_messages.length;
  const incomingLen = messageHistory.length;

  // 双方都为空 → 仅凭 sys_prompt 匹配（新建 session 的首次请求）
  if (syncedLen === 0 && incomingLen === 0) {
    return { matched: true, reason: 'sys✓ both_empty' };
  }

  // 一方有消息一方没有 → 仍然允许（agent 刚创建还没存消息，或压缩后清空了）
  if (syncedLen === 0 || incomingLen === 0) {
    return { matched: true, reason: `sys✓ one_empty(synced=${syncedLen},incoming=${incomingLen})` };
  }

  // Step 2: 比较前 HEAD_MATCH_COUNT 条消息
  const compareLen = Math.min(syncedLen, incomingLen, HEAD_MATCH_COUNT);

  for (let i = 0; i < compareLen; i++) {
    if (!deepEqualIgnoreCache(agent.current_messages[i], messageHistory[i])) {
      return { matched: false, reason: `sys✓ head✗(idx=${i},synced=${syncedLen},incoming=${incomingLen},compared=${compareLen})` };
    }
  }

  return { matched: true, reason: `sys✓ head✓(synced=${syncedLen},incoming=${incomingLen},compared=${compareLen})` };
}

/**
 * 深度比较，忽略 cache_control 字段
 */
function deepEqualIgnoreCache(a: unknown, b: unknown): boolean {
  return JSON.stringify(a, cacheReplacer) === JSON.stringify(b, cacheReplacer);
}

function cacheReplacer(key: string, value: unknown): unknown {
  if (key === 'cache_control') return undefined;
  return value;
}

/**
 * 递归在子智能体列表中查找匹配的 agent
 */
function findInSubAgents(
  subAgents: SubAgent[],
  sysPrompt: unknown,
  messageHistory: AnthropicMessage[],
): { agent: AgentBase | null; reason: string } {
  const failReasons: string[] = [];

  for (const sub of subAgents) {
    const result = matchesAgent(sub, sysPrompt, messageHistory);
    if (result.matched) {
      return { agent: sub, reason: `sub:${sub.agent_id.slice(-8)}(${result.reason})` };
    }
    failReasons.push(`sub:${sub.agent_id.slice(-8)}(${result.reason})`);

    // 递归检查子智能体的子智能体
    const nested = findInSubAgents(sub.sub_agents, sysPrompt, messageHistory);
    if (nested.agent) return nested;
    if (nested.reason) failReasons.push(nested.reason);
  }

  return { agent: null, reason: failReasons.length > 0 ? failReasons.join(', ') : '' };
}

/**
 * 在 agent 的 tools_call_result_map 中查找 Agent 工具调用
 */
function findAgentToolCall(
  agent: AgentBase,
  userMessageContent: string,
): { parentAgent: AgentBase; toolCallId: string; reason: string } | null {
  for (const [callId, entry] of Object.entries(agent.tools_call_result_map)) {
    if (
      entry.tool_name === 'Agent' &&
      !entry.is_finished &&
      typeof entry.arguments === 'object' &&
      entry.arguments !== null &&
      'prompt' in entry.arguments &&
      typeof (entry.arguments as Record<string, unknown>).prompt === 'string' &&
      userMessageContent.includes((entry.arguments as Record<string, unknown>).prompt as string)
    ) {
      const prompt = (entry.arguments as Record<string, unknown>).prompt as string;
      const shortPrompt = prompt.length > 30 ? prompt.slice(0, 30) + '...' : prompt;
      return {
        parentAgent: agent,
        toolCallId: callId,
        reason: `parent=${agent.agent_id.slice(-8)},call=${callId.slice(-8)},prompt="${shortPrompt}"`,
      };
    }
  }
  return null;
}

/**
 * 递归在子智能体列表中查找 Agent 工具调用
 */
function findAgentToolCallInSubAgents(
  subAgents: SubAgent[],
  userMessageContent: string,
): { parentAgent: AgentBase; toolCallId: string; reason: string } | null {
  for (const sub of subAgents) {
    const result = findAgentToolCall(sub, userMessageContent);
    if (result) return result;
    const nested = findAgentToolCallInSubAgents(sub.sub_agents, userMessageContent);
    if (nested) return nested;
  }
  return null;
}

/**
 * 统计 agent（含子智能体）中未完成的 Agent 调用数量
 */
function countPendingAgentCalls(agent: AgentBase): number {
  let count = 0;
  for (const entry of Object.values(agent.tools_call_result_map)) {
    if (entry.tool_name === 'Agent' && !entry.is_finished) count++;
  }
  if ('sub_agents' in agent) {
    for (const sub of (agent as MainAgent | SubAgent).sub_agents) {
      count += countPendingAgentCalls(sub);
    }
  }
  return count;
}

/**
 * 深度比较两个值（用于系统提示词比较）
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 从消息中提取文本内容
 */
function extractTextFromMessage(msg: AnthropicMessage | undefined): string {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    const textBlocks = msg.content
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text as string);
    return textBlocks.join('\n');
  }
  return '';
}

// 导出工具函数（供 classifier 使用）
export { extractTextFromMessage, matchesAgent };
