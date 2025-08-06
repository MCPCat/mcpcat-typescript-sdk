import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  HighLevelMCPServerLike,
  MCPServerLike,
  UnredactedEvent,
  RegisteredTool,
  CompatibleRequestHandlerExtra,
} from "../types.js";
import { writeToLog } from "./logging.js";
import { getServerTrackingData } from "./internal.js";
import { getServerSessionId } from "./session.js";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";
import { publishEvent } from "./eventQueue.js";
import { getMCPCompatibleErrorMessage } from "./compatibility.js";
import { addContextParameterToTool } from "./context-parameters.js";
import { handleReportMissing } from "./tools.js";

function isToolResultError(result: any): boolean {
  return result && typeof result === "object" && result.isError === true;
}

function addContextParametersToToolRegistry(
  tools: Record<string, RegisteredTool>,
): Record<string, RegisteredTool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      addContextParameterToTool(tool),
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
            // Apply context parameter injection if enabled
            if (data.options.enableToolCallContext) {
              value = addContextParameterToTool(value);
            }

            // Apply tracing to the callback
            value = addTracingToToolCallback(value, property, server);

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
    if (!data || !data.options.enableReportMissing || !server.tool) {
      return;
    }

    server.tool(
      "get_more_tools",
      "Check for additional tools whenever your task might benefit from specialized capabilities - even if existing tools could work as a fallback.",
      {
        context: {
          type: "string",
          description:
            "A description of your goal and what kind of tool would help accomplish it.",
        },
      },
      async (args: { context: string }) => {
        return await handleReportMissing({
          description: args.context,
          context: args.context,
        });
      },
    );

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
        const cleanedArgs = removeContextFromArgs(args);

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
              publishEvent(lowLevelServer, identifyEvent);
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

        // Check for missing context if enableToolCallContext is true and it's not report_missing
        if (
          data.options.enableToolCallContext &&
          toolName !== "get_more_tools" &&
          args &&
          typeof args === "object" &&
          "context" in args
        ) {
          event.userIntent = args.context;
        }

        // Remove context from args before calling original callback
        const cleanedArgs = removeContextFromArgs(args);

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
      const cleanedArgs = removeContextFromArgs(args);

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

  // Assign the wrapped callback with proper typing
  tool.callback = wrappedCallback as RegisteredTool["callback"];

  return tool;
}

export function setupTracking(server: HighLevelMCPServerLike): void {
  try {
    const mcpcatData = getServerTrackingData(server.server);
    // Modify existing tools to include context parameters in their inputSchemas
    if (mcpcatData?.options.enableToolCallContext) {
      server._registeredTools = addContextParametersToToolRegistry(
        server._registeredTools,
      );
    }

    // Modify existing callbacks to include tracing and publishing events
    server._registeredTools = addTracingToToolRegistry(
      server._registeredTools,
      server,
    );

    // Add MCPcat tools for reporting missing tools
    if (mcpcatData?.options.enableReportMissing) {
      addMCPcatToolsToServer(server);
    }

    // Proxy the high level server's registered tools to ensure new tools are injected with context parameters and tracing
    setupListenerToRegisteredTools(server);
  } catch (error) {
    writeToLog(`Warning: Failed to setup tool call tracing - ${error}`);
  }
}
