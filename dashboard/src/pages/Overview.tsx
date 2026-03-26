import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { StatsResponse } from '../types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(usd: number) {
  return `$${usd.toFixed(4)}`;
}

export default function Overview() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading]  = useState(true);
  const [error, setError]      = useState<string | null>(null);

  useEffect(() => {
    api.stats()
      .then(setStats)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">加载中...</div>;
  if (error)   return <div className="error">⚠️ {error}</div>;
  if (!stats)  return null;

  const { today, last7Days, allTime } = stats;

  const chartData = last7Days.map(d => ({
    date:    d.date.slice(5),   // MM-DD
    requests: d.total_requests,
    cost:    Number(d.total_cost_usd.toFixed(4)),
    tokens:  d.total_input_tokens + d.total_output_tokens,
  }));

  return (
    <div className="page">
      <h1 className="page-title">📊 总览</h1>

      {/* 今日统计卡片 */}
      <section>
        <h2 className="section-title">今日</h2>
        <div className="stat-grid">
          <StatCard label="请求次数" value={today.total_requests} />
          <StatCard label="输入 Token" value={fmt(today.total_input_tokens)} />
          <StatCard label="输出 Token" value={fmt(today.total_output_tokens)} />
          <StatCard label="预计费用"  value={fmtCost(today.total_cost_usd)} accent />
          <StatCard label="活跃 Session" value={today.sessions.length} />
        </div>
      </section>

      {/* 累计统计 */}
      <section>
        <h2 className="section-title">累计</h2>
        <div className="stat-grid">
          <StatCard label="总请求次数" value={allTime.total_requests} />
          <StatCard label="总 Session 数" value={allTime.total_sessions} />
          <StatCard label="总费用" value={fmtCost(allTime.total_cost_usd)} accent />
        </div>
      </section>

      {/* 近 7 天图表 */}
      {chartData.length > 0 && (
        <section>
          <h2 className="section-title">近 7 天趋势</h2>
          <div className="chart-row">
            <div className="chart-card">
              <h3>每日请求数</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="requests" fill="#6366f1" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-card">
              <h3>每日费用 (USD)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => [`$${v}`, 'Cost']} />
                  <Bar dataKey="cost" fill="#10b981" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* 今日使用的模型 */}
      {Object.keys(today.models).length > 0 && (
        <section>
          <h2 className="section-title">今日模型分布</h2>
          <div className="model-list">
            {Object.entries(today.models)
              .sort((a, b) => b[1] - a[1])
              .map(([model, count]) => (
                <div key={model} className="model-row">
                  <span className="model-name">{model}</span>
                  <span className="model-count">{count} 次</span>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className={`stat-card${accent ? ' stat-card--accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
