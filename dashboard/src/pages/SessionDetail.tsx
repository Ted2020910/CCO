import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  User, Bot, Brain, Wrench, CheckCircle, XCircle,
  GitBranch, ChevronDown, ChevronRight, Cpu, Terminal, FileText, Pencil,
  FilePlus, FolderSearch, Search, Globe, FileCode,
  Loader2, Check, X, Archive,
} from 'lucide-react';
import { api } from '../api/client';
import { getCache, setCache } from '../hooks/useLocalCache';
import type {
  Session, SubAgent, MainAgent, AgentBase, ToolDef,
  ConvNode, ToolCallNode, AgentCallNode, TextNode,
  AnthropicMessage, SessionHistoryEntry,
} from '../types';

// ============================================================================
// 消息预处理 — 将 messages[] 转换为对话树节点
// ============================================================================

function buildConvNodes(messages: AnthropicMessage[], subAgents: SubAgent[]): ConvNode[] {
  const nodes: ConvNode[] = [];

  // 收集所有 tool_result（tool_use_id → content）
  const toolResults = new Map<string, { content: string; isError: boolean }>();
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          let text = '';
          if (typeof block.content === 'string') text = block.content;
          else if (Array.isArray(block.content)) text = block.content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
          toolResults.set(block.tool_use_id, { content: text, isError: !!block.is_error });
        }
      }
    }
  }

  // sub_agent 的 agent_id（= tool_call_id）→ sub_agent 映射
  const toolCallToSub = new Map<string, SubAgent>();
  for (const sub of subAgents) {
    if (sub.agent_id) toolCallToSub.set(sub.agent_id, sub);
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      // user 消息：提取文本（跳过 tool_result，已合并到 tool_call 节点）
      const textParts: string[] = [];
      if (typeof msg.content === 'string') {
        textParts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) textParts.push(block.text);
          // tool_result 跳过，已在 toolResults map 中
        }
      }
      if (textParts.length > 0) {
        nodes.push({ type: 'user', text: textParts.join('\n') });
      }
    } else if (msg.role === 'assistant') {
      if (!Array.isArray(msg.content)) {
        if (typeof msg.content === 'string' && msg.content) {
          nodes.push({ type: 'assistant_text', text: msg.content });
        }
        continue;
      }

      // assistant 消息：拆分为 text / thinking / tool_call 节点
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          nodes.push({ type: 'assistant_text', text: block.text });
        } else if (block.type === 'thinking' && block.thinking) {
          nodes.push({ type: 'thinking', text: block.thinking });
        } else if (block.type === 'tool_use' && block.id && block.name) {
          const result = toolResults.get(block.id);
          const sub = toolCallToSub.get(block.id);

          if (block.name === 'Agent' && sub) {
            // Agent 工具 → agent_call 节点
            nodes.push({
              type: 'agent_call',
              toolCallId: block.id,
              input: (block.input ?? {}) as Record<string, unknown>,
              isFinished: sub.is_finished ?? !!result,
              result: result?.content,
              subAgentId: sub.agent_id,
            });
          } else {
            // 普通工具 → tool_call 节点
            nodes.push({
              type: 'tool_call',
              toolName: block.name,
              toolCallId: block.id,
              input: (block.input ?? {}) as Record<string, unknown>,
              isFinished: !!result,
              result: result?.content,
              isError: result?.isError,
            });
          }
        }
      }
    }
  }

  return nodes;
}

// ============================================================================
// 辅助函数
// ============================================================================

function getSubAgentLabel(parent: AgentBase, sub: SubAgent): string {
  const entry = parent.tools_call_result_map[sub.agent_id];
  if (entry?.tool_name === 'Agent') {
    const args = entry.arguments as Record<string, unknown>;
    return (args.subagent_type as string) ?? (args.description as string) ?? 'Agent';
  }
  // Fallback：使用 prompt 的前 30 个字符作为标签
  if (sub.prompt) {
    return sub.prompt.length > 30 ? sub.prompt.slice(0, 30) + '...' : sub.prompt;
  }
  return 'Agent';
}

