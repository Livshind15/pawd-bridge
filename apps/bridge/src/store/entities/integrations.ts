import { join } from 'path';
import { existsSync } from 'fs';
import { config } from '../../config.js';
import { parseMarkdownFile } from '../markdown/parser.js';
import { writeMarkdownFile } from '../markdown/serializer.js';
import { isIntegrationConnected, INTEGRATION_CONFIGS } from './integration-configs.js';
import matter from 'gray-matter';

const integrationsPath = () => join(config.dataDir, 'settings', 'integrations.md');

export interface IntegrationApp {
  id: string;
  name: string;
  tools: number;
  icon: string;
  color: string;
}

export interface IntegrationAppWithStatus extends IntegrationApp {
  connected: boolean;
  category: string;
  description: string;
}

const DEFAULT_INTEGRATIONS: IntegrationApp[] = [
  { id: 'brave_search', name: 'Brave Search', tools: 5, icon: 'https://cdn.simpleicons.org/brave', color: '#FB542B' },
  { id: 'gmail', name: 'Gmail', tools: 40, icon: 'https://cdn.simpleicons.org/gmail', color: '#EA4335' },
  { id: 'github', name: 'GitHub', tools: 792, icon: 'https://cdn.simpleicons.org/github', color: '#24292e' },
  { id: 'gcal', name: 'Google Calendar', tools: 46, icon: 'https://cdn.simpleicons.org/googlecalendar', color: '#4285F4' },
  { id: 'notion', name: 'Notion', tools: 46, icon: 'https://cdn.simpleicons.org/notion', color: '#000000' },
  { id: 'gsheets', name: 'Google Sheets', tools: 44, icon: 'https://cdn.simpleicons.org/googlesheets', color: '#0F9D58' },
  { id: 'slack', name: 'Slack', tools: 155, icon: 'https://cdn.simpleicons.org/slack', color: '#4A154B' },
  { id: 'supabase', name: 'Supabase', tools: 84, icon: 'https://cdn.simpleicons.org/supabase', color: '#3ECF8E' },
  { id: 'outlook', name: 'Outlook', tools: 62, icon: 'https://cdn.simpleicons.org/microsoftoutlook', color: '#0078D4' },
  { id: 'x', name: 'X (Twitter)', tools: 38, icon: 'https://cdn.simpleicons.org/x', color: '#000000' },
  { id: 'linear', name: 'Linear', tools: 52, icon: 'https://cdn.simpleicons.org/linear', color: '#5E6AD2' },
  { id: 'figma', name: 'Figma', tools: 28, icon: 'https://cdn.simpleicons.org/figma', color: '#F24E1E' },
  { id: 'discord', name: 'Discord', tools: 67, icon: 'https://cdn.simpleicons.org/discord', color: '#5865F2' },
  { id: 'stripe', name: 'Stripe', tools: 120, icon: 'https://cdn.simpleicons.org/stripe', color: '#635BFF' },
  { id: 'airtable', name: 'Airtable', tools: 35, icon: 'https://cdn.simpleicons.org/airtable', color: '#18BFFF' },
];

export function getIntegrations(): IntegrationAppWithStatus[] {
  const filepath = integrationsPath();
  let baseList: IntegrationApp[];

  if (!existsSync(filepath)) {
    saveIntegrations(DEFAULT_INTEGRATIONS);
    baseList = DEFAULT_INTEGRATIONS;
  } else {
    const parsed = parseMarkdownFile(filepath);
    const list = (parsed.data.integrations as IntegrationApp[]) || [];
    if (!list.length) {
      baseList = DEFAULT_INTEGRATIONS;
    } else {
      const byId = new Map(DEFAULT_INTEGRATIONS.map((d) => [d.id, d]));
      baseList = list.map((int) => {
        const def = byId.get(int.id);
        const icon =
          typeof int.icon === 'string' && int.icon.startsWith('http')
            ? int.icon
            : (def?.icon ?? int.icon ?? '');
        const color = int.color ?? def?.color ?? '#666666';
        return { ...int, icon, color };
      });

      // Ensure new defaults (like brave_search) are included
      for (const def of DEFAULT_INTEGRATIONS) {
        if (!baseList.some((i) => i.id === def.id)) {
          baseList.push(def);
        }
      }
    }
  }

  // Merge connected status and metadata from config schemas
  return baseList.map((app) => {
    const schema = INTEGRATION_CONFIGS[app.id];
    return {
      ...app,
      connected: isIntegrationConnected(app.id),
      category: schema?.category ?? '',
      description: schema?.description ?? '',
    };
  });
}

export function saveIntegrations(integrations: IntegrationApp[]): void {
  const content = matter.stringify('', { integrations }).trim() + '\n';
  writeMarkdownFile(integrationsPath(), content);
}
