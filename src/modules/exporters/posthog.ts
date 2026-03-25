import { createHash } from "crypto";
import { Event, Exporter } from "../../types.js";
import { writeToLog } from "../logging.js";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";
import { MCPCAT_SOURCE } from "../constants.js";

function toUUID(id: string): string {
  const hash = createHash("sha256").update(id).digest("hex");
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    "5" + hash.substring(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) +
      hash.substring(17, 20),
    hash.substring(20, 32),
  ].join("-");
}

function getDistinctId(event: Event): string {
  return event.identifyActorGivenId || event.sessionId || "anonymous";
}

function getTimestamp(event: Event): string {
  return event.timestamp
    ? event.timestamp.toISOString()
    : new Date().toISOString();
}

export interface PostHogExporterConfig {
  type: "posthog";
  apiKey: string; // PostHog project API key (e.g. phc_...)
  host?: string; // Default: "https://us.i.posthog.com" (supports self-hosted & EU region)
  /**
   * Emits `$ai_span` events for tool calls alongside regular capture events,
   * integrating with PostHog's AI observability views. Each tool call is its own
   * trace (`$ai_trace_id`), grouped into sessions via `$ai_session_id`.
   * Customer-defined `eventTags` are spread directly onto `$ai_span` properties
   * and can override any default, including reserved `$ai_*` fields.
   * @default false
   */
  enableAITracing?: boolean;
}

interface PostHogCaptureEvent {
  event: string;
  distinct_id: string;
  properties: Record<string, any>;
  timestamp: string;
  type: "capture";
}

export class PostHogExporter implements Exporter {
  private batchUrl: string;
  private apiKey: string;
  private config: PostHogExporterConfig;

  constructor(config: PostHogExporterConfig) {
    this.config = config;
    const host = (config.host || "https://us.i.posthog.com").replace(/\/$/, "");
    this.batchUrl = `${host}/batch`;
    this.apiKey = config.apiKey;

    writeToLog(`PostHogExporter: Initialized with endpoint ${this.batchUrl}`);
  }

  async export(event: Event): Promise<void> {
    try {
      const batch: PostHogCaptureEvent[] = [];

      // Always send the regular event
      batch.push(this.buildCaptureEvent(event));

      // Send $exception event alongside if this is an error
      if (event.isError && event.error) {
        batch.push(this.buildExceptionEvent(event));
      }

      // Send $ai_span for tool calls when AI tracing is enabled
      if (
        this.config.enableAITracing &&
        event.eventType === PublishEventRequestEventTypeEnum.mcpToolsCall
      ) {
        batch.push(this.buildAISpanEvent(event));
      }

      writeToLog(
        `PostHogExporter: Sending ${batch.length} event(s) for ${event.id}`,
      );

      const response = await fetch(this.batchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          batch,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        writeToLog(
          `PostHog export failed - Status: ${response.status}, Body: ${errorBody}`,
        );
      } else {
        writeToLog(`PostHog export success - Event: ${event.id}`);
      }
    } catch (error) {
      writeToLog(`PostHog export error: ${error}`);
    }
  }

  private buildCaptureEvent(event: Event): PostHogCaptureEvent {
    const distinctId = getDistinctId(event);
    const eventName = this.mapEventType(event.eventType);
    const timestamp = getTimestamp(event);

    const properties: Record<string, any> = {
      $session_id: event.sessionId,
      source: MCPCAT_SOURCE,
    };

    if (event.resourceName) {
      properties.resource_name = event.resourceName;
      if (event.eventType === PublishEventRequestEventTypeEnum.mcpToolsCall) {
        properties.tool_name = event.resourceName;
      }
    }
    if (event.duration !== undefined) {
      properties.duration_ms = event.duration;
    }
    if (event.serverName) properties.server_name = event.serverName;
    if (event.serverVersion) properties.server_version = event.serverVersion;
    if (event.clientName) properties.client_name = event.clientName;
    if (event.clientVersion) properties.client_version = event.clientVersion;
    if (event.projectId) properties.project_id = event.projectId;
    if (event.userIntent) properties.user_intent = event.userIntent;
    if (event.isError !== undefined) properties.is_error = event.isError;

    if (event.parameters !== undefined) {
      properties.parameters = event.parameters;
    }
    if (event.response !== undefined) {
      properties.response = event.response;
    }

    // Set person properties from identity data
    const $set: Record<string, any> = {};
    if (event.identifyActorName) $set.name = event.identifyActorName;
    if (event.identifyActorData) {
      Object.assign($set, event.identifyActorData);
    }
    if (Object.keys($set).length > 0) {
      properties.$set = $set;
    }

    // Spread customer-defined tags directly (can override MCPCat defaults)
    if (event.tags) {
      for (const [key, value] of Object.entries(event.tags)) {
        properties[key] = value;
      }
    }

    // Spread customer-defined properties directly (can override MCPCat defaults)
    if (event.properties) {
      for (const [key, value] of Object.entries(event.properties)) {
        properties[key] = value;
      }
    }

    return {
      event: eventName,
      distinct_id: distinctId,
      properties,
      timestamp,
      type: "capture",
    };
  }

