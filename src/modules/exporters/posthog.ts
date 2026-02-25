import { Event, Exporter } from "../../types.js";
import { writeToLog } from "../logging.js";

export interface PostHogExporterConfig {
  type: "posthog";
  apiKey: string; // PostHog project API key (e.g. phc_...)
  host?: string; // Default: "https://us.i.posthog.com" (supports self-hosted & EU region)
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

  constructor(config: PostHogExporterConfig) {
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
    const distinctId =
      event.identifyActorGivenId || event.sessionId || "anonymous";
    const eventName = this.mapEventType(event.eventType);
    const timestamp = event.timestamp
      ? event.timestamp.toISOString()
      : new Date().toISOString();

    const properties: Record<string, any> = {
      $session_id: event.sessionId,
    };

    if (event.resourceName) {
      properties.resource_name = event.resourceName;
      if (event.eventType === "tools/call") {
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

    return {
      event: eventName,
      distinct_id: distinctId,
      properties,
      timestamp,
      type: "capture",
    };
  }

  private buildExceptionEvent(event: Event): PostHogCaptureEvent {
    const distinctId =
      event.identifyActorGivenId || event.sessionId || "anonymous";
    const timestamp = event.timestamp
      ? event.timestamp.toISOString()
      : new Date().toISOString();

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
      if (event.eventType === "tools/call") {
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

  private mapEventType(eventType: string): string {
    // Map MCPcat event types to PostHog event names
    const mapping: Record<string, string> = {
      "tools/call": "mcp_tool_call",
      "tools/list": "mcp_tools_list",
      initialize: "mcp_initialize",
      "resources/read": "mcp_resource_read",
      "resources/list": "mcp_resources_list",
      "prompts/get": "mcp_prompt_get",
      "prompts/list": "mcp_prompts_list",
    };

    return mapping[eventType] || `mcp_${eventType.replace(/\//g, "_")}`;
  }
}
