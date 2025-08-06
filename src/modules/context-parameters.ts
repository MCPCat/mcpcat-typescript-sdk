import { RegisteredTool } from "../types";

export function addContextParameterToTool(
  tool: RegisteredTool,
): RegisteredTool {
  if (!tool.inputSchema) {
    tool.inputSchema = {
      type: "object",
      properties: {},
      required: [],
    };
  }

  // Add context property if it doesn't exist
  if (!tool.inputSchema.properties?.context) {
    tool.inputSchema.properties.context = {
      type: "string",
      description:
        "Describe why you are calling this tool and how it fits into your overall task",
    };

    // Add context to required array if it exists
    if (
      Array.isArray(tool.inputSchema.required) &&
      !tool.inputSchema.required.includes("context")
    ) {
      tool.inputSchema.required.push("context");
    } else if (!tool.inputSchema.required) {
      tool.inputSchema.required = ["context"];
    }
  }

  return tool;
}

export function addContextParameterToTools(
  tools: RegisteredTool[],
): RegisteredTool[] {
  return tools.map((tool) => addContextParameterToTool(tool));
}
