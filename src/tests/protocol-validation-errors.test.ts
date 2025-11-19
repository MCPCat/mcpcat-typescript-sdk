import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setupTestServerAndClient,
  resetTodos,
} from "./test-utils/client-server-factory.js";
import { z } from "zod";
import { track } from "../index.js";
import { EventCapture } from "./test-utils.js";

describe("Protocol Validation Error Tests", () => {
  let eventCapture: EventCapture;

  beforeEach(async () => {
    resetTodos();
    eventCapture = new EventCapture();
    await eventCapture.start();
  });

  afterEach(async () => {
    await eventCapture.stop();
  });

  it("should capture invalid enum parameter errors", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Add a calculator tool with enum validation
      server.tool(
        "calculate",
        "Perform calculation",
        {
          operation: z.enum(["add", "subtract", "multiply", "divide"]),
          a: z.number(),
          b: z.number(),
        },
        async (args: {
          operation: "add" | "subtract" | "multiply" | "divide";
          a: number;
          b: number;
        }) => {
          const { operation, a, b } = args;
          let result: number;
          switch (operation) {
            case "add":
              result = a + b;
              break;
            case "subtract":
              result = a - b;
              break;
            case "multiply":
              result = a * b;
              break;
            case "divide":
              result = a / b;
              break;
          }
          return {
            content: [{ type: "text" as const, text: String(result) }],
          };
        },
      );

      // Track the server AFTER registering tools
      track(server, "test-project", { enableTracing: true });

      // Now try to call with invalid enum value
      try {
        await client.request({
          method: "tools/call",
          params: {
            name: "calculate",
            arguments: {
              operation: "invalid_operation", // This should fail validation
              a: 5,
              b: 3,
              context: "Testing invalid enum",
            },
          },
        });
        // If we get here, the validation didn't work as expected
        expect.fail("Should have thrown validation error");
      } catch (error: any) {
        // This error should be caught by MCPcat
        console.log("Caught validation error:", error.message);
        expect(error.message).toContain("Invalid");
      }

      // Wait for event to be captured
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check if MCPcat captured this error
      const events = eventCapture.findEventsByResourceName("calculate");
      console.log("Events captured for 'calculate':", events.length);

      if (events.length > 0) {
        console.log(
          "Event details:",
          JSON.stringify(
            events.map((e) => ({
              resourceName: e.resourceName,
              isError: e.isError,
              error: e.error,
            })),
            null,
            2,
          ),
        );
      }

      // This is what we're testing: Did MCPcat capture the validation error?
      const errorEvent = events.find((e) => e.isError);

      if (!errorEvent) {
        console.log("❌ MCPcat did NOT capture the protocol validation error");
        console.log("This confirms the bug that we need to fix");
        // For now, we expect this to fail - that's the bug we're investigating
        expect(errorEvent).toBeUndefined();
      } else {
        console.log("✅ MCPcat captured the validation error!");
        expect(errorEvent.error?.message).toBeDefined();
      }
    } finally {
      await cleanup();
    }
  });

  it("should capture invalid tool name errors", async () => {
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // Track the server
      track(server, "test-project", { enableTracing: true });

      // Try to call non-existent tool
      try {
        await client.request({
          method: "tools/call",
          params: {
            name: "nonexistent_tool",
            arguments: {
              context: "Testing invalid tool name",
            },
          },
        });
        expect.fail("Should have thrown tool not found error");
      } catch (error: any) {
        console.log("Caught tool not found error:", error.message);
        expect(error.message).toContain("Unknown tool");
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check if MCPcat captured this
      const events = eventCapture.findEventsByResourceName("nonexistent_tool");
      console.log("Events for nonexistent tool:", events.length);

      const errorEvent = events.find((e) => e.isError);
      if (!errorEvent) {
        console.log("❌ MCPcat did NOT capture the tool not found error");
        // This is expected - the bug we're investigating
        expect(errorEvent).toBeUndefined();
      } else {
        console.log("✅ MCPcat captured the tool not found error!");
        expect(errorEvent.error?.message).toBeDefined();
      }
    } finally {
      await cleanup();
    }
  });
});
