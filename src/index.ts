// Import our minimal interface from types
import {
  MCPCatOptions,
  MCPCatData,
  UserIdentity,
  MCPServerLike,
  HighLevelMCPServerLike,
} from "./types.js";

// Import from modules
import {
  isCompatibleServerType,
  isHighLevelServer,
} from "./modules/compatibility.js";
import { writeToLog } from "./modules/logging.js";
import { setupMCPCatTools } from "./modules/tools.js";
import { setupToolCallTracing } from "./modules/tracing.js";
import { getSessionInfo, newSessionId } from "./modules/session.js";
import { setServerTrackingData } from "./modules/internal.js";
import { setupTracking } from "./modules/tracingV2.js";

/**
 * Integrates MCPCat analytics into an MCP server to track tool usage patterns and user interactions.
 *
 * @param server - The MCP server instance to track. Must be a compatible MCP server implementation.
 * @param projectId - Your MCPCat project ID obtained from mcpcat.io when creating an account.
 * @param options - Optional configuration to customize tracking behavior.
 * @param options.enableReportMissing - Adds a "get_more_tools" tool that allows LLMs to automatically report missing functionality.
 * @param options.enableTracing - Enables tracking of tool calls and usage patterns.
 * @param options.enableToolCallContext - Injects a "context" parameter to existing tools to capture user intent.
 * @param options.identify - Async function to identify users and attach custom data to their sessions.
 * @param options.redactSensitiveInformation - Function to redact sensitive data before sending to MCPCat.
 *
 * @returns The tracked server instance.
 *
 * @remarks
 * **IMPORTANT**: The `track()` function must be called AFTER all tools have been registered on the server.
 * Calling it before tool registration will result in those tools not being tracked.
 *
 * Analytics data and debug information are logged to `~/mcpcat.log` since console logs interfere
 * with STDIO-based MCP servers.
 *
 * Do not call `track()` multiple times on the same server instance as this will cause unexpected behavior.
 *
 * @example
 * ```typescript
 * import * as mcpcat from "mcpcat";
 *
 * const mcpServer = new Server({ name: "my-mcp-server", version: "1.0.0" });
 *
 * // Register your tools first
 * mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
 *   tools: [{ name: "my_tool", description: "Does something useful" }]
 * }));
 *
 * // Then call track() after all tools are registered
 * mcpcat.track(mcpServer, "proj_abc123xyz");
 * ```
 *
 * @example
 * ```typescript
 * // With user identification
 * mcpcat.track(mcpServer, "proj_abc123xyz", {
 *   identify: async (request, extra) => {
 *     const user = await getUserFromToken(request.params.arguments.token);
 *     return {
 *       userId: user.id,
 *       userData: { plan: user.plan, company: user.company }
 *     };
 *   }
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With sensitive data redaction
 * mcpcat.track(mcpServer, "proj_abc123xyz", {
 *   redactSensitiveInformation: async (text) => {
 *     return text.replace(/api_key_\w+/g, "[REDACTED]");
 *   }
 * });
 * ```
 */
function track(
  server: any,
  projectId: string,
  options: MCPCatOptions = {},
): any {
  try {
    const validatedServer = isCompatibleServerType(server);
    // For high-level servers, we need to pass the underlying server to some functions
    const lowLevelServer = (
      isHighLevelServer(validatedServer)
        ? (validatedServer as any).server
        : validatedServer
    ) as MCPServerLike;
    const sessionInfo = getSessionInfo(lowLevelServer, undefined);
    const mcpcatData: MCPCatData = {
      projectId,
      sessionId: newSessionId(),
      lastActivity: new Date(),
      identifiedSessions: new Map<string, UserIdentity>(),
      sessionInfo,
      options: {
        enableReportMissing: options.enableReportMissing ?? true,
        enableTracing: options.enableTracing ?? true,
        enableToolCallContext: options.enableToolCallContext ?? true,
        identify: options.identify,
        redactSensitiveInformation: options.redactSensitiveInformation,
      },
    };

    setServerTrackingData(lowLevelServer, mcpcatData);
    if (isHighLevelServer(validatedServer)) {
      const highLevelServer = validatedServer as HighLevelMCPServerLike;
      setupTracking(highLevelServer);
    }

    if (mcpcatData.options.enableReportMissing) {
      try {
        setupMCPCatTools(lowLevelServer);
      } catch (error) {
        writeToLog(`Warning: Failed to setup report missing tool - ${error}`);
      }
    }

    if (mcpcatData.options.enableTracing) {
      try {
        // Pass the low-level server to the current tracing module
        setupToolCallTracing(lowLevelServer);
      } catch (error) {
        writeToLog(`Warning: Failed to setup tool call tracing - ${error}`);
      }
    }

    return validatedServer;
  } catch (error) {
    writeToLog(`Warning: Failed to track server - ${error}`);
    return server;
  }
}

export type { MCPCatOptions, UserIdentity, RedactFunction } from "./types.js";

export type IdentifyFunction = MCPCatOptions["identify"];

export { track };
