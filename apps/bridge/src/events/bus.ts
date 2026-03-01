import { EventEmitter } from 'events';

export interface BridgeEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface SequencedEvent extends BridgeEvent {
  seq: number;
}

const MAX_REPLAY_BUFFER = 200;

class EventBus extends EventEmitter {
  private seq = 0;
  private replayBuffer: SequencedEvent[] = [];

  broadcast(event: BridgeEvent): void {
    const seqEvent: SequencedEvent = { ...event, seq: ++this.seq };

    // Maintain bounded ring buffer for reconnect replay
    this.replayBuffer.push(seqEvent);
    if (this.replayBuffer.length > MAX_REPLAY_BUFFER) {
      this.replayBuffer.shift();
    }

    this.emit('bridge-event', seqEvent);
  }

  /** Replay events after the given sequence number (for SSE reconnect catchup). */
  replay(afterSeq: number): SequencedEvent[] {
    return this.replayBuffer.filter((e) => e.seq > afterSeq);
  }

  /** Current sequence number. */
  get currentSeq(): number {
    return this.seq;
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(100); // Support many concurrent SSE connections
