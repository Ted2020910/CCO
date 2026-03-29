import { Router } from 'express';
import {
  getRecord,
  getRecordsByDate,
  getRecentRecords,
  getRecordsBySession,
  getDailyStats,
  getRecentDailyStats,
  getSessionSummaries,
  getAvailableDates,
} from '../storage/sessions.js';
import { todayString } from '../shared/utils.js';
import type { ApiResponse, StatsResponse } from '../shared/types.js';

export function createApiRouter(): Router {
  const router = Router();

  // ── 统计汇总 ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/stats
   * 返回今日统计 + 最近 7 天 + 全量汇总
   */
  router.get('/stats', (_req, res) => {
    try {
      const today       = getDailyStats(todayString());
      const last7Days   = getRecentDailyStats(7);
      const allDates    = getAvailableDates();
      const allSessions = getSessionSummaries(365);

      const allTime = {
        total_requests: allDates.reduce((sum, d) => sum + getDailyStats(d).total_requests, 0),
        total_cost_usd: allDates.reduce((sum, d) => sum + getDailyStats(d).total_cost_usd, 0),
        total_sessions: new Set(allSessions.map(s => s.sessionId)).size,
      };

      const data: StatsResponse = { today, last7Days, allTime };
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  // ── 记录列表 ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/records?limit=50&offset=0&date=YYYY-MM-DD&sessionId=xxx
   */
  router.get('/records', (req, res) => {
    try {
      const limit     = Math.min(Number(req.query['limit']  ?? 50), 200);
      const offset    = Number(req.query['offset'] ?? 0);
      const date      = req.query['date']      as string | undefined;
      const sessionId = req.query['sessionId'] as string | undefined;

      let records;
      if (sessionId) {
        records = getRecordsBySession(sessionId).slice(offset, offset + limit);
      } else if (date) {
        records = getRecordsByDate(date).slice(offset, offset + limit);
      } else {
        records = getRecentRecords(limit, offset);
      }

      res.json(ok({ records, total: records.length }));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  /**
   * GET /api/records/:id
   */
  router.get('/records/:id', (req, res) => {
    try {
      const record = getRecord(req.params['id']);
      if (!record) return res.status(404).json(fail('Record not found'));
      res.json(ok(record));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  // ── Sessions ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/sessions?days=30
   */
  router.get('/sessions', (req, res) => {
    try {
      const days     = Number(req.query['days'] ?? 30);
      const sessions = getSessionSummaries(days);
      res.json(ok({ sessions }));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  /**
   * GET /api/sessions/:sessionId/records
   */
  router.get('/sessions/:sessionId/records', (req, res) => {
    try {
      const records = getRecordsBySession(req.params['sessionId']);
      res.json(ok({ records }));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  // ── 日期 ─────────────────────────────────────────────────────────────────────

  /**
   * GET /api/dates
   */
  router.get('/dates', (_req, res) => {
    try {
      res.json(ok({ dates: getAvailableDates() }));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  /**
   * GET /api/daily/:date
   */
  router.get('/daily/:date', (req, res) => {
    try {
      const stats = getDailyStats(req.params['date']);
      res.json(ok(stats));
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
