import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  HighLevelMCPServerLike,
  MCPServerLike,
  UnredactedEvent,
  RegisteredTool,
  CompatibleRequestHandlerExtra,
} from "../types.js";
import { writeToLog } from "./logging.js";
import {
  getServerTrackingData,
  areIdentitiesEqual,
  mergeIdentities,
} from "./internal.js";
import { getServerSessionId } from "./session.js";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";
import { publishEvent } from "./eventQueue.js";
import { getMCPCompatibleErrorMessage } from "./compatibility.js";
import { addContextParameterToTool } from "./context-parameters.js";
import { handleReportMissing } from "./tools.js";
import { setupInitializeTracing, setupListToolsTracing } from "./tracing.js";

// WeakMap to track which callbacks have already been wrapped
const wrappedCallbacks = new WeakMap<Function, boolean>();

// Symbol to mark tools that have already been processed
const MCPCAT_PROCESSED = Symbol("__mcpcat_processed__");

function isToolResultError(result: any): boolean {
  return result && typeof result === "object" && result.isError === true;
}

function addContextParametersToToolRegistry(
  tools: Record<string, RegisteredTool>,
  customContextDescription?: string,
): Record<string, RegisteredTool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      // Skip get_more_tools - it has its own context parameter
      name === "get_more_tools"
        ? tool
        : addContextParameterToTool(tool, customContextDescription),
    ]),
  );
}

function addTracingToToolRegistry(
  tools: Record<string, RegisteredTool>,
  server: HighLevelMCPServerLike,
): Record<string, RegisteredTool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      addTracingToToolCallback(tool, name, server),
    ]),
  );
}

function setupListenerToRegisteredTools(server: HighLevelMCPServerLike): void {
  try {
    const data = getServerTrackingData(server.server as MCPServerLike);
    if (!data) {
      writeToLog("Warning: Cannot setup listener - no tracking data found");
      return;
    }

    // Create a proxy handler for the _registeredTools object
    const handler: ProxyHandler<Record<string, RegisteredTool>> = {
      set(
        target: Record<string, RegisteredTool>,
        property: string | symbol,
        value: RegisteredTool,
      ): boolean {
        try {
          // Check if this is a tool being registered (has callback property)
          if (
            typeof property === "string" &&
            value &&
            typeof value === "object" &&
            "callback" in value
          ) {
            // Check if tool has already been processed
            if ((value as any)[MCPCAT_PROCESSED]) {
              writeToLog(
                `Tool ${String(property)} already processed, skipping proxy wrapping`,
              );
              // Just set the value without processing
              return Reflect.set(target, property, value);
            }

            // Check if callback is already wrapped
            if (wrappedCallbacks.has(value.callback)) {
              writeToLog(
                `Tool ${String(property)} callback already wrapped, skipping proxy wrapping`,
              );
              // Just set the value without processing
              return Reflect.set(target, property, value);
            }

            // Apply context parameter injection if enabled (skip get_more_tools since it has its own context)
            if (
              data.options.enableToolCallContext &&
              property !== "get_more_tools"
            ) {
              value = addContextParameterToTool(
                value,
                data.options.customContextDescription,
              );
            }

            // Apply tracing to the callback
            value = addTracingToToolCallback(value, property, server);

            // After adding a tool, try to set up list tools tracing
            // This handles the case where track() is called before tools are registered
            setupListToolsTracing(server);

            // If the tool has an update method, wrap it to handle callback updates
            if (typeof value.update === "function") {
              const originalUpdate = value.update;
              value.update = function (...updateArgs: any[]) {
                // If callback is being updated, wrap the new callback
                if (updateArgs[0] && updateArgs[0].callback) {
                  updateArgs[0].callback = addTracingToToolCallback(
                    { callback: updateArgs[0].callback },
                    property,
                    server,
                  ).callback;
                }
                return originalUpdate.apply(this, updateArgs);
              };
            }
          }

          // Use Reflect to perform the actual property set
          return Reflect.set(target, property, value);
        } catch (error) {
          writeToLog(
            `Warning: Error in proxy set handler for tool ${String(property)} - ${error}`,
          );
          // Fall back to default behavior on error
          return Reflect.set(target, property, value);
        }
      },

      get(
        target: Record<string, RegisteredTool>,
        property: string | symbol,
      ): any {
        return Reflect.get(target, property);
      },

      deleteProperty(
        target: Record<string, RegisteredTool>,
        property: string | symbol,
      ): boolean {
        return Reflect.deleteProperty(target, property);
      },

      has(
        target: Record<string, RegisteredTool>,
        property: string | symbol,
      ): boolean {
        return Reflect.has(target, property);
      },
    };

    // Replace _registeredTools with a proxied version
    const originalTools = server._registeredTools || {};
    server._registeredTools = new Proxy(originalTools, handler);

    writeToLog("Successfully set up listener for new tool registrations");
  } catch (error) {
    writeToLog(
      `Warning: Failed to setup listener for registered tools - ${error}`,
    );
  }
}

