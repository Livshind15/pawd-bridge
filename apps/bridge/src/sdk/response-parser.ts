import { generateId } from '../utils/id.js';

/**
 * Parse a response (from SDK content blocks or legacy gateway blocks)
 * into structured ChatMessage fields.
 *
 * Content may arrive as:
 * - A plain string (simple text response)
 * - An array of blocks:
 *     text, thinking, tool_use, tool_result, image
 * - A top-level `message` fallback string
 */

interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | unknown;
  is_error?: boolean;
  tool_use_id?: string;
  media_type?: string;
  data?: string;
  url?: string;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  service: string;
  icon: string;
  input?: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'completed' | 'error';
}

export interface ParsedReasoning {
  id: string;
  charCount: number;
  isExpanded: boolean;
  content: string;
  isThinking: boolean;
}

export interface ParsedMetadata {
  duration: string;
  tokens: number;
  cost: string;
}

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

export interface ParsedResponse {
  content: string;
  contentParts: ContentPart[];
  toolCalls?: ParsedToolCall[];
  reasoning?: ParsedReasoning;
  metadata?: ParsedMetadata;
}

/**
 * Derive a display-friendly service name from a tool name.
 */
function deriveService(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower === 'bash' || lower.includes('terminal') || lower.includes('exec')) return 'Terminal';
  if (lower === 'read' || lower === 'write' || lower === 'edit' || lower === 'glob') return 'Files';
  if (lower === 'grep' || lower.includes('search')) return 'Search';
  if (lower.includes('web') || lower.includes('fetch')) return 'Web';
  if (lower.includes('mcp_')) {
    // MCP tool: extract the server name from "mcp_server__tool_name"
    const parts = toolName.split('__');
    if (parts.length >= 2) return parts[0].replace('mcp_', '');
  }
  return toolName;
}

/**
 * Derive an icon key from a tool name.
 */
function deriveIcon(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower === 'bash' || lower.includes('terminal') || lower.includes('exec')) return 'terminal';
  if (lower === 'read' || lower === 'write' || lower === 'edit') return 'file';
  if (lower === 'glob' || lower === 'grep' || lower.includes('search')) return 'search';
  if (lower.includes('web') || lower.includes('fetch')) return 'globe';
  return 'sparkles';
}

function parseBlocks(blocks: ContentBlock[]): ParsedResponse {
  let textContent = '';
  const toolCalls: ParsedToolCall[] = [];
  let reasoning: ParsedReasoning | undefined;
  const contentParts: ContentPart[] = [];

  // Map tool_use block IDs to contentParts indices for tool_result merging
  const toolPartIndexByUseId = new Map<string, number>();

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        textContent += block.text ?? '';
        contentParts.push({ type: 'text', text: block.text ?? '' });
        break;

      case 'thinking':
        reasoning = {
          id: block.id || generateId('think'),
          charCount: (block.text ?? '').length,
          isExpanded: false,
          content: block.text ?? '',
          isThinking: false,
        };
        contentParts.push({ type: 'thinking', thinking: block.text ?? '' });
        break;

      case 'tool_use': {
        const toolId = block.id || generateId('tc');
        const toolName = block.name || 'unknown';
        toolCalls.push({
          id: toolId,
          name: toolName,
          service: deriveService(toolName),
          icon: deriveIcon(toolName),
          input: block.input,
          status: 'running', // Will be updated by tool_result
        });
        const partIndex = contentParts.length;
        contentParts.push({
          type: 'tool_call',
          name: toolName,
          toolCallId: toolId,
          arguments: block.input ? JSON.stringify(block.input) : undefined,
          status: 'running',
        });
        toolPartIndexByUseId.set(toolId, partIndex);
        break;
      }

      case 'tool_result': {
        const resultContent = typeof block.content === 'string'
          ? block.content
          : block.content != null
            ? JSON.stringify(block.content)
            : '';

        // Find the matching tool_use and update its result/status
        const matchingTool = toolCalls.find((tc) => tc.id === block.tool_use_id);
        if (matchingTool) {
          matchingTool.status = block.is_error ? 'error' : 'completed';
          matchingTool.result = resultContent;

          // Update the corresponding contentPart
          const partIdx = toolPartIndexByUseId.get(matchingTool.id);
          if (partIdx !== undefined && contentParts[partIdx]) {
            contentParts[partIdx] = {
              ...contentParts[partIdx],
              status: block.is_error ? 'error' : 'success',
              result: resultContent,
              resultError: block.is_error || undefined,
            };
          }
        } else {
          // Orphan tool_result — create a standalone entry
          const orphanId = block.tool_use_id || generateId('tc');
          const orphanName = block.name || 'unknown';
          toolCalls.push({
            id: orphanId,
            name: orphanName,
            service: deriveService(orphanName),
            icon: deriveIcon(orphanName),
            result: block.content,
            status: block.is_error ? 'error' : 'completed',
          });
          contentParts.push({
            type: 'tool_call',
            name: orphanName,
            toolCallId: orphanId,
            status: block.is_error ? 'error' : 'success',
            result: resultContent,
            resultError: block.is_error || undefined,
          });
        }
        break;
      }

      case 'image': {
        const imageUrl = block.url || (block.data ? `data:${block.media_type || 'image/png'};base64,${block.data}` : undefined);
        contentParts.push({
          type: 'image',
          image_url: { url: imageUrl },
        });
        break;
      }
    }
  }

  // Mark any tool calls that never got a result as completed
  for (const tc of toolCalls) {
    if (tc.status === 'running' && tc.result === undefined) {
      tc.status = 'completed';
    }
  }
  // Also update the contentParts for tool_calls that had no matching tool_result
  for (const [useId, partIdx] of toolPartIndexByUseId.entries()) {
    const part = contentParts[partIdx];
    if (part && part.status === 'running') {
      const matchingTc = toolCalls.find((tc) => tc.id === useId);
      if (matchingTc && matchingTc.status === 'completed') {
        contentParts[partIdx] = { ...part, status: 'success' };
      }
    }
  }

  return {
    content: textContent,
    contentParts,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    reasoning,
  };
}

