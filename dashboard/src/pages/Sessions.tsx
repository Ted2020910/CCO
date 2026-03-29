import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare, MessagesSquare, GitBranch, Archive, Clock,
  Trash2, Pencil, Check, X, MoreVertical, AlertTriangle,
} from 'lucide-react';
import { api } from '../api/client';
import { getCache, setCache } from '../hooks/useLocalCache';
import type { SessionSummary } from '../types';

const CACHE_KEY = 'sessions-list';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

// ============================================================================
// 确认删除对话框
// ============================================================================

function ConfirmDialog({ sessionName, onConfirm, onCancel }: {
  sessionName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // 点击遮罩关闭
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="confirm-overlay" onClick={handleBackdrop}>
      <div className="confirm-dialog">
        <div className="confirm-icon">
          <AlertTriangle size={28} />
        </div>
        <h3 className="confirm-title">确认删除</h3>
        <p className="confirm-message">
          即将删除会话 <strong>{sessionName || '未命名会话'}</strong>，此操作不可撤销。
        </p>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--cancel" onClick={onCancel}>
            取消
          </button>
          <button className="confirm-btn confirm-btn--danger" onClick={onConfirm}>
            <Trash2 size={14} /> 删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 单个 Session 卡片
// ============================================================================

function SessionCard({ session, onDeleted, onRenamed }: {
  session: SessionSummary;
  onDeleted: (id: string) => void;
  onRenamed: (id: string, newName: string) => void;
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(session.session_name);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 非编辑状态下，父组件 poll 到新名字时同步过来
  useEffect(() => {
    if (!editing) setEditName(session.session_name);
  }, [session.session_name, editing]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  // 进入编辑时聚焦
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleRename = useCallback(async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === session.session_name) {
      setEditing(false);
      setEditName(session.session_name);
      return;
    }
    setRenaming(true);
    try {
      const result = await api.renameSession(session.session_id, trimmed);
      // 乐观更新：成功后立即通知父组件，不等下次 poll
      onRenamed(session.session_id, result.session_name);
    } catch (err) {
      console.error('Rename failed:', err);
      setEditName(session.session_name); // 还原
    } finally {
      setRenaming(false);
      setEditing(false);
    }
  }, [editName, session.session_id, session.session_name, onRenamed]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await api.deleteSession(session.session_id);
      onDeleted(session.session_id);
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [session.session_id, onDeleted]);

  const handleCardClick = () => {
    if (!editing) navigate(`/sessions/${session.session_id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRename();
    if (e.key === 'Escape') {
      setEditing(false);
      setEditName(session.session_name);
    }
  };

  return (
    <>
      <div
        className={`session-card ${deleting ? 'session-card--deleting' : ''}`}
        onClick={handleCardClick}
      >
        {/* 右上角操作菜单 */}
        <div className="card-menu-area" ref={menuRef}>
          <button
            className="card-menu-trigger"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            aria-label="操作菜单"
          >
            <MoreVertical size={16} />
          </button>
          {menuOpen && (
            <div className="card-menu-dropdown">
              <button
                className="card-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setEditName(session.session_name);
                  setEditing(true);
                }}
              >
                <Pencil size={14} /> 重命名
              </button>
              <button
                className="card-menu-item card-menu-item--danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              >
                <Trash2 size={14} /> 删除
              </button>
            </div>
          )}
        </div>

        <div className="card-header">
          {editing ? (
            <div className="inline-rename" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                className="rename-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleRename}
                disabled={renaming}
                maxLength={10}
              />
              <div className="rename-actions">
                <button
                  className="rename-btn rename-btn--confirm"
                  onClick={(e) => { e.stopPropagation(); handleRename(); }}
                  disabled={renaming}
                  aria-label="确认"
                >
                  <Check size={14} />
                </button>
                <button
                  className="rename-btn rename-btn--cancel"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(false);
                    setEditName(session.session_name);
                  }}
                  disabled={renaming}
                  aria-label="取消"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : (
            <h3 className="session-name">{session.session_name || '未命名会话'}</h3>
          )}
          <span className="session-date">
            {new Date(session.updated_at).toLocaleDateString('zh-CN')}
          </span>
        </div>

        <div className="card-stats">
          {session.stats.conversation_rounds !== undefined && (
            <span><MessagesSquare size={13} /> {session.stats.conversation_rounds} 轮对话</span>
          )}
          {session.stats.sub_agent_count !== undefined && session.stats.sub_agent_count > 0 && (
            <span><GitBranch size={13} /> {session.stats.sub_agent_count} 子智能体</span>
          )}
          {session.stats.compression_count !== undefined && session.stats.compression_count > 0 && (
            <span><Archive size={13} /> {session.stats.compression_count} 压缩</span>
          )}
        </div>

        <div className="card-metrics">
          <span>请求: {session.stats.total_requests}</span>
          <span><Clock size={12} /> {timeAgo(session.updated_at)}</span>
        </div>

        <div className="card-models">
          {Object.keys(session.stats.models_used).map(model => (
            <span key={model} className="model-tag">
              {model.replace('claude-', '')}
            </span>
          ))}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          sessionName={session.session_name}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

// ============================================================================
// Sessions 列表页
// ============================================================================

export default function Sessions() {
  // 懒初始化：优先从缓存恢复，页面刷新后立即呈现上次数据
  const [sessions, setSessions] = useState<SessionSummary[]>(
    () => getCache<SessionSummary[]>(CACHE_KEY) ?? []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSessions = () => {
      api.sessions(30)
        .then(d => {
          setSessions(prev => {
            const newSessions = d.sessions;
            if (JSON.stringify(prev) !== JSON.stringify(newSessions)) {
              setCache(CACHE_KEY, newSessions); // 数据变化时更新缓存
              return newSessions;
            }
            return prev;
          });
        })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    };

    fetchSessions();
    const interval = setInterval(fetchSessions, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleted = useCallback((deletedId: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.session_id !== deletedId);
      setCache(CACHE_KEY, next);
      return next;
    });
  }, []);

  const handleRenamed = useCallback((renamedId: string, newName: string) => {
    setSessions(prev => {
      const next = prev.map(s =>
        s.session_id === renamedId ? { ...s, session_name: newName } : s
      );
      setCache(CACHE_KEY, next);
      return next;
    });
  }, []);

  // 有缓存时跳过骨架屏，直接渲染
  const hasCachedData = sessions.length > 0;
  if (loading && !hasCachedData) return <div className="loading">加载中...</div>;
  if (error && !hasCachedData) return <div className="error">{error}</div>;

  return (
    <div className="page">
      <h1 className="page-title"><MessageSquare /> 会话列表</h1>
      <p className="page-sub">最近 30 天（共 {sessions.length} 个）</p>

      {sessions.length === 0 ? (
        <div className="empty">
          <p>暂无数据</p>
          <p className="hint">运行 <code>cco init</code> 并配置 ANTHROPIC_BASE_URL 后开始使用</p>
        </div>
      ) : (
        <div className="session-grid">
          {sessions.map(s => (
            <SessionCard
              key={s.session_id}
              session={s}
              onDeleted={handleDeleted}
              onRenamed={handleRenamed}
            />
          ))}
        </div>
      )}
    </div>
  );
}
