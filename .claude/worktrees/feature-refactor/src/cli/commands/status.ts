import chalk from 'chalk';
import { getDailyStats, getAvailableDates } from '../../storage/sessions.js';
import { todayString, formatTokens } from '../../shared/utils.js';

export async function statusCommand(options: { port?: string }): Promise<void> {
  const port = Number(options.port) || 9527;

  // 检查服务是否在线
  let online = false;
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    online = res.ok;
  } catch { /* not running */ }

  console.log(chalk.bold.blue('\n🔭 CCO Status\n'));
  console.log(`  服务状态: ${online
    ? chalk.green('● 运行中') + chalk.gray(` (port ${port})`)
    : chalk.red('● 未运行')}`);

  // 今日统计
  const today = getDailyStats(todayString());
  const dates  = getAvailableDates();

  console.log(`\n${chalk.bold('今日统计')} ${chalk.gray(`(${todayString()})`)}`);
  console.log(`  请求次数  : ${chalk.yellow(today.total_requests)}`);
  console.log(`  输入 Token: ${chalk.yellow(formatTokens(today.total_input_tokens))}`);
  console.log(`  输出 Token: ${chalk.yellow(formatTokens(today.total_output_tokens))}`);
  console.log(`  预计费用  : ${chalk.green('$' + today.total_cost_usd.toFixed(4))}`);
  console.log(`  活跃 Session: ${chalk.yellow(today.sessions.length)}`);

  if (dates.length > 1) {
    console.log(`\n${chalk.bold('历史数据')}`);
    console.log(`  有记录天数 : ${chalk.yellow(dates.length)}`);
    console.log(`  最早记录   : ${chalk.gray(dates[0])}`);
  }

  if (online) {
    console.log(`\n  Dashboard : ${chalk.underline.cyan(`http://localhost:${port}`)}`);
  }
  console.log();
}
