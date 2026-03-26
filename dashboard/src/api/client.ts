// Dashboard API 客户端
import type {
  ApiResponse,
  StatsResponse,
  RequestRecord,
  SessionSummary,
  DailyStats,
} from '../types';

const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const json: ApiResponse<T> = await res.json();
  if (!json.success) throw new Error(json.error ?? 'API Error');
  return json.data as T;
}

export const api = {
  /** 总体统计 */
  stats: () => get<StatsResponse>('/stats'),

  /** 最近记录列表 */
  records: (params?: { limit?: number; offset?: number; date?: string; sessionId?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit)     q.set('limit',     String(params.limit));
    if (params?.offset)    q.set('offset',    String(params.offset));
    if (params?.date)      q.set('date',      params.date);
    if (params?.sessionId) q.set('sessionId', params.sessionId);
    return get<{ records: RequestRecord[]; total: number }>(`/records?${q}`);
  },

  /** 单条记录详情 */
  record: (id: string) => get<RequestRecord>(`/records/${id}`),

  /** Session 列表 */
  sessions: (days = 30) => get<{ sessions: SessionSummary[] }>(`/sessions?days=${days}`),

  /** 某 session 的所有记录 */
  sessionRecords: (sessionId: string) =>
    get<{ records: RequestRecord[] }>(`/sessions/${sessionId}/records`),

  /** 某天统计 */
  daily: (date: string) => get<DailyStats>(`/daily/${date}`),

  /** 所有有数据的日期 */
  dates: () => get<{ dates: string[] }>('/dates'),
};
