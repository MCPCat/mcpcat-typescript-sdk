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
import { TelemetryManager } from "./modules/telemetry.js";
import { setTelemetryManager } from "./modules/eventQueue.js";

/**
 * Integrates MCPCat analytics into an MCP server to track tool usage patterns and user interactions.
 *
 * @param server - The MCP server instance to track. Must be a compatible MCP server implementation.
 * @param projectId - Your MCPCat project ID obtained from mcpcat.io when creating an account. Pass null for telemetry-only mode.
 * @param options - Optional configuration to customize tracking behavior.
 * @param options.enableReportMissing - Adds a "get_more_tools" tool that allows LLMs to automatically report missing functionality.
 * @param options.enableTracing - Enables tracking of tool calls and usage patterns.
 * @param options.enableToolCallContext - Injects a "context" parameter to existing tools to capture user intent.
 * @param options.customContextDescription - Custom description for the injected context parameter. Only applies when enableToolCallContext is true. Use this to provide domain-specific guidance to LLMs about what context they should provide.
 * @param options.identify - Async function to identify users and attach custom data to their sessions.
 * @param options.redactSensitiveInformation - Function to redact sensitive data before sending to MCPCat.
 * @param options.exporters - Configure telemetry exporters to send events to external systems. Available exporters:
 *   - `otlp`: OpenTelemetry Protocol exporter (see {@link ../modules/exporters/otlp.OTLPExporter})
 *   - `datadog`: Datadog APM exporter (see {@link ../modules/exporters/datadog.DatadogExporter})
 *   - `sentry`: Sentry Monitoring exporter (see {@link ../modules/exporters/sentry.SentryExporter})
 *
 * @returns The tracked server instance.
 *
 * @remarks
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
 * // Track the server with MCPCat
 * mcpcat.track(mcpServer, "proj_abc123xyz");
 *
 * // Register your tools
 * mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
 *   tools: [{ name: "my_tool", description: "Does something useful" }]
 * }));
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
 * // With custom context description
 * mcpcat.track(mcpServer, "proj_abc123xyz", {
 *   enableToolCallContext: true,
 *   customContextDescription: "Explain why you're calling this tool and what business objective it helps achieve"
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
 *
 * @example
 * ```typescript
 * // Telemetry-only mode (no MCPCat account required)
 * mcpcat.track(mcpServer, null, {
 *   exporters: {
 *     otlp: {
 *       type: "otlp",
 *       endpoint: "http://localhost:4318/v1/traces"
 *     }
 *   }
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Dual mode - send to both MCPCat and telemetry exporters
 * mcpcat.track(mcpServer, "proj_abc123xyz", {
 *   exporters: {
 *     datadog: {
 *       type: "datadog",
 *       apiKey: process.env.DD_API_KEY,
 *       site: "datadoghq.com"
 *     }
 *   }
 * });
 * ```
 */
function track(
  server: any,
  projectId: string | null,
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

    // Initialize telemetry if exporters are configured
    if (options.exporters) {
      const telemetryManager = new TelemetryManager(options.exporters);
      setTelemetryManager(telemetryManager);
      writeToLog(
        `Initialized telemetry with ${Object.keys(options.exporters).length} exporters`,
      );
    }

    // If projectId is null and no exporters, warn the user
    if (!projectId && !options.exporters) {
      writeToLog(
        "Warning: No projectId provided and no exporters configured. Events will not be sent anywhere.",
      );
    }

    const sessionInfo = getSessionInfo(lowLevelServer, undefined);
    const mcpcatData: MCPCatData = {
      projectId: projectId || "", // Use empty string for null projectId
      sessionId: newSessionId(),
      lastActivity: new Date(),
      identifiedSessions: new Map<string, UserIdentity>(),
      sessionInfo,
      options: {
        enableReportMissing: options.enableReportMissing ?? true,
        enableTracing: options.enableTracing ?? true,
        enableToolCallContext: options.enableToolCallContext ?? true,
        customContextDescription: options.customContextDescription,
        identify: options.identify,
        redactSensitiveInformation: options.redactSensitiveInformation,
      },
    };

    setServerTrackingData(lowLevelServer, mcpcatData);
    if (isHighLevelServer(validatedServer)) {
      const highLevelServer = validatedServer as HighLevelMCPServerLike;
      setupTracking(highLevelServer);
    } else {
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
    }

    return validatedServer;
  } catch (error) {
    writeToLog(`Warning: Failed to track server - ${error}`);
    return server;
  }
}

export type {
  MCPCatOptions,
  UserIdentity,
  RedactFunction,
  ExporterConfig,
  Exporter,
} from "./types.js";

export type IdentifyFunction = MCPCatOptions["identify"];

export { track };
