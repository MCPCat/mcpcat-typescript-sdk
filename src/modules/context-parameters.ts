import { RegisteredTool } from "../types";
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from "./constants";

/**
 * Adds a context parameter to a tool's JSON Schema.
 * This function is called AFTER the MCP SDK has converted Zod schemas to JSON Schema,
 * so we only need to handle JSON Schema format.
 */
export function addContextParameterToTool(
  tool: RegisteredTool,
  customContextDescription?: string,
): RegisteredTool {
  // Create a shallow copy of the tool to avoid modifying the original
  const modifiedTool = { ...tool };

  if (!modifiedTool.inputSchema) {
    modifiedTool.inputSchema = {
      type: "object",
      properties: {},
      required: [],
    };
  }

  // Check if context already exists
  if (modifiedTool.inputSchema.properties?.context) {
    return modifiedTool;
  }

  const contextDescription =
    customContextDescription || DEFAULT_CONTEXT_PARAMETER_DESCRIPTION;

  // Deep copy the inputSchema to avoid mutations
  modifiedTool.inputSchema = JSON.parse(
    JSON.stringify(modifiedTool.inputSchema),
  );

  // Ensure properties object exists
  if (!modifiedTool.inputSchema.properties) {
    modifiedTool.inputSchema.properties = {};
  }

  // Add context property
  modifiedTool.inputSchema.properties.context = {
    type: "string",
    description: contextDescription,
  };

  // Add context to required array
  if (Array.isArray(modifiedTool.inputSchema.required)) {
    if (!modifiedTool.inputSchema.required.includes("context")) {
      modifiedTool.inputSchema.required.push("context");
    }
  } else {
    modifiedTool.inputSchema.required = ["context"];
  }

  return modifiedTool;
}

export function addContextParameterToTools(
  tools: RegisteredTool[],
  customContextDescription?: string,
): RegisteredTool[] {
  return tools.map((tool) => {
    // Skip get_more_tools - it has its own special context parameter
    if ((tool as any).name === "get_more_tools") {
      return tool;
    }
    return addContextParameterToTool(tool, customContextDescription);
  });
}
