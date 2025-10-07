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
import { HighLevelMCPServerLike, UserIdentity } from "../types";
import { randomUUID } from "node:crypto";
import { z } from "zod";

describe("Identify Feature", () => {
  let server: HighLevelMCPServerLike;
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
              context: "Adding a todo item for identification test",
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
      const data = getServerTrackingData(server.server);
      const sessionId = data?.sessionId;
      expect(sessionId).toBeDefined();

      const storedIdentity = data?.identifiedSessions.get(sessionId!);
      expect(storedIdentity).toEqual({
        userId: testUserId,
        userData: testUserData,
      });

      await eventCapture.stop();
    });

    it("should call identify function on each tool call but only publish event when identity changes", async () => {
      let identifyCallCount = 0;
      const userId = `user-${randomUUID()}`;
      const userName = `Another User ${randomUUID()}`;

      const eventCapture = new EventCapture();
      await eventCapture.start();

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

      // First tool call - should trigger identify and publish event
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "First todo",
              context: "Adding a todo item for identification test",
            },
          },
        },
        CallToolResultSchema,
      );

      expect(identifyCallCount).toBe(1);
      const events1 = await eventCapture.getEvents();
      const identifyEvents1 = events1.filter(
        (e) => e.eventType === "mcpcat:identify",
      );
      expect(identifyEvents1.length).toBe(1); // First identify event published

      // Second tool call - should call identify but NOT publish event (identity unchanged)
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {
              context: "Adding a todo item for identification test",
            },
          },
        },
        CallToolResultSchema,
      );

      expect(identifyCallCount).toBe(2); // Called again
      const events2 = await eventCapture.getEvents();
      const identifyEvents2 = events2.filter(
        (e) => e.eventType === "mcpcat:identify",
      );
      expect(identifyEvents2.length).toBe(1); // Still only 1 event (no new event published)

      // Third tool call - should call identify but still NOT publish event
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "complete_todo",
            arguments: {
              id: "1",
              context: "Completing a todo item for identification test",
            },
          },
        },
        CallToolResultSchema,
      );

      expect(identifyCallCount).toBe(3); // Called again
      const events3 = await eventCapture.getEvents();
      const identifyEvents3 = events3.filter(
        (e) => e.eventType === "mcpcat:identify",
      );
      expect(identifyEvents3.length).toBe(1); // Still only 1 event

      await eventCapture.stop();
    });

    it("should properly identify when calling tools added after track()", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      let identifyCalled = false;
      const testUserId = `post-track-user-${randomUUID()}`;
      const testUserData = {
        name: `Post Track User ${randomUUID()}`,
        email: `post-track-${randomUUID()}@example.com`,
      };

      // Enable tracking with identify function FIRST
      track(server, "test-project", {
        enableTracing: true,
        enableToolCallContext: true,
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

      // Add a new tool AFTER track() has been called
      server.tool(
        "post_track_tool",
        "A tool added after tracking was enabled",
        {
          message: z.string().describe("A message to process"),
        },
        async (args) => {
          return {
            content: [
              {
                type: "text",
                text: `Processed message: ${args.message}`,
              },
            ],
          };
        },
      );

      // Call the newly added tool - this should trigger identify
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "post_track_tool",
            arguments: {
              message: "Testing post-track identification",
              context:
                "Verifying identification works for dynamically added tools",
            },
          },
        },
        CallToolResultSchema,
      );

      expect(result.content[0].text).toContain(
        "Processed message: Testing post-track identification",
      );
      expect(identifyCalled).toBe(true);

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify that an identify event was published
      const events = eventCapture.getEvents();
      const identifyEvent = events.find(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );

      expect(identifyEvent).toBeDefined();
      expect(identifyEvent?.resourceName).toBe("post_track_tool");

      // Verify tool call event was tracked with user intent
      const toolCallEvent = events.find(
        (e) =>
          e.eventType === PublishEventRequestEventTypeEnum.mcpToolsCall &&
          e.resourceName === "post_track_tool",
      );

      expect(toolCallEvent).toBeDefined();
      expect(toolCallEvent?.userIntent).toBe(
        "Verifying identification works for dynamically added tools",
      );

      // Verify user identity is stored in session
      const data = getServerTrackingData(server.server);
      const sessionId = data?.sessionId;
      expect(sessionId).toBeDefined();

      const storedIdentity = data?.identifiedSessions.get(sessionId!);
      expect(storedIdentity).toEqual({
        userId: testUserId,
        userData: testUserData,
      });

      await eventCapture.stop();
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
            arguments: {
              text: "Todo 1",
              context: "Adding a todo item for reset task",
            },
          },
        },
        CallToolResultSchema,
      );

      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Todo 2",
              context: "Adding a todo item for reset task",
            },
          },
        },
        CallToolResultSchema,
      );

      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: { context: "Listing todos for reset task" },
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
      const data = getServerTrackingData(server.server);
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
            arguments: {
              text: "Test todo",
              context: "Adding a todo item for null identity test",
            },
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
      const data = getServerTrackingData(server.server);
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
            arguments: {
              text: "Anonymous todo",
              context: "Adding a todo item for anonymous test",
            },
          },
        },
        CallToolResultSchema,
      );

      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: { context: "Listing todos for anonymous test" },
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
      const testUserName = `Session User ${randomUUID()}`;
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
          userName: testUserName,
          userData: testUserData,
        }),
      });

      // Call a tool to trigger identification
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test session info",
              context: "Adding a todo item for session info test",
            },
          },
        },
        CallToolResultSchema,
      );

      // Get session info from server data
      const data = getServerTrackingData(server.server);
      const sessionInfo = data?.sessionInfo;

      expect(sessionInfo).toBeDefined();
      expect(sessionInfo?.identifyActorGivenId).toBe(testUserId);
      expect(sessionInfo?.identifyActorName).toBe(testUserName);
      expect(sessionInfo?.identifyActorData).toEqual(testUserData);
    });

    it("should include identity data in tracked events", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const testUserId = `event-user-${randomUUID()}`;
      const testUserName = `Event User ${randomUUID()}`;
      const testUserData = {
        name: `Event Test User ${randomUUID()}`,
        subscription: "premium",
      };

      // Enable tracking with identify function
      track(server, "test-project", {
        enableTracing: true,
        identify: async () => ({
          userId: testUserId,
          userName: testUserName,
          userData: testUserData,
        }),
      });

      // Call a tool
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test event data",
              context: "Adding a todo item for event data test",
            },
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

      const data = getServerTrackingData(server.server);
      expect(data?.sessionInfo.identifyActorGivenId).toBe(testUserId);
      expect(data?.sessionInfo.identifyActorName).toBe(testUserName);
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
            arguments: {
              text: "Async test todo",
              context: "Adding a todo item for async test",
            },
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
            arguments: {
              text: "Error test todo",
              context: "Adding a todo item for error test",
            },
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
      const data = getServerTrackingData(server.server);
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
            arguments: {
              text: "Invalid identity test",
              context: "Adding a todo item for invalid identity test",
            },
          },
        },
        CallToolResultSchema,
      );

      expect(result.content[0].text).toContain("Added todo");

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The system should handle this gracefully
      const data = getServerTrackingData(server.server);
      const sessionId = data?.sessionId;
      const storedIdentity = data?.identifiedSessions.get(sessionId!);

      // It will store whatever was returned, even if invalid
      expect(storedIdentity).toBeDefined();
      expect((storedIdentity as any).invalidField).toBe("invalid");

      await eventCapture.stop();
    });
  });

  describe("Identity Merging Behavior", () => {
    it("should override userId/userName but merge userData fields", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      let callCount = 0;
      const firstUserId = `user-${randomUUID()}`;
      const secondUserId = `user-${randomUUID()}`;

      // Enable tracking with identify function that returns different data on each call
      track(server, "test-project", {
        enableTracing: true,
        identify: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              userId: firstUserId,
              userName: "Alice",
              userData: {
                role: "admin",
                department: "Engineering",
              },
            };
          } else {
            return {
              userId: secondUserId,
              userName: "Bob",
              userData: {
                department: "Sales", // This should overwrite
                location: "NYC", // This should be added
              },
            };
          }
        },
      });

      // First tool call - sets initial identity
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "First todo",
              context: "Testing identity merge",
            },
          },
        },
        CallToolResultSchema,
      );

      // Wait for first identify to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify first identity was stored
      const data = getServerTrackingData(server.server);
      const sessionId = data?.sessionId;
      let storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity).toEqual({
        userId: firstUserId,
        userName: "Alice",
        userData: {
          role: "admin",
          department: "Engineering",
        },
      });

      // Second tool call - should merge identities
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {
              context: "Testing identity merge again",
            },
          },
        },
        CallToolResultSchema,
      );

      // Wait for second identify to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify merged identity
      storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity).toEqual({
        userId: secondUserId, // Overwritten
        userName: "Bob", // Overwritten
        userData: {
          role: "admin", // Preserved from first call
          department: "Sales", // Overwritten from first call
          location: "NYC", // Added in second call
        },
      });

      // Verify two identify events were published (both represent changes)
      const events = eventCapture.getEvents();
      const identifyEvents = events.filter(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );

      expect(identifyEvents.length).toBe(2);

      await eventCapture.stop();
    });

    it("should merge complex nested userData fields correctly", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      let callCount = 0;
      const userId = `user-${randomUUID()}`;

      track(server, "test-project", {
        enableTracing: true,
        identify: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              userId: userId,
              userData: {
                name: "Alice",
                role: "admin",
                preferences: {
                  theme: "dark",
                  language: "en",
                },
                permissions: ["read", "write"],
              },
            };
          } else {
            return {
              userId: userId,
              userData: {
                role: "user", // Overwrite
                location: "NYC", // Add new field
                preferences: {
                  // This will replace the entire preferences object
                  theme: "light",
                  notifications: true,
                },
              },
            };
          }
        },
      });

      // First tool call
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test",
              context: "Testing complex merge",
            },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second tool call
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {
              context: "Testing complex merge again",
            },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify final merged identity
      const data = getServerTrackingData(server.server);
      const sessionId = data?.sessionId;
      const storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity).toEqual({
        userId: userId,
        userData: {
          name: "Alice", // Preserved
          role: "user", // Overwritten
          location: "NYC", // Added
          permissions: ["read", "write"], // Preserved
          preferences: {
            // Completely replaced (not deep merged)
            theme: "light",
            notifications: true,
          },
        },
      });

      await eventCapture.stop();
    });

    it("should overwrite userData field when same key provided in subsequent call", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      let callCount = 0;
      const userId = `user-${randomUUID()}`;

      track(server, "test-project", {
        enableTracing: true,
        identify: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              userId: userId,
              userData: {
                setting: "value1",
                counter: 1,
              },
            };
          } else {
            return {
              userId: userId,
              userData: {
                setting: "value2", // Overwrite
                counter: 2, // Overwrite
              },
            };
          }
        },
      });

      // First call
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test",
              context: "Testing overwrite",
            },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second call
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {
              context: "Testing overwrite again",
            },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      const data = getServerTrackingData(server.server);
      const sessionId = data?.sessionId;
      const storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity?.userData?.setting).toBe("value2");
      expect(storedIdentity?.userData?.counter).toBe(2);

      await eventCapture.stop();
    });

    it("should only publish identify events when identity actually changes", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      let callCount = 0;
      const userId = `user-${randomUUID()}`;

      track(server, "test-project", {
        enableTracing: true,
        identify: async () => {
          callCount++;
          if (callCount === 1) {
            // First call - new identity
            return {
              userId: userId,
              userData: { field1: "value1" },
            };
          } else if (callCount === 2) {
            // Second call - same identity (no change)
            return {
              userId: userId,
              userData: { field1: "value1" },
            };
          } else if (callCount === 3) {
            // Third call - change in userData
            return {
              userId: userId,
              userData: { field1: "value1", field2: "value2" },
            };
          } else {
            // Fourth call - same as third (no change)
            return {
              userId: userId,
              userData: { field1: "value1", field2: "value2" },
            };
          }
        },
      });

      // Call 1 - should publish (new identity)
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "1", context: "Test" },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      let events = eventCapture.getEvents();
      let identifyEvents = events.filter(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );
      expect(identifyEvents.length).toBe(1);

      // Call 2 - should NOT publish (same identity)
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: { context: "Test" },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      events = eventCapture.getEvents();
      identifyEvents = events.filter(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );
      expect(identifyEvents.length).toBe(1); // Still only 1

      // Call 3 - should publish (userData changed)
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "2", context: "Test" },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      events = eventCapture.getEvents();
      identifyEvents = events.filter(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );
      expect(identifyEvents.length).toBe(2); // Now 2

      // Call 4 - should NOT publish (same as call 3)
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: { context: "Test" },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      events = eventCapture.getEvents();
      identifyEvents = events.filter(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );
      expect(identifyEvents.length).toBe(2); // Still only 2

      await eventCapture.stop();
    });

    it("should preserve userData when subsequent identify call has no userData", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      let callCount = 0;
      const userId = `user-${randomUUID()}`;

      track(server, "test-project", {
        enableTracing: true,
        identify: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              userId: userId,
              userData: {
                importantField: "importantValue",
                metadata: { created: "2025-01-01" },
              },
            };
          } else {
            // Second call doesn't include userData
            return {
              userId: userId,
            };
          }
        },
      });

      // First call - sets userData
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test",
              context: "Testing userData preservation",
            },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify initial userData
      const data = getServerTrackingData(server.server);
      const sessionId = data?.sessionId;
      let storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity?.userData).toEqual({
        importantField: "importantValue",
        metadata: { created: "2025-01-01" },
      });

      // Second call - no userData in return value
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {
              context: "Testing userData preservation again",
            },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify userData is still preserved
      storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity?.userData).toEqual({
        importantField: "importantValue",
        metadata: { created: "2025-01-01" },
      });

      await eventCapture.stop();
    });

    it("should handle userName being added in subsequent identify call", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      let callCount = 0;
      const userId = `user-${randomUUID()}`;

      track(server, "test-project", {
        enableTracing: true,
        identify: async () => {
          callCount++;
          if (callCount === 1) {
            // First call - no userName
            return {
              userId: userId,
              userData: { role: "admin" },
            };
          } else {
            // Second call - adds userName
            return {
              userId: userId,
              userName: "Alice Smith",
              userData: { department: "Engineering" },
            };
          }
        },
      });

      // First call
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: { text: "Test", context: "Testing userName addition" },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      const data = getServerTrackingData(server.server);
      const sessionId = data?.sessionId;
      let storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity?.userName).toBeUndefined();

      // Second call
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: { context: "Testing userName addition again" },
          },
        },
        CallToolResultSchema,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      storedIdentity = data?.identifiedSessions.get(sessionId!);

      expect(storedIdentity).toEqual({
        userId: userId,
        userName: "Alice Smith",
        userData: {
          role: "admin", // Preserved
          department: "Engineering", // Added
        },
      });

      // Should publish 2 identify events (both represent changes)
      const events = eventCapture.getEvents();
      const identifyEvents = events.filter(
        (e) => e.eventType === PublishEventRequestEventTypeEnum.mcpcatIdentify,
      );
      expect(identifyEvents.length).toBe(2);

      await eventCapture.stop();
    });
  });
});
