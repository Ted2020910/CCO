import chalk from 'chalk';

export async function statusCommand(options: { port?: string }): Promise<void> {
  const port = Number(options.port) || 9527;

  // 检查服务是否在线
  let online = false;
  let sessionCount = 0;
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    online = res.ok;

    if (online) {
      const sessionsRes = await fetch(`http://localhost:${port}/api/sessions`, { signal: AbortSignal.timeout(2000) });
      if (sessionsRes.ok) {
        const data = await sessionsRes.json() as { data?: { sessions?: unknown[] } };
        sessionCount = data?.data?.sessions?.length ?? 0;
      }
    }
  } catch { /* not running */ }

  console.log(chalk.bold.blue('\n🔭 CCO Status\n'));
  console.log(`  服务状态: ${online
    ? chalk.green('● 运行中') + chalk.gray(` (port ${port})`)
    : chalk.red('● 未运行')}`);

  if (online) {
    console.log(`  活跃 Session: ${chalk.yellow(sessionCount)}`);
    console.log(`\n  Dashboard : ${chalk.underline.cyan(`http://localhost:${port}`)}`);
  }
  console.log();
}
