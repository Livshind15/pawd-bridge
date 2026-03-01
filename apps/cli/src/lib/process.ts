import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { PID_FILE } from './paths.js';

export function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (isNaN(pid)) return null;
    // Check if process is alive
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      // Process not running, clean up stale PID file
      unlinkSync(PID_FILE);
      return null;
    }
  } catch {
    return null;
  }
}

export function writePid(pid: number): void {
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

export function removePid(): void {
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}
