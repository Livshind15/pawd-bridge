import { execSync } from 'child_process';
import { homedir } from 'os';

export const PAWD_SERVICE_USER = 'pawd';

/** Check if the current process is running as root. */
export function isRoot(): boolean {
  return process.getuid?.() === 0;
}

/** Check if the pawd service user exists on the system. */
export function pawdUserExists(): boolean {
  try {
    execSync(`id ${PAWD_SERVICE_USER}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Create the pawd service user with a home directory. */
export function createPawdUser(): void {
  execSync(
    `useradd --create-home --shell /bin/bash ${PAWD_SERVICE_USER}`,
    { stdio: 'pipe' },
  );
}

/** Get the pawd service user's home directory. */
export function getPawdUserHome(): string {
  try {
    const entry = execSync(`getent passwd ${PAWD_SERVICE_USER}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    // getent format: name:x:uid:gid:comment:home:shell
    const home = entry.split(':')[5];
    if (home) return home;
  } catch {
    // user doesn't exist yet — fall through
  }
  return `/home/${PAWD_SERVICE_USER}`;
}

/**
 * Returns the effective home directory for pawd data.
 * When running as root, returns the pawd service user's home.
 * Otherwise, returns the current user's home.
 */
export function getEffectiveHome(): string {
  if (isRoot()) {
    return getPawdUserHome();
  }
  return homedir();
}
