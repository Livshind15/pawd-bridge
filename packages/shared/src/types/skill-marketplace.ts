/**
 * Skill marketplace types for catalog entries, packs, and gateway installations.
 *
 * Based on MarketplaceSkill, SkillPack, GatewayInstalledSkill models and schemas.
 */

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

/** Marketplace skill entry that can be installed onto one or more gateways. */
export interface MarketplaceSkill {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  category: string | null;
  /** Risk classification (e.g. "low", "medium", "high"). */
  risk: string | null;
  /** Source identifier (e.g. registry name). */
  source: string | null;
  sourceUrl: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Pack repository URL that can be synced into marketplace skills. */
export interface SkillPack {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  sourceUrl: string;
  branch: string;
  metadata: Record<string, unknown>;
  /** Number of skills this pack contributes to the marketplace. */
  skillCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Record marking that a marketplace skill is installed for a specific gateway. */
export interface GatewayInstalledSkill {
  id: string;
  gatewayId: string;
  skillId: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Card / enriched view
// ---------------------------------------------------------------------------

/** Marketplace card payload with gateway-specific install state. */
export interface MarketplaceSkillCard extends MarketplaceSkill {
  installed: boolean;
  installedAt: string | null;
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

/** Payload for registering a skill URL in the organization marketplace. */
export interface CreateMarketplaceSkillRequest {
  sourceUrl: string;
  name?: string | null;
  description?: string | null;
}

/** Payload for registering a pack URL in the organization. */
export interface CreateSkillPackRequest {
  sourceUrl: string;
  name?: string | null;
  description?: string | null;
  branch?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Response payloads
// ---------------------------------------------------------------------------

/** Install/uninstall action response payload. */
export interface MarketplaceSkillActionResponse {
  ok: boolean;
  skillId: string;
  gatewayId: string;
  installed: boolean;
}

/** Pack sync summary payload. */
export interface SkillPackSyncResponse {
  ok: boolean;
  packId: string;
  synced: number;
  created: number;
  updated: number;
  warnings: string[];
}
