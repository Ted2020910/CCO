import { generateId } from '../shared/utils.js';
export class SessionManager {
    sessions = new Map();
    // ── 查询 ────────────────────────────────────────────────────────────────────
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    getAllSessions() {
        return [...this.sessions.values()];
    }
    // ── 创建 Session ─────────────────────────────────────────────────────────────
    /**
     * 创建新 Session + MainAgent
     * 首次请求时调用
     */
    createSession(sessionId, sysPrompt, messages, tools) {
        const now = new Date().toISOString();
        // 提取首条 user message 的最后一个 text block 作为默认 session_name
        const firstUserMsg = messages.find(m => m.role === 'user');
        let defaultName = 'Untitled Session';
        if (firstUserMsg) {
            if (typeof firstUserMsg.content === 'string') {
                defaultName = firstUserMsg.content;
            }
            else if (Array.isArray(firstUserMsg.content)) {
                const textBlocks = firstUserMsg.content.filter(b => b.type === 'text' && b.text);
                if (textBlocks.length > 0) {
                    defaultName = textBlocks[textBlocks.length - 1].text || 'Untitled Session';
                }
            }
        }
        // session_name 最多 10 个字符
        if (defaultName.length > 10) {
            defaultName = defaultName.slice(0, 10);
        }
        const mainAgent = {
            agent_id: generateId(),
            current_sys_prompt: sysPrompt,
            current_messages: [], // 由每次请求全量同步
            tools,
            tools_call_result_map: {},
            session_history_list: [],
            sub_agents: [],
        };
        const session = {
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
    loadSession(session) {
        this.sessions.set(session.session_id, session);
    }
    // ── Agent 匹配 ──────────────────────────────────────────────────────────────
    /**
     * 在 session 中查找与 (sysPrompt, messageHistory) 匹配的 agent
     * messageHistory = request.messages[:-1]（去掉最后一条消息）
     * 返回匹配到的 agent + 原因，或 null + 失败原因
     */
    findMatchingAgent(session, sysPrompt, messageHistory) {
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
        const reasons = [`main(${mainResult.reason})`];
        if (subResult.reason) {
            reasons.push(subResult.reason);
        }
        return { agent: null, reason: reasons.join(', ') };
    }
    /**
     * 判断请求是否匹配主智能体，返回带诊断信息的结果
     */
    matchesMainAgent(session, sysPrompt, messageHistory) {
        return matchesAgent(session.main_agent, sysPrompt, messageHistory);
    }
    // ── 子智能体 ────────────────────────────────────────────────────────────────
    /**
     * 查找能关联到新子智能体的父 agent
     * 遍历所有 agent 的 tools_call_result_map，找到：
     *   tool_name == "Agent" && is_finished == false && arguments.prompt IN userMessage
     * 返回匹配结果 + 诊断原因
     */
    findParentForSubAgent(session, firstUserMessageContent) {
        // 检查主智能体
        const mainResult = findAgentToolCall(session.main_agent, firstUserMessageContent);
        if (mainResult)
            return mainResult;
        // 递归检查所有子智能体
        const subResult = findAgentToolCallInSubAgents(session.main_agent.sub_agents, firstUserMessageContent);
        if (subResult)
            return subResult;
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
    createSubAgent(parentAgent, toolCallId, prompt, sysPrompt, messages, tools) {
        const subAgent = {
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
            parentAgent.sub_agents.push(subAgent);
        }
        return subAgent;
    }
    /**
     * 在响应阶段检测到 Agent tool_use 时，立即创建占位子智能体
     * agent_id = toolCallId，占位节点 messages/tools/sys_prompt 为空
     */
    createPlaceholderSubAgent(parentAgent, toolCallId, prompt) {
        const subAgent = {
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
            parentAgent.sub_agents.push(subAgent);
        }
        return subAgent;
    }
    /**
     * 在 agent 的直接 sub_agents 中按 agent_id（= tool_call_id）查找
     * 用于将已有占位节点与后续到达的真实请求关联
     */
    findSubAgentByToolCallId(parentAgent, toolCallId) {
        if (!('sub_agents' in parentAgent))
            return null;
        const subs = parentAgent.sub_agents;
        return subs.find(s => s.agent_id === toolCallId) ?? null;
    }
    /**
     * 标记子智能体为已完成
     * 在 agent 的 sub_agents 中按 agent_id（= tool_call_id）查找并更新
     */
    markSubAgentFinished(agent, toolCallId) {
        if (!('sub_agents' in agent))
            return;
        const subs = agent.sub_agents;
        const sub = subs.find(s => s.agent_id === toolCallId);
        if (sub) {
            sub.is_finished = true;
        }
    }
    // ── 重命名 Session ──────────────────────────────────────────────────────────
    renameSession(sessionId, newName) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        // session_name 最多 10 个字符
        session.session_name = newName.length > 10 ? newName.slice(0, 10) : newName;
        session.updated_at = new Date().toISOString();
        return true;
    }
    // ── 删除 Session（内存） ──────────────────────────────────────────────────────
    removeSession(sessionId) {
        return this.sessions.delete(sessionId);
    }
    // ── 更新时间戳 ──────────────────────────────────────────────────────────────
    touch(session) {
        session.updated_at = new Date().toISOString();
    }
    // ── 统计更新 ─────────────────────────────────────────────────────────────────
    updateStats(session, model) {
        const s = session.stats;
        s.total_requests++;
        s.models_used[model] = (s.models_used[model] ?? 0) + 1;
    }
}
// ============================================================================
// 内部工具函数
// ============================================================================
function createEmptyStats() {
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
function matchesAgent(agent, sysPrompt, messageHistory) {
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
function deepEqualIgnoreCache(a, b) {
    return JSON.stringify(a, cacheReplacer) === JSON.stringify(b, cacheReplacer);
}
function cacheReplacer(key, value) {
    if (key === 'cache_control')
        return undefined;
    return value;
}
/**
 * 递归在子智能体列表中查找匹配的 agent
 */
function findInSubAgents(subAgents, sysPrompt, messageHistory) {
    const failReasons = [];
    for (const sub of subAgents) {
        const result = matchesAgent(sub, sysPrompt, messageHistory);
        if (result.matched) {
            return { agent: sub, reason: `sub:${sub.agent_id.slice(-8)}(${result.reason})` };
        }
        failReasons.push(`sub:${sub.agent_id.slice(-8)}(${result.reason})`);
        // 递归检查子智能体的子智能体
        const nested = findInSubAgents(sub.sub_agents, sysPrompt, messageHistory);
        if (nested.agent)
            return nested;
        if (nested.reason)
            failReasons.push(nested.reason);
    }
    return { agent: null, reason: failReasons.length > 0 ? failReasons.join(', ') : '' };
}
/**
 * 在 agent 的 tools_call_result_map 中查找 Agent 工具调用
 */
function findAgentToolCall(agent, userMessageContent) {
    for (const [callId, entry] of Object.entries(agent.tools_call_result_map)) {
        if (entry.tool_name === 'Agent' &&
            !entry.is_finished &&
            typeof entry.arguments === 'object' &&
            entry.arguments !== null &&
            'prompt' in entry.arguments &&
            typeof entry.arguments.prompt === 'string' &&
            userMessageContent.includes(entry.arguments.prompt)) {
            const prompt = entry.arguments.prompt;
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
function findAgentToolCallInSubAgents(subAgents, userMessageContent) {
    for (const sub of subAgents) {
        const result = findAgentToolCall(sub, userMessageContent);
        if (result)
            return result;
        const nested = findAgentToolCallInSubAgents(sub.sub_agents, userMessageContent);
        if (nested)
            return nested;
    }
    return null;
}
/**
 * 统计 agent（含子智能体）中未完成的 Agent 调用数量
 */
function countPendingAgentCalls(agent) {
    let count = 0;
    for (const entry of Object.values(agent.tools_call_result_map)) {
        if (entry.tool_name === 'Agent' && !entry.is_finished)
            count++;
    }
    if ('sub_agents' in agent) {
        for (const sub of agent.sub_agents) {
            count += countPendingAgentCalls(sub);
        }
    }
    return count;
}
/**
 * 深度比较两个值（用于系统提示词比较）
 */
function deepEqual(a, b) {
    if (a === b)
        return true;
    if (a == null || b == null)
        return a == b;
    return JSON.stringify(a) === JSON.stringify(b);
}
/**
 * 从消息中提取文本内容
 */
function extractTextFromMessage(msg) {
    if (!msg)
        return '';
    if (typeof msg.content === 'string')
        return msg.content;
    if (Array.isArray(msg.content)) {
        const textBlocks = msg.content
            .filter(b => b.type === 'text' && b.text)
            .map(b => b.text);
        return textBlocks.join('\n');
    }
    return '';
}
// 导出工具函数（供 classifier 使用）
export { extractTextFromMessage, matchesAgent };
