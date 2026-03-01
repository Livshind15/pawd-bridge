/**
 * Organization, membership, invite, board-group, and board-access types.
 *
 * Based on Organization, OrganizationMember, OrganizationInvite, BoardGroup,
 * OrganizationBoardAccess, and OrganizationInviteBoardAccess models and schemas.
 */

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

/** Top-level organization tenant record. */
export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating a new organization. */
export interface CreateOrganizationRequest {
  name: string;
}

/** Payload for switching the active organization context. */
export interface SetActiveOrganizationRequest {
  organizationId: string;
}

/** Organization list row for current user memberships. */
export interface OrganizationListItem {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Organization member
// ---------------------------------------------------------------------------

/** Role assigned to an organization member. */
export type OrganizationMemberRole = 'owner' | 'admin' | 'member' | (string & {});

/** Embedded user fields included in organization member payloads. */
export interface OrganizationUserSummary {
  id: string;
  email: string | null;
  name: string | null;
  preferredName: string | null;
}

/** Membership row linking a user to an organization with permissions. */
export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationMemberRole;
  allBoardsRead: boolean;
  allBoardsWrite: boolean;
  createdAt: string;
  updatedAt: string;
  user: OrganizationUserSummary | null;
  boardAccess: BoardAccessEntry[];
}

/** Payload for partial updates to an organization member role. */
export interface UpdateOrganizationMemberRequest {
  role?: string;
}

/** Payload for replacing organization member access permissions. */
export interface UpdateOrganizationMemberAccessRequest {
  allBoardsRead?: boolean;
  allBoardsWrite?: boolean;
  boardAccess?: BoardAccessSpec[];
}

// ---------------------------------------------------------------------------
// Board access
// ---------------------------------------------------------------------------

/** Board access specification used in member/invite mutation payloads. */
export interface BoardAccessSpec {
  boardId: string;
  canRead?: boolean;
  canWrite?: boolean;
}

/** Board access payload returned from read endpoints. */
export interface BoardAccessEntry {
  id: string;
  boardId: string;
  canRead: boolean;
  canWrite: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Organization invite
// ---------------------------------------------------------------------------

/** Invitation record granting prospective organization access. */
export interface OrganizationInvite {
  id: string;
  organizationId: string;
  invitedEmail: string;
  role: OrganizationMemberRole;
  allBoardsRead: boolean;
  allBoardsWrite: boolean;
  token: string;
  createdByUserId: string | null;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating an organization invite. */
export interface CreateOrganizationInviteRequest {
  invitedEmail: string;
  role?: string;
  allBoardsRead?: boolean;
  allBoardsWrite?: boolean;
  boardAccess?: BoardAccessSpec[];
}

/** Payload for accepting an organization invite token. */
export interface AcceptOrganizationInviteRequest {
  token: string;
}

// ---------------------------------------------------------------------------
// Board group
// ---------------------------------------------------------------------------

/** Logical grouping container for boards within an organization. */
export interface BoardGroup {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating a board group. */
export interface CreateBoardGroupRequest {
  name: string;
  slug: string;
  description?: string | null;
}

/** Payload for partial board-group updates. */
export interface UpdateBoardGroupRequest {
  name?: string;
  slug?: string;
  description?: string | null;
}
