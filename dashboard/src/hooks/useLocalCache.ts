// 本地存储缓存工具
// 为前端提供基于 localStorage 的数据持久化，确保页面刷新后能立即从缓存恢复 UI 状态

const PREFIX = 'cco-cache:';

interface CacheEntry<T> {
  data: T;
  savedAt: number; // unix ms
}

/**
 * 从 localStorage 读取缓存
 * @param key  缓存 key（不含前缀）
 * @returns    缓存的数据，若不存在或解析失败则返回 null
 */
export function getCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    return entry.data ?? null;
  } catch {
    return null;
  }
}

/**
 * 将数据写入 localStorage 缓存
 * @param key   缓存 key（不含前缀）
 * @param data  要缓存的数据
 */
export function setCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, savedAt: Date.now() };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage 满额或隐私模式，静默忽略
  }
}

/**
 * 删除指定缓存项
 */
export function removeCache(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch { /* ignore */ }
}
