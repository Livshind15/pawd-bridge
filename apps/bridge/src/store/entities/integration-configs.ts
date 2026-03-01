import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { config } from '../../config.js';
import { parseMarkdownFile } from '../markdown/parser.js';
import { writeMarkdownFile } from '../markdown/serializer.js';
import matter from 'gray-matter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntegrationConfigField {
  key: string;
  label: string;
  type: 'string' | 'secret' | 'url' | 'number';
  required: boolean;
  placeholder?: string;
  description?: string;
}

export interface IntegrationConfigSchema {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  color: string;
  tools: number;
  fields: IntegrationConfigField[];
}

export type IntegrationConfigValues = Record<string, string>;

// ---------------------------------------------------------------------------
// Schema definitions for every integration
// ---------------------------------------------------------------------------

export const INTEGRATION_CONFIGS: Record<string, IntegrationConfigSchema> = {
  brave_search: {
    id: 'brave_search',
    name: 'Brave Search',
    category: 'Search',
    description: 'Web search via Brave Search API',
    icon: 'https://cdn.simpleicons.org/brave',
    color: '#FB542B',
    tools: 5,
    fields: [
      { key: 'api_key', label: 'API Key', type: 'secret', required: true, placeholder: 'BSA...', description: 'Get your key at search.brave.com/api' },
    ],
  },
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    category: 'Communication',
    description: 'Send and manage email via Gmail API',
    icon: 'https://cdn.simpleicons.org/gmail',
    color: '#EA4335',
    tools: 40,
    fields: [
      { key: 'client_id', label: 'OAuth Client ID', type: 'string', required: true, placeholder: 'your-client-id.apps.googleusercontent.com' },
      { key: 'client_secret', label: 'OAuth Client Secret', type: 'secret', required: true },
    ],
  },
  github: {
    id: 'github',
    name: 'GitHub',
    category: 'Development',
    description: 'Repositories, issues, and pull requests',
    icon: 'https://cdn.simpleicons.org/github',
    color: '#24292e',
    tools: 792,
    fields: [
      { key: 'personal_access_token', label: 'Personal Access Token', type: 'secret', required: true, placeholder: 'ghp_...', description: 'Generate at github.com/settings/tokens' },
    ],
  },
  gcal: {
    id: 'gcal',
    name: 'Google Calendar',
    category: 'Productivity',
    description: 'Manage calendars and events',
    icon: 'https://cdn.simpleicons.org/googlecalendar',
    color: '#4285F4',
    tools: 46,
    fields: [
      { key: 'client_id', label: 'OAuth Client ID', type: 'string', required: true },
      { key: 'client_secret', label: 'OAuth Client Secret', type: 'secret', required: true },
    ],
  },
  notion: {
    id: 'notion',
    name: 'Notion',
    category: 'Productivity',
    description: 'Pages, databases, and workspace',
    icon: 'https://cdn.simpleicons.org/notion',
    color: '#000000',
    tools: 46,
    fields: [
      { key: 'api_key', label: 'Integration Token', type: 'secret', required: true, placeholder: 'ntn_...', description: 'Create at notion.so/my-integrations' },
    ],
  },
  gsheets: {
    id: 'gsheets',
    name: 'Google Sheets',
    category: 'Productivity',
    description: 'Read and write spreadsheets',
    icon: 'https://cdn.simpleicons.org/googlesheets',
    color: '#0F9D58',
    tools: 44,
    fields: [
      { key: 'client_id', label: 'OAuth Client ID', type: 'string', required: true },
      { key: 'client_secret', label: 'OAuth Client Secret', type: 'secret', required: true },
    ],
  },
  slack: {
    id: 'slack',
    name: 'Slack',
    category: 'Communication',
    description: 'Messaging, channels, and notifications',
    icon: 'https://www.svgrepo.com/show/303320/slack-new-logo-logo.svg',
    color: '#4A154B',
    tools: 155,
    fields: [
      { key: 'bot_token', label: 'Bot Token', type: 'secret', required: true, placeholder: 'xoxb-...', description: 'From your Slack app OAuth settings' },
    ],
  },
  supabase: {
    id: 'supabase',
    name: 'Supabase',
    category: 'Infrastructure',
    description: 'Database, auth, and storage',
    icon: 'https://cdn.simpleicons.org/supabase',
    color: '#3ECF8E',
    tools: 84,
    fields: [
      { key: 'project_url', label: 'Project URL', type: 'url', required: true, placeholder: 'https://xxx.supabase.co' },
      { key: 'service_role_key', label: 'Service Role Key', type: 'secret', required: true, placeholder: 'eyJ...' },
    ],
  },
  outlook: {
    id: 'outlook',
    name: 'Outlook',
    category: 'Communication',
    description: 'Microsoft email and calendar',
    icon: 'https://www.svgrepo.com/show/373951/outlook.svg',
    color: '#0078D4',
    tools: 62,
    fields: [
      { key: 'client_id', label: 'Azure App Client ID', type: 'string', required: true },
      { key: 'client_secret', label: 'Azure App Client Secret', type: 'secret', required: true },
      { key: 'tenant_id', label: 'Tenant ID', type: 'string', required: false, placeholder: 'common', description: 'Azure AD tenant (default: common)' },
    ],
  },
  x: {
    id: 'x',
    name: 'X (Twitter)',
    category: 'Social',
    description: 'Posts, timeline, and messages',
    icon: 'https://cdn.simpleicons.org/x',
    color: '#000000',
    tools: 38,
    fields: [
      { key: 'api_key', label: 'API Key', type: 'secret', required: true },
      { key: 'api_secret', label: 'API Secret', type: 'secret', required: true },
      { key: 'bearer_token', label: 'Bearer Token', type: 'secret', required: true },
    ],
  },
  linear: {
    id: 'linear',
    name: 'Linear',
    category: 'Development',
    description: 'Issues, projects, and cycles',
    icon: 'https://cdn.simpleicons.org/linear',
    color: '#5E6AD2',
    tools: 52,
    fields: [
      { key: 'api_key', label: 'API Key', type: 'secret', required: true, description: 'Generate at linear.app/settings/api' },
    ],
  },
  figma: {
    id: 'figma',
    name: 'Figma',
    category: 'Design',
    description: 'Design files and components',
    icon: 'https://cdn.simpleicons.org/figma',
    color: '#F24E1E',
    tools: 28,
    fields: [
      { key: 'personal_access_token', label: 'Personal Access Token', type: 'secret', required: true, description: 'Generate at figma.com/developers/api' },
    ],
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    category: 'Communication',
    description: 'Servers, channels, and bots',
    icon: 'https://cdn.simpleicons.org/discord',
    color: '#5865F2',
    tools: 67,
    fields: [
      { key: 'bot_token', label: 'Bot Token', type: 'secret', required: true, description: 'From your Discord developer portal' },
    ],
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe',
    category: 'Payments',
    description: 'Payments, subscriptions, and invoices',
    icon: 'https://cdn.simpleicons.org/stripe',
    color: '#635BFF',
    tools: 120,
    fields: [
      { key: 'secret_key', label: 'Secret Key', type: 'secret', required: true, placeholder: 'sk_...', description: 'From stripe.com/dashboard/apikeys' },
    ],
  },
  airtable: {
    id: 'airtable',
    name: 'Airtable',
    category: 'Productivity',
    description: 'Bases, tables, and records',
    icon: 'https://cdn.simpleicons.org/airtable',
    color: '#18BFFF',
    tools: 35,
    fields: [
      { key: 'api_key', label: 'Personal Access Token', type: 'secret', required: true, placeholder: 'pat...', description: 'Generate at airtable.com/create/tokens' },
    ],
  },
};

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function configDir(): string {
  return join(config.dataDir, 'settings', 'integrations');
}

