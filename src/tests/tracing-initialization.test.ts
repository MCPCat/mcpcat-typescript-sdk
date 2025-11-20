import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setupTestServerAndClient,
  resetTodos,
} from "./test-utils/client-server-factory.js";
import { track } from "../index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { EventCapture } from "./test-utils.js";

describe("Tracing Initialization Tests", () => {
  let eventCapture: EventCapture;

  beforeEach(async () => {
    resetTodos();
    eventCapture = new EventCapture();
    await eventCapture.start();
  });

  afterEach(async () => {
    await eventCapture.stop();
  });

  it("should not create duplicate events when track() is called multiple times", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Call track() multiple times on the same server instance
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // First add a todo so we can complete it
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test todo for double-wrapping",
              context: "Setup for double-wrapping test",
            },
          },
        },
        CallToolResultSchema,
      );

      // Wait for event to be published
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Clear events from setup
      eventCapture.clear();

      // Execute the actual test tool call
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "complete_todo",
            arguments: {
              id: "1",
              context: "Testing double-wrapping protection",
            },
          },
        },
        CallToolResultSchema,
      );

      // Wait for any events to be published
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the tool call succeeded (successful calls have undefined isError)
      expect(result).toBeDefined();
      expect(result.isError).not.toBe(true);

      // Get all events published
      const events = eventCapture.getEvents();

      // Should have exactly 1 event, not 3 (one per track() call)
      expect(events.length).toBe(1);
      expect(events[0].resourceName).toBe("complete_todo");
      expect(events[0].isError).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("should publish events for successful tool calls with handler-level architecture", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Initialize tracing with track()
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Execute a successful tool call
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test successful handler wrapping",
              context: "Testing handler-level event publishing",
            },
          },
        },
        CallToolResultSchema,
      );

      // Wait for event to be published
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify tool call succeeded (successful calls have undefined isError)
      expect(result).toBeDefined();
      expect(result.isError).not.toBe(true);

      // Get events
      const events = eventCapture.getEvents();

      // Should have exactly 1 event for the successful call
      expect(events.length).toBe(1);
      expect(events[0].resourceName).toBe("add_todo");
      expect(events[0].isError).toBeUndefined();
      expect(events[0].userIntent).toBe(
        "Testing handler-level event publishing",
      );

      // Verify event has the expected structure
      expect(events[0]).toHaveProperty("eventType");
      expect(events[0]).toHaveProperty("timestamp");
    } finally {
      await cleanup();
    }
  });
});
