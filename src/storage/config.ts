import fs from 'fs';
import path from 'path';
import { getCcoHome, todayString } from '../shared/utils.js';
import type { CcoConfig } from '../shared/types.js';

const CONFIG_FILE = path.join(getCcoHome(), 'config.json');

const DEFAULT_CONFIG: CcoConfig = {
  version: '1.0.0',
  port: 9527,
  dataDir: path.join(getCcoHome(), 'data'),
  logLevel: 'info',
};

/** 读取配置（不存在则返回默认值） */
export function readConfig(): CcoConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 写入配置 */
export function writeConfig(config: Partial<CcoConfig>): void {
  const current = readConfig();
  const merged = { ...current, ...config };
  ensureDir(path.dirname(CONFIG_FILE));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

/** 获取数据目录（按日期分目录） */
export function getDataDir(date?: string): string {
  const config = readConfig();
  return path.join(config.dataDir, date ?? todayString());
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
