import { RegisteredTool } from "../types";
import { z } from "zod";
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from "./constants";
import {
  isZodSchema,
  isShorthandZodSyntax,
  schemaHasProperty,
  extendObjectSchema,
} from "./zod-compat";

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

  // Check if context already exists in JSON Schema format
  if (modifiedTool.inputSchema.properties?.context) {
    // Context already exists, don't override it
    return modifiedTool;
  }

  const contextDescription =
    customContextDescription || DEFAULT_CONTEXT_PARAMETER_DESCRIPTION;

  // Handle Zod z.object() schemas (both v3 and v4)
  if (isZodSchema(modifiedTool.inputSchema)) {
    // Check if context already exists in Zod schema shape
    if (schemaHasProperty(modifiedTool.inputSchema, "context")) {
      return modifiedTool;
    }

    // Extend the schema with context using our compat layer
    const contextShape = {
      context: z.string().describe(contextDescription),
    };

    modifiedTool.inputSchema = extendObjectSchema(
      modifiedTool.inputSchema,
      contextShape,
    );

    return modifiedTool;
  }

  // Handle shorthand Zod syntax { a: z.number(), b: z.string() }
  if (isShorthandZodSyntax(modifiedTool.inputSchema)) {
    // Check if context already exists in shorthand syntax
    if ("context" in modifiedTool.inputSchema) {
      return modifiedTool;
    }

    // Extend using our compat layer (handles both v3 and v4)
    const contextShape = {
      context: z.string().describe(contextDescription),
    };

    modifiedTool.inputSchema = extendObjectSchema(
      modifiedTool.inputSchema,
      contextShape,
    );

    return modifiedTool;
  }

  // Handle regular JSON Schema format
  // Add context property if it doesn't exist
  if (!modifiedTool.inputSchema.properties?.context) {
    // Deep copy the inputSchema for JSON Schema to avoid mutations
    modifiedTool.inputSchema = JSON.parse(
      JSON.stringify(modifiedTool.inputSchema),
    );

    // Ensure properties object exists before trying to set context
    if (!modifiedTool.inputSchema.properties) {
      modifiedTool.inputSchema.properties = {};
    }

    modifiedTool.inputSchema.properties.context = {
      type: "string",
      description: contextDescription,
    };

    // Add context to required array if it exists
    if (
      Array.isArray(modifiedTool.inputSchema.required) &&
      !modifiedTool.inputSchema.required.includes("context")
    ) {
      modifiedTool.inputSchema.required.push("context");
    } else if (!modifiedTool.inputSchema.required) {
      modifiedTool.inputSchema.required = ["context"];
    }
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
