/**
 * Session Store — persists SDK session metadata to disk.
 *
 * In-memory Map backed by a JSON file at dataDir/sessions/index.json.
 * Key format: "agentId::conversationId"
 *
 * The file is written after every mutation for crash-safety.
 * On startup the file is loaded into the Map.
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { SessionInfo } from './types.js';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const sessions = new Map<string, SessionInfo>();
let loaded = false;

function sessionsDir(): string {
  return join(config.dataDir, 'sessions');
}

function indexPath(): string {
  return join(sessionsDir(), 'index.json');
}

function makeKey(agentId: string, conversationId: string): string {
  return `${agentId}::${conversationId}`;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function loadFromDisk(): void {
  if (loaded) return;
  loaded = true;

  const filepath = indexPath();
  if (!existsSync(filepath)) return;

  try {
    const raw = readFileSync(filepath, 'utf-8');
    const entries: SessionInfo[] = JSON.parse(raw);
    for (const entry of entries) {
      const key = makeKey(entry.agentId, entry.conversationId);
      sessions.set(key, entry);
    }
    logger.debug({ count: sessions.size }, 'Loaded SDK sessions from disk');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Failed to load sessions index — starting fresh',
    );
  }
}

function flushToDisk(): void {
  try {
    const dir = sessionsDir();
    mkdirSync(dir, { recursive: true });

    const entries = Array.from(sessions.values());
    writeFileSync(indexPath(), JSON.stringify(entries, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Failed to flush sessions index to disk',
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get session info for an agent+conversation pair (or null). */
export function getSession(agentId: string, conversationId: string): SessionInfo | null {
  loadFromDisk();
  return sessions.get(makeKey(agentId, conversationId)) ?? null;
}

/** Create or update a session entry. */
export function saveSession(info: SessionInfo): void {
  loadFromDisk();
  const key = makeKey(info.agentId, info.conversationId);
  sessions.set(key, info);
  flushToDisk();
}

/** Delete a specific session. Returns true if it existed. */
export function deleteSession(agentId: string, conversationId: string): boolean {
  loadFromDisk();
  const key = makeKey(agentId, conversationId);
  const existed = sessions.delete(key);
  if (existed) flushToDisk();
  return existed;
}

/** List all sessions, optionally filtered by agentId. */
export function listSessions(agentId?: string): SessionInfo[] {
  loadFromDisk();
  const all = Array.from(sessions.values());
  if (!agentId) return all;
  return all.filter((s) => s.agentId === agentId);
}

/** Delete every session belonging to the given agent. */
export function deleteAllForAgent(agentId: string): number {
  loadFromDisk();
  let removed = 0;
  for (const [key, info] of sessions) {
    if (info.agentId === agentId) {
      sessions.delete(key);
      removed++;
    }
  }
  if (removed > 0) flushToDisk();
  return removed;
}
