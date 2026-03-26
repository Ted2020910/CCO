import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { SessionSummary } from '../types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)    return '刚刚';
  if (m < 60)   return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export default function Sessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api.sessions(30)
      .then(d => setSessions(d.sessions))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">加载中...</div>;
  if (error)   return <div className="error">⚠️ {error}</div>;

  return (
    <div className="page">
      <h1 className="page-title">💬 Sessions</h1>
      <p className="page-sub">最近 30 天的 Claude Code 会话（共 {sessions.length} 个）</p>

      {sessions.length === 0 ? (
        <div className="empty">
          <p>暂无数据</p>
          <p className="hint">运行 <code>cco init</code> 并配置 ANTHROPIC_BASE_URL 后开始使用</p>
        </div>
      ) : (
        <div className="session-list">
          {sessions.map(s => (
            <div
              key={s.sessionId}
              className={`session-card${selected === s.sessionId ? ' session-card--active' : ''}`}
              onClick={() => setSelected(s.sessionId === selected ? null : s.sessionId)}
            >
              <div className="session-header">
                <span className="session-id" title={s.sessionId}>
                  {s.sessionId.slice(0, 8)}…
                </span>
                <span className="session-time">{timeAgo(s.lastCall)}</span>
              </div>
              <div className="session-stats">
                <span>{s.totalRequests} 次请求</span>
                <span>{((s.totalInputTokens + s.totalOutputTokens) / 1000).toFixed(1)}K tokens</span>
                <span className="cost">${s.totalCostUsd.toFixed(4)}</span>
              </div>
              <div className="session-models">
                {s.models.map(m => <span key={m} className="model-tag">{m}</span>)}
              </div>

              {selected === s.sessionId && (
                <SessionDetail sessionId={s.sessionId} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const [records, setRecords] = useState<Array<{ id: string; timestamp: string; model: string; status: string; usage?: { input_tokens: number; output_tokens: number }; cost?: { total_usd: number }; duration_ms?: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.sessionRecords(sessionId)
      .then(d => setRecords(d.records))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <div className="loading-small">加载记录中...</div>;

  return (
    <div className="session-detail">
      <h4>请求记录</h4>
      <table className="record-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>模型</th>
            <th>输入 Token</th>
            <th>输出 Token</th>
            <th>费用</th>
            <th>耗时</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => (
            <tr key={r.id}>
              <td>{new Date(r.timestamp).toLocaleTimeString()}</td>
              <td><span className="model-tag">{r.model}</span></td>
              <td>{r.usage?.input_tokens ?? '-'}</td>
              <td>{r.usage?.output_tokens ?? '-'}</td>
              <td>{r.cost ? `$${r.cost.total_usd.toFixed(5)}` : '-'}</td>
              <td>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '-'}</td>
              <td>
                <span className={`status status--${r.status}`}>{r.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
