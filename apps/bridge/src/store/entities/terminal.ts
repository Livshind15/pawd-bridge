import { join } from 'path';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { config } from '../../config.js';
import { parseMarkdownFile, listMarkdownFiles } from '../markdown/parser.js';
import {
  serializeTerminalSession,
  writeMarkdownFile,
  type TerminalSessionData,
} from '../markdown/serializer.js';

const sessionsDir = () => join(config.dataDir, 'terminal', 'sessions');

export interface QuickCommand {
  id: string;
  label: string;
  command: string;
  description: string;
}

// Default quick commands
const QUICK_COMMANDS: QuickCommand[] = [
  { id: 'qc1', label: 'Check logs', command: 'tail -f /var/log/agents.log', description: 'View recent agent activity logs' },
  { id: 'qc2', label: 'Show agents', command: 'ps agents', description: 'List all running agent processes' },
  { id: 'qc3', label: 'Restart runtime', command: 'systemctl restart agent-runtime', description: 'Restart the agent runtime service' },
  { id: 'qc4', label: 'Restart Home', command: 'pawd home restart', description: 'Restart your entire Home VM' },
  { id: 'qc5', label: 'Check disk', command: 'df -h', description: 'Show disk usage information' },
  { id: 'qc6', label: 'Memory usage', command: 'free -m', description: 'Display memory statistics' },
];

export function getAllSessions(): TerminalSessionData[] {
  const files = listMarkdownFiles(sessionsDir());
  return files.map((f) => parseSessionFile(f));
}

export function getSessionById(id: string): TerminalSessionData | null {
  const filepath = join(sessionsDir(), `${id}.md`);
  if (!existsSync(filepath)) return null;
  return parseSessionFile(filepath);
}

export function createSession(session: TerminalSessionData): TerminalSessionData {
  const filepath = join(sessionsDir(), `${session.id}.md`);
  writeMarkdownFile(filepath, serializeTerminalSession(session));
  return session;
}

export function appendToSession(id: string, line: string): void {
  const filepath = join(sessionsDir(), `${id}.md`);
  if (!existsSync(filepath)) return;

  const existing = readFileSync(filepath, 'utf-8');
  // Append to the code block or add a new one
  if (existing.includes('```')) {
    const updated = existing.replace(/```\s*$/, `${line}\n\`\`\``);
    writeMarkdownFile(filepath, updated);
  } else {
    appendFileSync(filepath, `\n\`\`\`\n${line}\n\`\`\`\n`, 'utf-8');
  }
}

export function updateSession(
  id: string,
  updates: Partial<TerminalSessionData>
): TerminalSessionData | null {
  const existing = getSessionById(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates, id };
  const filepath = join(sessionsDir(), `${id}.md`);
  writeMarkdownFile(filepath, serializeTerminalSession(updated));
  return updated;
}

export function getQuickCommands(): QuickCommand[] {
  return QUICK_COMMANDS;
}

function parseSessionFile(filepath: string): TerminalSessionData {
  const parsed = parseMarkdownFile(filepath);

  // Extract log from code blocks
  let log = '';
  const codeBlockMatch = parsed.raw.match(/```[\s\S]*?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    log = codeBlockMatch[1].trim();
  }

  return {
    id: parsed.data.id as string,
    date: parsed.data.date as string,
    duration: parsed.data.duration as string,
    status: parsed.data.status as string,
    commandCount: (parsed.data.commandCount as number) || 0,
    log,
  };
}
