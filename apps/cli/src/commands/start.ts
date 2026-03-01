import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import { existsSync, openSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { DATA_DIR, LOG_FILE, PAWD_HOME, getActiveBridgeDir } from '../lib/paths.js';
import { readPid, writePid } from '../lib/process.js';
import { getAnthropicApiKey, getClaudeOAuthToken } from '../lib/config.js';
import { checkPort } from '../lib/ports.js';
import { isRoot, PAWD_SERVICE_USER } from '../lib/user.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startCommand(): Command {
  return new Command('start')
    .description('Start the Pawd bridge as a background service')
    .option('--port <port>', 'Bridge port', '3001')
    .option('--foreground', 'Run in foreground (no daemon)')
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);
      console.log(chalk.bold('\n  Pawd Bridge — Start\n'));

      // Check if already running
      const existingPid = readPid();
      if (existingPid) {
        console.log(chalk.yellow(`  Bridge is already running (PID ${existingPid})`));
        console.log(chalk.dim('  Use "pawd stop" to stop it first\n'));
        return;
      }

      // Resolve the bridge directory (installed copy when root, source otherwise)
      const bridgeDir = getActiveBridgeDir();
      const bridgeEntry = join(bridgeDir, 'dist', 'index.js');
      if (!existsSync(bridgeEntry)) {
        console.log(chalk.red('  Bridge is not built. Run "pawd install" first.'));
        console.log(chalk.dim(`  Expected: ${bridgeEntry}\n`));
        process.exit(1);
      }

      // Read SDK credentials
      const oauthToken = getClaudeOAuthToken();
      const apiKey = getAnthropicApiKey();
      if (!oauthToken && !apiKey) {
        console.log(chalk.yellow('  Warning: No SDK credentials found'));
        console.log(chalk.dim('  Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in ~/.pawd/.env\n'));
      }

      // Ensure data dir exists
      mkdirSync(DATA_DIR, { recursive: true });

      // Ensure log directory exists
      mkdirSync(dirname(LOG_FILE), { recursive: true });

      // When running as root, ensure dirs are owned by the service user
      if (isRoot()) {
        try {
          execSync(
            `chown -R ${PAWD_SERVICE_USER}:${PAWD_SERVICE_USER} "${PAWD_HOME}"`,
            { stdio: 'pipe' },
          );
        } catch { /* best-effort */ }
      }

      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        PORT: String(port),
        DATA_DIR,
      };
      if (oauthToken) {
        env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
      }
      if (apiKey) {
        env.ANTHROPIC_API_KEY = apiKey;
      }

      // When running as root, set HOME to the service user's home
      // so the bridge (and Claude Code CLI) resolve paths correctly
      if (isRoot()) {
        const { getPawdUserHome } = await import('../lib/user.js');
        env.HOME = getPawdUserHome();
      }

      if (opts.foreground) {
        // Foreground mode: stdio inherited, no detach
        if (isRoot()) {
          console.log(chalk.cyan(`  Starting bridge on port ${port} as user ${PAWD_SERVICE_USER} (foreground)...\n`));
        } else {
          console.log(chalk.cyan(`  Starting bridge on port ${port} (foreground)...\n`));
        }

        const child = isRoot()
          ? spawn('sudo', ['-u', PAWD_SERVICE_USER, '-E', 'node', bridgeEntry], {
              env,
              stdio: 'inherit',
            })
          : spawn('node', ['dist/index.js'], {
              cwd: bridgeDir,
              env,
              stdio: 'inherit',
            });

        child.on('exit', (code) => {
          console.log(chalk.dim(`\n  Bridge exited with code ${code}`));
          process.exit(code ?? 0);
        });

        // Forward signals
        const signalHandler = (sig: NodeJS.Signals) => {
          child.kill(sig);
        };
        process.on('SIGINT', () => signalHandler('SIGINT'));
        process.on('SIGTERM', () => signalHandler('SIGTERM'));
        return;
      }

      // Daemon mode
      const spinner = ora('Starting bridge daemon').start();

      if (isRoot()) {
        spinner.text = `Starting bridge daemon as user ${PAWD_SERVICE_USER}...`;
      }

      try {
        const logFd = openSync(LOG_FILE, 'a');

        // Fix log file ownership so the service user can write to it
        if (isRoot()) {
          try {
            execSync(
              `chown ${PAWD_SERVICE_USER}:${PAWD_SERVICE_USER} "${LOG_FILE}"`,
              { stdio: 'pipe' },
            );
          } catch { /* best-effort */ }
        }

        const child = isRoot()
          ? spawn('sudo', ['-u', PAWD_SERVICE_USER, '-E', 'node', bridgeEntry], {
              env,
              detached: true,
              stdio: ['ignore', logFd, logFd],
            })
          : spawn('node', ['dist/index.js'], {
              cwd: bridgeDir,
              env,
              detached: true,
              stdio: ['ignore', logFd, logFd],
            });

        child.unref();

        if (!child.pid) {
          spinner.fail('Failed to start bridge (no PID)');
          process.exit(1);
        }

        writePid(child.pid);
        spinner.text = `Bridge spawned (PID ${child.pid}), waiting for port ${port}...`;

        // Wait up to 5s for the port to become available
        let started = false;
        for (let i = 0; i < 10; i++) {
          await sleep(500);
          if (await checkPort(port)) {
            started = true;
            break;
          }
        }

        if (started) {
          const userInfo = isRoot() ? chalk.dim(` as ${PAWD_SERVICE_USER}`) : '';
          spinner.succeed(`Bridge is running on port ${port} (PID ${child.pid})${userInfo}`);
        } else {
          spinner.warn(`Bridge spawned (PID ${child.pid}) but port ${port} not yet responding`);
          console.log(chalk.dim(`  Check logs: pawd logs`));
        }
      } catch (err) {
        spinner.fail('Failed to start bridge');
        if (err instanceof Error) {
          console.error(chalk.red(`  ${err.message}`));
        }
        process.exit(1);
      }

      console.log('');
    });
}
