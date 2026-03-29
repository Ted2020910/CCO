import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { api } from '../api/client';
import { getCache, setCache } from '../hooks/useLocalCache';
import type { SessionSummary } from '../types';

const CACHE_KEY = 'overview-sessions';

export default function Overview() {
  const navigate = useNavigate();
  // 懒初始化：优先从缓存恢复，避免白屏
  const [sessions, setSessions] = useState<SessionSummary[]>(
    () => getCache<SessionSummary[]>(CACHE_KEY) ?? []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sessions(30)
      .then(d => {
        setSessions(d.sessions);
        setCache(CACHE_KEY, d.sessions); // 成功后写入缓存
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // 有缓存时不阻塞渲染，直接显示缓存内容
  const hasCachedData = sessions.length > 0;
  if (loading && !hasCachedData) return <div className="loading">加载中...</div>;
  if (error && !hasCachedData) return <div className="error">{error}</div>;

  const totalRequests = sessions.reduce((sum, s) => sum + s.stats.total_requests, 0);

  return (
    <div className="page">
      <h1 className="page-title"><LayoutDashboard /> 总览</h1>
      <p className="page-sub">最近 30 天概览</p>

      <section>
        <h2 className="section-title">统计</h2>
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Session 数</div>
            <div className="stat-value">{sessions.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">总请求数</div>
            <div className="stat-value">{totalRequests}</div>
          </div>
        </div>
      </section>

      {sessions.length > 0 && (
        <section>
          <h2 className="section-title">最近会话</h2>
          <div className="recent-sessions">
            {sessions.slice(0, 5).map(s => (
              <div
                key={s.session_id}
                className="recent-session-row"
                onClick={() => navigate(`/sessions/${s.session_id}`)}
              >
                <span className="session-name">{s.session_name || '未命名会话'}</span>
                <span className="session-date">
                  {new Date(s.updated_at).toLocaleString('zh-CN')}
                </span>
                <span className="session-requests">{s.stats.total_requests} 请求</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
