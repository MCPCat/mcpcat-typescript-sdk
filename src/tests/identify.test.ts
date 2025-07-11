import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setupTestServerAndClient,
  resetTodos,
} from "./test-utils/client-server-factory";
import { track } from "../index";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types";
import { EventCapture } from "./test-utils";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";
import { getServerTrackingData } from "../modules/internal";
import { UserIdentity } from "../types";
import { randomUUID } from "node:crypto";

describe("Identify Feature", () => {
  let server: any;
  let client: any;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    resetTodos();
    const setup = await setupTestServerAndClient();
    server = setup.server;
    client = setup.client;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("Basic Identification Test", () => {
    it("should call identify function on first tool invocation and store user identity", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      let identifyCalled = false;
      const testUserId = `user-${randomUUID()}`;
      const testUserData = {
        name: `Test User ${randomUUID()}`,
        email: `test-${randomUUID()}@example.com`,
      };

      // Enable tracking with identify function
      track(server, "test-project", {
        enableTracing: true,
        identify: async (request, extra) => {
          identifyCalled = true;
          expect(request).toBeDefined();
          expect(extra).toBeDefined();
          return {
            userId: testUserId,
            userData: testUserData,
          };
        },
      });

      // Call a tool - this should trigger identify
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test todo for identification",
            },
          },
        },
        CallToolResultSchema,
      );

      expect(result.content[0].text).toContain("Added todo");
      expect(identifyCalled).toBe(true);

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify that an identify event was published
      const events = eventCapture.getEvents();
      const identifyEvent = events.find(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );

      expect(identifyEvent).toBeDefined();
      expect(identifyEvent?.resourceName).toBe("add_todo");

      // Verify user identity is stored in session
      const data = getServerTrackingData(server);
      const sessionId = data?.sessionId;
      expect(sessionId).toBeDefined();

      const storedIdentity = data?.identifiedSessions.get(sessionId!);
      expect(storedIdentity).toEqual({
        userId: testUserId,
        userData: testUserData,
      });

      await eventCapture.stop();
    });

    it("should not call identify function on subsequent tool calls in same session", async () => {
      let identifyCallCount = 0;
      const userId = `user-${randomUUID()}`;
      const userName = `Another User ${randomUUID()}`;

      // Enable tracking with identify function
      track(server, "test-project", {
        enableTracing: true,
        identify: async () => {
          identifyCallCount++;
          return {
            userId: userId,
            userData: { name: userName },
          };
        },
      });

      // First tool call - should trigger identify
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "First todo",
            },
          },
        },
        CallToolResultSchema,
      );

      expect(identifyCallCount).toBe(1);

      // Second tool call - should NOT trigger identify again
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {},
          },
        },
        CallToolResultSchema,
      );

      expect(identifyCallCount).toBe(1); // Still 1, not called again

      // Third tool call - should still not trigger identify
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "complete_todo",
            arguments: {
              id: "1",
            },
          },
        },
        CallToolResultSchema,
      );

      expect(identifyCallCount).toBe(1); // Still 1
    });
  });

  describe("User Data Persistence Across Tool Calls", () => {
    it("should maintain user identification across multiple tool calls", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const testUserId = `persistent-user-${randomUUID()}`;
      const testUserData = {
        name: `Persistent User ${randomUUID()}`,
        department: "Engineering",
        customField: `custom-value-${randomUUID()}`,
      };

      // Enable tracking with identify function
      track(server, "test-project", {
        enableTracing: true,
        identify: async () => ({
          userId: testUserId,
          userData: testUserData,
        }),
      });

      // Make multiple tool calls
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "Todo 1" },
          },
        },
        CallToolResultSchema,
      );

      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "Todo 2" },
          },
        },
        CallToolResultSchema,
      );

      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {},
          },
        },
        CallToolResultSchema,
      );

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get all tool call events
      const events = eventCapture.getEvents();
      const toolCallEvents = events.filter(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpToolsCall,
      );

      // Verify all events have the same session ID
      expect(toolCallEvents.length).toBe(3);
      const sessionIds = toolCallEvents.map((e) => e.sessionId);
      expect(new Set(sessionIds).size).toBe(1); // All should have same session ID

      // Verify user identity persists
      const data = getServerTrackingData(server);
      const sessionId = data?.sessionId;
      const storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity).toEqual({
        userId: testUserId,
        userData: testUserData,
      });

      await eventCapture.stop();
    });
  });

  describe("Null/Undefined Identity Handling", () => {
    it("should handle when identify function returns null", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      // Enable tracking with identify function that returns null
      track(server, "test-project", {
        enableTracing: true,
        identify: async () => null,
      });

      // Call a tool
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "Test todo" },
          },
        },
        CallToolResultSchema,
      );

      expect(result.content[0].text).toContain("Added todo");

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify no identify event was published (since it returned null)
      const events = eventCapture.getEvents();
      const identifyEvent = events.find(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );

      expect(identifyEvent).toBeUndefined();

      // Verify no user identity is stored
      const data = getServerTrackingData(server);
      const sessionId = data?.sessionId;
      const storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity).toBeUndefined();

      await eventCapture.stop();
    });

    it("should work without identify function (anonymous sessions)", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      // Enable tracking WITHOUT identify function
      track(server, "test-project", {
        enableTracing: true,
        // No identify function provided
      });

      // Call tools
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "Anonymous todo" },
          },
        },
        CallToolResultSchema,
      );

      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {},
          },
        },
        CallToolResultSchema,
      );

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify tool events were published with session IDs
      const events = eventCapture.getEvents();
      const toolCallEvents = events.filter(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpToolsCall,
      );

      expect(toolCallEvents.length).toBe(2);
      toolCallEvents.forEach((event) => {
        expect(event.sessionId).toBeDefined();
        expect(event.sessionId).not.toBe("");
      });

      // Verify no identify events were published
      const identifyEvent = events.find(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );
      expect(identifyEvent).toBeUndefined();

      await eventCapture.stop();
    });
  });

  describe("Identity Data in Session Info", () => {
    it("should populate actorGivenId, actorName, and actorData in session info", async () => {
      const testUserId = `session-user-${randomUUID()}`;
      const testUserData = {
        name: `Session Test User ${randomUUID()}`,
        role: "Developer",
        team: "Platform",
      };

      // Enable tracking with identify function
      track(server, "test-project", {
        enableTracing: true,
        identify: async () => ({
          userId: testUserId,
          userData: testUserData,
        }),
      });

      // Call a tool to trigger identification
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "Test session info" },
          },
        },
        CallToolResultSchema,
      );

      // Get session info from server data
      const data = getServerTrackingData(server);
      const sessionInfo = data?.sessionInfo;

      expect(sessionInfo).toBeDefined();
      expect(sessionInfo?.identifyActorGivenId).toBe(testUserId);
      expect(sessionInfo?.identifyActorName).toBe(testUserData.name);
      expect(sessionInfo?.identifyActorData).toEqual(testUserData);
    });

    it("should include identity data in tracked events", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const testUserId = `event-user-${randomUUID()}`;
      const testUserData = {
        name: `Event Test User ${randomUUID()}`,
        subscription: "premium",
      };

      // Enable tracking with identify function
      track(server, "test-project", {
        enableTracing: true,
        identify: async () => ({
          userId: testUserId,
          userData: testUserData,
        }),
      });

      // Call a tool
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "Test event data" },
          },
        },
        CallToolResultSchema,
      );

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check that events include session info with actor data
      const events = eventCapture.getEvents();
      const toolCallEvent = events.find(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpToolsCall,
      );

      expect(toolCallEvent).toBeDefined();
      // The event should have access to session info through the server's session data

      const data = getServerTrackingData(server);
      expect(data?.sessionInfo.identifyActorGivenId).toBe(testUserId);
      expect(data?.sessionInfo.identifyActorName).toBe(testUserData.name);
      expect(data?.sessionInfo.identifyActorData).toEqual(testUserData);

      await eventCapture.stop();
    });
  });

  describe("Async Identity Resolution", () => {
    it("should handle async operations in identify function", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      let asyncOperationCompleted = false;

      // Enable tracking with async identify function
      track(server, "test-project", {
        enableTracing: true,
        identify: async (request, extra) => {
          // Simulate async operation (e.g., database lookup, API call)
          await new Promise((resolve) => setTimeout(resolve, 100));
          asyncOperationCompleted = true;

          return {
            userId: `async-user-${randomUUID()}`,
            userData: {
              name: `Async User ${randomUUID()}`,
              source: "async-lookup",
            },
          };
        },
      });

      // Call a tool
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "Async test todo" },
          },
        },
        CallToolResultSchema,
      );

      expect(result.content[0].text).toContain("Added todo");
      expect(asyncOperationCompleted).toBe(true);

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify identify event was published with duration
      const events = eventCapture.getEvents();
      const identifyEvent = events.find(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );

      expect(identifyEvent).toBeDefined();
      expect(identifyEvent?.duration).toBeGreaterThan(0); // Should have measurable duration

      await eventCapture.stop();
    });

    it("should handle errors in identify function gracefully", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const errorMessage = "Failed to identify user";

      // Enable tracking with identify function that throws
      track(server, "test-project", {
        enableTracing: true,
        identify: async () => {
          throw new Error(errorMessage);
        },
      });

      // Call a tool - should not fail despite identify error
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "Error test todo" },
          },
        },
        CallToolResultSchema,
      );

      expect(result.content[0].text).toContain("Added todo");

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify identify event was published with error
      const events = eventCapture.getEvents();
      const identifyEvent = events.find(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );

      expect(identifyEvent).toBeDefined();
      expect(identifyEvent?.isError).toBe(true);
      expect(identifyEvent?.error?.message).toContain(errorMessage);
      expect(identifyEvent?.duration).toBeDefined();

      // Verify no user identity was stored
      const data = getServerTrackingData(server);
      const sessionId = data?.sessionId;
      const storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity).toBeUndefined();

      await eventCapture.stop();
    });

    it("should handle identify function that returns invalid data", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      // Enable tracking with identify function that returns invalid structure
      track(server, "test-project", {
        enableTracing: true,
        identify: async () => {
          // Return invalid structure (missing required fields)
          return { invalidField: "invalid" } as any as UserIdentity;
        },
      });

      // Call a tool
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "Invalid identity test" },
          },
        },
        CallToolResultSchema,
      );

      expect(result.content[0].text).toContain("Added todo");

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The system should handle this gracefully
      const data = getServerTrackingData(server);
      const sessionId = data?.sessionId;
      const storedIdentity = data?.identifiedSessions.get(sessionId!);

      // It will store whatever was returned, even if invalid
      expect(storedIdentity).toBeDefined();
      expect((storedIdentity as any).invalidField).toBe("invalid");

      await eventCapture.stop();
    });
  });
});
