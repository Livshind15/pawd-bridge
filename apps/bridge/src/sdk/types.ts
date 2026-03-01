/**
 * Type definitions for the Claude Agent SDK adapter layer.
 *
 * These types define the bridge's view of agent configuration, session state,
 * and streaming events. They are independent of the SDK's internal types and
 * form the public contract consumed by bridge routes and the mobile app.
 */

import type {
  Options,
  McpServerConfig,
  HookEvent,
  HookCallbackMatcher,
  AgentDefinition,
} from '@anthropic-ai/claude-agent-sdk';

// ---------------------------------------------------------------------------
// Agent Configuration
// ---------------------------------------------------------------------------

/** Full configuration for a single agent. Combines identity, tools, and SDK options. */
export interface AgentConfig {
  /** Unique agent identifier (e.g. "agt_abc123"). */
  id: string;
  /** Human-readable agent name. */
  name: string;
  /** System prompt configuration — preset with optional appended context. */
  systemPrompt: string | {
    type: 'preset';
    preset: 'claude_code';
    append?: string;
  };
  /** Explicitly allowed tool names the agent may use. */
  allowedTools: string[];
  /** MCP server configurations keyed by server name. */
  mcpServers: Record<string, McpServerConfig>;
  /** Hook callbacks keyed by event name. */
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /** Subagent definitions keyed by agent name. */
  subagents: Record<string, AgentDefinition>;
  /** Working directory for the agent session. */
  cwd: string;
  /** Which filesystem settings to load ('user', 'project', 'local'). */
  settingSources: Array<'user' | 'project' | 'local'>;
  /** Model identifier (e.g. 'claude-sonnet-4-6'). */
  model?: string;
  /** Environment variables passed to the SDK process. */
  env: Record<string, string | undefined>;
}

// ---------------------------------------------------------------------------
// Session Info
// ---------------------------------------------------------------------------

/** Persisted metadata about an agent conversation session. */
export interface SessionInfo {
  /** SDK session identifier (UUID). */
  sessionId: string;
  /** UUID of the last assistant message — used for resumeSessionAt. */
  lastAssistantUuid: string | null;
  /** The agent that owns this session. */
  agentId: string;
  /** Bridge-level conversation ID. */
  conversationId: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last active timestamp. */
  lastActiveAt: string;
  /** Running message count for this session. */
  messageCount: number;
  /** Cumulative token usage. */
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Stream Events (bridge -> mobile)
// ---------------------------------------------------------------------------

/** Base fields present on every stream event. */
export interface StreamEventBase {
  /** Monotonically increasing sequence number. */
  seq?: number;
  /** Agent that produced the event. */
  agentId: string;
  /** Conversation the event belongs to. */
  conversationId: string;
  /** ISO-8601 timestamp of event creation. */
  timestamp: string;
}

/** Emitted when the SDK session initialises and returns session metadata. */
export interface SessionInitEvent extends StreamEventBase {
  type: 'session.init';
  sessionId: string;
  model: string;
  tools: string[];
}

/** Partial text streaming from the assistant. */
export interface StreamDeltaEvent extends StreamEventBase {
  type: 'agent.stream.delta';
  text: string;
  parentToolUseId: string | null;
}

/** Full assistant message after streaming completes. */
export interface AssistantMessageEvent extends StreamEventBase {
  type: 'agent.message';
  uuid: string;
  sessionId: string;
  /** Stringified content blocks from the SDK message. */
  content: unknown[];
}

/** A tool use has started execution. */
export interface ToolStartedEvent extends StreamEventBase {
  type: 'tool.started';
  toolName: string;
  toolUseId: string;
  input: unknown;
}

/** A tool use completed (success or error). */
export interface ToolCompletedEvent extends StreamEventBase {
  type: 'tool.completed';
  toolName: string;
  toolUseId: string;
  output: string;
}

/** Incremental progress from a tool execution. */
export interface ToolProgressEvent extends StreamEventBase {
  type: 'tool.progress';
  toolName: string;
  toolUseId: string;
  progress: string;
}

/** Agent run produced a final result. */
export interface AgentResultEvent extends StreamEventBase {
  type: 'agent.result';
  subtype: string;
  result: string | null;
  isError: boolean;
  durationMs: number;
  totalCostUsd: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
}

/** Agent run encountered a fatal error. */
export interface AgentErrorEvent extends StreamEventBase {
  type: 'agent.error';
  error: string;
  code?: string;
}

/** Agent run was aborted. */
export interface AgentAbortedEvent extends StreamEventBase {
  type: 'agent.aborted';
}

/** Union of all stream event types. */
export type StreamEvent =
  | SessionInitEvent
  | StreamDeltaEvent
  | AssistantMessageEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolProgressEvent
  | AgentResultEvent
  | AgentErrorEvent
  | AgentAbortedEvent;

// ---------------------------------------------------------------------------
// Query Options (convenience wrapper)
// ---------------------------------------------------------------------------

/** Convenience wrapper that bundles SDK Options with additional bridge context. */
export interface QueryOptions {
  /** The underlying SDK Options object passed to query(). */
  sdkOptions: Options;
  /** Agent ID for session tracking. */
  agentId: string;
  /** Conversation ID for session tracking. */
  conversationId: string;
}
