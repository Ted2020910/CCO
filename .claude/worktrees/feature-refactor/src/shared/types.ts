// 核心数据类型定义

export interface RequestRecord {
  id: string;
  sessionId: string;         // Claude Code session UUID (来自 /proxy/:uuid)
  timestamp: string;         // ISO 8601
  model: string;
  endpoint: string;          // 例如 v1/messages

  request: {
    messages: AnthropicMessage[];
    system?: string | AnthropicMessage[];
    max_tokens?: number;
    temperature?: number;
    tools?: unknown[];
    stream?: boolean;
    [key: string]: unknown;
  };

  response?: {
    id?: string;
    type?: string;
    role?: string;
    content?: AnthropicContent[];
    stop_reason?: string;
    stop_sequence?: string | null;
    [key: string]: unknown;
  };

  usage?: TokenUsage;
  cost?: CostBreakdown;
  duration_ms?: number;

  status: 'pending' | 'completed' | 'error';
  error?: string;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

export interface AnthropicContent {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  [key: string]: unknown;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface CostBreakdown {
  input_usd: number;
  output_usd: number;
  cache_write_usd?: number;
  cache_read_usd?: number;
  total_usd: number;
}

// 聚合统计
export interface DailyStats {
  date: string;
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  sessions: string[];         // 去重 sessionId 列表
  models: Record<string, number>; // 模型 → 调用次数
}

export interface SessionSummary {
  sessionId: string;
  firstCall: string;
  lastCall: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  models: string[];
}

// 配置
export interface CcoConfig {
  version: string;
  port: number;
  dataDir: string;            // 数据存储目录，默认 ~/.cco/data
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  anthropicApiKey?: string;   // 可选，从环境变量读取
}

// API 响应格式
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StatsResponse {
  today: DailyStats;
  last7Days: DailyStats[];
  allTime: {
    total_requests: number;
    total_cost_usd: number;
    total_sessions: number;
  };
}
