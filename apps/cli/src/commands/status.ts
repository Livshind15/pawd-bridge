import { Command } from 'commander';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { readPid } from '../lib/process.js';
import { checkPort } from '../lib/ports.js';
import { IDENTITY_FILE } from '../lib/paths.js';
import { getStoredSubdomain } from '../lib/subdomain.js';
import { getSdkCredential } from '../lib/config.js';

const UP = chalk.green('●');
const DOWN = chalk.red('●');

async function fetchBridgeStatus(port: number): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://localhost:${port}/api/status`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      return (await res.json()) as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function statusCommand(): Command {
  return new Command('status')
    .description('Show status of bridge, API key, and Nginx')
    .action(async () => {
      console.log(chalk.bold('\n  Pawd Bridge — Status\n'));

      // Check bridge
      const pid = readPid();
      const bridgePort = 3001;
      const bridgePortUp = await checkPort(bridgePort);
      const bridgeRunning = pid !== null && bridgePortUp;

      let bridgeInfo = '';
      if (bridgeRunning) {
        const status = await fetchBridgeStatus(bridgePort);
        if (status) {
          const uptime = status.uptime ? ` uptime=${status.uptime}s` : '';
          const version = status.version ? ` v${status.version}` : '';
          bridgeInfo = chalk.dim(`${version}${uptime}`);
        }
      }

      // Check SDK credentials
      const credential = getSdkCredential();
      const authConfigured = credential.method !== 'none';

      // Check Nginx
      const nginxUp = await checkPort(80);

      // Check device identity
      const identityExists = existsSync(IDENTITY_FILE);

      // Check subdomain
      const subdomain = getStoredSubdomain();

      // Format output
      const padLabel = (label: string) => label.padEnd(20);

      console.log(`  ${bridgeRunning ? UP : DOWN}  ${padLabel('Bridge')}${bridgeRunning ? chalk.green('running') + (pid ? chalk.dim(` (PID ${pid})`) : '') : chalk.red('stopped')}  ${bridgeInfo}`);
      console.log(`  ${bridgePortUp ? UP : DOWN}  ${padLabel('Bridge port 3001')}${bridgePortUp ? chalk.green('listening') : chalk.red('not listening')}`);
      const authLabel = credential.method === 'oauth_token' ? 'Claude OAuth token' : credential.method === 'api_key' ? 'Anthropic API key' : 'SDK credentials';
      console.log(`  ${authConfigured ? UP : DOWN}  ${padLabel(authLabel)}${authConfigured ? chalk.green('configured') + chalk.dim(` (${credential.value.slice(0, 10)}...)`) : chalk.red('not set — add CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY to ~/.pawd/.env')}`);
      console.log(`  ${nginxUp ? UP : DOWN}  ${padLabel('Nginx (port 80)')}${nginxUp ? chalk.green('running') : chalk.red('not running')}`);
      console.log(`  ${identityExists ? UP : DOWN}  ${padLabel('Device identity')}${identityExists ? chalk.green('configured') : chalk.red('not found')}`);
      console.log(`  ${subdomain ? UP : DOWN}  ${padLabel('Subdomain')}${subdomain ? chalk.green(subdomain.fullDomain) : chalk.red('not provisioned')}`);

      console.log('');
    });
}
