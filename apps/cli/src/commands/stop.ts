import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readPid, removePid } from '../lib/process.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopCommand(): Command {
  return new Command('stop')
    .description('Stop the running Pawd bridge')
    .option('--force', 'Force kill (SIGKILL)')
    .action(async (opts) => {
      console.log(chalk.bold('\n  Pawd Bridge — Stop\n'));

      const pid = readPid();
      if (!pid) {
        console.log(chalk.yellow('  Bridge is not running (no PID found)\n'));
        return;
      }

      const spinner = ora(`Stopping bridge (PID ${pid})`).start();

      try {
        // Send SIGTERM
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process already gone
        spinner.succeed('Bridge process already stopped');
        removePid();
        console.log('');
        return;
      }

      // Poll for up to 5s (every 500ms)
      let stopped = false;
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        if (!isAlive(pid)) {
          stopped = true;
          break;
        }
      }

      if (stopped) {
        spinner.succeed(`Bridge stopped (PID ${pid})`);
        removePid();
        console.log('');
        return;
      }

      // Still alive after 5s
      if (opts.force) {
        spinner.text = `Force killing bridge (PID ${pid})...`;
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already dead
        }

        // Wait a moment for SIGKILL to take effect
        await sleep(500);

        if (!isAlive(pid)) {
          spinner.succeed(`Bridge force killed (PID ${pid})`);
        } else {
          spinner.fail(`Failed to kill bridge (PID ${pid})`);
        }
      } else {
        spinner.warn(`Bridge did not stop within 5s (PID ${pid})`);
        console.log(chalk.dim('  Use "pawd stop --force" to send SIGKILL'));
      }

      removePid();
      console.log('');
    });
}
