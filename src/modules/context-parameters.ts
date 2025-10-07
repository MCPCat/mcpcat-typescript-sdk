import { RegisteredTool } from "../types";
import { z } from "zod";
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from "./constants";

// Detect if something is a Zod schema (has _def and parse methods)
function isZodSchema(schema: any): boolean {
  return (
    schema &&
    typeof schema === "object" &&
    "_def" in schema &&
    typeof schema.parse === "function"
  );
}

// Detect if it's shorthand Zod syntax (object with z.* values)
function isShorthandZodSyntax(schema: any): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }

  // Check if any value is a Zod schema
  return Object.values(schema).some((value) => isZodSchema(value));
}

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

  // Handle Zod z.object() schemas
  if (isZodSchema(modifiedTool.inputSchema)) {
    // Check if context already exists in Zod schema shape
    if (
      modifiedTool.inputSchema.shape &&
      "context" in modifiedTool.inputSchema.shape
    ) {
      return modifiedTool;
    }
    // It's a Zod schema, augment it with context
    const contextSchema = z.object({
      context: z
        .string()
        .describe(
          customContextDescription || DEFAULT_CONTEXT_PARAMETER_DESCRIPTION,
        ),
    });

    // Use extend to add context to the schema
    if (typeof modifiedTool.inputSchema.extend === "function") {
      modifiedTool.inputSchema = modifiedTool.inputSchema.extend(
        contextSchema.shape,
      );
    } else if (typeof modifiedTool.inputSchema.augment === "function") {
      modifiedTool.inputSchema =
        modifiedTool.inputSchema.augment(contextSchema);
    } else {
      // Fallback: merge with new z.object
      modifiedTool.inputSchema = contextSchema.merge(modifiedTool.inputSchema);
    }

    return modifiedTool;
  }

  // Handle shorthand Zod syntax { a: z.number(), b: z.string() }
  if (isShorthandZodSyntax(modifiedTool.inputSchema)) {
    // Check if context already exists in shorthand syntax
    if ("context" in modifiedTool.inputSchema) {
      return modifiedTool;
    }

    // Create a new Zod schema with context
    const contextField = z
      .string()
      .describe(
        customContextDescription || DEFAULT_CONTEXT_PARAMETER_DESCRIPTION,
      );

    // Create new z.object with context and all original fields
    modifiedTool.inputSchema = z.object({
      context: contextField,
      ...modifiedTool.inputSchema,
    });

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
      description:
        customContextDescription || DEFAULT_CONTEXT_PARAMETER_DESCRIPTION,
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
