/**
 * Agent lifecycle and provisioning types for health monitoring.
 *
 * Derived from agent status fields, health schemas, and gateway coordination patterns.
 */

// ---------------------------------------------------------------------------
// State enums
// ---------------------------------------------------------------------------

/** Current lifecycle state of an agent managed by the coordinator. */
export type AgentLifecycleState =
  | 'provisioning'
  | 'active'
  | 'healthy'
  | 'degraded'
  | 'paused'
  | 'offline'
  | 'retired'
  | 'updating'
  | (string & {});

/** Provisioning status of an agent from bootstrap through readiness. */
export type ProvisionStatus =
  | 'pending'
  | 'bootstrapping'
  | 'configuring'
  | 'ready'
  | 'failed';

// ---------------------------------------------------------------------------
// Lifecycle event
// ---------------------------------------------------------------------------

/** Discrete lifecycle event emitted during agent state transitions. */
export interface LifecycleEvent {
  id: string;
  agentId: string;
  boardId: string | null;
  gatewayId: string;
  previousState: AgentLifecycleState | null;
  currentState: AgentLifecycleState;
  reason: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/** Standard health probe response payload. */
export interface HealthStatus {
  ok: boolean;
}

/** Agent-authenticated liveness payload for agent route probes. */
export interface AgentHealthStatus extends HealthStatus {
  agentId: string;
  boardId: string | null;
  gatewayId: string;
  status: AgentLifecycleState;
  isBoardLead: boolean;
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/** Heartbeat status payload sent by agents. */
export interface AgentHeartbeat {
  status?: AgentLifecycleState | null;
}

/** Heartbeat payload used to create/bootstrap an agent lazily on first contact. */
export interface AgentHeartbeatCreate extends AgentHeartbeat {
  name: string;
  boardId?: string | null;
}

// ---------------------------------------------------------------------------
// Board-group heartbeat
// ---------------------------------------------------------------------------

/** Request payload for applying heartbeat settings to board-group agents. */
export interface BoardGroupHeartbeatApplyRequest {
  /** Heartbeat cadence string (e.g. "2m", "10m", "30m"). */
  every: string;
  includeBoardLeads?: boolean;
}

/** Result payload describing agents updated by a board-group heartbeat request. */
export interface BoardGroupHeartbeatApplyResult {
  boardGroupId: string;
  requested: Record<string, unknown>;
  updatedAgentIds: string[];
  failedAgentIds: string[];
}
