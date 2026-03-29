import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
/** 生成唯一 ID */
export function generateId() {
    return randomUUID();
}
/** 获取当前 UTC 日期字符串，格式：YYYY-MM-DD */
export function todayString() {
    return new Date().toISOString().slice(0, 10);
}
/** CCO 数据目录：相对于本文件所在位置动态计算（dist/shared/utils.js → ../../data） */
export function getCcoHome() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // dist/shared/utils.js → 向上两级到项目根目录 → 再进入 data/
    return path.resolve(__dirname, '../../data');
}
/** 格式化 token 数量（如 1,234,567 → 1.23M） */
export function formatTokens(n) {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
/** 格式化持续时间（毫秒 → 可读字符串） */
export function formatDuration(ms) {
    if (ms < 1_000)
        return `${ms}ms`;
    if (ms < 60_000)
        return `${(ms / 1_000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}
/** 深克隆对象（用于不可变数据传递） */
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
