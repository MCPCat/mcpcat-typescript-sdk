import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setupTestServerAndClient,
  resetTodos,
} from "./test-utils/client-server-factory";
import { addContextParameterToTools } from "../modules/context-parameters";
import { track } from "../index";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types";
import { EventCapture } from "./test-utils";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";

describe("Context Parameters", () => {
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

  describe("addContextParameterToTools", () => {
    it("should add context parameter to tools without inputSchema", () => {
      const tools = [
        {
          name: "simple_tool",
          description: "A simple tool",
        },
      ];

      const modifiedTools = addContextParameterToTools(tools);

      expect(modifiedTools[0].inputSchema).toBeDefined();
      expect(modifiedTools[0].inputSchema.type).toBe("object");
      expect(modifiedTools[0].inputSchema.properties.context).toBeDefined();
      expect(modifiedTools[0].inputSchema.properties.context.type).toBe(
        "string",
      );
      expect(modifiedTools[0].inputSchema.required).toContain("context");
    });

    it("should add context parameter to tools with existing inputSchema", () => {
      const tools = [
        {
          name: "existing_tool",
          description: "A tool with existing schema",
          inputSchema: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "Some text",
              },
            },
            required: ["text"],
          },
        },
      ];

      const modifiedTools = addContextParameterToTools(tools);

      expect(modifiedTools[0].inputSchema.properties.text).toBeDefined();
      expect(modifiedTools[0].inputSchema.properties.context).toBeDefined();
      expect(modifiedTools[0].inputSchema.properties.context.type).toBe(
        "string",
      );
      expect(modifiedTools[0].inputSchema.required).toContain("text");
      expect(modifiedTools[0].inputSchema.required).toContain("context");
    });

    it("should not duplicate context parameter if already exists", () => {
      const tools = [
        {
          name: "tool_with_context",
          description: "A tool that already has context",
          inputSchema: {
            type: "object",
            properties: {
              context: {
                type: "string",
                description: "Existing context",
              },
            },
            required: ["context"],
          },
        },
      ];

      const modifiedTools = addContextParameterToTools(tools);

      expect(modifiedTools[0].inputSchema.properties.context.description).toBe(
        "Existing context",
      );
      expect(
        modifiedTools[0].inputSchema.required.filter(
          (r: string) => r === "context",
        ),
      ).toHaveLength(1);
    });

    it("should handle tools with empty required array", () => {
      const tools = [
        {
          name: "optional_tool",
          description: "A tool with no required fields",
          inputSchema: {
            type: "object",
            properties: {
              optional: {
                type: "string",
              },
            },
            required: [],
          },
        },
      ];

      const modifiedTools = addContextParameterToTools(tools);

      expect(modifiedTools[0].inputSchema.required).toContain("context");
      expect(modifiedTools[0].inputSchema.required).toHaveLength(1);
    });
  });

  describe("Integration with MCP server tracking", () => {
    it("should capture context parameter when tools are called after tracking", async () => {
      // Set up event capture
      const eventCapture = new EventCapture();
      await eventCapture.start();

      // Enable tracking on the server
      track(server, "test-project", {
        enableReportMissing: true,
        enableTracing: true,
        enableToolCallContext: true,
      });

      // Call a tool with context
      const contextString = "Testing context parameter injection for analytics";
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test todo item",
              context: contextString,
            },
          },
        },
        CallToolResultSchema,
      );

      expect(result.content[0].text).toContain("Added todo");

      // Wait a bit for the event to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify that an event was published with the context as userIntent
      const events = eventCapture.getEvents();
      const toolCallEvent = events.find(
        (e) =>
          e.eventType === PublishEventRequestEventTypeEnum.mcpToolsCall &&
          e.resourceName === "add_todo",
      );

      expect(toolCallEvent).toBeDefined();
      expect(toolCallEvent?.userIntent).toBe(contextString);

      await eventCapture.stop();
    });

    it("should work with tools that have context parameter", async () => {
      // Set up event capture
      const eventCapture = new EventCapture();
      await eventCapture.start();

      // Enable tracking
      track(server, "test-project", {
        enableToolCallContext: true,
      });

      // Call complete_todo with context
      // First add a todo
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Todo to complete",
              context: "Creating a todo to test completion",
            },
          },
        },
        CallToolResultSchema,
      );

      // Then complete it with context
      const completionContext = "Testing completion with context tracking";
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "complete_todo",
            arguments: {
              id: "1",
              context: completionContext,
            },
          },
        },
        CallToolResultSchema,
      );

      expect(result.content[0].text).toContain("Completed todo");

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify the complete_todo event has the context as userIntent
      const events = eventCapture.getEvents();
      const completeEvent = events.find(
        (e) =>
          e.eventType === PublishEventRequestEventTypeEnum.mcpToolsCall &&
          e.resourceName === "complete_todo",
      );

      expect(completeEvent).toBeDefined();
      expect(completeEvent?.userIntent).toBe(completionContext);

      await eventCapture.stop();
    });

    it("should handle tools without context parameter", async () => {
      // Set up event capture
      const eventCapture = new EventCapture();
      await eventCapture.start();

      // Enable tracking
      track(server, "test-project", {
        enableToolCallContext: true,
      });

      // Call list_todos without context
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_todos",
            arguments: {},
          },
        },
        CallToolResultSchema,
      );

      // Should work fine without context
      expect(result.content[0].text).toBeDefined();

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify the event was published but without userIntent
      const events = eventCapture.getEvents();
      const listEvent = events.find(
        (e) =>
          e.eventType === PublishEventRequestEventTypeEnum.mcpToolsCall &&
          e.resourceName === "list_todos",
      );

      expect(listEvent).toBeDefined();
      expect(listEvent?.userIntent).toBeUndefined();

      await eventCapture.stop();
    });

    it("should inject context into tool schemas when listing tools", async () => {
      // Enable tracking
      track(server, "test-project", {
        enableToolCallContext: true,
      });

      // Get the tools list
      const toolsResponse = await client.request(
        {
          method: "tools/list",
          params: {},
        },
        ListToolsResultSchema,
      );

      // Apply context parameter injection to simulate what the client would see
      const modifiedTools = addContextParameterToTools(toolsResponse.tools);

      // The tracking might add additional tools like report_missing_tool
      // We should check for at least 3 tools (the original ones)
      expect(modifiedTools.length).toBeGreaterThanOrEqual(3);

      // Find the original tools
      const originalTools = ["add_todo", "list_todos", "complete_todo"];
      const originalModifiedTools = modifiedTools.filter((tool: any) =>
        originalTools.includes(tool.name),
      );

      // Verify the original tools have context parameter in their schema
      expect(originalModifiedTools).toHaveLength(3);
      originalModifiedTools.forEach((tool: any) => {
        expect(tool.inputSchema.properties.context).toBeDefined();
        expect(tool.inputSchema.properties.context.type).toBe("string");
        expect(tool.inputSchema.properties.context.description).toBe(
          "Describe why you are calling this tool and how it fits into your overall task",
        );
      });
    });
  });
});
