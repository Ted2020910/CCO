import type {
  Session,
  AnthropicMessage,
  AnthropicContentBlock,
  Classification,
  ClassificationType,
  AgentBase,
} from '../shared/types.js';
import { SessionManager, extractTextFromMessage } from './manager.js';

// ============================================================================
// 请求分类器 - 实现 docs/claude code 场景分析.md 中的决策树
// ============================================================================

/**
 * 请求体中与分类相关的字段
 */
export interface RequestForClassification {
  system?: unknown;
  messages: AnthropicMessage[];
  tools?: unknown[];
}

/**
 * 对请求进行分类
 *
 * 决策树：
 *   Step 1: 先检测特殊请求（不依赖 session 是否存在）
 *     压缩指令 → compression（session 不存在时也能正确识别）
 *     （suggestion 不再特殊处理，走正常分类流程，由全量同步保证下次请求覆盖）
 *   Step 2: session 是否存在？
 *     不存在 + 有 tools → main_agent（创建 Session）
 *     不存在 + 无 tools → unclassified
 *   Step 3: tools 为空？
 *     → unclassified（命名等辅助请求）
 *   Step 3.5: 压缩恢复状态？
 *     session.pending_compression_summary === true → main_agent（压缩恢复）
 *   Step 4: (sys_prompt, messages[:-1]) 匹配已有 agent？
 *     匹配主智能体 → main_agent
 *     匹配某个子智能体 → sub_agent_continue
 *   Step 5: 是否有未完成的 Agent 工具调用？
 *     有 → 根据 prompt 参数匹配 → sub_agent_new
 *     没有 → 继续 Step 6
 *   Step 6: 兜底（带 tools 且 Step 4/5 都无法归属子智能体）
 *     → main_agent（只可能是 sys_prompt 动态内容变化导致 Step 4 失败）
 */
