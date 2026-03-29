import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

/** 生成唯一 ID */
export function generateId(): string {
  return randomUUID();
}

/** 获取当前 UTC 日期字符串，格式：YYYY-MM-DD */
export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── 可配置数据目录 ─────────────────────────────────────────────────────────
// 通过 setCcoHome() 在启动时设置；未设置时回退到项目根 ./data
let _dataDir: string | null = null;

/** 获取项目根目录（基于编译产物位置推算） */
function getProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // dist/shared/utils.js → 向上两级到项目根目录
  return path.resolve(__dirname, '../..');
}

/**
 * 设置 CCO 数据目录（在 CLI init 时调用）
 * @param dir 绝对路径或相对于 cwd 的路径
 */
export function setCcoHome(dir: string): void {
  _dataDir = path.resolve(dir);
}

/**
 * 获取 CCO 数据目录
 * 优先级：setCcoHome() 设置值 > 默认 <project-root>/data
 */
export function getCcoHome(): string {
  if (_dataDir) return _dataDir;
  return path.join(getProjectRoot(), 'data');
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
