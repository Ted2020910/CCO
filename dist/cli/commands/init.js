import chalk from 'chalk';
import { createServer } from '../../proxy/server.js';
import { writeConfig } from '../../storage/config.js';
export function initCommand(options) {
    const port = Number(options.port) || 9527;
    const apiBaseUrl = options.url || 'https://api.anthropic.com';
    // 持久化配置
    writeConfig({ port, apiBaseUrl });
    console.log(chalk.bold.blue('\n🔭 Claude Code Observer\n'));
    console.log(`  ${chalk.gray('Port      :')} ${chalk.yellow(port)}`);
    console.log(`  ${chalk.gray('Target API:')} ${chalk.yellow(apiBaseUrl)}\n`);
    console.log(chalk.bold('接入 Claude Code：'));
    console.log(chalk.gray('  在项目的 .claude/settings.local.json 中添加：\n'));
    console.log(chalk.cyan(JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://localhost:${port}/proxy` } }, null, 2).split('\n').map(l => `  ${l}`).join('\n')));
    console.log();
    console.log(chalk.gray('  session_id 会自动从请求的 metadata 中提取，无需手动指定。\n'));
    createServer(port);
}
