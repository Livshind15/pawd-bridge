export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'waiting_for_human' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskStep {
  id: string;
  label: string;
  timestamp: string;
  completed: boolean;
  current?: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgentId: string;
  tags: string[];
  dueDate: string | null;
  tokensUsed: number | null;
  tokenEstimate: [number, number];
  createdAt: string;
  completedAt: string | null;
  steps: TaskStep[];
  output?: string | null;
}
