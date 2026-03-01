import matter from 'gray-matter';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface AgentData {
  id: string;
  name: string;
  icon: string;
  role: string;
  roleLabel: string;
  tagline: string;
  description: string;
  status: string;
  accentColor: string;
  bgColor: string;
  skillsCount: number;
  lastActive: string;
  missionsCompleted: number;
  tokensUsed: number;
  avgMissionTime: string;
  avatar: string;
  skills?: SkillData[];
  model?: string;          // e.g. "anthropic/claude-opus-4-6"
  thinkingLevel?: string;  // "off"|"minimal"|"low"|"medium"|"high"|"xhigh"
  // SDK agent configuration fields
  systemPrompt?: string;
  allowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  hookConfigs?: Record<string, unknown>;
  subagentDefs?: Array<{ name: string; model?: string; prompt?: string }>;
  cwd?: string;
  settingSources?: string[];
  // Self-discovery identity fields
  creature?: string;        // "AI", "robot", "familiar", "ghost in the machine", etc.
  vibe?: string;            // "sharp", "warm", "chaotic", "calm", etc.
  identityEmoji?: string;   // Signature emoji
  identityAvatar?: string;  // Workspace-relative path, URL, or data URI
}

export interface SkillData {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: string;
  enabled: boolean;
  tokenCostHint: string;
}

export interface TaskData {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignedAgentId: string;
  tags: string[];
  dueDate: string | null;
  tokensUsed: number | null;
  tokenEstimate: [number, number];
  createdAt: string;
  completedAt: string | null;
  steps: TaskStepData[];
  output?: string | null;
}

export interface TaskStepData {
  id: string;
  label: string;
  timestamp: string;
  completed: boolean;
  current?: boolean;
}

export function serializeAgent(agent: AgentData): string {
  const { description, skills, ...rest } = agent;

  // Strip undefined values — js-yaml (used by gray-matter) rejects them
  const frontmatterData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) frontmatterData[k] = v;
  }

  const yaml = matter.stringify('', frontmatterData).trim();
  let body = `\n# ${agent.name}\n\n${description}\n`;

  if (skills && skills.length > 0) {
    body += '\n## Skills\n\n';
    for (const skill of skills) {
      const status = skill.enabled ? 'enabled' : 'disabled';
      body += `- **${skill.name}** (${skill.category}) - ${skill.description} [${status}] ${skill.tokenCostHint}\n`;
    }
  }

  return yaml + body;
}

export function serializeTask(task: TaskData): string {
  const { description, steps, output, ...frontmatterData } = task;

  const yaml = matter.stringify('', frontmatterData).trim();
  let body = `\n# ${task.title}\n\n${description}\n`;

  if (steps && steps.length > 0) {
    body += '\n## Steps\n\n';
    for (const step of steps) {
      const checkbox = step.completed ? '[x]' : '[ ]';
      const timestamp = step.timestamp ? ` (${step.timestamp})` : '';
      const current = step.current ? ' **<-- current**' : '';
      body += `- ${checkbox} ${step.label}${timestamp}${current}\n`;
    }
  }

  if (output) {
    body += '\n## Output\n\n' + output + '\n';
  }

  return yaml + body;
}

export interface ConversationMeta {
  id: string;
  title: string;
  agentId: string;
  agentIds?: string[];
  mode?: 'single' | 'broadcast' | 'multi';
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** SDK session identifier for conversation continuity */
  sessionId?: string;
  /** UUID of the last assistant message (for SDK resume) */
  lastAssistantUuid?: string;
}

export function serializeConversationMeta(meta: ConversationMeta): string {
  // Strip undefined values for gray-matter compatibility
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined) data[k] = v;
  }
  return matter.stringify('', data).trim() + '\n';
}

export interface TerminalSessionData {
  id: string;
  date: string;
  duration: string;
  status: string;
  commandCount: number;
  log?: string;
}

export function serializeTerminalSession(session: TerminalSessionData): string {
  const { log, ...frontmatterData } = session;

  const yaml = matter.stringify('', frontmatterData).trim();
  let body = `\n# Terminal Session ${session.id}\n`;

  if (log) {
    body += `\n\`\`\`\n${log}\n\`\`\`\n`;
  }

  return yaml + body;
}

export function writeMarkdownFile(filepath: string, content: string): void {
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, content, 'utf-8');
}
