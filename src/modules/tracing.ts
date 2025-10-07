import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
  ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  HighLevelMCPServerLike,
  MCPServerLike,
  UnredactedEvent,
} from "../types.js";
import { writeToLog } from "./logging.js";
import { handleReportMissing } from "./tools.js";
import {
  getServerTrackingData,
  areIdentitiesEqual,
  mergeIdentities,
} from "./internal.js";
import { getServerSessionId } from "./session.js";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";
import { publishEvent } from "./eventQueue.js";
import { getMCPCompatibleErrorMessage } from "./compatibility.js";

function isToolResultError(result: any): boolean {
  return result && typeof result === "object" && result.isError === true;
}

// Track if we've already set up list tools tracing
let listToolsTracingSetup = false;

export function setupListToolsTracing(
  highLevelServer: HighLevelMCPServerLike,
): void {
  const server = highLevelServer.server;

  // Check if server supports tools capability
  if (!(server as any)._capabilities?.tools) {
    // Server doesn't support tools yet, skip setup
    return;
  }

  // Check if we've already set up tracing
  if (listToolsTracingSetup) {
    return;
  }

  const handlers = server._requestHandlers;
  const originalListToolsHandler = handlers.get("tools/list");

  // No handler to override yet
  if (!originalListToolsHandler) {
    return;
  }

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

      event.response = { tools };
      event.isError = false;
      event.duration =
        (event.timestamp && new Date().getTime() - event.timestamp.getTime()) ||
        0;
      publishEvent(server, event);
      return { tools };
    });

    // Mark as setup successful
    listToolsTracingSetup = true;
  } catch (error) {
    writeToLog(`Warning: Failed to override list tools handler - ${error}`);
  }
}

export function setupInitializeTracing(
  highLevelServer: HighLevelMCPServerLike,
): void {
  const server = highLevelServer.server;
  const handlers = server._requestHandlers;
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
        if (data.options.identify) {
          let identifyEvent: UnredactedEvent = {
            ...event,
            eventType: PublishEventRequestEventTypeEnum.mcpcatIdentify,
          };
          try {
            const identityResult = await data.options.identify(request, extra);
            if (identityResult) {
              // Get previous identity for this session
              const previousIdentity = data.identifiedSessions.get(sessionId);

              // Merge identities (overwrite userId/userName, merge userData)
              const mergedIdentity = mergeIdentities(
                previousIdentity,
                identityResult,
              );

              // Only publish if identity has changed
              const hasChanged =
                !previousIdentity ||
                !areIdentitiesEqual(previousIdentity, mergedIdentity);

              // Always update the stored identity with the merged version FIRST
              // so that publishEvent can get the latest identity in sessionInfo
              data.identifiedSessions.set(sessionId, mergedIdentity);

              if (hasChanged) {
                writeToLog(
                  `Identified session ${sessionId} with identity: ${JSON.stringify(mergedIdentity)}`,
                );
                publishEvent(server, identifyEvent);
              }
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
          result = await handleReportMissing(request.params.arguments.context);
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
