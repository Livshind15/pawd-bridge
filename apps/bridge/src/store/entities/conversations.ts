import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  appendFileSync,
  unlinkSync,
  rmSync,
  readdirSync,
} from 'fs';
import { config } from '../../config.js';
import { parseMarkdownFile } from '../markdown/parser.js';
import {
  serializeConversationMeta,
  writeMarkdownFile,
  type ConversationMeta,
} from '../markdown/serializer.js';

export type { ConversationMeta };

export interface ContentPart {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  toolCallId?: string;
  arguments?: string;
  status?: string;
  result?: string;
  resultError?: boolean;
  image_url?: { url?: string };
  file_url?: string;
  file_name?: string;
  file_mime?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contentParts?: ContentPart[];
  timestamp: string;
  toolCalls?: {
    id: string;
    name: string;
    service: string;
    icon: string;
    input?: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'completed' | 'error';
  }[];
  reasoning?: {
    id: string;
    charCount: number;
    isExpanded: boolean;
    content: string;
    isThinking: boolean;
  };
  metadata?: {
    duration: string;
    tokens: number;
    cost: string;
  };
  isStreaming?: boolean;
  agentId?: string;
  agentName?: string;
  attachments?: {
    type: 'image';
    media_type: string;
    data: string;
  }[];
}

const conversationsDir = () => join(config.dataDir, 'conversations');

export function getAllConversations(): ConversationMeta[] {
  const dir = conversationsDir();
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const conversations: ConversationMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(dir, entry.name, 'meta.md');
    if (!existsSync(metaPath)) continue;

    const parsed = parseMarkdownFile(metaPath);
    conversations.push(parsed.data as unknown as ConversationMeta);
  }

  return conversations;
}

export function getConversation(id: string): { meta: ConversationMeta; messages: ChatMessage[] } | null {
  const dir = join(conversationsDir(), id);
  const metaPath = join(dir, 'meta.md');
  if (!existsSync(metaPath)) {
    // Fallback: case-insensitive directory lookup (gateway lowercases session keys)
    const resolved = resolveConversationId(id);
    if (!resolved || resolved === id) return null;
    return getConversation(resolved);
  }

  const parsed = parseMarkdownFile(metaPath);
  const meta = parsed.data as unknown as ConversationMeta;
  const messages = getMessages(id);

  return { meta, messages };
}

/**
 * Case-insensitive lookup: find the real conversation directory name
 * that matches the given ID (ignoring case). Returns the actual ID or null.
 */
export function resolveConversationId(id: string): string | null {
  const dir = conversationsDir();
  if (!existsSync(dir)) return null;
  const lower = id.toLowerCase();
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.toLowerCase() === lower) {
      return entry.name;
    }
  }
  return null;
}

export function createConversation(meta: ConversationMeta): ConversationMeta {
  const dir = join(conversationsDir(), meta.id);
  mkdirSync(dir, { recursive: true });

  const metaPath = join(dir, 'meta.md');
  writeMarkdownFile(metaPath, serializeConversationMeta(meta));

  // Create empty messages file
  const messagesPath = join(dir, 'messages.jsonl');
  if (!existsSync(messagesPath)) {
    appendFileSync(messagesPath, '', 'utf-8');
  }

  return meta;
}

export function deleteConversation(id: string): boolean {
  const dir = join(conversationsDir(), id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true });
  return true;
}

export function getMessages(conversationId: string, limit?: number, offset?: number): ChatMessage[] {
  const result = getMessagesPaginated(conversationId, limit, offset);
  return result.messages;
}

/**
 * Paginated message retrieval.
 * - If only `limit` is provided (no offset), returns the LAST `limit` messages.
 * - If `offset` is provided, slices from that position.
 * - Always returns `totalCount` so clients know if more exist.
 */
export function getMessagesPaginated(
  conversationId: string,
  limit?: number,
  offset?: number,
): { messages: ChatMessage[]; totalCount: number } {
  let messagesPath = join(conversationsDir(), conversationId, 'messages.jsonl');
  if (!existsSync(messagesPath)) {
    const resolved = resolveConversationId(conversationId);
    if (!resolved) return { messages: [], totalCount: 0 };
    messagesPath = join(conversationsDir(), resolved, 'messages.jsonl');
    if (!existsSync(messagesPath)) return { messages: [], totalCount: 0 };
  }

  const content = readFileSync(messagesPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  const all = lines.map((line) => JSON.parse(line) as ChatMessage);
  const totalCount = all.length;

  if (limit && offset === undefined) {
    // No offset: return the LAST `limit` messages
    return { messages: all.slice(-limit), totalCount };
  }

  let messages = all;
  if (offset !== undefined) {
    messages = messages.slice(offset);
  }
  if (limit) {
    messages = messages.slice(0, limit);
  }

  return { messages, totalCount };
}

export function appendMessage(conversationId: string, message: ChatMessage): void {
  // Resolve case-insensitive ID (gateway lowercases session keys)
  const resolved = resolveConversationId(conversationId) || conversationId;
  const dir = join(conversationsDir(), resolved);
  mkdirSync(dir, { recursive: true });

  const messagesPath = join(dir, 'messages.jsonl');
  appendFileSync(messagesPath, JSON.stringify(message) + '\n', 'utf-8');

  // Update message count in meta
  const metaPath = join(dir, 'meta.md');
  if (existsSync(metaPath)) {
    const parsed = parseMarkdownFile(metaPath);
    const meta = parsed.data as unknown as ConversationMeta;
    meta.messageCount = (meta.messageCount || 0) + 1;
    meta.updatedAt = new Date().toISOString();
    writeMarkdownFile(metaPath, serializeConversationMeta(meta));
  }
}
