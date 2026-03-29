#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { openCommand } from './commands/open.js';

const program = new Command();

program
  .name('cco')
  .description('Claude Code Observer — 监控 Claude Code 的 API 调用、Token 用量与费用')
  .version('1.0.0');

program
  .command('init')
  .description('初始化并启动 CCO 代理服务')
  .option('-p, --port <port>', '指定端口', '9527')
  .option('-u, --url <url>', '指定 Anthropic API 地址（支持中转）', 'https://api.anthropic.com')
  .option('-d, --data <path>', '指定数据存储目录（默认 ./data）')
  .action(initCommand);

program
  .command('status')
  .description('查看 CCO 服务运行状态与今日统计')
  .option('-p, --port <port>', '指定端口', '9527')
  .action(statusCommand);

program
  .command('open')
  .description('在浏览器中打开 Dashboard')
  .option('-p, --port <port>', '指定端口', '9527')
  .action(openCommand);

program.addHelpText('after', `
${chalk.bold('使用示例：')}
  ${chalk.cyan('cco init')}                           启动代理服务（默认端口 9527）
  ${chalk.cyan('cco init -p 8080')}                   使用自定义端口
  ${chalk.cyan('cco init -u https://your-api.com')}  使用自定义 API 地址（中转服务）
  ${chalk.cyan('cco init -d /path/to/data')}         自定义数据存储目录
  ${chalk.cyan('cco status')}                         查看服务状态
  ${chalk.cyan('cco open')}                           打开 Dashboard

${chalk.bold('接入 Claude Code：')}
  在项目的 ${chalk.yellow('.claude/settings.local.json')} 中设置：
  ${chalk.gray('{ "env": { "ANTHROPIC_BASE_URL": "http://localhost:9527/proxy" } }')}
`);

program.parse();
