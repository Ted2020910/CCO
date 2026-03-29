import { useEffect, useState, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Sparkles, LayoutDashboard, Sun, Moon, Clock,
  Check, X, Loader2, MoreVertical, Pencil, Trash2, AlertTriangle,
} from 'lucide-react';
import { ThemeProvider, useTheme } from './hooks/useTheme';
import { api } from './api/client';
import { getCache, setCache } from './hooks/useLocalCache';
import type { SessionSummary } from './types';
import Overview from './pages/Overview';
import SessionDetail from './pages/SessionDetail';
import './App.css';

const SIDEBAR_CACHE_KEY = 'sidebar-sessions';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

// ── 确认删除对话框（复用 Sessions 页的样式）──────────────────────────────────

function ConfirmDialog({ sessionName, onConfirm, onCancel }: {
  sessionName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="confirm-overlay" onClick={handleBackdrop}>
      <div className="confirm-dialog">
        <div className="confirm-icon"><AlertTriangle size={28} /></div>
        <h3 className="confirm-title">确认删除</h3>
        <p className="confirm-message">
          即将删除会话 <strong>{sessionName || '未命名会话'}</strong>，此操作不可撤销。
        </p>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--cancel" onClick={onCancel}>取消</button>
          <button className="confirm-btn confirm-btn--danger" onClick={onConfirm}>
            <Trash2 size={14} /> 删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 侧边栏单个会话条目（三点菜单：重命名 + 删除）────────────────────────────

function SidebarSessionItem({ session, isActive, onNavigate, onRenamed, onDeleted }: {
  session: SessionSummary;
  isActive: boolean;
  onNavigate: () => void;
  onRenamed: (id: string, newName: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(session.session_name);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 同步外部名字变更
  useEffect(() => {
    if (!editing) setEditName(session.session_name);
  }, [session.session_name, editing]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
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

  const handleSave = useCallback(async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === session.session_name) {
      setEditing(false);
      setEditName(session.session_name);
      return;
    }
    setSaving(true);
    try {
      const result = await api.renameSession(session.session_id, trimmed);
      onRenamed(session.session_id, result.session_name);
    } catch {
      setEditName(session.session_name);
    } finally {
      setSaving(false);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') { setEditing(false); setEditName(session.session_name); }
  };

  return (
    <>
      <div
        className={`sidebar-session-item ${isActive ? 'sidebar-session-item--active' : ''} ${deleting ? 'sidebar-session-item--deleting' : ''}`}
        onClick={() => { if (!editing) onNavigate(); }}
      >
        {/* 三点菜单 */}
        <div className="sb-menu-area" ref={menuRef}>
          <button
            className="sb-menu-trigger"
            onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            aria-label="操作菜单"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div className="sb-menu-dropdown">
              <button className="sb-menu-item" onClick={e => {
                e.stopPropagation(); setMenuOpen(false); setEditName(session.session_name); setEditing(true);
              }}>
                <Pencil size={12} /> 重命名
              </button>
              <button className="sb-menu-item sb-menu-item--danger" onClick={e => {
                e.stopPropagation(); setMenuOpen(false); setConfirmDelete(true);
              }}>
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="sb-inline-rename" onClick={e => e.stopPropagation()}>
            <input
              ref={inputRef}
              className="sidebar-session-rename-input"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              disabled={saving}
              maxLength={10}
            />
            <div className="sidebar-session-rename-actions">
              <button className="sidebar-rename-btn sidebar-rename-btn--ok" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={12} className="tool-status--running" /> : <Check size={12} />}
              </button>
              <button className="sidebar-rename-btn sidebar-rename-btn--cancel"
                onClick={() => { setEditing(false); setEditName(session.session_name); }} disabled={saving}
              >
                <X size={12} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="sidebar-session-name">{session.session_name || '未命名'}</div>
            <div className="sidebar-session-meta">
              <span>{session.stats.total_requests} 请求</span>
              <span><Clock size={10} /> {timeAgo(session.updated_at)}</span>
            </div>
          </>
        )}
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

// ── AppShell ─────────────────────────────────────────────────────────────────

function AppShell() {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const match = location.pathname.match(/^\/sessions\/([^/]+)/);
  const activeSessionId = match ? match[1] : null;

  const [sessions, setSessions] = useState<SessionSummary[]>(
    () => getCache<SessionSummary[]>(SIDEBAR_CACHE_KEY) ?? []
  );

  useEffect(() => {
    const fetchList = () => {
      api.sessions(30)
        .then(d => {
          setSessions(prev => {
            const next = d.sessions;
            if (JSON.stringify(prev) !== JSON.stringify(next)) {
              setCache(SIDEBAR_CACHE_KEY, next);
              return next;
            }
            return prev;
          });
        })
        .catch(() => {});
    };
    fetchList();
    const interval = setInterval(fetchList, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleRenamed = useCallback((id: string, newName: string) => {
    setSessions(prev => {
      const next = prev.map(s => s.session_id === id ? { ...s, session_name: newName } : s);
      setCache(SIDEBAR_CACHE_KEY, next);
      return next;
    });
  }, []);

  const handleDeleted = useCallback((id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.session_id !== id);
      setCache(SIDEBAR_CACHE_KEY, next);
      return next;
    });
    // 如果删除的是当前查看的 session，跳转回首页
    if (activeSessionId === id) navigate('/');
  }, [activeSessionId, navigate]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <Sparkles size={22} className="logo-icon" />
          <span className="logo-text">CCO</span>
        </div>

        <nav className="nav">
          <NavLink to="/" end className={navCls}>
            <LayoutDashboard size={18} />
            <span>总览</span>
          </NavLink>
        </nav>

        {/* Sidebar session list */}
        <div className="sidebar-sessions">
          <div className="sidebar-sessions-label">会话 ({sessions.length})</div>
          <div className="sidebar-sessions-list">
            {sessions.map(s => (
              <SidebarSessionItem
                key={s.session_id}
                session={s}
                isActive={activeSessionId === s.session_id}
                onNavigate={() => navigate(`/sessions/${s.session_id}`)}
                onRenamed={handleRenamed}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        </div>

        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span>{theme === 'dark' ? 'Warm 模式' : 'Dark 模式'}</span>
        </button>
        <div className="sidebar-footer">Claude Code Observer</div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/sessions/:sessionId" element={<SessionDetail />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ThemeProvider>
  );
}

function navCls({ isActive }: { isActive: boolean }) {
  return `nav-item${isActive ? ' nav-item--active' : ''}`;
}
