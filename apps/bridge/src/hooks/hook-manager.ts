import { logger } from '../utils/logger.js';

export interface HookEvent {
  hookId: string;
  name: string;
  agentId?: string;
  status: 'triggered' | 'running' | 'completed' | 'failed';
  progress?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

const MAX_HISTORY = 100;

class HookManager {
  private activeHooks = new Map<string, HookEvent>();
  private history: HookEvent[] = [];

  registerHook(hookId: string, data: Record<string, unknown>): HookEvent {
    const now = new Date().toISOString();
    const hook: HookEvent = {
      hookId,
      name: (data.name as string) || 'unknown',
      agentId: data.agentId as string | undefined,
      status: 'triggered',
      startedAt: now,
      updatedAt: now,
    };

    this.activeHooks.set(hookId, hook);
    logger.info({ hookId, name: hook.name }, '[hooks] Hook registered');
    return hook;
  }

  updateHookProgress(hookId: string, progress: Record<string, unknown>): HookEvent | undefined {
    const hook = this.activeHooks.get(hookId);
    if (!hook) {
      logger.warn({ hookId }, '[hooks] Progress update for unknown hook');
      return undefined;
    }

    hook.status = 'running';
    hook.progress = progress;
    hook.updatedAt = new Date().toISOString();

    logger.debug({ hookId, progress }, '[hooks] Hook progress updated');
    return hook;
  }

  resolveHook(hookId: string, result: Record<string, unknown>): HookEvent | undefined {
    const hook = this.activeHooks.get(hookId);
    if (!hook) {
      logger.warn({ hookId }, '[hooks] Resolve for unknown hook');
      return undefined;
    }

    const now = new Date().toISOString();
    hook.status = 'completed';
    hook.result = result;
    hook.updatedAt = now;
    hook.completedAt = now;

    this.activeHooks.delete(hookId);
    this.pushHistory(hook);

    logger.info({ hookId, name: hook.name }, '[hooks] Hook resolved');
    return hook;
  }

  failHook(hookId: string, error: string): HookEvent | undefined {
    const hook = this.activeHooks.get(hookId);
    if (!hook) {
      logger.warn({ hookId }, '[hooks] Fail for unknown hook');
      return undefined;
    }

    const now = new Date().toISOString();
    hook.status = 'failed';
    hook.error = error;
    hook.updatedAt = now;
    hook.completedAt = now;

    this.activeHooks.delete(hookId);
    this.pushHistory(hook);

    logger.warn({ hookId, name: hook.name, error }, '[hooks] Hook failed');
    return hook;
  }

  getActiveHooks(): HookEvent[] {
    return Array.from(this.activeHooks.values());
  }

  getHookHistory(limit?: number): HookEvent[] {
    if (limit && limit > 0) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  getHookById(hookId: string): HookEvent | undefined {
    // Check active hooks first, then history
    const active = this.activeHooks.get(hookId);
    if (active) return active;
    return this.history.find((h) => h.hookId === hookId);
  }

  private pushHistory(hook: HookEvent): void {
    this.history.push({ ...hook });
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
  }
}

export const hookManager = new HookManager();
