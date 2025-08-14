import { Event, Exporter } from "../../types.js";
import { writeToLog } from "../logging.js";

export interface OTLPExporterConfig {
  type: "otlp";
  endpoint?: string;
  protocol?: "http/protobuf" | "grpc";
  headers?: Record<string, string>;
  compression?: "gzip" | "none";
}

export class OTLPExporter implements Exporter {
  private endpoint: string;
  private headers: Record<string, string>;
  private protocol: string;

  constructor(config: OTLPExporterConfig) {
    // Default to HTTP protocol on localhost
    this.protocol = config.protocol || "http/protobuf";
    this.endpoint =
      config.endpoint ||
      (this.protocol === "grpc"
        ? "http://localhost:4317"
        : "http://localhost:4318/v1/traces");
    this.headers = {
      "Content-Type": "application/json", // Using JSON for now for easier debugging
      ...config.headers,
    };
  }

  async export(event: Event): Promise<void> {
    try {
      // Convert MCPCat event to OTLP trace format
      const span = this.convertToOTLPSpan(event);

      // Create OTLP JSON format
      const otlpRequest = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: event.serverName || "mcp-server" },
                },
                {
                  key: "service.version",
                  value: { stringValue: event.serverVersion || "unknown" },
                },
              ],
            },
            scopeSpans: [
              {
                scope: {
                  name: "mcpcat",
                  version: event.mcpcatVersion || "0.1.0",
                },
                spans: [span],
              },
            ],
          },
        ],
      };

      // Use JSON format for now
      const body = JSON.stringify(otlpRequest);

      // Use fetch to send the data
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body,
      });

      if (!response.ok) {
        throw new Error(
          `OTLP export failed: ${response.status} ${response.statusText}`,
        );
      }

      writeToLog(`Successfully exported event to OTLP: ${event.id}`);
    } catch (error) {
      throw new Error(`OTLP export error: ${error}`);
    }
  }

  private convertToOTLPSpan(event: Event): any {
    const startTimeNanos = event.timestamp
      ? BigInt(event.timestamp.getTime()) * BigInt(1_000_000)
      : BigInt(Date.now()) * BigInt(1_000_000);

    const endTimeNanos = event.duration
      ? startTimeNanos + BigInt(event.duration) * BigInt(1_000_000)
      : startTimeNanos;

    return {
      traceId: this.generateTraceId(event.sessionId),
      spanId: this.generateSpanId(event.id),
      name: event.eventType || "mcp.event",
      kind: 2, // SPAN_KIND_SERVER
      startTimeUnixNano: startTimeNanos.toString(),
      endTimeUnixNano: endTimeNanos.toString(),
      attributes: [
        {
          key: "mcp.event_type",
          value: { stringValue: event.eventType || "" },
        },
        {
          key: "mcp.session_id",
          value: { stringValue: event.sessionId || "" },
        },
        {
          key: "mcp.project_id",
          value: { stringValue: event.projectId || "" },
        },
        {
          key: "mcp.resource_name",
          value: { stringValue: event.resourceName || "" },
        },
        {
          key: "mcp.actor_id",
          value: { stringValue: event.identifyActorGivenId || "anonymous" },
        },
        {
          key: "mcp.client_name",
          value: { stringValue: event.clientName || "" },
        },
        {
          key: "mcp.client_version",
          value: { stringValue: event.clientVersion || "" },
        },
      ].filter((attr) => attr.value.stringValue), // Remove empty attributes
      status: {
        code: event.isError ? 2 : 1, // ERROR : OK
      },
    };
  }

  private generateTraceId(sessionId?: string): string {
    // Generate a 32-character hex string (128 bits)
    if (sessionId) {
      // Use session ID as base for consistent trace grouping
      return this.padHex(sessionId.replace(/[^a-f0-9]/gi, ""), 32);
    }
    return this.randomHex(32);
  }

  private generateSpanId(eventId?: string): string {
    // Generate a 16-character hex string (64 bits)
    if (eventId) {
      return this.padHex(eventId.replace(/[^a-f0-9]/gi, ""), 16);
    }
    return this.randomHex(16);
  }

  private padHex(str: string, length: number): string {
    return str.padStart(length, "0").slice(-length);
  }

  private randomHex(length: number): string {
    // Use crypto for better randomness and performance
    const bytes = new Uint8Array(Math.ceil(length / 2));

    // Use crypto.getRandomValues for browser compatibility
    // or crypto.randomBytes in Node.js
    if (
      typeof globalThis.crypto !== "undefined" &&
      globalThis.crypto.getRandomValues
    ) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      // Fallback to Node.js crypto module
      const crypto = require("crypto");
      const buffer = crypto.randomBytes(Math.ceil(length / 2));
      bytes.set(buffer);
    }

    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, length);
  }
}
