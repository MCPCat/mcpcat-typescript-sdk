import { describe, it, expect } from "vitest";
import { addContextParameterToTool } from "../modules/context-parameters";
import { RegisteredTool } from "../types";

describe("Context Parameter Preservation", () => {
  it("should preserve existing context parameter with custom description", () => {
    const toolWithCustomContext: RegisteredTool = {
      description: "Test tool",
      inputSchema: {
        type: "object",
        properties: {
          context: {
            type: "string",
            description:
              "A custom context description that should be preserved",
          },
        },
        required: ["context"],
      },
      callback: async () => ({ content: [] }),
    };

    const result = addContextParameterToTool(toolWithCustomContext);

    // The custom context description should be preserved
    expect(result.inputSchema.properties.context.description).toBe(
      "A custom context description that should be preserved",
    );

    // It should NOT be replaced with the default description
    expect(result.inputSchema.properties.context.description).not.toBe(
      "Describe why you are calling this tool and how it fits into your overall task",
    );
  });

  it("should add context parameter when it doesn't exist", () => {
    const toolWithoutContext: RegisteredTool = {
      description: "Test tool",
      inputSchema: {
        type: "object",
        properties: {
          foo: { type: "string" },
        },
        required: ["foo"],
      },
      callback: async () => ({ content: [] }),
    };

    const result = addContextParameterToTool(toolWithoutContext);

    // Context should be added with default description
    expect(result.inputSchema.properties.context).toBeDefined();
    expect(result.inputSchema.properties.context.description).toBe(
      "Describe why you are calling this tool and how it fits into your overall task",
    );
  });
});
