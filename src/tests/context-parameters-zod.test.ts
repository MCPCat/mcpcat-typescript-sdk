import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { addContextParameterToTool } from "../modules/context-parameters";
import { RegisteredTool } from "../types";

describe("Context Parameters with Zod Schemas", () => {
  it("should handle tools with JSON Schema format", () => {
    const tool: RegisteredTool = {
      description: "Test tool",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a", "b"],
      },
      callback: async () => ({ content: [] }),
    };

    const modifiedTool = addContextParameterToTool(tool);

    expect(modifiedTool.inputSchema).toBeDefined();
    expect(modifiedTool.inputSchema.properties).toBeDefined();
    expect(modifiedTool.inputSchema.properties.context).toBeDefined();
    expect(modifiedTool.inputSchema.properties.context.type).toBe("string");
    expect(modifiedTool.inputSchema.required).toContain("context");
  });

  it("should handle tools with no inputSchema", () => {
    const tool: RegisteredTool = {
      description: "Test tool",
      callback: async () => ({ content: [] }),
    };

    const modifiedTool = addContextParameterToTool(tool);

    expect(modifiedTool.inputSchema).toBeDefined();
    expect(modifiedTool.inputSchema.properties).toBeDefined();
    expect(modifiedTool.inputSchema.properties.context).toBeDefined();
  });

  it("should handle Zod schema objects without throwing errors", () => {
    // This is the exact pattern from the user's code
    const zodSchema = z.object({
      a: z.number(),
      b: z.number(),
    });

    const tool: RegisteredTool = {
      inputSchema: zodSchema,
      callback: async ({ a, b }) => ({
        content: [{ type: "text", text: String(a + b) }],
      }),
    };

    // The implementation should handle Zod schemas gracefully
    // It should NOT throw an error
    expect(() => {
      const modifiedTool = addContextParameterToTool(tool);

      // The tool should still be valid
      expect(modifiedTool).toBeDefined();
      expect(modifiedTool.inputSchema).toBeDefined();
      expect(modifiedTool.callback).toBeDefined();

      // The Zod schema should ideally be extended with context
      // or at least remain a valid Zod schema
      expect(modifiedTool.inputSchema).toBeTruthy();
    }).not.toThrow();
  });

  it("should demonstrate what the current implementation tries to do with Zod schemas", () => {
    const zodSchema = z.object({
      a: z.number(),
      b: z.number(),
    });

    // Log the structure to understand it better
    console.log("Zod schema structure:");
    console.log("  - Has properties field?", "properties" in zodSchema);
    console.log("  - Has _def field?", "_def" in zodSchema);
    console.log("  - Type of schema:", typeof zodSchema);
    console.log("  - Constructor name:", zodSchema.constructor.name);

    // This simulates what the current addContextParameterToTool tries to do
    const simulateCurrentImplementation = () => {
      const inputSchema = zodSchema as any;

      // Current implementation checks: if (!tool.inputSchema.properties?.context)
      // For Zod schemas, properties is undefined
      if (!inputSchema.properties) {
        // This line tries to access undefined
        console.log("properties is undefined, trying to set it...");
      }

      // Then it tries to set: inputSchema.properties.context = { ... }
      // But since properties is undefined, this causes the error
      if (!inputSchema.properties?.context) {
        // This will throw: Cannot set properties of undefined
        inputSchema.properties.context = {
          type: "string",
          description:
            "Describe why you are calling this tool and how it fits into your overall task",
        };
      }
    };

    // This should throw the exact error we're seeing
    expect(() => simulateCurrentImplementation()).toThrow(
      /Cannot set propert(y|ies) of undefined/,
    );
  });

  it("should handle the exact tool pattern from user's code", () => {
    // This matches the user's exact usage pattern:
    // server.tool("add", { a: z.number(), b: z.number() }, handler)
    // When stored in _registeredTools, the inputSchema is the raw object passed
    const tool: RegisteredTool = {
      inputSchema: {
        a: z.number(),
        b: z.number(),
      },
      callback: async ({ a, b }) => ({
        content: [{ type: "text", text: String(a + b) }],
      }),
    };

    // The implementation should handle this pattern without errors
    expect(() => {
      const modifiedTool = addContextParameterToTool(tool);
      expect(modifiedTool).toBeDefined();
      expect(modifiedTool.inputSchema).toBeDefined();
    }).not.toThrow();
  });

  it("should handle z.object() wrapped schemas with enum fields", () => {
    // Another common pattern
    const tool: RegisteredTool = {
      inputSchema: z.object({
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
        a: z.number(),
        b: z.number(),
      }),
      callback: async () => ({ content: [] }),
    };

    // This should NOT throw - the implementation should handle it gracefully
    expect(() => {
      const modifiedTool = addContextParameterToTool(tool);
      expect(modifiedTool).toBeDefined();
      expect(modifiedTool.inputSchema).toBeDefined();
    }).not.toThrow();
  });
});
