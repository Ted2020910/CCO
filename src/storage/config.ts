import fs from 'fs';
import path from 'path';
import { getCcoHome } from '../shared/utils.js';
import type { CcoConfig } from '../shared/types.js';

/** 配置文件路径（惰性求值，确保 setCcoHome() 生效后再计算） */
function getConfigFile(): string {
  return path.join(getCcoHome(), 'config.json');
}

function getDefaultConfig(): CcoConfig {
  return {
    version: '1.0.0',
    port: 9527,
    dataDir: getCcoHome(),
    sessionsDir: path.join(getCcoHome(), 'sessions'),
    apiBaseUrl: 'https://api.anthropic.com',
    logLevel: 'info',
  };
}

/** 读取配置（不存在则返回默认值） */
export function readConfig(): CcoConfig {
  const configFile = getConfigFile();
  const defaults = getDefaultConfig();
  try {
    if (!fs.existsSync(configFile)) return { ...defaults };
    const raw = fs.readFileSync(configFile, 'utf-8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

/** 写入配置 */
export function writeConfig(config: Partial<CcoConfig>): void {
  const configFile = getConfigFile();
  const current = readConfig();
  const merged = { ...current, ...config };
  ensureDir(path.dirname(configFile));
  fs.writeFileSync(configFile, JSON.stringify(merged, null, 2), 'utf-8');
}

/** 获取 session 存储目录 */
export function getSessionsDir(): string {
  const config = readConfig();
  return config.sessionsDir;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
