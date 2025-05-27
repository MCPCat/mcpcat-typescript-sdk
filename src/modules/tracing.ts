import {
  CallToolRequestSchema,
  InitializeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MCPServerLike, UnredactedEvent } from "../types.js";
import { writeToLog } from "./logging.js";
import { handleReportMissing } from "./tools.js";
import { getServerTrackingData } from "./internal.js";
import { getServerSessionId } from "./session.js";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";
import { publishEvent } from "./eventQueue.js";
import { getMCPCompatibleErrorMessage } from "./compatibility.js";

function isToolResultError(result: any): boolean {
  return result && typeof result === "object" && result.isError === true;
}

export function setupToolCallTracing(server: MCPServerLike): void {
  try {
    const handlers = server._requestHandlers;

    const originalCallToolHandler = handlers.get("tools/call");
    const originalInitializeHandler = handlers.get("initialize");

    if (originalInitializeHandler) {
      server.setRequestHandler(
        InitializeRequestSchema,
        async (request, extra) => {
          const data = getServerTrackingData(server);
          if (!data) {
            writeToLog(
              "Warning: MCPCat is unable to find server tracking data. Please ensure you have called track(server, options) before using tool calls.",
            );
            return await originalInitializeHandler(request, extra);
          }

          const sessionId = getServerSessionId(server);
          let event: UnredactedEvent = {
            sessionId: sessionId,
            resourceName: request.params?.name || "Unknown Tool Name",
            eventType: PublishEventRequestEventTypeEnum.mcpInitialize,
            parameters: {
              request: request,
              extra: extra,
            },
            timestamp: new Date(),
            redactionFn: data.options.redactSensitiveInformation,
          };
          const result = await originalInitializeHandler(request, extra);
          event.response = result;
          publishEvent(server, event);
          return result;
        },
      );
    }

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const data = getServerTrackingData(server);
      if (!data) {
        writeToLog(
          "Warning: MCPCat is unable to find server tracking data. Please ensure you have called track(server, options) before using tool calls.",
        );
        return await originalCallToolHandler?.(request, extra);
      }

      const sessionId = getServerSessionId(server);
      let event: UnredactedEvent = {
        sessionId: sessionId,
        resourceName: request.params?.name || "Unknown Tool Name",
        parameters: {
          request: request,
          extra: extra,
        },
        eventType: PublishEventRequestEventTypeEnum.mcpToolsCall,
        timestamp: new Date(),
        redactionFn: data.options.redactSensitiveInformation,
      };

      try {
        // Try to identify the session if we haven't already and identify function is provided
        if (
          data.options.identify &&
          data.identifiedSessions.get(sessionId) === undefined
        ) {
          let identifyEvent: UnredactedEvent = {
            ...event,
            eventType: PublishEventRequestEventTypeEnum.mcpcatIdentify,
          };
          try {
            const identityResult = await data.options.identify(request, extra);
            if (identityResult) {
              writeToLog(
                `Identified session ${sessionId} with identity: ${JSON.stringify(identityResult)}`,
              );
              data.identifiedSessions.set(sessionId, identityResult);
              publishEvent(server, identifyEvent);
            } else {
              writeToLog(
                `Warning: Supplied identify function returned null for session ${sessionId}`,
              );
            }
          } catch (error) {
            writeToLog(
              `Warning: Supplied identify function threw an error while identifying session ${sessionId} - ${error}`,
            );
            identifyEvent.duration =
              (identifyEvent.timestamp &&
                new Date().getTime() - identifyEvent.timestamp.getTime()) ||
              undefined;
            identifyEvent.isError = true;
            identifyEvent.error = {
              message: getMCPCompatibleErrorMessage(error),
            };
            publishEvent(server, identifyEvent);
          }
        }

        // Check for missing context if enableToolCallContext is true and it's not report_missing
        if (
          data.options.enableToolCallContext &&
          request.params?.name !== "get_more_tools"
        ) {
          const hasContext =
            request.params?.arguments &&
            typeof request.params.arguments === "object" &&
            "context" in request.params.arguments;
          if (hasContext) {
            event.userIntent = request.params.arguments.context;
          }
        }

        let result;
        if (request.params?.name === "get_more_tools") {
          result = await handleReportMissing(request.params.arguments as any);
          event.userIntent = request.params.arguments.context;
        } else if (originalCallToolHandler) {
          result = await originalCallToolHandler(request, extra);
        } else {
          event.isError = true;
          event.error = {
            message: `Tool call handler not found for ${request.params?.name || "unknown"}`,
          };
          event.duration =
            (event.timestamp &&
              new Date().getTime() - event.timestamp.getTime()) ||
            undefined;
          publishEvent(server, event);
          throw new Error(`Unknown tool: ${request.params?.name || "unknown"}`);
        }

        // Check if the result indicates an error
        if (isToolResultError(result)) {
          event.isError = true;
          event.error = {
            message: getMCPCompatibleErrorMessage(result),
          };
        }

        event.response = result;
        publishEvent(server, event);
        return result;
      } catch (error) {
        event.isError = true;
        event.error = {
          message: getMCPCompatibleErrorMessage(error),
        };
        publishEvent(server, event);
        throw error;
      }
    });
  } catch (error) {
    writeToLog(`Warning: Failed to setup tool call tracing - ${error}`);
    throw error;
  }
}
