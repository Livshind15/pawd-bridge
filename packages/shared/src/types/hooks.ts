/**
 * Hook integration types for hook discovery, management, and activity feed.
 *
 * Updated for SDK hook model (PreToolUse, PostToolUse, PreCompact)
 * while maintaining backward-compatible discovery/management types.
 */

// ---------------------------------------------------------------------------
// SDK hook types
// ---------------------------------------------------------------------------

/** SDK hook trigger points */
export type SdkHookTrigger = 'PreToolUse' | 'PostToolUse' | 'PreCompact';

/** An SDK hook rule configuration */
export interface SdkHookRule {
  trigger: SdkHookTrigger;
  /** Tool name pattern to match (glob-style, e.g. "Bash", "Read*") */
  toolPattern?: string;
  /** Action to take: allow, deny, ask, or run a script */
  action: 'allow' | 'deny' | 'ask' | 'script';
  /** Script path or command to run (for action=script) */
  script?: string;
  /** Optional description for display */
  description?: string;
}

// ---------------------------------------------------------------------------
// Hook discovery & management
// ---------------------------------------------------------------------------

/** Installation step descriptor within a hook definition. */
export interface HookInstallStep {
  id: string;
  kind: string;
}

/** System or environment requirements a hook declares. */
export interface HookRequirements {
  bins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
}

/** A discovered hook with its metadata, eligibility, and installation steps. */
export interface HookDefinition {
  id: string;
  name: string;
  description: string;
  emoji?: string;
  events: string[];
  enabled: boolean;
  eligible: boolean;
  requirements?: HookRequirements;
  install?: HookInstallStep[];
  /** SDK hook rules (if this hook uses the SDK hook model) */
  sdkRules?: SdkHookRule[];
}

/** Response returned after enabling or disabling a hook. */
export interface HookManagementResponse {
  success: boolean;
  hookId: string;
  action: 'enable' | 'disable';
  message?: string;
}

/** Paginated list of discovered hooks. */
export interface HookListResponse {
  hooks: HookDefinition[];
  count: number;
}

/** Per-hook eligibility check with optional missing-requirement details. */
export interface HookEligibilityEntry {
  id: string;
  eligible: boolean;
  missing?: string[];
}

/** Batch eligibility response for all discovered hooks. */
export interface HookEligibilityResponse {
  hooks: HookEligibilityEntry[];
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

/** A single event in the unified activity feed. */
export interface ActivityFeedEvent {
  id: string;
  type: string;
  timestamp: string;
  source: string;
  title: string;
  description?: string;
  agentId?: string;
  hookId?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

/** Paginated activity feed response. */
export interface ActivityFeedResponse {
  events: ActivityFeedEvent[];
  total: number;
  hasMore: boolean;
}
