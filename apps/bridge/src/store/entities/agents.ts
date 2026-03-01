import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { config } from '../../config.js';
import {
  parseMarkdownFile,
  parseSkillsFromSection,
  listMarkdownFiles,
} from '../markdown/parser.js';
import {
  serializeAgent,
  writeMarkdownFile,
  type AgentData,
  type SkillData,
} from '../markdown/serializer.js';

export type { AgentData, SkillData };

const agentsDir = () => join(config.dataDir, 'agents');

export function getAllAgents(): AgentData[] {
  const files = listMarkdownFiles(agentsDir());
  return files.map((f) => parseAgentFile(f));
}

export function getAgentById(id: string): AgentData | null {
  const filepath = join(agentsDir(), `${id}.md`);
  if (!existsSync(filepath)) return null;
  return parseAgentFile(filepath);
}

export function createAgent(agent: AgentData): AgentData {
  const filepath = join(agentsDir(), `${agent.id}.md`);
  writeMarkdownFile(filepath, serializeAgent(agent));
  return agent;
}

export function updateAgent(id: string, updates: Partial<AgentData>): AgentData | null {
  const existing = getAgentById(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates, id }; // id is immutable
  const filepath = join(agentsDir(), `${id}.md`);
  writeMarkdownFile(filepath, serializeAgent(updated));
  return updated;
}

export function deleteAgent(id: string): boolean {
  const filepath = join(agentsDir(), `${id}.md`);
  if (!existsSync(filepath)) return false;
  unlinkSync(filepath);
  return true;
}

export function getAgentSkills(id: string): SkillData[] {
  const filepath = join(agentsDir(), `${id}.md`);
  if (!existsSync(filepath)) return [];

  const parsed = parseMarkdownFile(filepath);
  const skillsSection = parsed.sections.get('Skills');
  if (!skillsSection) return [];

  return parseSkillsFromSection(skillsSection);
}

function parseAgentFile(filepath: string): AgentData {
  const parsed = parseMarkdownFile(filepath);
  const skills = parsed.sections.has('Skills')
    ? parseSkillsFromSection(parsed.sections.get('Skills')!)
    : [];

  return {
    id: parsed.data.id as string,
    name: parsed.data.name as string,
    icon: parsed.data.icon as string,
    role: parsed.data.role as string,
    roleLabel: parsed.data.roleLabel as string,
    tagline: parsed.data.tagline as string,
    description: parsed.description,
    status: parsed.data.status as string,
    accentColor: parsed.data.accentColor as string,
    bgColor: parsed.data.bgColor as string,
    skillsCount: (parsed.data.skillsCount as number) || skills.length,
    lastActive: parsed.data.lastActive as string,
    missionsCompleted: (parsed.data.missionsCompleted as number) || 0,
    tokensUsed: (parsed.data.tokensUsed as number) || 0,
    avgMissionTime: parsed.data.avgMissionTime as string,
    avatar: parsed.data.avatar as string,
    skills,
    model: (parsed.data.model as string) || undefined,
    thinkingLevel: (parsed.data.thinkingLevel as string) || undefined,
    // SDK agent configuration fields
    systemPrompt: (parsed.data.systemPrompt as string) || undefined,
    allowedTools: (parsed.data.allowedTools as string[]) || undefined,
    mcpServers: (parsed.data.mcpServers as Record<string, unknown>) || undefined,
    hookConfigs: (parsed.data.hookConfigs as Record<string, unknown>) || undefined,
    subagentDefs: (parsed.data.subagentDefs as Array<{ name: string; model?: string; prompt?: string }>) || undefined,
    cwd: (parsed.data.cwd as string) || undefined,
    settingSources: (parsed.data.settingSources as string[]) || undefined,
    // Self-discovery identity fields
    creature: (parsed.data.creature as string) || undefined,
    vibe: (parsed.data.vibe as string) || undefined,
    identityEmoji: (parsed.data.identityEmoji as string) || undefined,
    identityAvatar: (parsed.data.identityAvatar as string) || undefined,
  };
}
