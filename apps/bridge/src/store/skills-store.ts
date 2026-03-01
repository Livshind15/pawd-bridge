/**
 * In-memory store for marketplace skills, skill packs, and gateway installations.
 *
 * Mirrors Mission Control's MarketplaceSkill / SkillPack /
 * GatewayInstalledSkill persistence layer but keeps everything in RAM
 * (consistent with the bridge's other in-memory entity stores).
 */

import { generateId } from '../utils/id.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketplaceSkill {
  id: string;
  name: string;
  sourceUrl: string;
  description: string | null;
  category: string | null;
  risk: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  createdAt: string; // ISO-8601
  updatedAt: string;
}

export interface SkillPack {
  id: string;
  name: string;
  sourceUrl: string;
  description: string | null;
  branch: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayInstalledSkill {
  id: string;
  skillId: string;
  gatewayId: string;
  installedAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Create / Update input types
// ---------------------------------------------------------------------------

export interface CreateMarketplaceSkillInput {
  sourceUrl: string;
  name?: string;
  description?: string | null;
  category?: string | null;
  risk?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateMarketplaceSkillInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  risk?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateSkillPackInput {
  sourceUrl: string;
  name?: string;
  description?: string | null;
  branch?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateSkillPackInput {
  name?: string;
  sourceUrl?: string;
  description?: string | null;
  branch?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal storage
// ---------------------------------------------------------------------------

const marketplaceSkills = new Map<string, MarketplaceSkill>();
const skillPacks = new Map<string, SkillPack>();
const gatewayInstallations = new Map<string, GatewayInstalledSkill>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Infer a human-readable skill name from a source URL.
 */
export function inferSkillName(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    const path = url.pathname.replace(/\/+$/, '');
    const segment = path.split('/').pop() || url.hostname;
    const candidate = decodeURIComponent(segment)
      .replace(/\.git$/, '')
      .replace(/[-_]/g, ' ')
      .trim();
    return candidate || 'Skill';
  } catch {
    return 'Skill';
  }
}

/**
 * Normalize a pack source URL for uniqueness checks.
 */
export function normalizeSourceUrl(sourceUrl: string): string {
  const normalized = sourceUrl.trim().replace(/\/+$/, '');
  return normalized.endsWith('.git')
    ? normalized.slice(0, -4)
    : normalized;
}

/**
 * Normalize a branch name to a safe value.
 */
export function normalizeBranch(raw: string | undefined | null): string {
  if (!raw) return 'main';
  const trimmed = raw.trim();
  if (!trimmed) return 'main';
  if (/[\n\r\t]/.test(trimmed)) return 'main';
  if (!/^[A-Za-z0-9._/\-]+$/.test(trimmed)) return 'main';
  return trimmed;
}

// ---------------------------------------------------------------------------
// MarketplaceSkill CRUD
// ---------------------------------------------------------------------------

export function createMarketplaceSkill(
  data: CreateMarketplaceSkillInput,
): MarketplaceSkill {
  const id = generateId('msk');
  const now = nowISO();

  const skill: MarketplaceSkill = {
    id,
    name: data.name?.trim() || inferSkillName(data.sourceUrl),
    sourceUrl: data.sourceUrl.trim(),
    description: data.description ?? null,
    category: data.category ?? null,
    risk: data.risk ?? null,
    source: data.source ?? null,
    metadata: data.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };

  marketplaceSkills.set(id, skill);
  return skill;
}

export function getMarketplaceSkill(id: string): MarketplaceSkill | null {
  return marketplaceSkills.get(id) ?? null;
}

export function getMarketplaceSkillBySourceUrl(
  sourceUrl: string,
): MarketplaceSkill | null {
  const normalized = normalizeSourceUrl(sourceUrl);
  for (const skill of marketplaceSkills.values()) {
    if (normalizeSourceUrl(skill.sourceUrl) === normalized) return skill;
  }
  return null;
}

export function listMarketplaceSkills(filters?: {
  search?: string;
  category?: string;
  risk?: string;
}): MarketplaceSkill[] {
  let result = Array.from(marketplaceSkills.values());

  if (filters?.search) {
    const lower = filters.search.toLowerCase();
    result = result.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        (s.description ?? '').toLowerCase().includes(lower) ||
        (s.category ?? '').toLowerCase().includes(lower) ||
        (s.source ?? '').toLowerCase().includes(lower),
    );
  }

  if (filters?.category) {
    const cat = filters.category.toLowerCase();
    if (cat === 'uncategorized') {
      result = result.filter((s) => !s.category?.trim());
    } else {
      result = result.filter(
        (s) => (s.category ?? '').toLowerCase().trim() === cat,
      );
    }
  }

  if (filters?.risk) {
    const riskFilter = filters.risk.toLowerCase();
    if (riskFilter === 'uncategorized') {
      result = result.filter((s) => !s.risk?.trim());
    } else {
      result = result.filter(
        (s) => (s.risk ?? '').toLowerCase().trim() === riskFilter,
      );
    }
  }

  // Newest first
  result.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return result;
}

export function updateMarketplaceSkill(
  id: string,
  data: UpdateMarketplaceSkillInput,
): MarketplaceSkill | null {
  const existing = marketplaceSkills.get(id);
  if (!existing) return null;

  const updated: MarketplaceSkill = {
    ...existing,
    ...(data.name !== undefined && { name: data.name.trim() }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.category !== undefined && { category: data.category }),
    ...(data.risk !== undefined && { risk: data.risk }),
    ...(data.source !== undefined && { source: data.source }),
    ...(data.metadata !== undefined && { metadata: data.metadata }),
    updatedAt: nowISO(),
  };

  marketplaceSkills.set(id, updated);
  return updated;
}

export function deleteMarketplaceSkill(id: string): boolean {
  // Cascade: remove all gateway installation records referencing this skill
  for (const [instId, inst] of gatewayInstallations) {
    if (inst.skillId === id) gatewayInstallations.delete(instId);
  }
  return marketplaceSkills.delete(id);
}

// ---------------------------------------------------------------------------
// SkillPack CRUD
// ---------------------------------------------------------------------------

export function createSkillPack(data: CreateSkillPackInput): SkillPack {
  const id = generateId('spk');
  const now = nowISO();

  const pack: SkillPack = {
    id,
    name: data.name?.trim() || inferSkillName(data.sourceUrl),
    sourceUrl: normalizeSourceUrl(data.sourceUrl),
    description: data.description ?? null,
    branch: normalizeBranch(data.branch),
    metadata: data.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };

  skillPacks.set(id, pack);
  return pack;
}

export function getSkillPack(id: string): SkillPack | null {
  return skillPacks.get(id) ?? null;
}

export function getSkillPackBySourceUrl(
  sourceUrl: string,
): SkillPack | null {
  const normalized = normalizeSourceUrl(sourceUrl);
  for (const pack of skillPacks.values()) {
    if (normalizeSourceUrl(pack.sourceUrl) === normalized) return pack;
  }
  return null;
}

export function listSkillPacks(): SkillPack[] {
  return Array.from(skillPacks.values()).sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function updateSkillPack(
  id: string,
  data: UpdateSkillPackInput,
): SkillPack | null {
  const existing = skillPacks.get(id);
  if (!existing) return null;

  const updated: SkillPack = {
    ...existing,
    ...(data.name !== undefined && { name: data.name.trim() }),
    ...(data.sourceUrl !== undefined && {
      sourceUrl: normalizeSourceUrl(data.sourceUrl),
    }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.branch !== undefined && { branch: normalizeBranch(data.branch) }),
    ...(data.metadata !== undefined && { metadata: data.metadata }),
    updatedAt: nowISO(),
  };

  skillPacks.set(id, updated);
  return updated;
}

export function deleteSkillPack(id: string): boolean {
  return skillPacks.delete(id);
}

// ---------------------------------------------------------------------------
// GatewayInstalledSkill CRUD
// ---------------------------------------------------------------------------

export function installSkill(
  gatewayId: string,
  skillId: string,
): GatewayInstalledSkill {
  // Check for existing installation
  for (const inst of gatewayInstallations.values()) {
    if (inst.gatewayId === gatewayId && inst.skillId === skillId) {
      // Update the timestamp and return existing
      const refreshed: GatewayInstalledSkill = {
        ...inst,
        updatedAt: nowISO(),
      };
      gatewayInstallations.set(inst.id, refreshed);
      return refreshed;
    }
  }

  const id = generateId('gis');
  const now = nowISO();

  const installation: GatewayInstalledSkill = {
    id,
    skillId,
    gatewayId,
    installedAt: now,
    updatedAt: now,
  };

  gatewayInstallations.set(id, installation);
  return installation;
}

export function uninstallSkill(
  gatewayId: string,
  skillId: string,
): boolean {
  for (const [instId, inst] of gatewayInstallations) {
    if (inst.gatewayId === gatewayId && inst.skillId === skillId) {
      return gatewayInstallations.delete(instId);
    }
  }
  return false;
}

export function getInstallation(
  gatewayId: string,
  skillId: string,
): GatewayInstalledSkill | null {
  for (const inst of gatewayInstallations.values()) {
    if (inst.gatewayId === gatewayId && inst.skillId === skillId) {
      return inst;
    }
  }
  return null;
}

export function listInstallationsForGateway(
  gatewayId: string,
): GatewayInstalledSkill[] {
  return Array.from(gatewayInstallations.values())
    .filter((inst) => inst.gatewayId === gatewayId)
    .sort(
      (a, b) =>
        new Date(b.installedAt).getTime() -
        new Date(a.installedAt).getTime(),
    );
}

export function listInstallationsForSkill(
  skillId: string,
): GatewayInstalledSkill[] {
  return Array.from(gatewayInstallations.values()).filter(
    (inst) => inst.skillId === skillId,
  );
}

/**
 * Count how many marketplace skills were sourced from each normalized
 * repository base URL.  Used by pack listing to show skill counts.
 */
export function countSkillsByRepoBase(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const skill of marketplaceSkills.values()) {
    const base = repoBaseFromTreeUrl(skill.sourceUrl);
    if (base) {
      counts[base] = (counts[base] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Extract the repository base URL from a GitHub tree-style URL.
 * e.g. "https://github.com/owner/repo/tree/main/path" -> "https://github.com/owner/repo"
 */
export function repoBaseFromTreeUrl(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const marker = '/tree/';
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex <= 0) return null;

    const repoPath = url.pathname.slice(0, markerIndex);
    if (!repoPath) return null;
    return normalizeSourceUrl(`${url.protocol}//${url.host}${repoPath}`);
  } catch {
    return null;
  }
}

/**
 * Get the skill count for a specific pack based on its source URL.
 */
export function packSkillCount(pack: SkillPack): number {
  const counts = countSkillsByRepoBase();
  const base = normalizeSourceUrl(pack.sourceUrl);
  return counts[base] ?? 0;
}

// ---------------------------------------------------------------------------
// Utility -- primarily for tests
// ---------------------------------------------------------------------------

export function clearAll(): void {
  marketplaceSkills.clear();
  skillPacks.clear();
  gatewayInstallations.clear();
}