export function parseResponse(result: Record<string, unknown>): ParsedResponse {
  // Case 1: content is an array of blocks
  if (Array.isArray(result.content)) {
    const parsed = parseBlocks(result.content as ContentBlock[]);

    // Also check for top-level metadata
    if (result.metadata && typeof result.metadata === 'object') {
      const meta = result.metadata as Record<string, unknown>;
      parsed.metadata = {
        duration: String(meta.duration ?? ''),
        tokens: Number(meta.tokens ?? 0),
        cost: String(meta.cost ?? ''),
      };
    }

    return parsed;
  }

  // Case 2: top-level blocks array (some response formats)
  if (Array.isArray(result.blocks)) {
    const parsed = parseBlocks(result.blocks as ContentBlock[]);

    if (result.metadata && typeof result.metadata === 'object') {
      const meta = result.metadata as Record<string, unknown>;
      parsed.metadata = {
        duration: String(meta.duration ?? ''),
        tokens: Number(meta.tokens ?? 0),
        cost: String(meta.cost ?? ''),
      };
    }

    return parsed;
  }

  // Case 3: content is a plain string
  if (typeof result.content === 'string') {
    const contentParts: ContentPart[] = [{ type: 'text', text: result.content }];
    const parsed: ParsedResponse = { content: result.content, contentParts };

    // Check for separately provided toolCalls
    if (Array.isArray(result.toolCalls)) {
      parsed.toolCalls = (result.toolCalls as ParsedToolCall[]).map((tc) => ({
        ...tc,
        service: tc.service || deriveService(tc.name),
        icon: tc.icon || deriveIcon(tc.name),
      }));
      // Also add tool calls to contentParts
      for (const tc of parsed.toolCalls) {
        contentParts.push({
          type: 'tool_call',
          name: tc.name,
          toolCallId: tc.id,
          arguments: tc.input ? JSON.stringify(tc.input) : undefined,
          status: tc.status === 'error' ? 'error' : tc.status === 'completed' ? 'success' : 'running',
          result: tc.result != null ? (typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)) : undefined,
        });
      }
    }

    if (result.metadata && typeof result.metadata === 'object') {
      const meta = result.metadata as Record<string, unknown>;
      parsed.metadata = {
        duration: String(meta.duration ?? ''),
        tokens: Number(meta.tokens ?? 0),
        cost: String(meta.cost ?? ''),
      };
    }

    return parsed;
  }

  // Case 4: message fallback
  if (typeof result.message === 'string') {
    return { content: result.message, contentParts: [{ type: 'text', text: result.message }] };
  }

  // Case 5: unknown shape — stringify whatever we have
  const fallbackContent = JSON.stringify(result);
  return { content: fallbackContent, contentParts: [{ type: 'text', text: fallbackContent }] };
}

/** @deprecated Use parseResponse instead. Kept for backward compatibility. */
export const parseGatewayResponse = parseResponse;
