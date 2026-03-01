/**
 * Tag types for organization-scoped task categorization.
 *
 * Based on Tag, TagAssignment models and corresponding Pydantic schemas.
 */

// ---------------------------------------------------------------------------
// Core entity
// ---------------------------------------------------------------------------

/** Organization-scoped tag used to classify and group tasks. */
export interface Tag {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  /** 6-digit hex color without leading hash (e.g. "9e9e9e"). */
  color: string;
  description: string | null;
  /** Number of tasks currently assigned this tag. */
  taskCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Compact tag representation embedded in task payloads. */
export interface TagRef {
  id: string;
  name: string;
  slug: string;
  color: string;
}

/** Association row mapping one task to one tag. */
export interface TagAssignment {
  id: string;
  taskId: string;
  tagId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

/** Payload for creating a tag. */
export interface CreateTagRequest {
  name: string;
  slug?: string | null;
  /** 6-digit hex color without leading hash. Defaults to "9e9e9e". */
  color?: string;
  description?: string | null;
}

/** Payload for partial tag updates. */
export interface UpdateTagRequest {
  name?: string;
  slug?: string | null;
  /** 6-digit hex color without leading hash. */
  color?: string | null;
  description?: string | null;
}
