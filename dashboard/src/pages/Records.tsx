import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { RequestRecord } from '../types';

export default function Records() {
  const [searchParams] = useSearchParams();
  const dateFilter      = searchParams.get('date') ?? undefined;

  const [records, setRecords] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.records({ limit: 100, date: dateFilter })
      .then(d => setRecords(d.records))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [dateFilter]);

  if (loading) return <div className="loading">加载中...</div>;
  if (error)   return <div className="error">⚠️ {error}</div>;

  const detail = selected ? records.find(r => r.id === selected) : null;

  return (
    <div className="page records-layout">
      {/* 列表面板 */}
      <div className="records-list">
        <h1 className="page-title">📋 请求记录</h1>
        {records.length === 0 ? (
          <div className="empty"><p>暂无记录</p></div>
        ) : (
          <div className="record-cards">
            {records.map(r => (
              <div
                key={r.id}
                className={`record-item${selected === r.id ? ' record-item--active' : ''}`}
                onClick={() => setSelected(r.id)}
              >
                <div className="record-item-header">
                  <span className="model-tag">{r.model}</span>
                  <span className={`status status--${r.status}`}>{r.status}</span>
                </div>
                <div className="record-item-meta">
                  <span>{new Date(r.timestamp).toLocaleString()}</span>
                  {r.cost && <span className="cost">${r.cost.total_usd.toFixed(5)}</span>}
                </div>
                {r.usage && (
                  <div className="record-item-tokens">
                    ↑{r.usage.input_tokens} / ↓{r.usage.output_tokens} tokens
                    {r.duration_ms && <span> · {(r.duration_ms / 1000).toFixed(1)}s</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 详情面板 */}
      {detail && (
        <div className="record-detail">
          <div className="detail-header">
            <h2>请求详情</h2>
            <button className="close-btn" onClick={() => setSelected(null)}>✕</button>
          </div>

          <div className="detail-meta">
            <MetaRow label="ID"       value={detail.id} />
            <MetaRow label="Session"  value={detail.sessionId} />
            <MetaRow label="模型"     value={detail.model} />
            <MetaRow label="端点"     value={detail.endpoint} />
            <MetaRow label="时间"     value={new Date(detail.timestamp).toLocaleString()} />
            <MetaRow label="状态"     value={detail.status} />
            {detail.duration_ms && <MetaRow label="耗时" value={`${detail.duration_ms}ms`} />}
          </div>

          {detail.usage && (
            <div className="detail-section">
              <h3>Token 用量</h3>
              <div className="token-grid">
                <div><span>输入</span><strong>{detail.usage.input_tokens}</strong></div>
                <div><span>输出</span><strong>{detail.usage.output_tokens}</strong></div>
                {detail.usage.cache_creation_input_tokens != null && (
                  <div><span>缓存写入</span><strong>{detail.usage.cache_creation_input_tokens}</strong></div>
                )}
                {detail.usage.cache_read_input_tokens != null && (
                  <div><span>缓存命中</span><strong>{detail.usage.cache_read_input_tokens}</strong></div>
                )}
              </div>
            </div>
          )}

          {detail.cost && (
            <div className="detail-section">
              <h3>费用明细</h3>
              <div className="cost-grid">
                <div><span>输入费用</span><strong>${detail.cost.input_usd.toFixed(6)}</strong></div>
                <div><span>输出费用</span><strong>${detail.cost.output_usd.toFixed(6)}</strong></div>
                {detail.cost.cache_write_usd != null && (
                  <div><span>缓存写入</span><strong>${detail.cost.cache_write_usd.toFixed(6)}</strong></div>
                )}
                {detail.cost.cache_read_usd != null && (
                  <div><span>缓存读取</span><strong>${detail.cost.cache_read_usd.toFixed(6)}</strong></div>
                )}
                <div className="cost-total"><span>合计</span><strong>${detail.cost.total_usd.toFixed(6)}</strong></div>
              </div>
            </div>
          )}

          <div className="detail-section">
            <h3>请求内容</h3>
            <pre className="json-viewer">
              {JSON.stringify(detail.request, null, 2)}
            </pre>
          </div>

          {detail.response && (
            <div className="detail-section">
              <h3>响应内容</h3>
              <pre className="json-viewer">
                {JSON.stringify(detail.response, null, 2)}
              </pre>
            </div>
          )}

          {detail.error && (
            <div className="detail-section error-section">
              <h3>错误信息</h3>
              <pre className="json-viewer error-text">{detail.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}