function configFilePath(id: string): string {
  return join(configDir(), `${id}.md`);
}

function ensureConfigDir(): void {
  const dir = configDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getIntegrationSchema(id: string): IntegrationConfigSchema | null {
  return INTEGRATION_CONFIGS[id] ?? null;
}

export function getAllSchemas(): IntegrationConfigSchema[] {
  return Object.values(INTEGRATION_CONFIGS);
}

export function getIntegrationConfig(id: string): IntegrationConfigValues | null {
  const filepath = configFilePath(id);
  if (!existsSync(filepath)) return null;

  try {
    const parsed = parseMarkdownFile(filepath);
    const data = parsed.data as Record<string, unknown>;
    const values: IntegrationConfigValues = {};
    for (const [key, val] of Object.entries(data)) {
      if (key === 'configured_at') continue;
      if (val !== null && val !== undefined) {
        values[key] = String(val);
      }
    }
    return values;
  } catch {
    return null;
  }
}

export function saveIntegrationConfig(id: string, values: IntegrationConfigValues): void {
  ensureConfigDir();
  const data: Record<string, string> = {
    ...values,
    configured_at: new Date().toISOString(),
  };
  const content = matter.stringify('', data).trim() + '\n';
  writeMarkdownFile(configFilePath(id), content);
}

export function deleteIntegrationConfig(id: string): boolean {
  const filepath = configFilePath(id);
  if (!existsSync(filepath)) return false;
  try {
    unlinkSync(filepath);
    return true;
  } catch {
    return false;
  }
}

export function isIntegrationConnected(id: string): boolean {
  const schema = INTEGRATION_CONFIGS[id];
  if (!schema) return false;

  const values = getIntegrationConfig(id);
  if (!values) return false;

  // Check that all required fields have non-empty values
  return schema.fields
    .filter((f) => f.required)
    .every((f) => {
      const val = values[f.key];
      return val !== undefined && val !== null && val.trim().length > 0;
    });
}

/** Compute a short hash of config values for optimistic concurrency control. */
export function computeConfigHash(values: IntegrationConfigValues): string {
  return createHash('sha256').update(JSON.stringify(values, Object.keys(values).sort())).digest('hex').slice(0, 16);
}

export function maskSecret(value: string): string {
  if (!value || value.length <= 4) return value ? '****' : '';
  return '****' + value.slice(-4);
}
