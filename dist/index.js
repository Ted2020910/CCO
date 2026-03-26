#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
const program = new Command();
// 先定义基本信息
program
    .name('cco')
    .description('Claude Code Observer - 监控工具')
    .version('1.0.0');
// 然后定义命令
program
    .command('init')
    .description('初始化并启动服务')
    .option('-p, --port <port>', '指定端口', '9527')
    .action(initCommand);
program
    .command('hello')
    .description('测试命令')
    .action(() => {
    console.log(chalk.green('✅ Hello from CCO!'));
});
program.parse();
