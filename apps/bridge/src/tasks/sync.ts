import * as taskStore from '../store/entities/tasks.js';
import * as agentStore from '../store/entities/agents.js';
import * as tokenStore from '../store/entities/tokens.js';
import { eventBus } from '../events/bus.js';
import { logger } from '../utils/logger.js';

/**
 * In-memory snapshot of the last-known task state.
 * Used to detect transitions triggered by agents editing task files
 * via HEARTBEAT.md instructions.
 */
interface TaskSnapshot {
  status: string;
  tokensUsed: number | null;
  completedAt: string | null;
  /** Stringified steps for quick comparison */
  stepsHash: string;
}

const lastKnown = new Map<string, TaskSnapshot>();

/** Build a fast hash of steps for change detection. */
function hashSteps(steps: Array<{ id: string; completed: boolean }>): string {
  return steps.map((s) => `${s.id}:${s.completed ? '1' : '0'}`).join('|');
}

/**
 * Scan all task markdown files and detect state transitions since the
 * last scan.  Broadcasts SSE events for any changes and updates agent
 * stats / token accounting when tasks complete.
 *
 * Called on a periodic timer from index.ts (piggy-backed on the 60 s
 * agent-sync interval).
 */
export function syncTaskStates(): void {
  try {
    const tasks = taskStore.getAllTasks();

    for (const task of tasks) {
      const prev = lastKnown.get(task.id);
      const currentStepsHash = hashSteps(task.steps);

      if (!prev) {
        // First time seeing this task — snapshot it, no events
        lastKnown.set(task.id, {
          status: task.status,
          tokensUsed: task.tokensUsed,
          completedAt: task.completedAt,
          stepsHash: currentStepsHash,
        });
        continue;
      }

      // ------------------------------------------------------------------
      // Detect: todo → in_progress (agent picked up the task)
      // ------------------------------------------------------------------
      if (prev.status === 'todo' && task.status === 'in_progress') {
        logger.info({ taskId: task.id, agentId: task.assignedAgentId }, '[task-sync] Task started');
        eventBus.broadcast({
          type: 'task.started',
          payload: {
            taskId: task.id,
            agentId: task.assignedAgentId,
          },
        });
      }

      // ------------------------------------------------------------------
      // Detect: * → done  (agent completed the task)
      // ------------------------------------------------------------------
      if (prev.status !== 'done' && task.status === 'done') {
        logger.info(
          { taskId: task.id, agentId: task.assignedAgentId, tokensUsed: task.tokensUsed },
          '[task-sync] Task completed'
        );

        // Update agent stats
        if (task.assignedAgentId) {
          const agent = agentStore.getAgentById(task.assignedAgentId);
          if (agent) {
            const tokensDelta = (task.tokensUsed || 0) - (prev.tokensUsed || 0);
            agentStore.updateAgent(agent.id, {
              missionsCompleted: (agent.missionsCompleted || 0) + 1,
              tokensUsed: (agent.tokensUsed || 0) + Math.max(0, tokensDelta),
              lastActive: 'Just now',
            });
          }
        }

        // Update account-level token usage
        const tokensDelta = (task.tokensUsed || 0) - (prev.tokensUsed || 0);
        if (tokensDelta > 0) {
          try {
            const tokenData = tokenStore.getTokenData();
            tokenStore.saveTokenData({
              monthlyUsage: tokenData.monthlyUsage + tokensDelta,
              accountBalance: Math.max(0, tokenData.accountBalance - tokensDelta),
            });
          } catch (err) {
            logger.warn({ err, taskId: task.id }, '[task-sync] Failed to update account tokens');
          }
        }

        eventBus.broadcast({
          type: 'task.completed',
          payload: {
            taskId: task.id,
            completedAt: task.completedAt || new Date().toISOString(),
            tokensUsed: task.tokensUsed,
          },
        });
      }

      // ------------------------------------------------------------------
      // Detect: steps changed (agent checked off items)
      // ------------------------------------------------------------------
      if (prev.stepsHash !== currentStepsHash && task.status !== 'done') {
        logger.debug({ taskId: task.id }, '[task-sync] Task steps updated');
        eventBus.broadcast({
          type: 'task.progress',
          payload: {
            taskId: task.id,
            steps: task.steps as unknown as Record<string, unknown>[],
            tokensUsed: task.tokensUsed,
          },
        });
      }

      // ------------------------------------------------------------------
      // Detect: tokensUsed changed (mid-task accounting)
      // ------------------------------------------------------------------
      if (
        prev.tokensUsed !== task.tokensUsed &&
        task.status === 'in_progress' &&
        prev.stepsHash === currentStepsHash // avoid double-fire with steps
      ) {
        // Quietly update — the progress event already carries tokensUsed when steps change
        const tokensDelta = (task.tokensUsed || 0) - (prev.tokensUsed || 0);
        if (tokensDelta > 0 && task.assignedAgentId) {
          const agent = agentStore.getAgentById(task.assignedAgentId);
          if (agent) {
            agentStore.updateAgent(agent.id, {
              tokensUsed: (agent.tokensUsed || 0) + tokensDelta,
            });
          }
        }
      }

      // Update snapshot
      lastKnown.set(task.id, {
        status: task.status,
        tokensUsed: task.tokensUsed,
        completedAt: task.completedAt,
        stepsHash: currentStepsHash,
      });
    }

    // Remove snapshots for deleted tasks
    for (const id of lastKnown.keys()) {
      if (!tasks.some((t) => t.id === id)) {
        lastKnown.delete(id);
      }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[task-sync] Task state sync failed'
    );
  }
}

/**
 * Initialize snapshots for all existing tasks (call once at startup
 * so the first real sync only fires events for actual changes).
 */
export function initTaskSnapshots(): void {
  try {
    const tasks = taskStore.getAllTasks();
    for (const task of tasks) {
      lastKnown.set(task.id, {
        status: task.status,
        tokensUsed: task.tokensUsed,
        completedAt: task.completedAt,
        stepsHash: hashSteps(task.steps),
      });
    }
    logger.debug({ count: tasks.length }, '[task-sync] Initialized task snapshots');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[task-sync] Failed to initialize task snapshots'
    );
  }
}
