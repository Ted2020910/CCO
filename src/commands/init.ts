import chalk from 'chalk';

import { createServer } from '../server/index.js';

export function initCommand(options: { port?: number }) {
  const port = Number(options.port) || 9527;

  console.log(chalk.blue(`🚀 启动服务...`));

  createServer(port);

  console.log(chalk.green(`✅ 服务已启动: http://localhost:${port}`));
}