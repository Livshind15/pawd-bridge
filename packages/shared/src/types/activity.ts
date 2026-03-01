/**
 * Activity event types for audit logging and feed use-cases.
 *
 * Based on ActivityEvent model and ActivityEventRead / ActivityTaskCommentFeedItemRead schemas.
 */

// ---------------------------------------------------------------------------
// Event type enum
// ---------------------------------------------------------------------------

/** Well-known activity event type identifiers. */
export type ActivityEventType =
  | 'task_created'
  | 'task_updated'
  | 'task_completed'
  | 'task_deleted'
  | 'task_comment'
  | 'agent_created'
  | 'agent_updated'
  | 'agent_heartbeat'
  | 'approval_created'
  | 'approval_resolved'
  | 'webhook_received'
  | 'board_created'
  | 'board_updated'
  | 'memory_created'
  | 'skill_installed'
  | 'skill_uninstalled'
  | (string & {});

// ---------------------------------------------------------------------------
// Core entity
// ---------------------------------------------------------------------------

/** Discrete activity event tied to tasks and agents. */
export interface ActivityEvent {
  id: string;
  eventType: ActivityEventType;
  message: string | null;
  agentId: string | null;
  taskId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Feed item (denormalized)
// ---------------------------------------------------------------------------

/** Denormalized task-comment feed item enriched with task and board fields. */
export interface ActivityTaskCommentFeedItem {
  id: string;
  createdAt: string;
  message: string | null;
  agentId: string | null;
  agentName: string | null;
  agentRole: string | null;
  taskId: string;
  taskTitle: string;
  boardId: string;
  boardName: string;
}
