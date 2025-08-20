import { Event, Exporter } from "../../types.js";
import { writeToLog } from "../logging.js";
import { traceContext } from "./trace-context.js";

export interface DatadogExporterConfig {
  type: "datadog";
  apiKey: string; // Required - Datadog API key
  site: string; // Required - 'datadoghq.com', 'datadoghq.eu', etc.
  service: string; // Required - MCP server name
  env?: string; // Optional - environment
}

interface DatadogLog {
  message: string;
  service: string;
  ddsource: string;
  ddtags: string;
  timestamp: number;
  status?: string;
  dd?: {
    trace_id: string;
    span_id: string;
  };
  error?: {
    message: string;
  };
  mcp: {
    session_id?: string;
    event_id?: string;
    event_type?: string;
    resource?: string;
    duration_ms?: number;
    user_intent?: string;
    actor_id?: string;
    actor_name?: string;
    client_name?: string;
    client_version?: string;
    server_name?: string;
    server_version?: string;
    is_error?: boolean;
    error?: any;
  };
}

interface DatadogMetric {
  metric: string;
  type: "count" | "gauge" | "rate";
  points: Array<[number, number]>;
  tags?: string[];
}

export class DatadogExporter implements Exporter {
  private logsUrl: string;
  private metricsUrl: string;
  private config: DatadogExporterConfig;

  constructor(config: DatadogExporterConfig) {
    this.config = config;

    // Build API endpoints based on site
    const site = config.site.replace(/^https?:\/\//, "").replace(/\/$/, "");
    this.logsUrl = `https://http-intake.logs.${site}/api/v2/logs`;
    this.metricsUrl = `https://api.${site}/api/v1/series`;
  }

  async export(event: Event): Promise<void> {
    writeToLog("DatadogExporter: Sending event immediately to Datadog");

    // Convert event to log and metrics
    const log = this.eventToLog(event);
    const metrics = this.eventToMetrics(event);

    // Debug: Log the metrics payload
    writeToLog(`DatadogExporter: Metrics URL: ${this.metricsUrl}`);
    writeToLog(
      `DatadogExporter: Metrics payload: ${JSON.stringify({ series: metrics })}`,
    );

    // Send logs with response checking
    const logsPromise = fetch(this.logsUrl, {
      method: "POST",
      headers: {
        "DD-API-KEY": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([log]),
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorBody = await response.text();
          writeToLog(
            `Datadog logs failed - Status: ${response.status}, Body: ${errorBody}`,
          );
        } else {
          writeToLog(`Datadog logs success - Status: ${response.status}`);
        }
        return response;
      })
      .catch((err) => {
        writeToLog(`Datadog logs network error: ${err}`);
      });

    // Send metrics with response checking
    const metricsPromise = fetch(this.metricsUrl, {
      method: "POST",
      headers: {
        "DD-API-KEY": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ series: metrics }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorBody = await response.text();
          writeToLog(
            `Datadog metrics failed - Status: ${response.status}, Body: ${errorBody}`,
          );
        } else {
          const responseBody = await response.text();
          writeToLog(
            `Datadog metrics success - Status: ${response.status}, Body: ${responseBody}`,
          );
        }
        return response;
      })
      .catch((err) => {
        writeToLog(`Datadog metrics network error: ${err}`);
      });

    // Wait for both to complete
    await Promise.all([logsPromise, metricsPromise]);
  }

  private eventToLog(event: Event): DatadogLog {
    const tags: string[] = [];

    // Add basic tags
    if (this.config.env) tags.push(`env:${this.config.env}`);
    if (event.eventType)
      tags.push(`event_type:${event.eventType.replace(/\//g, ".")}`);
    if (event.resourceName) tags.push(`resource:${event.resourceName}`);
    if (event.isError) tags.push("error:true");

    const log: DatadogLog = {
      message: `${event.eventType || "unknown"} - ${event.resourceName || "unknown"}`,
      service: this.config.service,
      ddsource: "mcpcat",
      ddtags: tags.join(","),
      timestamp: event.timestamp ? event.timestamp.getTime() : Date.now(),
      status: event.isError ? "error" : "info",
      dd: {
        trace_id: traceContext.getDatadogTraceId(event.sessionId),
        span_id: traceContext.getDatadogSpanId(event.id),
      },
      mcp: {
        session_id: event.sessionId,
        event_id: event.id,
        event_type: event.eventType,
        resource: event.resourceName,
        duration_ms: event.duration,
        user_intent: event.userIntent,
        actor_id: event.identifyActorGivenId,
        actor_name: event.identifyActorName,
        client_name: event.clientName,
        client_version: event.clientVersion,
        server_name: event.serverName,
        server_version: event.serverVersion,
        is_error: event.isError,
        error: event.error,
      },
    };

    // Add error at root level if it exists
    if (event.isError && event.error) {
      log.error = {
        message:
          typeof event.error === "string"
            ? event.error
            : JSON.stringify(event.error),
      };
    }

    return log;
  }

  private eventToMetrics(event: Event): DatadogMetric[] {
    const metrics: DatadogMetric[] = [];
    const timestamp = Math.floor(
      (event.timestamp?.getTime() || Date.now()) / 1000,
    );
    const tags: string[] = [`service:${this.config.service}`];

    // Add optional tags
    if (this.config.env) tags.push(`env:${this.config.env}`);
    if (event.eventType)
      tags.push(`event_type:${event.eventType.replace(/\//g, ".")}`);
    if (event.resourceName) tags.push(`resource:${event.resourceName}`);

    // Event count metric
    metrics.push({
      metric: "mcp.events.count",
      type: "count",
      points: [[timestamp, 1]],
      tags,
    });

    // Duration metric (only if duration exists)
    if (event.duration) {
      metrics.push({
        metric: "mcp.event.duration",
        type: "gauge",
        points: [[timestamp, event.duration]],
        tags,
      });
    }

    // Error count metric
    if (event.isError) {
      metrics.push({
        metric: "mcp.errors.count",
        type: "count",
        points: [[timestamp, 1]],
        tags,
      });
    }

    return metrics;
  }
}
