// 与后端 src/shared/types.ts 保持同步的前端类型定义

// ── Anthropic API 类型 ──────────────────────────────────────────────────────

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
  [key: string]: unknown;
}

export interface ToolCallEntry {
  tool_name: string;
  arguments: Record<string, unknown>;
  is_finished: boolean;
  result: unknown;
}

// ── Agent 类型 ──────────────────────────────────────────────────────────────

export interface SchemaProperty {
  description?: string;
  type?: string;
  enum?: string[];
  minLength?: number;
  items?: SchemaProperty;
  [key: string]: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type?: string;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface AgentBase {
  agent_id: string;
  current_sys_prompt: unknown;
  current_messages: AnthropicMessage[];
  tools: ToolDef[];
  tools_call_result_map: Record<string, ToolCallEntry>;
}

export interface SessionHistoryEntry {
  sys_prompt: unknown;
  messages: AnthropicMessage[];
  sub_agents: SubAgent[];                            // 归档时的子智能体快照
  tools_call_result_map: Record<string, ToolCallEntry>; // 用于重建子智能体标签
  archived_at: string;
}

export interface MainAgent extends AgentBase {
  session_history_list: SessionHistoryEntry[];
  sub_agents: SubAgent[];
}

export interface SubAgent extends AgentBase {
  // agent_id 直接使用父 agent 的 tool_call_id
  prompt: string;
  is_finished: boolean;
  sub_agents: SubAgent[];
}

// ── Session 类型 ────────────────────────────────────────────────────────────

export interface SessionStats {
  total_requests: number;
  models_used: Record<string, number>;
  conversation_rounds?: number;
  sub_agent_count?: number;
  compression_count?: number;
}

export interface Session {
  session_id: string;
  session_name: string;
  main_agent: MainAgent;
  created_at: string;
  updated_at: string;
  stats: SessionStats;
  pending_compression_summary?: string;              // 压缩后等待恢复的摘要片段
}

export interface SessionSummary {
  session_id: string;
  session_name: string;
  created_at: string;
  updated_at: string;
  stats: SessionStats;
}

// ── 前端展示用的对话树节点 ──────────────────────────────────────────────────

/** 对话树节点类型 */
export type ConvNodeType = 'user' | 'assistant_text' | 'thinking' | 'tool_call' | 'agent_call';

/** tool_use + tool_result 配对后的节点 */
export interface ToolCallNode {
  type: 'tool_call';
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  isFinished: boolean;
  result?: string;
  isError?: boolean;
}

/** Agent 工具调用节点（特殊的 tool_call） */
export interface AgentCallNode {
  type: 'agent_call';
  toolCallId: string;
  input: Record<string, unknown>;
  isFinished: boolean;
  result?: string;
  subAgentId?: string;  // 关联的子智能体 agent_id
}

/** 文本/思考节点 */
export interface TextNode {
  type: 'user' | 'assistant_text' | 'thinking';
  text: string;
}

/** 对话树节点联合类型 */
export type ConvNode = TextNode | ToolCallNode | AgentCallNode;

// ── API 响应格式 ────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
