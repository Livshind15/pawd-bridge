import { spawn } from 'child_process';
import { FastifyInstance } from 'fastify';
import * as terminalStore from '../../store/entities/terminal.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import { generateId } from '../../utils/id.js';

function execLocal(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const exitCode = code ?? (signal ? 128 : 0);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

export function terminalRoutes(fastify: FastifyInstance): void {
  // GET /api/terminal/sessions
  fastify.get('/api/terminal/sessions', async () => {
    const sessions = terminalStore.getAllSessions();
    return { sessions };
  });

  // GET /api/terminal/sessions/:id
  fastify.get<{ Params: { id: string } }>('/api/terminal/sessions/:id', async (request) => {
    const session = terminalStore.getSessionById(request.params.id);
    if (!session) throw new NotFoundError('Terminal session', request.params.id);
    return { session };
  });

  // POST /api/terminal/exec
  fastify.post<{
    Body: { command: string; sessionId?: string };
  }>('/api/terminal/exec', async (request) => {
    const body = request.body as { command: string; sessionId?: string };
    if (!body.command) throw new ValidationError('Command is required');

    // Create or use existing session
    let sessionId = body.sessionId;
    if (!sessionId) {
      sessionId = generateId('ts');
      terminalStore.createSession({
        id: sessionId,
        date: new Date().toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        duration: '0m',
        status: 'active',
        commandCount: 0,
      });
    }

    try {
      // Execute command locally in the same VM
      const result = await execLocal(body.command);

      const output = result.stdout + (result.stderr ? result.stderr : '');
      terminalStore.appendToSession(sessionId, `$ ${body.command}\n${output}`);

      const session = terminalStore.getSessionById(sessionId);
      if (session) {
        terminalStore.updateSession(sessionId, {
          commandCount: session.commandCount + 1,
        });
      }

      return {
        sessionId,
        output,
        exitCode: result.exitCode,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Command execution failed';
      terminalStore.appendToSession(sessionId, `$ ${body.command}\nError: ${errorMessage}`);

      return {
        sessionId,
        output: `Error: ${errorMessage}`,
        exitCode: 1,
      };
    }
  });

  // GET /api/terminal/quick-commands
  fastify.get('/api/terminal/quick-commands', async () => {
    const commands = terminalStore.getQuickCommands();
    return { commands };
  });
}
