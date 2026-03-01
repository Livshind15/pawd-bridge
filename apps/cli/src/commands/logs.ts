import { Command } from 'commander';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { LOG_FILE } from '../lib/paths.js';

export function logsCommand(): Command {
  return new Command('logs')
    .description('Tail bridge logs')
    .option('--lines <n>', 'Number of lines to show', '50')
    .option('--no-follow', 'Do not follow (just show last N lines)')
    .action(async (opts) => {
      if (!existsSync(LOG_FILE)) {
        console.log(chalk.yellow('\n  No log file found.'));
        console.log(chalk.dim(`  Expected: ${LOG_FILE}`));
        console.log(chalk.dim('  Start the bridge first: pawd start\n'));
        return;
      }

      const lines = opts.lines || '50';
      const follow = opts.follow !== false;

      const args = follow
        ? ['-f', '-n', lines, LOG_FILE]
        : ['-n', lines, LOG_FILE];

      const tail = spawn('tail', args, {
        stdio: 'inherit',
      });

      // Handle SIGINT for clean exit
      const cleanup = () => {
        tail.kill('SIGTERM');
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      tail.on('exit', (code) => {
        process.removeListener('SIGINT', cleanup);
        process.removeListener('SIGTERM', cleanup);
        process.exit(code ?? 0);
      });

      tail.on('error', (err) => {
        console.error(chalk.red(`  Failed to tail logs: ${err.message}`));
        process.exit(1);
      });
    });
}
