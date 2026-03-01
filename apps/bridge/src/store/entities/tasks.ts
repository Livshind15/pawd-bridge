import { join, basename } from 'path';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { config } from '../../config.js';
import {
  parseMarkdownFile,
  parseStepsFromSection,
  listMarkdownFiles,
} from '../markdown/parser.js';
import {
  serializeTask,
  writeMarkdownFile,
  type TaskData,
} from '../markdown/serializer.js';

export type { TaskData };

const tasksDir = () => join(config.dataDir, 'tasks');

export function getAllTasks(filters?: {
  status?: string;
  agentId?: string;
  priority?: string;
}): TaskData[] {
  const files = listMarkdownFiles(tasksDir()).filter(
    (f) => !basename(f, '.md').endsWith('-output')
  );
  let tasks = files.map((f) => parseTaskFile(f));

  if (filters?.status) {
    tasks = tasks.filter((t) => t.status === filters.status);
  }
  if (filters?.agentId) {
    tasks = tasks.filter((t) => t.assignedAgentId === filters.agentId);
  }
  if (filters?.priority) {
    tasks = tasks.filter((t) => t.priority === filters.priority);
  }

  return tasks;
}

export function getTaskById(id: string): TaskData | null {
  const filepath = join(tasksDir(), `${id}.md`);
  if (!existsSync(filepath)) return null;
  return parseTaskFile(filepath);
}

export function createTask(task: TaskData): TaskData {
  const filepath = join(tasksDir(), `${task.id}.md`);
  writeMarkdownFile(filepath, serializeTask(task));
  return task;
}

export function updateTask(id: string, updates: Partial<TaskData>): TaskData | null {
  const existing = getTaskById(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates, id };
  const filepath = join(tasksDir(), `${id}.md`);
  writeMarkdownFile(filepath, serializeTask(updated));
  return updated;
}

export function deleteTask(id: string): boolean {
  const filepath = join(tasksDir(), `${id}.md`);
  if (!existsSync(filepath)) return false;
  unlinkSync(filepath);
  return true;
}

export function getTaskOutput(id: string): { content: string; fromFile: boolean } | null {
  const task = getTaskById(id);
  if (!task) return null;
  const outputFilePath = join(tasksDir(), `${id}-output.md`);
  if (existsSync(outputFilePath)) {
    const content = readFileSync(outputFilePath, 'utf-8');
    return { content, fromFile: true };
  }
  const inline = task.output ?? '';
  return { content: inline, fromFile: false };
}

function parseTaskFile(filepath: string): TaskData {
  const parsed = parseMarkdownFile(filepath);
  const steps = parsed.sections.has('Steps')
    ? parseStepsFromSection(parsed.sections.get('Steps')!)
    : [];
  // Output can be in "Output", "פלט (Artifact)", or "Artifact" section
  const output =
    parsed.sections.get('Output') ||
    parsed.sections.get('פלט (Artifact)') ||
    parsed.sections.get('Artifact') ||
    null;

  return {
    id: parsed.data.id as string,
    title: parsed.data.title as string,
    description: parsed.description,
    status: parsed.data.status as string,
    priority: parsed.data.priority as string,
    assignedAgentId: parsed.data.assignedAgentId as string,
    tags: (parsed.data.tags as string[]) || [],
    dueDate: (parsed.data.dueDate as string) || null,
    tokensUsed: (parsed.data.tokensUsed as number) ?? null,
    tokenEstimate: (parsed.data.tokenEstimate as [number, number]) || [0, 0],
    createdAt: parsed.data.createdAt as string,
    completedAt: (parsed.data.completedAt as string) || null,
    steps,
    output,
  };
}
