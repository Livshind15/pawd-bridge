/**
 * Memory types for board-level and board-group-level persistent contextual state.
 *
 * Based on BoardMemory, BoardGroupMemory models and corresponding Pydantic schemas.
 */

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

/** Persisted memory item attached directly to a board. */
export interface BoardMemory {
  id: string;
  boardId: string;
  content: string;
  tags: string[] | null;
  source: string | null;
  /** Whether the memory originated from a chat interaction. */
  isChat: boolean;
  /** Arbitrary key-value metadata associated with this memory entry. */
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Persisted memory item associated with a board group (shared context). */
export interface BoardGroupMemory {
  id: string;
  boardGroupId: string;
  content: string;
  tags: string[] | null;
  source: string | null;
  /** Whether the memory originated from a chat interaction. */
  isChat: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

/** Payload for creating a board memory entry. */
export interface CreateBoardMemoryRequest {
  content: string;
  tags?: string[] | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Payload for creating a board-group memory entry. */
export interface CreateBoardGroupMemoryRequest {
  content: string;
  tags?: string[] | null;
  source?: string | null;
}

/**
 * Unified create-memory request type covering both board and board-group scopes.
 * The caller decides which endpoint to POST to; the shape is identical.
 */
export type CreateMemoryRequest = CreateBoardMemoryRequest;
