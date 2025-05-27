export function addContextParameterToTools(tools: any[]): any[] {
  return tools.map((tool) => {
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
  });
}