function findAgentById(root: MainAgent, id: string): AgentBase | null {
  if (root.agent_id === id) return root;
  return findInSubs(root.sub_agents, id);
}

function findInSubs(subs: SubAgent[], id: string): AgentBase | null {
  for (const sub of subs) {
    if (sub.agent_id === id) return sub;
    const found = findInSubs(sub.sub_agents, id);
    if (found) return found;
  }
  return null;
}

function findParentOf(root: MainAgent, childId: string): AgentBase | null {
  for (const sub of root.sub_agents) {
    if (sub.agent_id === childId) return root;
    const found = findParentInSubs(sub, childId);
    if (found) return found;
  }
  return null;
}

function findParentInSubs(parent: SubAgent, childId: string): AgentBase | null {
  for (const sub of parent.sub_agents) {
    if (sub.agent_id === childId) return parent;
    const found = findParentInSubs(sub, childId);
    if (found) return found;
  }
  return null;
}

/** Build breadcrumb path from root to a given agent */
function buildBreadcrumbPath(root: MainAgent, targetId: string): Array<{ agent: AgentBase; label: string }> {
  const path: Array<{ agent: AgentBase; label: string }> = [];

  function walk(node: AgentBase & { sub_agents?: SubAgent[] }, parentAgent: AgentBase | null): boolean {
    const label = node.agent_id === root.agent_id
      ? 'Main Agent'
      : parentAgent
        ? getSubAgentLabel(parentAgent, node as SubAgent)
        : 'Agent';
    path.push({ agent: node, label });
    if (node.agent_id === targetId) return true;

    const subs = 'sub_agents' in node ? (node as MainAgent | SubAgent).sub_agents : [];
    for (const sub of subs) {
      if (walk(sub, node)) return true;
    }
    path.pop();
    return false;
  }

  walk(root, null);
  return path;
}

