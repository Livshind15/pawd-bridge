import { FastifyInstance } from 'fastify';
import * as taskStore from '../../store/entities/tasks.js';
import * as agentStore from '../../store/entities/agents.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import { generateId } from '../../utils/id.js';

export function taskRoutes(fastify: FastifyInstance): void {
  // GET /api/tasks
  fastify.get<{
    Querystring: { status?: string; agentId?: string; priority?: string };
  }>('/api/tasks', async (request) => {
    const tasks = taskStore.getAllTasks({
      status: request.query.status,
      agentId: request.query.agentId,
      priority: request.query.priority,
    });
    return { tasks };
  });

  // GET /api/tasks/:id
  fastify.get<{ Params: { id: string } }>('/api/tasks/:id', async (request) => {
    const task = taskStore.getTaskById(request.params.id);
    if (!task) throw new NotFoundError('Task', request.params.id);
    return { task };
  });

  // GET /api/tasks/:id/output
  fastify.get<{ Params: { id: string } }>('/api/tasks/:id/output', async (request) => {
    const result = taskStore.getTaskOutput(request.params.id);
    if (!result) throw new NotFoundError('Task', request.params.id);
    return result;
  });

  // POST /api/tasks
  fastify.post<{ Body: Partial<taskStore.TaskData> }>('/api/tasks', async (request) => {
    const body = request.body as Partial<taskStore.TaskData>;
    if (!body.title) throw new ValidationError('Task title is required');
    if (!body.assignedAgentId) throw new ValidationError('assignedAgentId is required');
    if (!agentStore.getAgentById(body.assignedAgentId)) {
      throw new ValidationError(`Agent '${body.assignedAgentId}' does not exist`);
    }

    const task: taskStore.TaskData = {
      id: body.id || generateId('t'),
      title: body.title,
      description: body.description || '',
      status: body.status || 'todo',
      priority: body.priority || 'medium',
      assignedAgentId: body.assignedAgentId,
      tags: body.tags || [],
      dueDate: body.dueDate || null,
      tokensUsed: body.tokensUsed ?? null,
      tokenEstimate: body.tokenEstimate || [0, 0],
      createdAt: body.createdAt || new Date().toISOString(),
      completedAt: body.completedAt || null,
      steps: body.steps || [],
      output: body.output || null,
    };

    const created = taskStore.createTask(task);
    return { task: created };
  });

  // PUT /api/tasks/:id
  fastify.put<{ Params: { id: string }; Body: Partial<taskStore.TaskData> }>(
    '/api/tasks/:id',
    async (request) => {
      const updated = taskStore.updateTask(request.params.id, request.body as Partial<taskStore.TaskData>);
      if (!updated) throw new NotFoundError('Task', request.params.id);
      return { task: updated };
    }
  );

  // DELETE /api/tasks/:id
  fastify.delete<{ Params: { id: string } }>('/api/tasks/:id', async (request) => {
    const deleted = taskStore.deleteTask(request.params.id);
    if (!deleted) throw new NotFoundError('Task', request.params.id);
    return { success: true };
  });
}
