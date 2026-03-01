import { generateId } from '../../utils/id.js';

export interface ActivityFeedEvent {
  id: string;
  type: string;
  timestamp: string;
  source: string;
  title: string;
  description?: string;
  agentId?: string;
  hookId?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

const MAX_EVENTS = 500;

class ActivityFeedStore {
  private events: ActivityFeedEvent[] = [];
  private typeSet = new Set<string>();

  addEvent(partial: Omit<ActivityFeedEvent, 'id' | 'timestamp'>): ActivityFeedEvent {
    const event: ActivityFeedEvent = {
      id: generateId('evt'),
      timestamp: new Date().toISOString(),
      ...partial,
    };

    this.events.push(event);
    this.typeSet.add(event.type);

    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    return event;
  }

  getEvents(limit = 50, offset = 0, type?: string): ActivityFeedEvent[] {
    let filtered = type
      ? this.events.filter((e) => e.type === type || e.type.startsWith(`${type}.`))
      : this.events;

    // Return newest first
    filtered = [...filtered].reverse();
    return filtered.slice(offset, offset + limit);
  }

  getTotal(type?: string): number {
    if (type) return this.events.filter((e) => e.type === type || e.type.startsWith(`${type}.`)).length;
    return this.events.length;
  }

  getEventTypes(): string[] {
    return Array.from(this.typeSet).sort();
  }

  clear(): void {
    this.events = [];
    this.typeSet.clear();
  }
}

export const activityFeedStore = new ActivityFeedStore();
