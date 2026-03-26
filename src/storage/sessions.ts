import fs from 'fs';
import path from 'path';
import { readConfig, getDataDir } from './config.js';
import type { RequestRecord, DailyStats, SessionSummary } from '../shared/types.js';

// ─── 写入 ────────────────────────────────────────────────────────────────────

/** 保存（新建或更新）一条请求记录 */
export function saveRecord(record: RequestRecord): void {
  const dir = getDataDir(record.timestamp.slice(0, 10));
  ensureDir(dir);
  const filePath = path.join(dir, `${record.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
}

// ─── 读取 ────────────────────────────────────────────────────────────────────

/** 读取单条记录（不知道日期时全局搜索） */
export function getRecord(id: string, date?: string): RequestRecord | null {
  const dates = date ? [date] : getAvailableDates();
  for (const d of dates) {
    const filePath = path.join(getDataDir(d), `${id}.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RequestRecord;
    }
  }
  return null;
}

/** 读取某天所有记录（按时间升序） */
export function getRecordsByDate(date: string): RequestRecord[] {
  const dir = getDataDir(date);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .flatMap(f => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as RequestRecord];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** 分页读取记录（跨日期，降序） */
export function getRecentRecords(limit = 50, offset = 0): RequestRecord[] {
  const all: RequestRecord[] = [];
  for (const date of [...getAvailableDates()].reverse()) {
    all.push(...getRecordsByDate(date));
    if (all.length >= offset + limit) break;
  }
  return all
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(offset, offset + limit);
}

/** 读取某个 session 的所有记录 */
export function getRecordsBySession(sessionId: string): RequestRecord[] {
  const all: RequestRecord[] = [];
  for (const date of getAvailableDates()) {
    all.push(...getRecordsByDate(date).filter(r => r.sessionId === sessionId));
  }
  return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ─── 统计 ────────────────────────────────────────────────────────────────────

/** 计算某天的统计数据 */
export function getDailyStats(date: string): DailyStats {
  const records = getRecordsByDate(date).filter(r => r.status === 'completed');
  const sessionSet = new Set<string>();
  const models: Record<string, number> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  for (const r of records) {
    totalInputTokens  += r.usage?.input_tokens  ?? 0;
    totalOutputTokens += r.usage?.output_tokens ?? 0;
    totalCostUsd      += r.cost?.total_usd      ?? 0;
    sessionSet.add(r.sessionId);
    models[r.model] = (models[r.model] ?? 0) + 1;
  }

  return {
    date,
    total_requests:      records.length,
    total_input_tokens:  totalInputTokens,
    total_output_tokens: totalOutputTokens,
    total_cost_usd:      round8(totalCostUsd),
    sessions:            [...sessionSet],
    models,
  };
}

/** 获取最近 N 天的统计（只返回有数据的天） */
export function getRecentDailyStats(days = 7): DailyStats[] {
  return getAvailableDates()
    .slice(-days)
    .map(date => getDailyStats(date))
    .filter(s => s.total_requests > 0);
}

/** 获取 Session 摘要列表（最近 N 天，按最后调用降序） */
export function getSessionSummaries(days = 30): SessionSummary[] {
  const sessionMap = new Map<string, SessionSummary>();

  for (const date of getAvailableDates().slice(-days)) {
    for (const r of getRecordsByDate(date)) {
      if (r.status !== 'completed') continue;

      const s = sessionMap.get(r.sessionId);
      if (!s) {
        sessionMap.set(r.sessionId, {
          sessionId:         r.sessionId,
          firstCall:         r.timestamp,
          lastCall:          r.timestamp,
          totalRequests:     1,
          totalInputTokens:  r.usage?.input_tokens  ?? 0,
          totalOutputTokens: r.usage?.output_tokens ?? 0,
          totalCostUsd:      r.cost?.total_usd      ?? 0,
          models:            r.model ? [r.model] : [],
        });
      } else {
        if (r.timestamp > s.lastCall)  s.lastCall  = r.timestamp;
        if (r.timestamp < s.firstCall) s.firstCall = r.timestamp;
        s.totalRequests++;
        s.totalInputTokens  += r.usage?.input_tokens  ?? 0;
        s.totalOutputTokens += r.usage?.output_tokens ?? 0;
        s.totalCostUsd      += r.cost?.total_usd      ?? 0;
        if (r.model && !s.models.includes(r.model)) s.models.push(r.model);
      }
    }
  }

  return [...sessionMap.values()]
    .sort((a, b) => b.lastCall.localeCompare(a.lastCall));
}

// ─── 工具 ────────────────────────────────────────────────────────────────────

/** 获取所有可用日期目录（升序） */
export function getAvailableDates(): string[] {
  const { dataDir } = readConfig();
  if (!fs.existsSync(dataDir)) return [];

  return fs.readdirSync(dataDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
