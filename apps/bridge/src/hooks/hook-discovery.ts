/**
 * Filesystem-based hook discovery.
 *
 * Scans agent workspace directories for hook definitions:
 *   1. Agent workspace hooks: <agentWorkspacesDir>/<agentId>/hooks/
 *   2. Data dir hooks: <dataDir>/hooks/
 *
 * Each hook dir contains HOOK.md with YAML frontmatter.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface DiscoveredHook {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  events?: string[];
  source: 'workspace' | 'managed' | 'bundled';
  enabled?: boolean;
  eligible?: boolean;
}

/** Very simple YAML frontmatter parser — just enough for HOOK.md files. */
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, unknown> = {};

  for (const line of yaml.split('\n')) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (!kv) continue;
    const [, key, rawVal] = kv;
    let val: unknown = rawVal.trim();

    // Try to parse JSON values (for metadata objects)
    if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
      try { val = JSON.parse(val); } catch { /* keep as string */ }
    }
    // Strip surrounding quotes
    if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }

    result[key] = val;
  }

  return result;
}

function scanHookDir(dir: string, source: DiscoveredHook['source']): DiscoveredHook[] {
  if (!existsSync(dir)) return [];

  const hooks: DiscoveredHook[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const hookMd = resolve(dir, entry.name, 'HOOK.md');
      if (!existsSync(hookMd)) continue;

      try {
        const content = readFileSync(hookMd, 'utf-8');
        const fm = parseFrontmatter(content);

        const metadata = (fm.metadata as Record<string, unknown>) ?? {};

        hooks.push({
          id: entry.name,
          name: (fm.name as string) ?? entry.name,
          description: (fm.description as string) ?? undefined,
          emoji: (fm.emoji as string) ?? (metadata.emoji as string) ?? undefined,
          events: Array.isArray(fm.events) ? fm.events : undefined,
          source,
        });
      } catch {
        // Skip unparseable hooks
      }
    }
  } catch {
    // Directory not readable
  }

  return hooks;
}

/** Discover hooks from agent workspace directories. */
export function discoverHooks(): DiscoveredHook[] {
  const workspaceHooksDir = resolve(config.agentWorkspacesDir, 'hooks');
  const dataHooksDir = resolve(config.dataDir, 'hooks');

  const workspace = scanHookDir(workspaceHooksDir, 'workspace');
  const managed = scanHookDir(dataHooksDir, 'managed');

  // Merge with workspace taking precedence
  const seen = new Set<string>();
  const all: DiscoveredHook[] = [];

  for (const hook of [...workspace, ...managed]) {
    if (seen.has(hook.id)) continue;
    seen.add(hook.id);
    all.push(hook);
  }

  logger.debug({ count: all.length }, 'Discovered hooks from filesystem');
  return all;
}

/** Read hooks config from local data directory. */
export function readHooksConfig(): Record<string, unknown> {
  try {
    const configPath = resolve(config.dataDir, 'settings', 'hooks.json');
    if (!existsSync(configPath)) return {};

    const data = JSON.parse(readFileSync(configPath, 'utf-8'));
    return data ?? {};
  } catch {
    return {};
  }
}
