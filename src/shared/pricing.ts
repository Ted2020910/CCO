import type { TokenUsage, CostBreakdown } from './types.js';

// Anthropic 模型定价表（每百万 token，USD）
// 参考：https://www.anthropic.com/pricing
const MODEL_PRICING: Record<string, {
  input: number;           // $ per 1M input tokens
  output: number;          // $ per 1M output tokens
  cacheWrite?: number;     // $ per 1M cache write tokens
  cacheRead?: number;      // $ per 1M cache read tokens
}> = {
  // Claude 4 系列
  'claude-opus-4-5':              { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-5':            { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },

  // Claude 3.7 系列
  'claude-sonnet-3-7':            { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },

  // Claude 3.5 系列
  'claude-opus-3-5':              { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-3-5':            { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-haiku-3-5':             { input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },

  // Claude 3 系列
  'claude-opus-3':                { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-3':              { input:  3.00, output: 15.00 },
  'claude-haiku-3':               { input:  0.25, output:  1.25, cacheWrite:  0.30, cacheRead: 0.03 },
};

const PER_MILLION = 1_000_000;

/**
 * 根据 model 名称获取定价，支持部分匹配（如 claude-opus-4-5-20251101）
 */
function getPricing(model: string) {
  // 精确匹配
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  // 前缀模糊匹配（处理带日期后缀的版本号）
  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return price;
  }

  // 兜底：未知模型用 sonnet 定价
  console.warn(`[pricing] Unknown model: ${model}, using claude-sonnet-3-5 pricing as fallback`);
  return MODEL_PRICING['claude-sonnet-3-5'];
}

/**
 * 根据 token 用量计算费用
 */
export function calculateCost(model: string, usage: TokenUsage): CostBreakdown {
  const pricing = getPricing(model);

  const input_usd  = (usage.input_tokens  / PER_MILLION) * pricing.input;
  const output_usd = (usage.output_tokens / PER_MILLION) * pricing.output;

  const cache_write_usd = (usage.cache_creation_input_tokens && pricing.cacheWrite)
    ? (usage.cache_creation_input_tokens / PER_MILLION) * pricing.cacheWrite
    : undefined;

  const cache_read_usd = (usage.cache_read_input_tokens && pricing.cacheRead)
    ? (usage.cache_read_input_tokens / PER_MILLION) * pricing.cacheRead
    : undefined;

  const total_usd =
    input_usd +
    output_usd +
    (cache_write_usd ?? 0) +
    (cache_read_usd ?? 0);

  return {
    input_usd:       round8(input_usd),
    output_usd:      round8(output_usd),
    cache_write_usd: cache_write_usd !== undefined ? round8(cache_write_usd) : undefined,
    cache_read_usd:  cache_read_usd  !== undefined ? round8(cache_read_usd)  : undefined,
    total_usd:       round8(total_usd),
  };
}

/** 格式化费用为可读字符串 */
export function formatCost(usd: number): string {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(4)}m`;  // 毫美元
  return `$${usd.toFixed(4)}`;
}

/** 获取支持的模型列表 */
export function getSupportedModels(): string[] {
  return Object.keys(MODEL_PRICING);
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
