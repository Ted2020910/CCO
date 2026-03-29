import { Router } from 'express';
import type { ApiResponse, Session, SubAgent } from '../shared/types.js';
import { SessionManager } from '../session/index.js';
import { deleteSession, saveSession } from '../storage/session-store.js';

export function createApiRouter(sessionManager: SessionManager): Router {
  const router = Router();

  // ── Sessions 列表 ─────────────────────────────────────────────────────────

  /**
   * GET /api/sessions?days=30
   * 返回 Session 摘要列表
   */
  router.get('/sessions', (req, res) => {
    try {
      const days = Number(req.query['days'] ?? 30);
      const sessions = sessionManager.getAllSessions();
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();

      const summaries = sessions
        .filter(s => s.updated_at >= cutoff)
        .map(s => toSessionSummary(s))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

      res.json(ok({ sessions: summaries }));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  // ── Session 详情 ─────────────────────────────────────────────────────────

  /**
   * GET /api/sessions/:sessionId
   * 返回完整 Session 对象（含嵌套 agent 树）
   */
  router.get('/sessions/:sessionId', (req, res) => {
    try {
      const sessionId = req.params['sessionId'];
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json(fail('Session not found'));
      }
      res.json(ok(session));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  // ── 删除 Session ──────────────────────────────────────────────────────────

  /**
   * DELETE /api/sessions/:sessionId
   * 同时从内存和磁盘删除
   */
  router.delete('/sessions/:sessionId', (req, res) => {
    try {
      const sessionId = req.params['sessionId'];
      sessionManager.removeSession(sessionId);
      deleteSession(sessionId);
      res.json(ok({ deleted: true }));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  // ── 重命名 Session ──────────────────────────────────────────────────────────

  /**
   * PATCH /api/sessions/:sessionId
   * body: { session_name: string }
   * 更新 session_name，同步内存 + 磁盘
   */
  router.patch('/sessions/:sessionId', (req, res) => {
    try {
      const sessionId = req.params['sessionId'];
      const { session_name } = req.body as { session_name?: string };

      if (typeof session_name !== 'string' || session_name.trim().length === 0) {
        return res.status(400).json(fail('session_name is required and cannot be empty'));
      }

      const trimmed = session_name.trim().slice(0, 10);
      const updated = sessionManager.renameSession(sessionId, trimmed);
      if (!updated) {
        return res.status(404).json(fail('Session not found'));
      }

      // 同步到磁盘
      const session = sessionManager.getSession(sessionId);
      if (session) saveSession(session);

      res.json(ok({ session_id: sessionId, session_name: trimmed }));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  return router;
}

// ─── 工具 ────────────────────────────────────────────────────────────────────

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

function fail(err: unknown): ApiResponse<never> {
  return {
    success: false,
    error: err instanceof Error ? err.message : String(err),
  };
}

/**
 * 将 Session 转换为 SessionSummary（API 返回用）
 */
function toSessionSummary(session: Session) {
  return {
    session_id: session.session_id,
    session_name: session.session_name,
    created_at: session.created_at,
    updated_at: session.updated_at,
    stats: {
      ...session.stats,
      conversation_rounds: countConversationRounds(session),
      sub_agent_count: countSubAgents(session.main_agent.sub_agents),
      compression_count: session.main_agent.session_history_list.length,
    },
  };
}

/**
 * 统计对话轮次（user message 数量）
 */
function countConversationRounds(session: Session): number {
  return session.main_agent.current_messages
    .filter(m => m.role === 'user')
    .length;
}

/**
 * 递归统计子智能体数量
 */
function countSubAgents(subs: SubAgent[]): number {
  let count = subs.length;
  for (const sub of subs) {
    count += countSubAgents(sub.sub_agents);
  }
  return count;
}