function addMCPcatToolsToServer(server: HighLevelMCPServerLike): void {
  try {
    const data = getServerTrackingData(server.server as MCPServerLike);
    if (!data || !data.options.enableReportMissing) {
      return;
    }

    // Use registerTool if available, otherwise fall back to direct assignment
    if (server.registerTool) {
      // Use the MCP SDK registerTool syntax: (name, config, handler)
      server.registerTool(
        "get_more_tools",
        {
          description:
            "Check for additional tools whenever your task might benefit from specialized capabilities - even if existing tools could work as a fallback.",
          inputSchema: {
            context: z
              .string()
              .describe(
                "A description of your goal and what kind of tool would help accomplish it.",
              ),
          },
        },
        (args: { context: string }) => {
          return handleReportMissing({
            context: args.context,
          });
        },
      );
    } else {
      // Fallback to direct assignment for compatibility
      server._registeredTools["get_more_tools"] = {
        description:
          "Check for additional tools whenever your task might benefit from specialized capabilities - even if existing tools could work as a fallback.",
        inputSchema: {
          context: z
            .string()
            .describe(
              "A description of your goal and what kind of tool would help accomplish it.",
            ),
        },
        callback: (args: { context: string }) => {
          return handleReportMissing({
            context: args.context,
          });
        },
      };
    }

    writeToLog("Successfully added MCPcat tools to server");
  } catch (error) {
    writeToLog(`Warning: Failed to add MCPcat tools - ${error}`);
  }
}

