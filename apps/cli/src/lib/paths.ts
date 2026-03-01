import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { getEffectiveHome, isRoot } from './user.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Effective home: /home/pawd when root, ~ otherwise
const home = getEffectiveHome();

export const PAWD_HOME = join(home, '.pawd-bridge');
export const DATA_DIR = join(PAWD_HOME, 'data');
export const PID_FILE = join(PAWD_HOME, 'bridge.pid');
export const LOG_FILE = join(PAWD_HOME, 'bridge.log');
export const IDENTITY_FILE = join(DATA_DIR, 'identity', 'device.json');
export const PAIRING_SECRET_FILE = join(DATA_DIR, 'auth', 'pairing-secret.json');
export const SUBDOMAIN_FILE = join(DATA_DIR, 'subdomain.json');

// Source directories (relative to the CLI package in the monorepo)
export const CLI_DIR = resolve(__dirname, '..', '..');
export const BRIDGE_DIR = resolve(CLI_DIR, '..', 'bridge');
export const NGINX_SCRIPT = join(BRIDGE_DIR, 'scripts', 'install-nginx-bridge.sh');

// Installed bridge location (used when running as root)
export const BRIDGE_INSTALL_DIR = '/opt/pawd/bridge';

export const PAWD_CONFIG_DIR = join(home, '.pawd');
export const PAWD_ENV_FILE = join(PAWD_CONFIG_DIR, '.env');

/**
 * Returns the bridge directory to use at runtime.
 * When running as root, uses the installed copy at /opt/pawd/bridge/
 * (only if it has both dist and node_modules).
 * Otherwise, uses the monorepo source directory.
 */
export function getActiveBridgeDir(): string {
  if (
    isRoot() &&
    existsSync(join(BRIDGE_INSTALL_DIR, 'dist', 'index.js')) &&
    existsSync(join(BRIDGE_INSTALL_DIR, 'node_modules'))
  ) {
    return BRIDGE_INSTALL_DIR;
  }
  return BRIDGE_DIR;
}
