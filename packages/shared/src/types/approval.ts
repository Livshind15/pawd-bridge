/**
 * Approval types for gated operations requiring human review.
 *
 * Based on Approval, ApprovalTaskLink models and corresponding Pydantic schemas.
 */

// ---------------------------------------------------------------------------
// Status enum
// ---------------------------------------------------------------------------

/** Status of an approval request through its lifecycle. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

/** Approval request and decision metadata for gated operations. */
export interface Approval {
  id: string;
  boardId: string;
  taskId: string | null;
  /** All linked task IDs (deduplicated, may include taskId). */
  taskIds: string[];
  /** Human-readable task titles corresponding to taskIds. */
  taskTitles: string[];
  agentId: string | null;
  actionType: string;
  payload: Record<string, unknown> | null;
  /** Confidence score from 0 to 100. */
  confidence: number;
  rubricScores: Record<string, number> | null;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt: string | null;
}

/** Many-to-many link mapping an approval request to one task. */
export interface ApprovalTaskLink {
  id: string;
  approvalId: string;
  taskId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

/** Payload for creating a new approval request. */
export interface CreateApprovalRequest {
  actionType: string;
  taskId?: string | null;
  taskIds?: string[];
  payload?: Record<string, unknown> | null;
  /** Confidence score from 0 to 100. */
  confidence: number;
  rubricScores?: Record<string, number> | null;
  status?: ApprovalStatus;
  agentId?: string | null;
  /** Explicit reasoning text; falls back to payload.reason or payload.decision.reason. */
  leadReasoning?: string | null;
}

/** Payload for updating an approval status. */
export interface UpdateApprovalRequest {
  status: ApprovalStatus;
}
