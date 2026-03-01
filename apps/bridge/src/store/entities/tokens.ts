import { join } from 'path';
import { existsSync } from 'fs';
import { config } from '../../config.js';
import { parseMarkdownFile } from '../markdown/parser.js';
import { writeMarkdownFile } from '../markdown/serializer.js';
import matter from 'gray-matter';

const tokensPath = () => join(config.dataDir, 'settings', 'tokens.md');

export interface UsageWindow {
  used: number;
  limit: number;
  resetsAt: string;
}

export interface TokenData {
  accountBalance: number;
  monthlyUsage: number;
  baseOverhead: number;
  sessionUsage: UsageWindow;
  weeklyUsage: UsageWindow;
  lastUpdated: string;
}

function defaultSessionReset(): string {
  const d = new Date();
  d.setHours(d.getHours() + 4);
  return d.toISOString();
}

function defaultWeeklyReset(): string {
  const d = new Date();
  d.setDate(d.getDate() + (7 - d.getDay()));
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const DEFAULT_TOKENS: TokenData = {
  accountBalance: 98450,
  monthlyUsage: 112450,
  baseOverhead: 1120,
  sessionUsage: { used: 24300, limit: 50000, resetsAt: defaultSessionReset() },
  weeklyUsage: { used: 112450, limit: 500000, resetsAt: defaultWeeklyReset() },
  lastUpdated: new Date().toISOString(),
};

export function getTokenData(): TokenData {
  const filepath = tokensPath();
  if (!existsSync(filepath)) {
    saveTokenData(DEFAULT_TOKENS);
    return DEFAULT_TOKENS;
  }

  const parsed = parseMarkdownFile(filepath);
  const d = parsed.data;
  const parseWindow = (raw: unknown, fallback: UsageWindow): UsageWindow => {
    if (raw && typeof raw === 'object') {
      const w = raw as Record<string, unknown>;
      return {
        used: (typeof w.used === 'number' ? w.used : fallback.used),
        limit: (typeof w.limit === 'number' ? w.limit : fallback.limit),
        resetsAt: (typeof w.resetsAt === 'string' ? w.resetsAt : fallback.resetsAt),
      };
    }
    return fallback;
  };
  return {
    accountBalance: (d.accountBalance as number) ?? DEFAULT_TOKENS.accountBalance,
    monthlyUsage: (d.monthlyUsage as number) ?? DEFAULT_TOKENS.monthlyUsage,
    baseOverhead: (d.baseOverhead as number) ?? DEFAULT_TOKENS.baseOverhead,
    sessionUsage: parseWindow(d.sessionUsage, DEFAULT_TOKENS.sessionUsage),
    weeklyUsage: parseWindow(d.weeklyUsage, DEFAULT_TOKENS.weeklyUsage),
    lastUpdated: (d.lastUpdated as string) ?? DEFAULT_TOKENS.lastUpdated,
  };
}

export function saveTokenData(data: Partial<TokenData>): TokenData {
  const existing = existsSync(tokensPath()) ? getTokenData() : DEFAULT_TOKENS;
  const updated = { ...existing, ...data, lastUpdated: new Date().toISOString() };
  const content = matter.stringify('', updated).trim() + '\n';
  writeMarkdownFile(tokensPath(), content);
  return updated;
}
