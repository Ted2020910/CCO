// ============================================================================
// CCO 核心数据类型定义
// ============================================================================

// ── Anthropic API 基础类型 ──────────────────────────────────────────────────

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image';
  // text block
  text?: string;
  // thinking block
  thinking?: string;
  // tool_use block
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result block
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
  // 其他扩展字段
  [key: string]: unknown;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// ── 工具调用追踪 ────────────────────────────────────────────────────────────

export interface ToolCallEntry {
  tool_name: string;
  arguments: Record<string, unknown>;
  is_finished: boolean;
  result: unknown;
}

// ── Agent 基础接口 ──────────────────────────────────────────────────────────

export interface AgentBase {
  agent_id: string;
  current_sys_prompt: unknown;                      // Anthropic system 格式（数组或字符串）
  current_messages: AnthropicMessage[];              // 当前对话历史（Anthropic 格式）
  tools: unknown[];                                  // 工具定义列表
  tools_call_result_map: Record<string, ToolCallEntry>;
  _synced_message_count?: number;                    // 全量同步时的消息数量（不含响应阶段 append 的 assistant）
                                                     // HEAD_MATCH 只比较前 _synced_message_count 条消息
                                                     // 避免 SSE 重建的 assistant 与 CC 发送的版本不一致导致匹配失败
}

// ── 主智能体 ────────────────────────────────────────────────────────────────

export interface MainAgent extends AgentBase {
  session_history_list: SessionHistoryEntry[];        // 压缩归档
  sub_agents: SubAgent[];
}

export interface SessionHistoryEntry {
  sys_prompt: unknown;
  messages: AnthropicMessage[];
  sub_agents: SubAgent[];                            // 归档时的子智能体快照
  tools_call_result_map: Record<string, ToolCallEntry>; // 用于重建子智能体标签
  archived_at: string;                               // ISO 8601
}

// ── 子智能体 ────────────────────────────────────────────────────────────────

export interface SubAgent extends AgentBase {
  // agent_id 直接使用父 agent 的 tool_call_id（即 tools_call_result_map 的 key）
  // 这样 tool_result.tool_use_id === sub_agent.agent_id，天然关联
  prompt: string;                                    // Agent 工具调用的 prompt 参数，用于身份辨识
  is_finished: boolean;                              // 该子智能体是否已完成任务（由父 agent 的 tool_result 驱动）
  sub_agents: SubAgent[];                            // general-purpose 子智能体可再调 Agent
}

// ── Session ─────────────────────────────────────────────────────────────────

export interface Session {
  session_id: string;
  session_name: string;                              // 默认为首条 user message，可被命名请求更新
  main_agent: MainAgent;
  created_at: string;                                // ISO 8601
  updated_at: string;                                // ISO 8601
  stats: SessionStats;
  pending_compression_summary?: boolean;              // 压缩后待恢复标记（true 表示下一个请求应恢复为主智能体）
}

export interface SessionStats {
  total_requests: number;
  models_used: Record<string, number>;               // model → 调用次数
}

// ── Session 列表概要（给 API 返回用） ───────────────────────────────────────

export interface SessionSummary {
  session_id: string;
  session_name: string;
  created_at: string;
  updated_at: string;
  stats: SessionStats & {
    conversation_rounds?: number;
    sub_agent_count?: number;
    compression_count?: number;
  };
}

// ── 配置 ────────────────────────────────────────────────────────────────────

export interface CcoConfig {
  version: string;
  port: number;
  dataDir: string;
  sessionsDir: string;
  apiBaseUrl: string;                                    // Anthropic API 地址（支持中转）
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// ── API 响应格式 ────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── 请求记录（仅 interceptor 内部流转，不再持久化） ─────────────────────────

export interface RequestRecord {
  id: string;
  sessionId: string;
  timestamp: string;                                 // ISO 8601
  model: string;
  endpoint: string;
  request: Record<string, unknown>;
  response?: Record<string, unknown>;
  status: 'pending' | 'completed' | 'error';
  error?: string;
  classification?: ClassificationType;               // 请求分类标签
}

// ── 请求分类 ────────────────────────────────────────────────────────────────

export type ClassificationType =
  | 'main_agent'
  | 'compression'
  | 'sub_agent_new'
  | 'sub_agent_continue'
  | 'unclassified';

export interface Classification {
  type: ClassificationType;
  agent?: AgentBase;                                 // 匹配到的已有 agent（continue 场景）
  parentAgent?: AgentBase;                           // 父 agent（sub_agent_new 场景）
  toolCallId?: string;                               // 父 agent 的 Agent tool_call id
  reason: string;                                    // 决策路径描述（debug 日志用）
}
