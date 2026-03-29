// Dashboard API 客户端
import type {
  ApiResponse,
  SessionSummary,
  Session,
} from '../types';

const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const json: ApiResponse<T> = await res.json();
  if (!json.success) throw new Error(json.error ?? 'API Error');
  return json.data as T;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  const json: ApiResponse<T> = await res.json();
  if (!json.success) throw new Error(json.error ?? 'API Error');
  return json.data as T;
}

async function patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: ApiResponse<T> = await res.json();
  if (!json.success) throw new Error(json.error ?? 'API Error');
  return json.data as T;
}

export const api = {
  /** Session 列表 */
  sessions: (days = 30) => get<{ sessions: SessionSummary[] }>(`/sessions?days=${days}`),

  /** Session 详情（完整 agent 树） */
  sessionDetail: (sessionId: string) => get<Session>(`/sessions/${sessionId}`),

  /** 删除 Session */
  deleteSession: (sessionId: string) => del<{ deleted: boolean }>(`/sessions/${sessionId}`),

  /** 重命名 Session */
  renameSession: (sessionId: string, newName: string) =>
    patch<{ session_id: string; session_name: string }>(`/sessions/${sessionId}`, { session_name: newName }),
};
