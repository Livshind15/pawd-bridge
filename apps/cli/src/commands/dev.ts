import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import chalk from 'chalk';
import { BRIDGE_DIR, DATA_DIR, PAWD_HOME } from '../lib/paths.js';
import { getAnthropicApiKey, getClaudeOAuthToken } from '../lib/config.js';
import { isRoot, getPawdUserHome, PAWD_SERVICE_USER } from '../lib/user.js';

export function devCommand(): Command {
  return new Command('dev')
    .description('Run the bridge in foreground with logs visible (development mode)')
    .option('--port <port>', 'Bridge port', '3001')
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);

      // Check the source bridge directory exists
      const bridgeSrc = join(BRIDGE_DIR, 'src', 'index.ts');
      if (!existsSync(bridgeSrc)) {
        console.log(chalk.red('  Bridge source not found.'));
        console.log(chalk.dim(`  Expected: ${bridgeSrc}\n`));
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

      // Resolve tsx binary from the bridge's node_modules
      const tsxBin = join(BRIDGE_DIR, 'node_modules', '.bin', 'tsx');
      const tsxCmd = existsSync(tsxBin) ? tsxBin : 'tsx';

      if (isRoot()) {
        env.HOME = getPawdUserHome();

        console.log(chalk.cyan(`  Starting bridge on port ${port} as user ${PAWD_SERVICE_USER}...\n`));

        // Fix ownership before starting
        try {
          execSync(
            `chown -R ${PAWD_SERVICE_USER}:${PAWD_SERVICE_USER} "${PAWD_HOME}"`,
            { stdio: 'pipe' },
          );
        } catch { /* best-effort */ }

        // Give the pawd user read+traverse access to the bridge directory
        // and all parent directories (needed when source is under /root/)
        try {
          // Collect all parent directories up to /
          const resolvedBridge = resolve(BRIDGE_DIR);
          const parents: string[] = [];
          let cur = resolvedBridge;
          while (cur !== '/') {
            parents.push(cur);
            cur = dirname(cur);
          }
          // chmod from top-most parent down so pawd can traverse
          for (const d of parents.reverse()) {
            try {
              execSync(`chmod o+x "${d}"`, { stdio: 'pipe' });
            } catch { /* skip dirs we can't change */ }
          }
          // Make bridge contents readable
          execSync(`chmod -R o+rX "${resolvedBridge}"`, { stdio: 'pipe' });
        } catch { /* best-effort */ }

        const child = spawn(
          'sudo',
          ['-u', PAWD_SERVICE_USER, '-E', tsxCmd, 'watch', 'src/index.ts'],
          { cwd: BRIDGE_DIR, env, stdio: 'inherit' },
        );

        child.on('exit', (code) => {
          process.exit(code ?? 0);
        });

        const signalHandler = (sig: NodeJS.Signals) => { child.kill(sig); };
        process.on('SIGINT', () => signalHandler('SIGINT'));
        process.on('SIGTERM', () => signalHandler('SIGTERM'));
      } else {
        console.log(chalk.cyan(`  Starting bridge on port ${port}...\n`));

        const child = spawn(tsxCmd, ['watch', 'src/index.ts'], {
          cwd: BRIDGE_DIR,
          env,
          stdio: 'inherit',
        });

        child.on('exit', (code) => {
          process.exit(code ?? 0);
        });

        const signalHandler = (sig: NodeJS.Signals) => { child.kill(sig); };
        process.on('SIGINT', () => signalHandler('SIGINT'));
        process.on('SIGTERM', () => signalHandler('SIGTERM'));
      }
    });
}
