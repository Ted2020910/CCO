import { randomUUID } from 'crypto';
import path from 'path';
import os from 'os';

/** 生成唯一 ID */
export function generateId(): string {
  return randomUUID();
}

/** 获取当前 UTC 日期字符串，格式：YYYY-MM-DD */
export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 默认 CCO 主目录：~/.cco */
export function getCcoHome(): string {
  return path.join(os.homedir(), '.cco');
}

/** 格式化 token 数量（如 1,234,567 → 1.23M） */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 格式化持续时间（毫秒 → 可读字符串） */
export function formatDuration(ms: number): string {
  if (ms < 1_000)  return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

/** 深克隆对象（用于不可变数据传递） */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
