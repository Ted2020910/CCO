import chalk from 'chalk';
import { exec } from 'child_process';

export function openCommand(options: { port?: string }): void {
  const port = Number(options.port) || 9527;
  const url  = `http://localhost:${port}`;

  console.log(`${chalk.blue('🌐 打开 Dashboard:')} ${chalk.underline.cyan(url)}\n`);

  // 跨平台打开浏览器
  const cmd =
    process.platform === 'win32'  ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
                                    `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(chalk.yellow('  无法自动打开浏览器，请手动访问上面的地址'));
    }
  });
}