export function classifyRequest(
  session: Session | undefined,
  requestBody: RequestForClassification,
  manager: SessionManager,
  sessionId: string,
): Classification {
  const { system: sysPrompt, messages, tools } = requestBody;

  const lastMessage = messages[messages.length - 1];

  // ── Step 1: 先检测特殊请求（无论 session 是否存在） ────────────────────────
  // 必须在 Step 2 之前，否则 CCO 中途启动时首个请求恰好是压缩，会被误分类为 main_agent
  // 注意：
  //   1. 只检查最后一条消息的 text blocks，不检查 tool_result
  //      压缩指令一定在 user 消息的 text block 中，而不是 tool_result 中
  //      如果检查 tool_result，读取包含压缩关键词的文件内容会导致误判
  //   2. 必须有 tools → 真正的压缩请求一定携带 tools
  //      没有 tools 的辅助请求（命名、count_tokens 等）可能碰巧携带相同的消息历史
  const hasTools = tools && Array.isArray(tools) && tools.length > 0;

  // 额外守卫：如果 session 已处于压缩恢复等待状态（pending_compression_summary === true），
  // 跳过 Step 1 的压缩检测，让请求正常走到 Step 3.5 进行恢复。
  // 原因：压缩后 CC 发送的恢复请求中，最后一条 user message 可能仍然回显压缩指令文本，
  // 如果不守卫会导致同一个 session 连续触发两次压缩。
  if (hasTools && lastMessage && lastMessage.role === 'user' && !session?.pending_compression_summary) {
    const lastTextOnly = getTextOnlyContent(lastMessage);

    if (lastTextOnly.includes('Your task is to create a detailed summary of the conversation so far')) {
      // session 可能不存在（CCO 中途启动），agent 字段允许为 undefined
      return { type: 'compression', agent: session?.main_agent, reason: 'step1 compression_keyword' };
    }
  }

  // ── Step 2: Session 是否存在？ ──────────────────────────────────────────────
  if (!session) {
    if (hasTools) {
      return { type: 'main_agent', reason: 'step2 new_session' };
    }
    return { type: 'unclassified', reason: 'step2 no_session_no_tools' };
  }

  const messageHistory = messages.slice(0, -1);

  // ── Step 3: tools 为空 → 辅助请求（命名等），忽略 ──────────────────────────
  if (!hasTools) {
    return { type: 'unclassified', reason: 'step3 no_tools' };
  }

  // ── Step 3.5: 压缩恢复状态？ ─────────────────────────────────────────────
  // 压缩后 sys_prompt 和 messages 已清空，pending_compression_summary 标记为 true
  // 下一个带 tools 的请求即为主智能体恢复
  if (session.pending_compression_summary) {
    return { type: 'main_agent', agent: session.main_agent, reason: 'step3.5 compression_recovery' };
  }

  // ── Step 4: 匹配已有 agent（sys_prompt + messages[:-1]） ──────────────────
  const mainMatch = manager.matchesMainAgent(session, sysPrompt, messageHistory);
  if (mainMatch.matched) {
    return { type: 'main_agent', agent: session.main_agent, reason: `step4 main(${mainMatch.reason})` };
  }

  const agentMatch = manager.findMatchingAgent(session, sysPrompt, messageHistory);
  if (agentMatch.agent && agentMatch.agent !== session.main_agent) {
    return { type: 'sub_agent_continue', agent: agentMatch.agent, reason: `step4 ${agentMatch.reason}` };
  }

  // Step 4 全部失败，记录原因，继续 Step 5
  const step4Reason = agentMatch.reason;

  // ── Step 5: 是否存在未完成的 Agent 工具调用？ ─────────────────────────────
  // 只有当某个 agent 调用了 Agent 工具且尚未返回结果时，才可能是新子智能体
  const firstMessageContent = getFirstUserMessageText(
    lastMessage ? [...messageHistory, lastMessage] : messageHistory,
  );

  if (firstMessageContent) {
    const parentResult = manager.findParentForSubAgent(session, firstMessageContent);
    if (parentResult.parentAgent) {
      return {
        type: 'sub_agent_new',
        parentAgent: parentResult.parentAgent,
        toolCallId: parentResult.toolCallId,
        reason: `step5 new_sub(${parentResult.reason})`,
      };
    }
    // ── Step 6: 兜底 → 主智能体 ──────────────────────────────────────────────
    // 带 tools 的请求只可能是主智能体或 general sub-agent
    // general sub-agent 一定有 pending Agent 调用（Step 5 已排除）→ 只能是主智能体
    return {
      type: 'main_agent',
      agent: session.main_agent,
      reason: `step6 fallback_main(${step4Reason} → ${parentResult.reason})`,
    };
  }

  // Step 6 兜底（无 firstMessageContent 时同理）
  return {
    type: 'main_agent',
    agent: session.main_agent,
    reason: `step6 fallback_main(${step4Reason} → no_user_message)`,
  };
}

// ============================================================================
// 文本提取工具
// ============================================================================

/**
 * 从 Anthropic system 字段（数组或字符串）中提取纯文本
 * 用于压缩恢复时的摘要匹配
 */
function extractSystemText(system: unknown): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .filter((b: unknown) => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'text' && typeof (b as Record<string, unknown>).text === 'string')
      .map((b: unknown) => (b as Record<string, string>).text)
      .join('\n');
  }
  return '';
}

/**
 * 仅提取消息中 text 类型 block 的文本（不包含 tool_result）
 * 用于压缩指令检测，避免 tool_result 中的文件内容导致误判
 */
function getTextOnlyContent(msg: AnthropicMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text)
      .join('\n');
  }
  return '';
}

/**
 * 提取消息的完整文本内容（包括所有 text blocks 和 tool_result）
 */
function getFullMessageText(msg: AnthropicMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map(block => {
        if (block.type === 'text' && block.text) return block.text;
        if (block.type === 'tool_result' && typeof block.content === 'string') return block.content;
        return '';
      })
      .join('\n');
  }
  return '';
}

/**
 * 获取 messages 中首条 user message 的文本内容
 * 用于子智能体关联（prompt IN user_message 匹配）
 */
function getFirstUserMessageText(messages: AnthropicMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  return firstUser ? getFullMessageText(firstUser) : '';
}

export { getFullMessageText, extractSystemText };
