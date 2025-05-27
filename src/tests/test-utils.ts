import { existsSync, unlinkSync } from "fs";
import { beforeEach, afterEach } from "vitest";
import { Event } from "../types.js";

export const LOG_FILE = "mcpcat.log";

export function cleanupLogFile() {
  if (existsSync(LOG_FILE)) {
    unlinkSync(LOG_FILE);
  }
}

export const setupTestHooks = () => {
  beforeEach(() => {
    cleanupLogFile();
  });

  afterEach(() => {
    cleanupLogFile();
  });
};

// Event capture helper for testing
export class EventCapture {
  private capturedEvents: Event[] = [];
  private originalEventQueueAdd?: (event: Event) => void;

  async start() {
    // Mock the eventQueue.add method to capture events
    const eventQueueModule = await import("../modules/eventQueue.js");
    this.originalEventQueueAdd = eventQueueModule.eventQueue.add;

    // Replace the add method with our capturing version
    eventQueueModule.eventQueue.add = (event: Event) => {
      this.capturedEvents.push(event);
      // Still call the original if it exists (for integration tests)
      this.originalEventQueueAdd?.call(eventQueueModule.eventQueue, event);
    };
  }

  async stop() {
    // Restore the original method
    if (this.originalEventQueueAdd) {
      const eventQueueModule = await import("../modules/eventQueue.js");
      eventQueueModule.eventQueue.add = this.originalEventQueueAdd;
    }
  }

  getEvents(): Event[] {
    return [...this.capturedEvents];
  }

  clear() {
    this.capturedEvents = [];
  }

  findEventByType(eventType: string): Event | undefined {
    return this.capturedEvents.find((e) => e.eventType === eventType);
  }

  findEventsByResourceName(resourceName: string): Event[] {
    return this.capturedEvents.filter((e) => e.resourceName === resourceName);
  }
}