function addTracingToToolCallback(
  tool: RegisteredTool,
  toolName: string,
  server: HighLevelMCPServerLike,
): RegisteredTool {
  const originalCallback = tool.callback;
  const lowLevelServer = server.server as MCPServerLike;

  // Check if this callback has already been wrapped
  if (wrappedCallbacks.has(originalCallback)) {
    writeToLog(`Tool ${toolName} callback already wrapped, skipping re-wrap`);
    return tool;
  }

  // Check if tool has already been processed
  if ((tool as any)[MCPCAT_PROCESSED]) {
    writeToLog(`Tool ${toolName} already processed, skipping re-wrap`);
    return tool;
  }

  // Create a wrapper that matches both callback signatures
  const wrappedCallback = async function (
    ...params: any[]
  ): Promise<CallToolResult> {
    // Determine if this is (args, extra) or just (extra) signature
    let args: any;
    let extra: CompatibleRequestHandlerExtra;

    if (params.length === 2) {
      // (args, extra) signature
      args = params[0];
      extra = params[1];
    } else {
      // (extra) signature
      args = undefined;
      extra = params[0];
    }

    // Helper function to remove context from args
    const removeContextFromArgs = (args: any): any => {
      if (args && typeof args === "object" && "context" in args) {
        const { context: _context, ...argsWithoutContext } = args;
        return argsWithoutContext;
      }
      return args;
    };

    try {
      const data = getServerTrackingData(lowLevelServer);
      if (!data) {
        writeToLog(
          "Warning: MCPCat is unable to find server tracking data. Please ensure you have called track(server, options) before using tool calls.",
        );

        // Remove context from args before calling original callback
        // BUT keep it for get_more_tools since it's a required parameter
        const cleanedArgs =
          toolName === "get_more_tools" ? args : removeContextFromArgs(args);

        // Call with original params
        return await (cleanedArgs === undefined
          ? (
              originalCallback as (
                extra: CompatibleRequestHandlerExtra,
              ) => Promise<CallToolResult>
            )(extra)
          : (
              originalCallback as (
                args: any,
                extra: CompatibleRequestHandlerExtra,
              ) => Promise<CallToolResult>
            )(cleanedArgs, extra));
      }

      const sessionId = getServerSessionId(lowLevelServer);

      // Create a request-like object for compatibility with existing code
      const request = {
        params: {
          name: toolName,
          arguments: args,
        },
      };

      let event: UnredactedEvent = {
        sessionId: sessionId,
        resourceName: toolName,
        parameters: {
          request: request,
          extra: extra,
        },
        eventType: PublishEventRequestEventTypeEnum.mcpToolsCall,
        timestamp: new Date(),
        redactionFn: data.options.redactSensitiveInformation,
      };

      try {
        // Try to identify the session if identify function is provided
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
                publishEvent(lowLevelServer, identifyEvent);
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
            publishEvent(lowLevelServer, identifyEvent);
          }
        }

        // Extract context for userIntent if present
        if (args && typeof args === "object" && "context" in args) {
          event.userIntent = args.context;
        }

        // Remove context from args before calling original callback
        // BUT keep it for get_more_tools since it's a required parameter
        const cleanedArgs =
          toolName === "get_more_tools" ? args : removeContextFromArgs(args);

        let result = await (cleanedArgs === undefined
          ? (
              originalCallback as (
                extra: CompatibleRequestHandlerExtra,
              ) => Promise<CallToolResult>
            )(extra)
          : (
              originalCallback as (
                args: any,
                extra: CompatibleRequestHandlerExtra,
              ) => Promise<CallToolResult>
            )(cleanedArgs, extra));

        // Check if the result indicates an error
        if (isToolResultError(result)) {
          event.isError = true;
          event.error = {
            message: getMCPCompatibleErrorMessage(result),
          };
        }

        event.response = result;
        event.duration =
          (event.timestamp &&
            new Date().getTime() - event.timestamp.getTime()) ||
          undefined;
        publishEvent(lowLevelServer, event);
        return result;
      } catch (error) {
        event.isError = true;
        event.error = {
          message: getMCPCompatibleErrorMessage(error),
        };
        event.duration =
          (event.timestamp &&
            new Date().getTime() - event.timestamp.getTime()) ||
          undefined;
        publishEvent(lowLevelServer, event);
        throw error;
      }
    } catch (error) {
      // If any error occurs in our tracing code, log it and call the original callback
      writeToLog(
        `Warning: MCPCat tracing failed for tool ${toolName}, falling back to original callback - ${error}`,
      );

      // Remove context from args before calling original callback
      // BUT keep it for get_more_tools since it's a required parameter
      const cleanedArgs =
        toolName === "get_more_tools" ? args : removeContextFromArgs(args);

      return await (cleanedArgs === undefined
        ? (
            originalCallback as (
              extra: CompatibleRequestHandlerExtra,
            ) => Promise<CallToolResult>
          )(extra)
        : (
            originalCallback as (
              args: any,
              extra: CompatibleRequestHandlerExtra,
            ) => Promise<CallToolResult>
          )(cleanedArgs, extra));
    }
  };

  // Mark the original callback as wrapped
  wrappedCallbacks.set(originalCallback, true);

  // Mark the wrapped callback as well (in case it gets re-wrapped)
  wrappedCallbacks.set(wrappedCallback, true);

  // Create a new tool object with the wrapped callback
  const wrappedTool = {
    ...tool,
    callback: wrappedCallback as RegisteredTool["callback"],
  };

  // Mark the tool as processed
  (wrappedTool as any)[MCPCAT_PROCESSED] = true;

  return wrappedTool;
}

export function setupTracking(server: HighLevelMCPServerLike): void {
  try {
    const mcpcatData = getServerTrackingData(server.server);

    setupInitializeTracing(server);
    // Modify existing tools to include context parameters in their inputSchemas
    if (mcpcatData?.options.enableToolCallContext) {
      server._registeredTools = addContextParametersToToolRegistry(
        server._registeredTools,
        mcpcatData.options.customContextDescription,
      );
    }

    // Add MCPcat tools for reporting missing tools FIRST
    if (mcpcatData?.options.enableReportMissing) {
      addMCPcatToolsToServer(server);
    }

    // Modify existing callbacks to include tracing and publishing events
    // This now includes get_more_tools if it was added
    server._registeredTools = addTracingToToolRegistry(
      server._registeredTools,
      server,
    );

    setupListToolsTracing(server);

    // Proxy the high level server's registered tools to ensure new tools are injected with context parameters and tracing
    setupListenerToRegisteredTools(server);
  } catch (error) {
    writeToLog(`Warning: Failed to setup tool call tracing - ${error}`);
  }
}