  private buildExceptionEvent(event: Event): PostHogCaptureEvent {
    const distinctId = getDistinctId(event);
    const timestamp = getTimestamp(event);

    const properties: Record<string, any> = {
      $exception_source: "backend",
      $session_id: event.sessionId,
    };

    if (event.error) {
      if (event.error.message) {
        properties.$exception_message = event.error.message;
      }
      if (event.error.type) {
        properties.$exception_type = event.error.type;
      }
      if (event.error.stack) {
        properties.$exception_stacktrace = event.error.stack;
      }
    }

    // Add tool/resource context
    if (event.resourceName) {
      properties.resource_name = event.resourceName;
      if (event.eventType === PublishEventRequestEventTypeEnum.mcpToolsCall) {
        properties.tool_name = event.resourceName;
      }
    }
    if (event.serverName) properties.server_name = event.serverName;
    if (event.serverVersion) properties.server_version = event.serverVersion;
    if (event.clientName) properties.client_name = event.clientName;
    if (event.clientVersion) properties.client_version = event.clientVersion;

    return {
      event: "$exception",
      distinct_id: distinctId,
      properties,
      timestamp,
      type: "capture",
    };
  }

  private buildAISpanEvent(event: Event): PostHogCaptureEvent {
    const distinctId = getDistinctId(event);
    const timestamp = getTimestamp(event);

    const properties: Record<string, any> = {
      $ai_session_id: `mcpcat_${event.sessionId}`,
      $ai_trace_id: toUUID(event.sessionId),
      $ai_span_id: toUUID(event.id),
      $ai_span_name: event.resourceName || "unknown_tool",
      $ai_is_error: event.isError || false,
      $session_id: event.sessionId,
      source: MCPCAT_SOURCE,
    };

    if (event.duration !== undefined) {
      properties.$ai_latency = event.duration / 1000;
    }
    if (event.isError && event.error) {
      properties.$ai_error = event.error;
    }
    if (event.parameters !== undefined) {
      properties.$ai_input_state = event.parameters;
    }
    if (event.response !== undefined) {
      properties.$ai_output_state = event.response;
    }
    if (event.serverName) properties.server_name = event.serverName;
    if (event.clientName) properties.client_name = event.clientName;

    // Spread customer tags directly (can override MCPCat defaults)
    if (event.tags) {
      for (const [key, value] of Object.entries(event.tags)) {
        properties[key] = value;
      }
    }

    // Spread customer properties directly (can override MCPCat defaults)
    if (event.properties) {
      for (const [key, value] of Object.entries(event.properties)) {
        properties[key] = value;
      }
    }

    return {
      event: "$ai_span",
      distinct_id: distinctId,
      properties,
      timestamp,
      type: "capture",
    };
  }

  private mapEventType(eventType: string): string {
    // Map MCPcat event types to PostHog event names
    const mapping: Record<string, string> = {
      [PublishEventRequestEventTypeEnum.mcpToolsCall]: "mcp_tool_call",
      [PublishEventRequestEventTypeEnum.mcpToolsList]: "mcp_tools_list",
      [PublishEventRequestEventTypeEnum.mcpInitialize]: "mcp_initialize",
      [PublishEventRequestEventTypeEnum.mcpResourcesRead]: "mcp_resource_read",
      [PublishEventRequestEventTypeEnum.mcpResourcesList]: "mcp_resources_list",
      [PublishEventRequestEventTypeEnum.mcpPromptsGet]: "mcp_prompt_get",
      [PublishEventRequestEventTypeEnum.mcpPromptsList]: "mcp_prompts_list",
    };

    return (
      mapping[eventType] ||
      `mcp_${eventType.replace(/^mcp:/, "").replace(/\//g, "_")}`
    );
  }
}
