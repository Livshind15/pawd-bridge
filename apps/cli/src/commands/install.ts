import { Command } from 'commander';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import {
  BRIDGE_DIR,
  BRIDGE_INSTALL_DIR,
  NGINX_SCRIPT,
  PAWD_HOME,
  DATA_DIR,
  PAWD_CONFIG_DIR,
} from '../lib/paths.js';
import { getSdkCredential, persistEnvVar } from '../lib/config.js';
import {
  detectPublicIp,
  ensureDeviceId,
  provisionSubdomain,
  getStoredSubdomain,
} from '../lib/subdomain.js';
import {
  isRoot,
  pawdUserExists,
  createPawdUser,
  getPawdUserHome,
  PAWD_SERVICE_USER,
} from '../lib/user.js';

export function installCommand(): Command {
  return new Command('install')
    .description('Install dependencies, build bridge, setup Nginx + subdomain')
    .argument('[token]', 'API key or OAuth token (auto-detected by prefix)')
    .option('--skip-nginx', 'Skip Nginx installation')
    .option('--skip-build', 'Skip bridge build step')
    .option('--skip-subdomain', 'Skip automatic subdomain provisioning')
    .option('--domain <domain>', 'Manual domain for Nginx config (skips auto-provisioning)')
    .option('--api-key <key>', 'Set ANTHROPIC_API_KEY for Claude SDK')
    .option('--oauth-token <token>', 'Set CLAUDE_CODE_OAUTH_TOKEN for Claude subscription')
    .action(async (token: string | undefined, opts) => {
      // Auto-detect token type from positional argument
      if (token && !opts.oauthToken && !opts.apiKey) {
        if (token.startsWith('sk-ant-oat')) {
          opts.oauthToken = token;
        } else {
          opts.apiKey = token;
        }
      }
      console.log(chalk.bold('\n  Pawd Bridge — Install\n'));

      // Step 0: Create pawd service user (when running as root)
      if (isRoot()) {
        const userSpinner = ora('Setting up service user').start();
        if (pawdUserExists()) {
          userSpinner.succeed(
            `Service user ${chalk.cyan(PAWD_SERVICE_USER)} already exists`,
          );
        } else {
          try {
            createPawdUser();
            userSpinner.succeed(
              `Created service user ${chalk.cyan(PAWD_SERVICE_USER)} (home: ${chalk.dim(getPawdUserHome())})`,
            );
          } catch (err) {
            userSpinner.fail(`Failed to create service user "${PAWD_SERVICE_USER}"`);
            if (err instanceof Error) {
              console.error(chalk.red(`  ${err.message}`));
            }
            process.exit(1);
          }
        }

        // Ensure data directories exist and are owned by the service user
        const setupSpinner = ora('Setting up data directories').start();
        try {
          mkdirSync(DATA_DIR, { recursive: true });
          mkdirSync(PAWD_CONFIG_DIR, { recursive: true });
          execSync(
            `chown -R ${PAWD_SERVICE_USER}:${PAWD_SERVICE_USER} "${PAWD_HOME}" "${PAWD_CONFIG_DIR}"`,
            { stdio: 'pipe' },
          );
          setupSpinner.succeed(
            `Data directories ready (${chalk.dim(PAWD_HOME)})`,
          );
        } catch (err) {
          setupSpinner.fail('Failed to set up data directories');
          if (err instanceof Error) {
            console.error(chalk.red(`  ${err.message}`));
          }
          process.exit(1);
        }
      }

      // Step 1: Check Node.js
      const nodeSpinner = ora('Checking Node.js availability').start();
      try {
        const nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim();
        nodeSpinner.succeed(`Node.js found: ${chalk.cyan(nodeVersion)}`);
      } catch {
        nodeSpinner.fail('Node.js is not installed or not in PATH');
        console.log(chalk.yellow('  Install Node.js from https://nodejs.org/'));
        process.exit(1);
      }

      // Step 2: npm install in bridge
      const installSpinner = ora('Installing bridge dependencies').start();
      try {
        if (!existsSync(BRIDGE_DIR)) {
          installSpinner.fail(`Bridge directory not found: ${BRIDGE_DIR}`);
          process.exit(1);
        }
        execSync('npm install', {
          cwd: BRIDGE_DIR,
          stdio: 'pipe',
          encoding: 'utf-8',
        });
        installSpinner.succeed('Bridge dependencies installed');
      } catch (err) {
        installSpinner.fail('Failed to install bridge dependencies');
        if (err instanceof Error) {
          console.error(chalk.red(`  ${err.message}`));
        }
        process.exit(1);
      }

      // Step 3: Build bridge
      if (!opts.skipBuild) {
        const buildSpinner = ora('Building bridge').start();
        try {
          execSync('npm run build', {
            cwd: BRIDGE_DIR,
            stdio: 'pipe',
            encoding: 'utf-8',
          });
          buildSpinner.succeed('Bridge built successfully');
        } catch (err) {
          buildSpinner.fail('Failed to build bridge');
          if (err instanceof Error) {
            console.error(chalk.red(`  ${err.message}`));
          }
          process.exit(1);
        }
      } else {
        console.log(chalk.dim('  Skipping build (--skip-build)'));
      }

      // Step 3b: Install bridge to /opt/pawd/bridge/ (when running as root)
      if (isRoot()) {
        const copySpinner = ora('Installing bridge to /opt/pawd/bridge/').start();
        try {
          mkdirSync(BRIDGE_INSTALL_DIR, { recursive: true });
          // Copy dist, node_modules, and package.json
          execSync(
            `cp -r "${BRIDGE_DIR}/dist" "${BRIDGE_INSTALL_DIR}/" && ` +
            `cp -r "${BRIDGE_DIR}/node_modules" "${BRIDGE_INSTALL_DIR}/" && ` +
            `cp "${BRIDGE_DIR}/package.json" "${BRIDGE_INSTALL_DIR}/"`,
            { stdio: 'pipe', encoding: 'utf-8' },
          );
          execSync(
            `chown -R ${PAWD_SERVICE_USER}:${PAWD_SERVICE_USER} /opt/pawd`,
            { stdio: 'pipe' },
          );
          copySpinner.succeed(
            `Bridge installed to ${chalk.dim(BRIDGE_INSTALL_DIR)}`,
          );
        } catch (err) {
          copySpinner.fail('Failed to install bridge to /opt/pawd/bridge/');
          if (err instanceof Error) {
            console.error(chalk.red(`  ${err.message}`));
          }
          console.log(chalk.yellow('  The bridge can still run from the source directory.'));
        }
      }

      // Step 4: Check Claude Code CLI (required by SDK)
      const claudeSpinner = ora('Checking Claude Code CLI').start();
      try {
        const claudeVersion = execSync('claude --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
        claudeSpinner.succeed(`Claude Code CLI found: ${chalk.cyan(claudeVersion)}`);
      } catch {
        claudeSpinner.text = 'Installing Claude Code CLI...';
        try {
          execSync('npm install -g @anthropic-ai/claude-code@latest', {
            stdio: 'pipe',
            encoding: 'utf-8',
          });
          const ver = execSync('claude --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
          claudeSpinner.succeed(`Claude Code CLI installed: ${chalk.cyan(ver)}`);
        } catch (err) {
          claudeSpinner.fail('Failed to install Claude Code CLI');
          console.log(chalk.yellow('  Install manually: npm install -g @anthropic-ai/claude-code'));
          if (err instanceof Error) {
            console.error(chalk.dim(`  ${err.message.split('\n')[0]}`));
          }
        }
      }

      // Step 5: Persist credentials if provided via flags
      if (opts.oauthToken) {
        const saveSpinner = ora('Saving Claude OAuth token').start();
        persistEnvVar('CLAUDE_CODE_OAUTH_TOKEN', opts.oauthToken.trim());
        // When root, fix ownership of the env file
        if (isRoot()) {
          try {
            execSync(
              `chown -R ${PAWD_SERVICE_USER}:${PAWD_SERVICE_USER} "${PAWD_CONFIG_DIR}"`,
              { stdio: 'pipe' },
            );
          } catch { /* best-effort */ }
        }
        saveSpinner.succeed(`Claude OAuth token saved to ${chalk.dim('~/.pawd/.env')}`);
      }
      if (opts.apiKey) {
        const saveSpinner = ora('Saving Anthropic API key').start();
        persistEnvVar('ANTHROPIC_API_KEY', opts.apiKey.trim());
        if (isRoot()) {
          try {
            execSync(
              `chown -R ${PAWD_SERVICE_USER}:${PAWD_SERVICE_USER} "${PAWD_CONFIG_DIR}"`,
              { stdio: 'pipe' },
            );
          } catch { /* best-effort */ }
        }
        saveSpinner.succeed(`Anthropic API key saved to ${chalk.dim('~/.pawd/.env')}`);
      }

      // Step 6: Check SDK authentication
      const authSpinner = ora('Checking SDK credentials').start();
      const credential = getSdkCredential();
      if (credential.method === 'oauth_token') {
        authSpinner.succeed(`Claude OAuth token found (${chalk.dim(credential.value.slice(0, 12) + '...')})`);
      } else if (credential.method === 'api_key') {
        authSpinner.succeed(`Anthropic API key found (${chalk.dim(credential.value.slice(0, 8) + '...')})`);
      } else {
        authSpinner.warn('No SDK credentials found');
        console.log(chalk.yellow('  Set credentials with: pawd install --oauth-token <token>'));
        console.log(chalk.yellow('  Or:                   pawd install --api-key <key>'));
      }

      // Step 7: Subdomain provisioning (always runs unless skipped or manual domain)
      let domain = opts.domain || null;

      if (!opts.skipSubdomain && !opts.domain) {
        const subSpinner = ora('Provisioning subdomain').start();

        // Check if already provisioned
        const existing = getStoredSubdomain();
        if (existing) {
          domain = existing.fullDomain;
          subSpinner.succeed(
            `Subdomain already provisioned: ${chalk.cyan(`https://${existing.fullDomain}`)}`
          );
        } else {
          try {
            // Detect public IP
            subSpinner.text = 'Detecting public IP...';
            const ip = await detectPublicIp();
            subSpinner.text = `Public IP: ${ip} — setting up device identity...`;

            // Ensure device identity exists (generates if missing)
            const deviceId = ensureDeviceId();
            subSpinner.text = `Public IP: ${ip} — provisioning subdomain...`;

            // Call edge function
            const result = await provisionSubdomain(deviceId, ip);
            domain = result.fullDomain;
            subSpinner.succeed(
              `Subdomain provisioned: ${chalk.cyan(`https://${result.fullDomain}`)} → ${chalk.dim(ip)}`
            );
          } catch (err) {
            subSpinner.warn('Subdomain provisioning failed');
            if (err instanceof Error) {
              console.error(chalk.dim(`  ${err.message.split('\n')[0]}`));
            }
            console.log(chalk.yellow('  You can set a domain manually: pawd install --domain <domain>'));
          }
        }

        // Fix ownership of data dir after identity/subdomain writes
        if (isRoot()) {
          try {
            execSync(
              `chown -R ${PAWD_SERVICE_USER}:${PAWD_SERVICE_USER} "${PAWD_HOME}"`,
              { stdio: 'pipe' },
            );
          } catch { /* best-effort */ }
        }
      } else if (opts.skipSubdomain) {
        console.log(chalk.dim('  Skipping subdomain provisioning (--skip-subdomain)'));
      }

      // Step 8: Nginx
      if (!opts.skipNginx) {
        const nginxSpinner = ora('Installing Nginx reverse proxy').start();
        if (!existsSync(NGINX_SCRIPT)) {
          nginxSpinner.warn(`Nginx install script not found: ${NGINX_SCRIPT}`);
        } else {
          try {
            const args: string[] = ['bash', NGINX_SCRIPT];
            if (domain) {
              args.push('--domain', domain);
            }
            nginxSpinner.stop();
            execSync(`sudo ${args.map(a => `"${a}"`).join(' ')}`, {
              stdio: 'inherit',
              encoding: 'utf-8',
            });
            console.log(chalk.green('  ✔ Nginx reverse proxy configured'));

            // Step 8b: SSL certificate via certbot (when domain is set)
            if (domain) {
              const sslSpinner = ora('Setting up SSL certificate with Let\'s Encrypt').start();
              try {
                // Check if certbot is installed
                try {
                  execSync('which certbot', { stdio: 'pipe', encoding: 'utf-8' });
                } catch {
                  sslSpinner.text = 'Installing certbot...';
                  try {
                    execSync('sudo snap install --classic certbot && sudo ln -sf /snap/bin/certbot /usr/bin/certbot', {
                      stdio: 'pipe',
                      encoding: 'utf-8',
                    });
                  } catch {
                    try {
                      execSync('sudo apt-get install -y certbot python3-certbot-nginx', {
                        stdio: 'pipe',
                        encoding: 'utf-8',
                      });
                    } catch {
                      try {
                        execSync('brew install certbot', {
                          stdio: 'pipe',
                          encoding: 'utf-8',
                        });
                      } catch {
                        throw new Error('Could not install certbot. Install it manually: https://certbot.eff.org/');
                      }
                    }
                  }
                }

                sslSpinner.text = `Requesting SSL certificate for ${domain}...`;
                sslSpinner.stop();
                execSync(
                  `sudo certbot --nginx -d "${domain}" --non-interactive --agree-tos --register-unsafely-without-email`,
                  { stdio: 'inherit', encoding: 'utf-8' }
                );
                console.log(chalk.green(`  ✔ SSL certificate installed for ${domain}`));
                console.log(chalk.dim(`  HTTPS active at https://${domain}`));
              } catch (err) {
                console.log(chalk.yellow(`  ⚠ SSL setup failed for ${domain}`));
                if (err instanceof Error) {
                  console.error(chalk.dim(`  ${err.message.split('\n')[0]}`));
                }
                console.log(chalk.yellow('  You can retry manually: sudo certbot --nginx -d ' + domain));
              }
            }
          } catch (err) {
            console.log(chalk.yellow('  ⚠ Nginx installation failed (may require sudo)'));
            if (err instanceof Error) {
              console.error(chalk.dim(`  ${err.message.split('\n')[0]}`));
            }
          }
        }
      } else {
        console.log(chalk.dim('  Skipping Nginx (--skip-nginx)'));
      }

      console.log(chalk.green('\n  Installation complete!\n'));
      if (isRoot()) {
        console.log(chalk.dim(`  Bridge will run as user ${chalk.white(PAWD_SERVICE_USER)} to avoid root restrictions`));
      }
      if (domain) {
        console.log(chalk.dim(`  Bridge URL: ${chalk.white(`https://${domain}`)}`));
      }
      console.log(chalk.dim('  Next steps:'));
      console.log(chalk.dim('    pawd start      — start the bridge'));
      console.log(chalk.dim('    pawd status     — check service status'));
      console.log(chalk.dim('    pawd pair       — show pairing QR code\n'));
    });
}
