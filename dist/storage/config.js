import fs from 'fs';
import path from 'path';
import { getCcoHome } from '../shared/utils.js';
const CONFIG_FILE = path.join(getCcoHome(), 'config.json');
const DEFAULT_CONFIG = {
    version: '1.0.0',
    port: 9527,
    dataDir: getCcoHome(),
    sessionsDir: path.join(getCcoHome(), 'sessions'),
    apiBaseUrl: 'https://api.anthropic.com',
    logLevel: 'info',
};
/** 读取配置（不存在则返回默认值） */
export function readConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE))
            return { ...DEFAULT_CONFIG };
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
    catch {
        return { ...DEFAULT_CONFIG };
    }
}
/** 写入配置 */
export function writeConfig(config) {
    const current = readConfig();
    const merged = { ...current, ...config };
    ensureDir(path.dirname(CONFIG_FILE));
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}
/** 获取 session 存储目录 */
export function getSessionsDir() {
    const config = readConfig();
    return config.sessionsDir;
}
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
