// 与后端 src/shared/types.ts 保持同步的前端类型定义

export interface RequestRecord {
  id: string;
  sessionId: string;
  timestamp: string;
  model: string;
  endpoint: string;
  request: {
    messages?: Array<{ role: string; content: unknown }>;
    system?: unknown;
    max_tokens?: number;
    temperature?: number;
    tools?: unknown[];
    stream?: boolean;
    [key: string]: unknown;
  };
  response?: Record<string, unknown>;
  usage?: TokenUsage;
  cost?: CostBreakdown;
  duration_ms?: number;
  status: 'pending' | 'completed' | 'error';
  error?: string;
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

export interface DailyStats {
  date: string;
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  sessions: string[];
  models: Record<string, number>;
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

export interface StatsResponse {
  today: DailyStats;
  last7Days: DailyStats[];
  allTime: {
    total_requests: number;
    total_cost_usd: number;
    total_sessions: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
