import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { config } from './config.js';
import { serializeAgent, serializeTask, writeMarkdownFile } from './store/markdown/serializer.js';
import type { AgentData, TaskData, SkillData } from './store/markdown/serializer.js';
import { logger } from './utils/logger.js';

// Agent seed data (from mocks/agents.ts)
const SEED_AGENTS: AgentData[] = [
  {
    id: 'a1',
    name: 'Rascal',
    icon: 'mail',
    avatar: '/avatars/rascal.jpeg',
    role: 'assistant',
    roleLabel: 'Personal Assistant',
    tagline: 'Inbox & travel planner',
    description: 'Rascal helps me plan trips and clean my inbox. Fast, reliable, never complains.',
    status: 'online',
    skillsCount: 6,
    lastActive: '2 min ago',
    accentColor: '#BAB4B4',
    bgColor: '#EFF6FF',
    missionsCompleted: 47,
    tokensUsed: 12450,
    avgMissionTime: '1.8m',
    skills: [
      { id: 's1', name: 'Web Search', icon: '', description: 'Search the internet for information', category: 'planning', enabled: true, tokenCostHint: '~5-15 tokens' },
      { id: 's2', name: 'Task Planner', icon: '', description: 'Break down goals into actionable steps', category: 'planning', enabled: true, tokenCostHint: '~10-20 tokens' },
      { id: 's3', name: 'Calendar Planner', icon: '', description: 'Schedule and manage calendar events', category: 'planning', enabled: false, tokenCostHint: '~3-8 tokens' },
      { id: 's4', name: 'Email Assistant', icon: '', description: 'Read, draft, and send emails', category: 'communication', enabled: true, tokenCostHint: '~8-15 tokens' },
      { id: 's5', name: 'Slack Helper', icon: '', description: 'Monitor and respond in Slack channels', category: 'communication', enabled: false, tokenCostHint: '~5-10 tokens' },
      { id: 's6', name: 'File Reader', icon: '', description: 'Read and extract data from documents', category: 'files', enabled: true, tokenCostHint: '~10-25 tokens' },
    ],
  },
  {
    id: 'a2',
    name: 'Scout',
    icon: 'search',
    avatar: '/avatars/scout.jpeg',
    role: 'research',
    roleLabel: 'Researcher',
    tagline: 'Deep dives & reports',
    description: 'Maple digs through data and produces detailed research summaries.',
    status: 'busy',
    skillsCount: 4,
    lastActive: 'Running task',
    accentColor: '#A585B0',
    bgColor: '#FEF2F2',
    missionsCompleted: 23,
    tokensUsed: 8900,
    avgMissionTime: '3.2m',
  },
  {
    id: 'a3',
    name: 'Shadow',
    icon: 'settingsAlt',
    avatar: '/avatars/shadow.jpeg',
    role: 'automation',
    roleLabel: 'Automation',
    tagline: 'Background workflows',
    description: 'Ghost runs silent automations. Monitors, triggers, and executes routines.',
    status: 'sleeping',
    skillsCount: 8,
    lastActive: '3h ago',
    accentColor: '#D7997C',
    bgColor: '#FEF2F2',
    missionsCompleted: 112,
    tokensUsed: 34200,
    avgMissionTime: '0.9m',
  },
  {
    id: 'a4',
    name: 'Piper',
    icon: 'sparkles',
    avatar: '/avatars/piper.jpeg',
    role: 'creative',
    roleLabel: 'Creative',
    tagline: 'Writing & content',
    description: 'Splash crafts emails, blog posts, and creative content with flair.',
    status: 'online',
    skillsCount: 5,
    lastActive: '10 min ago',
    accentColor: '#94C7B1',
    bgColor: '#ECFEFF',
    missionsCompleted: 31,
    tokensUsed: 15600,
    avgMissionTime: '2.4m',
  },
  {
    id: 'a5',
    name: 'Cooper',
    icon: 'hash',
    avatar: '/avatars/cooper.jpeg',
    role: 'dev',
    roleLabel: 'Dev Helper',
    tagline: 'Code & debugging',
    description: 'Tusk reviews code, writes scripts, and debugs issues methodically.',
    status: 'online',
    skillsCount: 7,
    lastActive: '5 min ago',
    accentColor: '#0D1337',
    bgColor: '#ECFDF5',
    missionsCompleted: 64,
    tokensUsed: 28100,
    avgMissionTime: '1.5m',
  },
  {
    id: 'a6',
    name: 'Ranger',
    icon: 'globe',
    avatar: '/avatars/ranger.png',
    role: 'research',
    roleLabel: 'Web Scout',
    tagline: 'Search & monitor',
    description: 'Talon scans the web for information, tracks changes, and alerts you.',
    status: 'sleeping',
    skillsCount: 3,
    lastActive: '1d ago',
    accentColor: '#E9C6AD',
    bgColor: '#FFFBEB',
    missionsCompleted: 19,
    tokensUsed: 4300,
    avgMissionTime: '2.1m',
  },
];

// Task seed data (from mocks/tasks.ts)
const SEED_TASKS: TaskData[] = [];

export async function initDataDir(): Promise<void> {
  const dirs = [
    config.dataDir,
    join(config.dataDir, 'agents'),
    join(config.dataDir, 'tasks'),
    join(config.dataDir, 'conversations'),
    join(config.dataDir, 'terminal', 'sessions'),
    join(config.dataDir, 'settings'),
    join(config.dataDir, 'config'),
    join(config.dataDir, 'uploads'),
    join(config.dataDir, 'uploads', 'avatars'),
    // Cron lives one level above agentWorkspacesDir (sibling of data/)
    join(dirname(config.agentWorkspacesDir), 'cron'),
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Ensure default integrations file exists (with image URLs, not emojis)
  const { getIntegrations } = await import('./store/entities/integrations.js');
  getIntegrations();

  // Seed agents if empty
  const agentsDir = join(config.dataDir, 'agents');
  if (!existsSync(join(agentsDir, 'a1.md'))) {
    logger.info('Seeding agent data...');
    for (const agent of SEED_AGENTS) {
      writeMarkdownFile(join(agentsDir, `${agent.id}.md`), serializeAgent(agent));
    }
    logger.info({ count: SEED_AGENTS.length }, 'Agents seeded');
  }


}

// Allow running directly: tsx src/seed.ts
if (process.argv[1]?.endsWith('seed.ts')) {
  initDataDir().then(() => {
    logger.info('Seed complete');
    process.exit(0);
  });
}
