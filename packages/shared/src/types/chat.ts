// ---------------------------------------------------------------------------
// Content-part architecture ported from mobileclaw
// ---------------------------------------------------------------------------

/** Discriminator for ContentPart variants */
export type ContentPartType = 'text' | 'tool_call' | 'thinking' | 'image' | 'image_url' | 'file';

/**
 * A single content part inside a message.
 *
 * Messages are represented as `ContentPart[]` so the UI can render text,
 * tool invocations, thinking blocks, images and files inline.
 */
export interface ContentPart {
  type: ContentPartType;
  // Text content
  text?: string;
  // Thinking / reasoning content
  thinking?: string;
  // Tool-call fields
  name?: string;
  toolCallId?: string;
  arguments?: string; // JSON string
  status?: 'running' | 'success' | 'error';
  result?: string;
  resultError?: boolean;
  source?: Record<string, unknown>;
  // Image fields
  image_url?: { url?: string };
  // File fields
  file_url?: string;
  file_name?: string;
  file_mime?: string;
  // Sub-agent spawn fields
  subagentSessionKey?: string;
  taskName?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Granular event types emitted by bridge
// ---------------------------------------------------------------------------

export type GranularEventType =
  | 'tool.started' | 'tool.progress' | 'tool.completed' | 'tool.error' | 'tool.approval.needed'
  | 'agent.thinking.start' | 'agent.thinking.delta' | 'agent.thinking.end'
  | 'agent.stream.start' | 'agent.stream.delta' | 'agent.stream.end'
  | 'subagent.spawned' | 'subagent.completed' | 'subagent.failed' | 'subagent.activity'
  | 'hook.triggered' | 'hook.progress' | 'hook.completed' | 'hook.failed'
  | 'session.state.changed' | 'session.model.changed' | 'session.compacted'
  | 'chat.delta' | 'chat.final' | 'chat.aborted' | 'chat.error'
  | 'lifecycle.start' | 'lifecycle.end' | 'lifecycle.error'
  | 'message.complete';

// ---------------------------------------------------------------------------
// Message roles
// ---------------------------------------------------------------------------

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'toolResult';

// ---------------------------------------------------------------------------
// Sub-agent activity
// ---------------------------------------------------------------------------

/** Single activity entry inside a sub-agent session */
export interface SubagentEntry {
  type: 'text' | 'tool' | 'reasoning';
  text: string;
  toolStatus?: 'running' | 'success' | 'error';
  ts: number;
}

// ---------------------------------------------------------------------------
// Tool display helpers
// ---------------------------------------------------------------------------

/** Resolved display metadata for a tool invocation */
export interface ToolDisplayInfo {
  icon: 'terminal' | 'file' | 'search' | 'globe' | 'gear' | 'robot';
  label: string;
  service: string;
}

// ---------------------------------------------------------------------------
// Chat message (content-parts aware)
// ---------------------------------------------------------------------------

/**
 * Primary chat message type with full content-parts support.
 *
 * `content` can be either a plain string (simple text message) or an array
 * of `ContentPart` objects for rich, multi-part messages.
 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: ContentPart[] | string;
  timestamp: string;
  // Tool calls (legacy flat array -- prefer content parts)
  toolCalls?: ToolCall[];
  // Reasoning (legacy -- prefer thinking content parts)
  reasoning?: {
    id: string;
    charCount: number;
    isExpanded: boolean;
    content: string;
    isThinking: boolean;
  };
  metadata?: {
    duration?: string;
    tokens?: number;
    cost?: string;
  };
  isStreaming?: boolean;
  agentId?: string;
  agentName?: string;
  attachments?: ImageAttachment[];
  // mobileclaw-style fields
  stopReason?: string;
  isContext?: boolean;
  isCommandResponse?: boolean;
  isHidden?: boolean;
  thinkingDuration?: number;
  runDuration?: number;
}

// ---------------------------------------------------------------------------
// Tool call
// ---------------------------------------------------------------------------

/** Tool call shape from gateway response */
export interface ToolCall {
  id: string;
  name: string;
  service: string;
  icon: string;
  input?: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'completed' | 'error';
}

// ---------------------------------------------------------------------------
// Image attachment
// ---------------------------------------------------------------------------

/** Image attachment sent alongside a user message */
export interface ImageAttachment {
  type: 'image';
  media_type: string;
  data: string;
}

// ---------------------------------------------------------------------------
// Granular event payload
// ---------------------------------------------------------------------------

/** A single granular event emitted by the bridge layer */
export interface GranularEvent {
  type: GranularEventType;
  conversationId?: string;
  agentId?: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Preserved types (existed before mobileclaw port)
// ---------------------------------------------------------------------------

/** Reasoning / thinking block from assistant */
export interface ReasoningBlock {
  id: string;
  charCount: number;
  isExpanded: boolean;
  content: string;
  isThinking: boolean;
}

/** Quick suggestion chip shown in empty chat state */
export interface SuggestionChip {
  id: string;
  label: string;
  icons: string[];
}

/** Shape used by chat header and message bubbles (derived from Agent) */
export interface ChatAgentDisplay {
  id: string;
  name: string;
  species: string;
  emoji: string;
  description: string;
  image: string;
  accentColor: string;
  bgGradient: [string, string];
  role: string;
  greeting?: string;
}
