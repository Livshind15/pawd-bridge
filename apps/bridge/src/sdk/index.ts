/**
 * SDK Adapter Layer — public API surface.
 *
 * Re-exports everything from the sdk/ modules so consumers can import
 * from a single entry point: import { runAgent, ... } from '../sdk/index.js'
 */

// Types
export type {
  AgentConfig,
  SessionInfo,
  StreamEvent,
  StreamEventBase,
  SessionInitEvent,
  StreamDeltaEvent,
  AssistantMessageEvent,
  ToolStartedEvent,
  ToolCompletedEvent,
  ToolProgressEvent,
  AgentResultEvent,
  AgentErrorEvent,
  AgentAbortedEvent,
  QueryOptions,
} from './types.js';

// Message stream
export { MessageStream } from './message-stream.js';
export type { MessageAttachment } from './message-stream.js';

// Session store
export {
  getSession,
  saveSession,
  deleteSession,
  listSessions,
  deleteAllForAgent,
} from './session-store.js';

// Agent config
export { loadAgentConfig } from './agent-config.js';

// Workspace
export {
  agentWorkspacePath,
  ensureAgentWorkspace,
  removeAgentWorkspace,
  readClaudeMd,
  writeClaudeMd,
  readIdentityFile,
  writeIdentityFile,
  buildSystemPromptAppend,
  listSkills,
  addSkill,
  removeSkill,
  parseIdentityFields,
  syncIdentityToAgent,
} from './workspace.js';
export type { WorkspaceSkill, ParsedIdentity } from './workspace.js';

// Agent runner
export {
  runAgent,
  abortAgent,
  isAgentRunning,
  listActiveRuns,
} from './agent-runner.js';
