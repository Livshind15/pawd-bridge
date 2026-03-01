import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../../config.js';
import { generateId } from '../../utils/id.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WebhookConfig {
  /** Unique identifier, e.g. wbk_a1b2c3d4e5f6 */
  id: string;
  /** Human-readable name, e.g. "WhatsApp New Message" */
  name: string;
  /** Which agent to trigger */
  agentId: string;
  /**
   * Conversation to use when triggering the agent:
   *   'heartbeat' — uses the agent's shared heartbeat conversation
   *   'new'       — creates a fresh conversation ID per trigger
   *   <id>        — a specific existing conversation ID
   */
  sessionTarget: string;
  /**
   * Optional HMAC-SHA256 signing secret.
   * When set, each inbound request must include:
   *   X-Webhook-Signature: sha256=<hex>
   */
  secret?: string;
  /**
   * Prompt template rendered with the inbound JSON payload.
   * Use {{field}} or {{nested.field}} placeholders.
   * Example: "New WhatsApp message from {{from}}: {{body}}"
   */
  promptTemplate: string;
  enabled: boolean;
  createdAt: string;
  lastFiredAt?: string;
  fireCount: number;
}

export type WebhookCreate = Omit<WebhookConfig, 'id' | 'createdAt' | 'fireCount'>;
export type WebhookUpdate = Partial<Omit<WebhookConfig, 'id' | 'createdAt'>>;

// ── Persistence ───────────────────────────────────────────────────────────────

function webhooksPath(): string {
  return join(config.dataDir, 'webhooks.json');
}

function loadAll(): WebhookConfig[] {
  try {
    const p = webhooksPath();
    if (!existsSync(p)) return [];
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    return Array.isArray(raw.webhooks) ? raw.webhooks : [];
  } catch {
    return [];
  }
}

function saveAll(webhooks: WebhookConfig[]): void {
  const dir = join(config.dataDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(webhooksPath(), JSON.stringify({ webhooks }, null, 2), 'utf-8');
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function getAllWebhooks(): WebhookConfig[] {
  return loadAll();
}

export function getWebhookById(id: string): WebhookConfig | null {
  return loadAll().find((w) => w.id === id) ?? null;
}

export function createWebhook(data: WebhookCreate): WebhookConfig {
  const webhooks = loadAll();
  const webhook: WebhookConfig = {
    ...data,
    id: generateId('wbk'),
    createdAt: new Date().toISOString(),
    fireCount: 0,
    enabled: data.enabled ?? true,
  };
  webhooks.push(webhook);
  saveAll(webhooks);
  return webhook;
}

export function updateWebhook(id: string, patch: WebhookUpdate): WebhookConfig | null {
  const webhooks = loadAll();
  const idx = webhooks.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  webhooks[idx] = { ...webhooks[idx], ...patch };
  saveAll(webhooks);
  return webhooks[idx];
}

export function deleteWebhook(id: string): boolean {
  const webhooks = loadAll();
  const idx = webhooks.findIndex((w) => w.id === id);
  if (idx === -1) return false;
  webhooks.splice(idx, 1);
  saveAll(webhooks);
  return true;
}

export function recordFire(id: string): void {
  const webhooks = loadAll();
  const idx = webhooks.findIndex((w) => w.id === id);
  if (idx === -1) return;
  webhooks[idx].lastFiredAt = new Date().toISOString();
  webhooks[idx].fireCount = (webhooks[idx].fireCount ?? 0) + 1;
  saveAll(webhooks);
}