// ============================================================================
// SessionDetail — 主页面
// ============================================================================

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(
    () => sessionId ? getCache<Session>(`session-detail:${sessionId}`) : null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // ── 内联重命名状态 ──────────────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [renamingName, setRenamingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    const cacheKey = `session-detail:${sessionId}`;
    const fetchSession = () => {
      api.sessionDetail(sessionId)
        .then(ns => {
          setSession(prev => {
            if (!prev || prev.updated_at !== ns.updated_at) {
              setCache(cacheKey, ns);
              return ns;
            }
            return prev;
          });
        })
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    };
    fetchSession();
    const interval = setInterval(fetchSession, 2000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // 非编辑时同步后端改动的名字（poll 到新数据时更新）
  useEffect(() => {
    if (!editingName && session) setEditName(session.session_name);
  }, [session?.session_name, editingName]);

  // 进入编辑时聚焦
  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  const handleRename = useCallback(async () => {
    if (!session || !sessionId) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed === session.session_name) {
      setEditingName(false);
      setEditName(session.session_name);
      return;
    }
    setRenamingName(true);
    try {
      const result = await api.renameSession(sessionId, trimmed);
      // 乐观更新：立即反映到本地 session 状态
      setSession(prev => prev ? { ...prev, session_name: result.session_name } : prev);
      setCache(`session-detail:${sessionId}`, { ...session, session_name: result.session_name });
    } catch (err) {
      console.error('Rename failed:', err);
      setEditName(session.session_name);
    } finally {
      setRenamingName(false);
      setEditingName(false);
    }
  }, [editName, session, sessionId]);

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRename();
    if (e.key === 'Escape') {
      setEditingName(false);
      setEditName(session?.session_name ?? '');
    }
  };

  const hasCachedData = session !== null;
  if (loading && !hasCachedData) return <div className="loading">加载中...</div>;
  if (error && !hasCachedData) return <div className="error">错误: {error}</div>;
  if (!session) return <div className="error">会话不存在</div>;

  const activeId = selectedAgentId ?? session.main_agent.agent_id;
  const selectedAgent = findAgentById(session.main_agent, activeId);
  const selectedParent = selectedAgent ? findParentOf(session.main_agent, activeId) : null;

  return (
    <div className="session-detail">
      <div className="session-header">
        <div className="session-title">
          {editingName ? (
            <div className="session-name-edit" onClick={e => e.stopPropagation()}>
              <input
                ref={nameInputRef}
                className="session-name-input"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={handleNameKeyDown}
                onBlur={handleRename}
                disabled={renamingName}
                maxLength={10}
              />
              <button
                className="rename-btn rename-btn--confirm"
                onClick={handleRename}
                disabled={renamingName}
                aria-label="确认"
              >
                {renamingName ? <Loader2 size={14} className="tool-status--running" /> : <Check size={14} />}
              </button>
              <button
                className="rename-btn rename-btn--cancel"
                onClick={() => { setEditingName(false); setEditName(session.session_name); }}
                disabled={renamingName}
                aria-label="取消"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="session-name-display" onClick={() => { setEditName(session.session_name); setEditingName(true); }}>
              <h1>{session.session_name}</h1>
              <Pencil size={14} className="session-name-edit-icon" />
            </div>
          )}
          <div className="session-meta">
            <span>Session: {session.session_id.slice(0, 8)}...</span>
            <span>请求数: {session.stats.total_requests}</span>
          </div>
        </div>
      </div>

      <div className="session-content">
        {/* 左侧：Agent 关系图 */}
        <div className="graph-area">
          <h2><Cpu size={16} /> Agent 关系图</h2>
          <div className="agent-graph">
            <AgentNode
              agent={session.main_agent}
              label="Main Agent"
              selectedId={activeId}
              onSelect={setSelectedAgentId}
              parent={null}
            />
          </div>
        </div>

        {/* 右侧：选中 Agent 的详情面板 */}
        <div className="detail-panel">
          {selectedAgent ? (
            <AgentDetailPanel
              agent={selectedAgent}
              label={
                selectedAgent.agent_id === session.main_agent.agent_id
                  ? 'Main Agent'
                  : selectedParent
                    ? getSubAgentLabel(selectedParent, selectedAgent as SubAgent)
                    : 'Agent'
              }
              session={session}
              onSelectAgent={setSelectedAgentId}
            />
          ) : (
            <div className="panel-empty">点击左侧节点查看详情</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Agent 关系图节点
// ============================================================================

function AgentNode({ agent, label, selectedId, onSelect, parent, depth = 0, index = 0 }: {
  agent: AgentBase & { sub_agents?: SubAgent[] };
  label: string;
  selectedId: string;
  onSelect: (id: string) => void;
  parent: AgentBase | null;
  depth?: number;
  index?: number;
}) {
  const isSelected = agent.agent_id === selectedId;
  const subAgents = 'sub_agents' in agent ? (agent as MainAgent | SubAgent).sub_agents : [];
  const isMain = !parent;
  // 子智能体的完成状态：直接读取 SubAgent 自身的 is_finished 字段
  const isSubFinished = !isMain ? (agent as SubAgent).is_finished : false;
  const running = !isMain && !isSubFinished;
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="graph-branch">
      <div
        className={`graph-node ${isSelected ? 'graph-node--selected' : ''} ${isMain ? 'graph-node--main' : 'graph-node--sub'} ${!isMain ? (running ? 'graph-node--running' : 'graph-node--done') : ''}`}
        onClick={() => onSelect(agent.agent_id)}
        style={{
          '--node-depth': depth,
          '--node-index': index,
        } as React.CSSProperties}
      >
        <div className="graph-node-icon">
          {isMain ? <Cpu size={18} /> : <GitBranch size={18} />}
        </div>
        <div className="graph-node-info">
          <div className="graph-node-label">{label}</div>
          <div className="graph-node-meta">{agent.current_messages.length} 条消息</div>
        </div>
        {!isMain && (
          <span className={`agent-status-badge ${running ? 'agent-status-badge--running' : 'agent-status-badge--done'}`}>
            {running
              ? <><Loader2 size={12} className="agent-status-badge-icon--spin" /> 运行中</>
              : <><CheckCircle size={12} /> 已完成</>
            }
          </span>
        )}
        {subAgents.length > 0 && (
          <button
            className={`graph-node-toggle ${collapsed ? 'graph-node-toggle--collapsed' : ''}`}
            onClick={e => { e.stopPropagation(); setCollapsed(c => !c); }}
            aria-label={collapsed ? '展开' : '折叠'}
          >
            <ChevronDown size={14} />
          </button>
        )}
      </div>
      {subAgents.length > 0 && (
        <div className={`graph-children-wrapper ${collapsed ? 'graph-children-wrapper--collapsed' : ''}`}>
          <div className="graph-children-wrapper-inner">
            <div className="graph-children">
              {subAgents.map((sub, i) => (
                <AgentNode
                  key={sub.agent_id || i}
                  agent={sub}
                  label={getSubAgentLabel(agent, sub)}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  parent={agent}
                  depth={depth + 1}
                  index={i}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Agent 详情面板
// ============================================================================

function AgentDetailPanel({ agent, label, session, onSelectAgent }: {
  agent: AgentBase;
  label: string;
  session: Session;
  onSelectAgent: (id: string) => void;
}) {
  const subAgents = 'sub_agents' in agent ? (agent as MainAgent | SubAgent).sub_agents : [];
  const nodes = buildConvNodes(agent.current_messages, subAgents);
  const breadcrumb = buildBreadcrumbPath(session.main_agent, agent.agent_id);
  const showBreadcrumb = breadcrumb.length > 1;

  // 历史归档：仅 Main Agent 具有 session_history_list
  const historyList = 'session_history_list' in agent
    ? (agent as MainAgent).session_history_list
    : [];

  return (
    <div className="agent-detail" key={agent.agent_id}>
      {/* 面包屑导航 */}
      {showBreadcrumb && (
        <nav className="agent-breadcrumb">
          {breadcrumb.map((item, i) => (
            <span key={item.agent.agent_id} style={{ display: 'contents' }}>
              {i > 0 && (
                <span className="breadcrumb-separator"><ChevronRight size={12} /></span>
              )}
              <button
                className={`breadcrumb-item ${i === breadcrumb.length - 1 ? 'breadcrumb-item--active' : ''}`}
                onClick={() => i < breadcrumb.length - 1 && onSelectAgent(item.agent.agent_id)}
              >
                {i === 0 ? <Cpu size={13} /> : <GitBranch size={13} />}
                {item.label}
              </button>
            </span>
          ))}
        </nav>
      )}

      {/* 头部 */}
      <div className="agent-detail-header">
        <span className="agent-detail-icon">
          {agent.agent_id === session.main_agent.agent_id ? <Cpu size={20} /> : <GitBranch size={20} />}
        </span>
        <div>
          <h2>{label}</h2>
          <span className="agent-detail-id">{agent.agent_id.slice(0, 12)}...</span>
        </div>
      </div>

      {/* 历史归档（仅 Main Agent，紧接 header） */}
      {historyList.length > 0 && (
        <HistoryArchivesSection historyList={historyList} />
      )}

      {/* 系统提示词 */}
      <SystemPromptCard sysPrompt={agent.current_sys_prompt} />

      {/* 对话树 */}
      <div className="conv-tree">
        {nodes.map((node, i) => (
          <ConvTreeNode key={i} node={node} onSelectAgent={onSelectAgent} index={i} />
        ))}
      </div>

      {/* 可用工具 */}
      {agent.tools.length > 0 && (
        <CollapsibleSection
          icon={<Wrench size={15} />}
          title={`可用工具 (${agent.tools.length})`}
          defaultOpen={false}
        >
          <ToolsPanel tools={agent.tools} />
        </CollapsibleSection>
      )}
    </div>
  );
}

// ============================================================================
// 对话树节点渲染
// ============================================================================

function ConvTreeNode({ node, onSelectAgent, index = 0 }: {
  node: ConvNode;
  onSelectAgent: (id: string) => void;
  index?: number;
}) {
  switch (node.type) {
    case 'user':
      return <UserNode node={node} index={index} />;
    case 'assistant_text':
      return <AssistantTextNode node={node} index={index} />;
    case 'thinking':
      return <ThinkingNode node={node} index={index} />;
    case 'tool_call':
      return <ToolCallNodeView node={node} index={index} />;
    case 'agent_call':
      return <AgentCallNodeView node={node} onSelectAgent={onSelectAgent} index={index} />;
  }
}

/* ── User 节点 ────────────────────────────────────────────────────────────── */

function UserNode({ node, index }: { node: TextNode; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const preview = node.text.slice(0, 80) + (node.text.length > 80 ? '...' : '');

  return (
    <div className="tree-item tree-item--user" style={{ '--node-delay': `${index * 30}ms` } as React.CSSProperties}>
      <div className="tree-line" />
      <div className="tree-content">
        <div className="tree-item-header" onClick={() => setExpanded(!expanded)}>
          <User size={14} />
          <span className="tree-item-label">User</span>
          {!expanded && <span className="tree-item-preview">{preview}</span>}
          <span className={`expand-icon ${expanded ? 'expanded' : ''}`}><ChevronDown size={12} /></span>
        </div>
        <div className={`tree-item-body-wrapper ${expanded ? 'tree-item-body-wrapper--open' : ''}`}>
          <div className="tree-item-body-wrapper-inner">
            <div className="tree-item-body"><ReactMarkdown>{node.text}</ReactMarkdown></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Assistant 文本节点 ───────────────────────────────────────────────────── */

function AssistantTextNode({ node, index }: { node: TextNode; index: number }) {
  const [expanded, setExpanded] = useState(true);
  const preview = node.text.slice(0, 80) + (node.text.length > 80 ? '...' : '');

  return (
    <div className="tree-item tree-item--assistant" style={{ '--node-delay': `${index * 30}ms` } as React.CSSProperties}>
      <div className="tree-line" />
      <div className="tree-content">
        <div className="tree-item-header" onClick={() => setExpanded(!expanded)}>
          <Bot size={14} />
          <span className="tree-item-label">Assistant</span>
          {!expanded && <span className="tree-item-preview">{preview}</span>}
          <span className={`expand-icon ${expanded ? 'expanded' : ''}`}><ChevronDown size={12} /></span>
        </div>
        <div className={`tree-item-body-wrapper ${expanded ? 'tree-item-body-wrapper--open' : ''}`}>
          <div className="tree-item-body-wrapper-inner">
            <div className="tree-item-body text-content"><ReactMarkdown>{node.text}</ReactMarkdown></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Thinking 节点 ────────────────────────────────────────────────────────── */

function ThinkingNode({ node, index }: { node: TextNode; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const preview = node.text.slice(0, 60) + (node.text.length > 60 ? '...' : '');

  return (
    <div className="tree-item tree-item--thinking" style={{ '--node-delay': `${index * 30}ms` } as React.CSSProperties}>
      <div className="tree-line" />
      <div className="tree-content">
        <div className="tree-item-header" onClick={() => setExpanded(!expanded)}>
          <Brain size={14} />
          <span className="tree-item-label">Thinking</span>
          {!expanded && <span className="tree-item-preview">{preview}</span>}
          <span className={`expand-icon ${expanded ? 'expanded' : ''}`}><ChevronDown size={12} /></span>
        </div>
        <div className={`tree-item-body-wrapper ${expanded ? 'tree-item-body-wrapper--open' : ''}`}>
          <div className="tree-item-body-wrapper-inner">
            <div className="tree-item-body tree-thinking-body"><ReactMarkdown>{node.text}</ReactMarkdown></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 工具调用节点（tool_use + tool_result 合并） ─────────────────────────── */

const TOOL_ICON_MAP: Record<string, React.ReactNode> = {
  Bash: <Terminal size={14} />, Read: <FileText size={14} />, Edit: <Pencil size={14} />,
  Write: <FilePlus size={14} />, Glob: <FolderSearch size={14} />, Grep: <Search size={14} />,
  WebFetch: <Globe size={14} />, WebSearch: <Globe size={14} />,
};

function ToolCallNodeView({ node, index }: { node: ToolCallNode; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const icon = TOOL_ICON_MAP[node.toolName] ?? <Wrench size={14} />;
  const resultPreview = node.result ? node.result.slice(0, 60) + (node.result.length > 60 ? '...' : '') : '';

  return (
    <div className={`tree-item tree-item--tool ${node.isError ? 'tree-item--error' : ''}`} style={{ '--node-delay': `${index * 30}ms` } as React.CSSProperties}>
      <div className="tree-line" />
      <div className="tree-content">
        <div className="tree-item-header" onClick={() => setExpanded(!expanded)}>
          {icon}
          <span className="tree-tool-name">{node.toolName}</span>
          {node.isFinished
            ? (node.isError
                ? <XCircle size={13} className="tool-status tool-status--error" />
                : <CheckCircle size={13} className="tool-status tool-status--done" />)
            : <Loader2 size={13} className="tool-status tool-status--running" />
          }
          {!expanded && resultPreview && <span className="tree-item-preview">{resultPreview}</span>}
          <span className={`expand-icon ${expanded ? 'expanded' : ''}`}><ChevronDown size={12} /></span>
        </div>
        <div className={`tree-item-body-wrapper ${expanded ? 'tree-item-body-wrapper--open' : ''}`}>
          <div className="tree-item-body-wrapper-inner">
            <div className="tree-item-body">
              <div className="tool-section">
                <span className="tool-section-label">入参</span>
                <pre className="json-content">{JSON.stringify(node.input, null, 2)}</pre>
              </div>
              {node.result !== undefined && (
                <div className="tool-section">
                  <span className="tool-section-label">结果</span>
                  <pre className="result-content">{node.result}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Agent 调用节点（显示摘要，点击跳转） ─────────────────────────────────── */

function AgentCallNodeView({ node, onSelectAgent, index }: {
  node: AgentCallNode;
  onSelectAgent: (id: string) => void;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const desc = (node.input.description as string) ?? '';
  const agentType = (node.input.subagent_type as string) ?? 'general';

  return (
    <div className="tree-item tree-item--agent" style={{ '--node-delay': `${index * 30}ms` } as React.CSSProperties}>
      <div className="tree-line" />
      <div className="tree-content">
        <div className="tree-item-header" onClick={() => setExpanded(!expanded)}>
          <GitBranch size={14} />
          <span className="tree-tool-name">Agent</span>
          <span className="agent-type-tag">{agentType}</span>
          {node.isFinished
            ? <CheckCircle size={13} className="tool-status tool-status--done" />
            : <Loader2 size={13} className="tool-status tool-status--running" />
          }
          {!expanded && desc && <span className="tree-item-preview">{desc}</span>}
          <span className={`expand-icon ${expanded ? 'expanded' : ''}`}><ChevronDown size={12} /></span>
        </div>
        <div className={`tree-item-body-wrapper ${expanded ? 'tree-item-body-wrapper--open' : ''}`}>
          <div className="tree-item-body-wrapper-inner">
            <div className="tree-item-body">
              <div className="tool-section">
                <span className="tool-section-label">入参</span>
                <pre className="json-content">{JSON.stringify(node.input, null, 2)}</pre>
              </div>
              {node.result !== undefined && (
                <div className="tool-section">
                  <span className="tool-section-label">出参</span>
                  <pre className="result-content">{node.result.slice(0, 500)}{node.result.length > 500 ? '...' : ''}</pre>
                </div>
              )}
              {node.subAgentId && (
                <button className="view-agent-btn" onClick={() => onSelectAgent(node.subAgentId!)}>
                  <GitBranch size={14} /> 查看 Agent 详细过程
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 系统提示词卡片
// ============================================================================

function SystemPromptCard({ sysPrompt }: { sysPrompt: unknown }) {
  const [expanded, setExpanded] = useState(false);
  let text = '';
  if (typeof sysPrompt === 'string') text = sysPrompt;
  else if (Array.isArray(sysPrompt)) text = sysPrompt.map((b: Record<string, unknown>) => typeof b.text === 'string' ? b.text : '').filter(Boolean).join('\n\n---\n\n');
  else text = JSON.stringify(sysPrompt, null, 2);
  const preview = text.slice(0, 150) + (text.length > 150 ? '...' : '');

  return (
    <div className="sys-prompt-card">
      <div className="sys-prompt-header" onClick={() => setExpanded(!expanded)}>
        <span className="sys-prompt-header-left"><FileCode size={15} /> 系统提示词</span>
        <span className="sys-prompt-size">{text.length} 字符</span>
        <span className={`expand-icon ${expanded ? 'expanded' : ''}`}><ChevronDown size={14} /></span>
      </div>
      {expanded ? <div className="sys-prompt-body">{text}</div> : <div className="sys-prompt-preview">{preview}</div>}
    </div>
  );
}

// ============================================================================
// 历史归档区域（Main Agent 专用）
// ============================================================================

function HistoryArchivesSection({ historyList }: {
  historyList: SessionHistoryEntry[];
}) {
  return (
    <CollapsibleSection
      icon={<Archive size={15} />}
      title={`历史归档 (${historyList.length} 轮)`}
      defaultOpen={false}
    >
      <div className="history-archives">
        {historyList.map((entry, i) => (
          <HistoryEntryView
            key={i}
            entry={entry}
            roundIndex={i + 1}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

function HistoryEntryView({ entry, roundIndex }: {
  entry: SessionHistoryEntry;
  roundIndex: number;
}) {
  const [open, setOpen] = useState(false);

  const dateStr = (() => {
    try {
      return new Date(entry.archived_at).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return entry.archived_at;
    }
  })();

  // 按需构建节点
  const nodes = open ? buildConvNodes(entry.messages, []) : [];
  const archivedSubs = entry.sub_agents ?? [];
  const archivedMap = entry.tools_call_result_map ?? {};

  return (
    <div className={`history-entry ${open ? 'history-entry--open' : ''}`}>
      <div className="history-entry-header" onClick={() => setOpen(o => !o)}>
        <Archive size={13} className="history-entry-icon" />
        <span className="history-round-label">第 {roundIndex} 轮</span>
        <span className="history-entry-date">{dateStr}</span>
        <span className="history-entry-count">{entry.messages.length} 条消息</span>
        {archivedSubs.length > 0 && (
          <span className="history-sub-count">
            <GitBranch size={10} /> {archivedSubs.length}
          </span>
        )}
        <span className={`expand-icon ${open ? 'expanded' : ''}`}><ChevronDown size={12} /></span>
      </div>

      <div className={`tree-item-body-wrapper ${open ? 'tree-item-body-wrapper--open' : ''}`}>
        <div className="tree-item-body-wrapper-inner">
          <div className="history-entry-body">
            {/* 归档时的系统提示词 */}
            <SystemPromptCard sysPrompt={entry.sys_prompt} />

            {/* 归档消息树（agent tool call 节点不可跳转，onSelectAgent 传空函数） */}
            {nodes.length > 0 ? (
              <div className="conv-tree history-conv-tree">
                {nodes.map((node, i) => (
                  <ConvTreeNode key={i} node={node} onSelectAgent={() => {}} index={i} />
                ))}
              </div>
            ) : (
              <div className="history-empty">无消息记录</div>
            )}

            {/* 归档子智能体列表 */}
            {archivedSubs.length > 0 && (
              <ArchivedSubAgentsSection
                subAgents={archivedSubs}
                parentMap={archivedMap}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 归档子智能体列表 ─────────────────────────────────────────────────────── */

function ArchivedSubAgentsSection({ subAgents, parentMap }: {
  subAgents: SubAgent[];
  parentMap: Record<string, { tool_name: string; arguments: Record<string, unknown>; is_finished: boolean; result: unknown }>;
}) {
  return (
    <div className="archived-subs">
      <div className="archived-subs-label">
        <GitBranch size={12} /> 本轮子智能体 ({subAgents.length})
      </div>
      {subAgents.map((sub, i) => (
        <ArchivedSubAgentRow key={i} sub={sub} parentMap={parentMap} />
      ))}
    </div>
  );
}

function ArchivedSubAgentRow({ sub, parentMap }: {
  sub: SubAgent;
  parentMap: Record<string, { tool_name: string; arguments: Record<string, unknown>; is_finished: boolean; result: unknown }>;
}) {
  const [open, setOpen] = useState(false);

  // 从父 agent 的 tools_call_result_map 取标签（同 getSubAgentLabel 逻辑）
  const entry = parentMap[sub.agent_id];
  const label = (() => {
    if (entry?.tool_name === 'Agent') {
      const args = entry.arguments as Record<string, unknown>;
      return (args.subagent_type as string) ?? (args.description as string) ?? 'Agent';
    }
    if (sub.prompt) return sub.prompt.length > 30 ? sub.prompt.slice(0, 30) + '...' : sub.prompt;
    return 'Agent';
  })();

  const nodes = open ? buildConvNodes(sub.current_messages, sub.sub_agents ?? []) : [];

  return (
    <div className={`archived-sub-row ${open ? 'archived-sub-row--open' : ''}`}>
      <div className="archived-sub-header" onClick={() => setOpen(o => !o)}>
        <GitBranch size={12} className="archived-sub-icon" />
        <span className="archived-sub-label">{label}</span>
        <span className="archived-sub-count">{sub.current_messages.length} 条</span>
        <span className={`expand-icon ${open ? 'expanded' : ''}`}><ChevronDown size={11} /></span>
      </div>

      <div className={`tree-item-body-wrapper ${open ? 'tree-item-body-wrapper--open' : ''}`}>
        <div className="tree-item-body-wrapper-inner">
          <div className="archived-sub-body">
            {nodes.length > 0 ? (
              <div className="conv-tree history-conv-tree">
                {nodes.map((node, i) => (
                  <ConvTreeNode key={i} node={node} onSelectAgent={() => {}} index={i} />
                ))}
              </div>
            ) : (
              <div className="history-empty">无消息记录</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 可折叠区域 + Tools Panel
// ============================================================================

function CollapsibleSection({ icon, title, defaultOpen, children }: {
  icon: React.ReactNode; title: string; defaultOpen: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible-section">
      <div className="collapsible-header" onClick={() => setOpen(!open)}>
        <span className="collapsible-title">{icon} {title}</span>
        <span className={`expand-icon ${open ? 'expanded' : ''}`}><ChevronDown size={14} /></span>
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

const TOOL_CATEGORY: Record<string, string> = {
  Agent: 'tool-cat-agent', Bash: 'tool-cat-system', Read: 'tool-cat-file',
  Edit: 'tool-cat-file', Write: 'tool-cat-file', Glob: 'tool-cat-search',
  Grep: 'tool-cat-search', WebFetch: 'tool-cat-web', WebSearch: 'tool-cat-web',
};

function ToolsPanel({ tools }: { tools: ToolDef[] }) {
  return (
    <div className="tools-panel">
      {tools.map((tool, i) => <ToolCard key={i} tool={tool} />)}
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolDef }) {
  const [expanded, setExpanded] = useState(false);
  const desc = tool.description?.split('\n')[0]?.slice(0, 200) ?? '';
  const properties = tool.input_schema?.properties ?? {};
  const required = new Set(tool.input_schema?.required ?? []);
  const paramEntries = Object.entries(properties);
  const catClass = TOOL_CATEGORY[tool.name] ?? 'tool-cat-default';
  const icon = TOOL_ICON_MAP[tool.name] ?? <Wrench size={15} />;

  return (
    <div className={`tool-card ${catClass}`}>
      <div className="tool-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-card-icon">{icon}</span>
        <span className="tool-card-name">{tool.name}</span>
        <span className="tool-card-params">{paramEntries.length} 参数</span>
        <span className={`expand-icon ${expanded ? 'expanded' : ''}`}><ChevronDown size={12} /></span>
      </div>
      {expanded && (
        <div className="tool-card-body">
          {desc && <div className="tool-desc">{desc}</div>}
          {paramEntries.length > 0 && (
            <div className="tool-params">
              {paramEntries.map(([name, prop]) => (
                <div key={name} className="param-row">
                  <span className="param-name">{name}{required.has(name) && <span className="required-mark">*</span>}</span>
                  <span className={`type-tag type-${prop.type ?? 'unknown'}`}>{prop.type ?? '?'}</span>
                  {prop.description && <span className="param-desc">{prop.description.slice(0, 80)}{prop.description.length > 80 ? '...' : ''}</span>}
                  {prop.enum && <div className="param-enum">{prop.enum.map(v => <span key={v} className="enum-value">{v}</span>)}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
