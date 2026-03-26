import chalk from 'chalk';
import { createServer } from '../../proxy/server.js';
import { writeConfig } from '../../storage/config.js';
import { generateId } from '../../shared/utils.js';

export function initCommand(options: { port?: string }): void {
  const port = Number(options.port) || 9527;
  const sessionId = generateId();

  // 持久化配置
  writeConfig({ port });

  console.log(chalk.bold.blue('\n🔭 Claude Code Observer\n'));
  console.log(`  ${chalk.gray('Session ID:')} ${chalk.yellow(sessionId)}`);
  console.log(`  ${chalk.gray('Port      :')} ${chalk.yellow(port)}\n`);

  console.log(chalk.bold('接入 Claude Code：'));
  console.log(chalk.gray('  在项目的 .claude/settings.local.json 中添加：\n'));
  console.log(chalk.cyan(JSON.stringify(
    { env: { ANTHROPIC_BASE_URL: `http://localhost:${port}/proxy/${sessionId}` } },
    null, 2
  ).split('\n').map(l => `  ${l}`).join('\n')));
  console.log();

  createServer(port);
}
