/**
 * MessageStream — push-based async iterable for multi-turn SDK conversations.
 *
 * Modelled after the NanoClaw MessageStream class. The key behaviour is that
 * the async iterator stays alive (does not return) until end() is called.
 * This ensures the SDK treats the conversation as multi-turn rather than
 * single-user-turn, which allows tool use loops and subagent execution to
 * complete normally.
 *
 * Usage:
 *   const stream = new MessageStream();
 *   stream.push("Hello");
 *   // ... later, from another async context ...
 *   stream.push("Follow up");
 *   stream.end();
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export interface MessageAttachment {
  /** Base64-encoded file content. */
  data: string;
  /** MIME type (e.g. 'image/png'). */
  mediaType: string;
}

/**
 * Push-based async iterable that yields SDKUserMessage objects.
 *
 * The iterator blocks (via Promise) when the queue is empty and the stream
 * has not been ended. This keeps the SDK conversation loop alive.
 */
export class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  /**
   * Enqueue a plain-text user message.
   * If attachments are provided they are included as image content blocks.
   */
  push(text: string, attachments?: MessageAttachment[]): void {
    const content = this.buildContent(text, attachments);

    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: '',
    };

    this.queue.push(msg);
    this.waiting?.();
  }

  /** Signal that no more messages will be pushed. */
  end(): void {
    this.done = true;
    this.waiting?.();
  }

  /** Whether end() has been called. */
  get ended(): boolean {
    return this.done;
  }

  // -----------------------------------------------------------------------
  // AsyncIterable protocol
  // -----------------------------------------------------------------------

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      // Drain everything currently in the queue
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      // If the stream has been ended, stop the generator
      if (this.done) return;
      // Otherwise, block until push() or end() is called
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
      this.waiting = null;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildContent(
    text: string,
    attachments?: MessageAttachment[],
  ): string | Array<{ type: string; [key: string]: unknown }> {
    if (!attachments || attachments.length === 0) {
      return text;
    }

    // Build multi-part content with images followed by text
    const parts: Array<{ type: string; [key: string]: unknown }> = [];
    for (const att of attachments) {
      parts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mediaType,
          data: att.data,
        },
      });
    }
    parts.push({ type: 'text', text });
    return parts;
  }
}
