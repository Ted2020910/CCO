import fs from 'fs';
import path from 'path';
import { getSessionsDir } from './config.js';
// ============================================================================
// Session 持久化 - 将 Session 对象存储到 ~/.cco/sessions/{session_id}.json
// ============================================================================
/**
 * 保存 Session 到磁盘
 */
export function saveSession(session) {
    const dir = getSessionsDir();
    ensureDir(dir);
    const filePath = path.join(dir, `${session.session_id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}
/**
 * 从磁盘加载单个 Session
 */
export function loadSession(sessionId) {
    const filePath = path.join(getSessionsDir(), `${sessionId}.json`);
    if (!fs.existsSync(filePath))
        return null;
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const session = JSON.parse(raw);
        migrateSession(session);
        return session;
    }
    catch {
        return null;
    }
}
/**
 * 加载所有 Session（服务器启动时调用）
 */
export function loadAllSessions() {
    const dir = getSessionsDir();
    if (!fs.existsSync(dir))
        return [];
    const sessions = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json'))
            continue;
        try {
            const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
            const session = JSON.parse(raw);
            migrateSession(session);
            sessions.push(session);
        }
        catch {
            // 跳过损坏的文件
        }
    }
    return sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
/**
 * 列出所有 session ID
 */
export function listSessionIds() {
    const dir = getSessionsDir();
    if (!fs.existsSync(dir))
        return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
}
/**
 * 删除 Session 文件
 */
export function deleteSession(sessionId) {
    const filePath = path.join(getSessionsDir(), `${sessionId}.json`);
    if (!fs.existsSync(filePath))
        return false;
    fs.unlinkSync(filePath);
    return true;
}
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
// ============================================================================
// 数据迁移 — 为旧版 Session 补充新增字段
// ============================================================================
/**
 * 迁移 Session 数据：
 * - v1 → v2: 补充 SubAgent 的 prompt / is_finished 字段
 * - v2 → v3: 移除 parent_tool_call_id，将其值迁移到 agent_id
 */
function migrateSession(session) {
    migrateAgentSubAgents(session.main_agent, session.main_agent);
}
/**
 * 递归迁移 agent 树中的所有 SubAgent
 */
function migrateAgentSubAgents(agent, parentAgent) {
    if (!('sub_agents' in agent))
        return;
    const typedAgent = agent;
    for (const sub of typedAgent.sub_agents) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = sub;
        // v2→v3 迁移：如果有 parent_tool_call_id，将其迁移到 agent_id 并删除旧字段
        if (raw.parent_tool_call_id) {
            raw.agent_id = raw.parent_tool_call_id;
            delete raw.parent_tool_call_id;
        }
        // 用 agent_id 作为 key 查找父 agent 的 tool call 信息
        const toolCallId = sub.agent_id;
        // v1→v2 迁移：补充 prompt 字段
        if (raw.prompt === undefined || raw.prompt === null) {
            const entry = parentAgent.tools_call_result_map[toolCallId];
            if (entry && entry.tool_name === 'Agent') {
                const args = entry.arguments;
                raw.prompt = typeof args.prompt === 'string' ? args.prompt : '';
            }
            else {
                raw.prompt = '';
            }
        }
        // v1→v2 迁移：补充 is_finished 字段
        if (raw.is_finished === undefined || raw.is_finished === null) {
            const entry = parentAgent.tools_call_result_map[toolCallId];
            raw.is_finished = entry ? entry.is_finished : false;
        }
        // 递归处理嵌套子智能体
        migrateAgentSubAgents(sub, sub);
    }
}
