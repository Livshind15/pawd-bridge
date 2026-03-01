export type AgentStatus = 'online' | 'busy' | 'sleeping';
export type AgentRole = 'assistant' | 'research' | 'automation' | 'creative' | 'dev';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface AgentIcon {
  set: string;
  name: string;
}

export type AgentIconKey = string;

export interface Agent {
  id: string;
  name: string;
  icon: AgentIcon;
  avatar: string | number;
  role: AgentRole;
  roleLabel: string;
  tagline: string;
  description: string;
  status: AgentStatus;
  skillsCount: number;
  lastActive: string;
  accentColor: string;
  bgColor: string;
  missionsCompleted: number;
  tokensUsed: number;
  avgMissionTime: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  // SDK agent configuration fields
  systemPrompt?: string;
  allowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  hookConfigs?: Record<string, unknown>;
  subagentDefs?: Array<{ name: string; model?: string; prompt?: string }>;
  cwd?: string;
  settingSources?: string[];
}

export interface Skill {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: string;
  enabled: boolean;
  tokenCostHint: string;
}

export interface SkillCategory {
  id: string;
  title: string;
  skills: Skill[];
}
