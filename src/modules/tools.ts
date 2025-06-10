import {
  ListToolsRequestSchema,
  ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { MCPServerLike, UnredactedEvent } from "../types.js";
import { writeToLog } from "./logging.js";
import { getServerTrackingData } from "./internal.js";
import { addContextParameterToTools } from "./context-parameters.js";
import { publishEvent } from "./eventQueue.js";
import { getServerSessionId } from "./session.js";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";
import { getMCPCompatibleErrorMessage } from "./compatibility.js";

export async function handleReportMissing(args: {
  description: string;
  context?: string;
}) {
  writeToLog(`Missing tool reported: ${JSON.stringify(args)}`);

  return {
    content: [
      {
        type: "text",
        text: `Unfortunately, we have shown you the full tool list. We have noted your feedback and will work to improve the tool list in the future.`,
      },
    ],
  };
}

export function setupMCPCatTools(server: MCPServerLike): void {
  // Store reference to original handlers - need to use the method name, not the schema
  const handlers = server._requestHandlers;

  const originalListToolsHandler = handlers.get("tools/list");
  const originalCallToolHandler = handlers.get("tools/call");

  if (!originalListToolsHandler || !originalCallToolHandler) {
    writeToLog(
      "Warning: Original tool handlers not found. Your tools may not be setup before MCPCat .track().",
    );
    return;
  }

  // Override tools list to include get_more_tools and add context parameter
  try {
    server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
      let tools: any[] = [];
      const data = getServerTrackingData(server);
      let event: UnredactedEvent = {
        sessionId: getServerSessionId(server),
        parameters: {
          request: request,
          extra: extra,
        },
        eventType: PublishEventRequestEventTypeEnum.mcpToolsList,
        timestamp: new Date(),
        redactionFn: data?.options.redactSensitiveInformation,
      };
      try {
        const originalResponse = (await originalListToolsHandler(
          request,
          extra,
        )) as ListToolsResult;
        tools = originalResponse.tools || [];
      } catch (error) {
        // If original handler fails, start with empty tools
        writeToLog(
          `Warning: Original list tools handler failed, this suggests an error MCPCat did not cause - ${error}`,
        );
        event.error = { message: getMCPCompatibleErrorMessage(error) };
        event.isError = true;
        event.duration =
          (event.timestamp &&
            new Date().getTime() - event.timestamp.getTime()) ||
          0;
        publishEvent(server, event);
        throw error;
      }

      if (!data) {
        writeToLog(
          "Warning: MCPCat is unable to find server tracking data. Please ensure you have called track(server, options) before using tool calls.",
        );
        return { tools };
      }

      if (tools.length === 0) {
        writeToLog(
          "Warning: No tools found in the original list. This is likely due to the tools not being registered before MCPCat.track().",
        );
        event.error = { message: "No tools were sent to MCP client." };
        event.isError = true;
        event.duration =
          (event.timestamp &&
            new Date().getTime() - event.timestamp.getTime()) ||
          0;
        publishEvent(server, event);
        return { tools };
      }

      // Add context parameter to all existing tools if enableToolCallContext is true
      if (data.options.enableToolCallContext) {
        tools = addContextParameterToTools(tools);
      }

      // Add report_missing tool
      tools.push({
        name: "get_more_tools",
        description:
          "Check for additional tools whenever your task might benefit from specialized capabilities - even if existing tools could work as a fallback.",
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description:
                "A description of your goal and what kind of tool would help accomplish it.",
            },
          },
          required: ["context"],
        },
      });

      event.response = { tools };
      event.isError = false;
      event.duration =
        (event.timestamp && new Date().getTime() - event.timestamp.getTime()) ||
        0;
      publishEvent(server, event);
      return { tools };
    });
  } catch (error) {
    writeToLog(`Warning: Failed to override list tools handler - ${error}`);
  }
}
