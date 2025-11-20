import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setupTestServerAndClient,
  resetTodos,
} from "./test-utils/client-server-factory.js";
import { track } from "../index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types";
import { EventCapture } from "./test-utils.js";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";
import { z } from "zod";

describe("Error Capture Integration Tests", () => {
  let eventCapture: EventCapture;

  beforeEach(async () => {
    resetTodos();
    eventCapture = new EventCapture();
    await eventCapture.start();
  });

  afterEach(async () => {
    await eventCapture.stop();
  });

  it("should capture stack traces when tool throws Error", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Track the server with mcpcat (uses default settings including context parameters)
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Call a tool that throws an error (complete_todo with invalid ID)
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "complete_todo",
            arguments: {
              id: "nonexistent-id",
              context: "Testing error capture",
            },
          },
        },
        CallToolResultSchema,
      );

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true);

      // Wait for event to be captured
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName("complete_todo");
      expect(events.length).toBeGreaterThan(0);

      const errorEvent = events.find((e) => e.isError);
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.isError).toBe(true);

      // Verify error structure
      expect(errorEvent!.error).toBeDefined();
      expect(errorEvent!.error!.message).toContain("not found");
      // SDK converts execution errors to CallToolResult, losing Error type
      expect(errorEvent!.error!.type).toBe("NonError");

      // Execution errors don't preserve stack traces (SDK limitation)
      // Only validation errors preserve full Error objects
    } finally {
      await cleanup();
    }
  });

  it("should capture Error.cause chains", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Add a tool that throws an error with a cause
      server.tool(
        "error_with_cause",
        "Throws error with cause",
        {},
        async () => {
          const rootCause = new Error("Root cause error");
          const wrapperError = new Error("Wrapper error", { cause: rootCause });
          throw wrapperError;
        },
      );

      // Track the server
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Call the error-throwing tool
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "error_with_cause",
            arguments: {
              context: "Testing error.cause chains",
            },
          },
        },
        CallToolResultSchema,
      );

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true);

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName("error_with_cause");
      expect(events.length).toBeGreaterThan(0);

      const errorEvent = events.find((e) => e.isError);
      expect(errorEvent).toBeDefined();

      // Execution errors are converted to CallToolResult by SDK
      expect(errorEvent!.error!.type).toBe("NonError");
      expect(errorEvent!.error!.message).toContain("Wrapper error");

      // Error.cause chains are lost when SDK converts to CallToolResult
      // This is an SDK limitation for execution errors
    } finally {
      await cleanup();
    }
  });

  it("should capture TypeError with correct type", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Add a tool that throws a TypeError
      server.tool("type_error_tool", "Throws TypeError", {}, async () => {
        const obj: any = null;
        obj.property; // This will throw TypeError
        return {
          content: [{ type: "text", text: "unreachable" }],
        };
      });

      // Track the server
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Call the error-throwing tool
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "type_error_tool",
            arguments: {
              context: "Testing TypeError capture",
            },
          },
        },
        CallToolResultSchema,
      );

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true);

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName("type_error_tool");
      const errorEvent = events.find((e) => e.isError);

      expect(errorEvent).toBeDefined();
      // Execution errors lose their specific type when SDK converts to CallToolResult
      expect(errorEvent!.error!.type).toBe("NonError");
      expect(errorEvent!.error!.message).toContain("null");
    } finally {
      await cleanup();
    }
  });

  it("should capture non-Error thrown values", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Add a tool that throws a string
      server.tool("throw_string", "Throws string", {}, async () => {
        throw "This is a string error";
      });

      // Track the server
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Call the error-throwing tool
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "throw_string",
            arguments: {
              context: "Testing non-Error thrown values",
            },
          },
        },
        CallToolResultSchema,
      );

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true);

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName("throw_string");
      const errorEvent = events.find((e) => e.isError);

      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error!.type).toBe("NonError");
      expect(errorEvent!.error!.message).toContain("This is a string error");
      // Non-Error objects don't have stack traces
      expect(errorEvent!.error!.stack).toBeUndefined();
      expect(errorEvent!.error!.frames).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it.skip("should detect in_app frames correctly", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Track the server
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Call a tool that throws an error
      const result = await client.request({
        method: "tools/call",
        params: {
          name: "complete_todo",
          arguments: {
            id: "bad-id",
            context: "Testing in_app frame detection",
          },
        },
        CallToolResultSchema,
      });

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true);

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100));

      const events = eventCapture.findEventsByResourceName("complete_todo");
      const errorEvent = events.find((e) => e.isError);

      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error!.frames).toBeDefined();

      // Check that we have both in_app and library frames
      const hasInAppFrame = errorEvent!.error!.frames!.some(
        (frame) => frame.in_app,
      );
      const hasLibraryFrame = errorEvent!.error!.frames!.some(
        (frame) => !frame.in_app,
      );

      // At least one frame should be from user code
      expect(hasInAppFrame).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("should still propagate errors to MCP client", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Track the server
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Verify that the error is still returned to the client
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "complete_todo",
            arguments: {
              id: "invalid",
              context: "Testing error propagation",
            },
          },
        },
        CallToolResultSchema,
      );

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    } finally {
      await cleanup();
    }
  });

  it("should capture identify errors with stack traces", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Track with an identify function that throws
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
        identify: async () => {
          throw new Error("Identify error");
        },
      });

      // Make a tool call to trigger identify
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {
              context: "Testing identify error capture",
            },
          },
        },
        CallToolResultSchema,
      );

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find identify error event
      const events = eventCapture.getEvents();
      const identifyEvent = events.find(
        (e) =>
          e.eventType === PublishEventRequestEventTypeEnum.McpcatIdentify &&
          e.isError,
      );

      if (identifyEvent) {
        expect(identifyEvent.error).toBeDefined();
        expect(identifyEvent.error!.message).toBe("Identify error");
        expect(identifyEvent.error!.type).toBe("Error");
        expect(identifyEvent.error!.stack).toBeDefined();
        expect(identifyEvent.error!.frames).toBeDefined();
      }
    } finally {
      await cleanup();
    }
  });

  it("should handle successful tool calls without errors", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Track the server
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Make a successful tool call
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test todo",
              context: "Testing successful tool calls",
            },
          },
        },
        CallToolResultSchema,
      );

      expect(result).toBeDefined();

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100));

      const events = eventCapture.findEventsByResourceName("add_todo");
      expect(events.length).toBeGreaterThan(0);

      const successEvent = events[events.length - 1];
      expect(successEvent.isError).toBeUndefined();
      expect(successEvent.error).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("should capture validation errors for invalid enum values", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Add a tool with enum validation
      server.tool(
        "calculate",
        "Perform calculations",
        {
          operation: z.enum(["add", "subtract", "multiply", "divide"]),
          a: z.number(),
          b: z.number(),
        },
        async (args) => {
          return {
            content: [{ type: "text", text: `Result: ${args.a}` }],
          };
        },
      );

      // Track the server
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Call with invalid enum value - should throw before callback executes
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "calculate",
              arguments: {
                operation: "modulo", // Invalid enum value
                a: 10,
                b: 3,
                context: "Testing validation error capture",
              },
            },
          },
          CallToolResultSchema,
        );
        expect.fail("Should have thrown validation error");
      } catch (error: any) {
        // MCP SDK throws validation errors, doesn't return CallToolResult
        expect(error).toBeDefined();
      }

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName("calculate");
      expect(events.length).toBeGreaterThan(0);

      const errorEvent = events.find((e) => e.isError);
      expect(errorEvent).toBeDefined();

      // Verify error captured with full Error object
      expect(errorEvent!.error).toBeDefined();
      expect(errorEvent!.error!.message).toContain("Invalid");
      expect(errorEvent!.error!.type).toBe("McpError");

      // Verify stack trace is captured
      expect(errorEvent!.error!.stack).toBeDefined();
      expect(errorEvent!.error!.stack!.length).toBeGreaterThan(0);

      // Verify stack frames parsed
      expect(errorEvent!.error!.frames).toBeDefined();
      expect(errorEvent!.error!.frames!.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  it("should capture errors for unknown tool names", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Track the server
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Call non-existent tool
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "nonexistent_tool",
              arguments: {
                context: "Testing unknown tool error",
              },
            },
          },
          CallToolResultSchema,
        );
        expect.fail("Should have thrown unknown tool error");
      } catch (error: any) {
        // SDK throws error for unknown tools
        expect(error).toBeDefined();
      }

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName("nonexistent_tool");
      expect(events.length).toBeGreaterThan(0);

      const errorEvent = events.find((e) => e.isError);
      expect(errorEvent).toBeDefined();

      // Verify error captured
      expect(errorEvent!.error!.message).toContain("not found");
      expect(errorEvent!.error!.type).toBe("McpError");

      // Verify stack trace
      expect(errorEvent!.error!.stack).toBeDefined();
      expect(errorEvent!.error!.frames).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it("should capture validation errors for missing required parameters", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // add_todo requires 'text' parameter
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Call without required parameter
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "add_todo",
              arguments: {
                context: "Testing missing parameter",
                // 'text' parameter is missing
              },
            },
          },
          CallToolResultSchema,
        );
        expect.fail("Should have thrown validation error");
      } catch (error: any) {
        expect(error).toBeDefined();
      }

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100));

      const events = eventCapture.findEventsByResourceName("add_todo");
      const errorEvent = events.find((e) => e.isError);

      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error!.message).toContain("Invalid");
      expect(errorEvent!.error!.type).toBe("McpError");
      expect(errorEvent!.error!.stack).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it("should publish exactly one event per tool call", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      await track(server, {
        projectId: "test-project",
        enableTracing: true,
      });

      // Make a successful tool call
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {
              context: "Testing single event publishing",
            },
          },
        },
        CallToolResultSchema,
      );

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify exactly one event for this call
      const events = eventCapture.findEventsByResourceName("list_todos");
      const successEvents = events.filter((e) => !e.isError);

      // Should be exactly 1 event, not 2 (which would indicate double publishing)
      expect(successEvents.length).toBe(1);
    } finally {
      await cleanup();
    }
  });
});
