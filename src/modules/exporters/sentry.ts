import { Event, Exporter } from "../../types.js";
import { writeToLog } from "../logging.js";

export interface SentryExporterConfig {
  type: "sentry";
  dsn: string;
  environment?: string;
  release?: string;
}

interface ParsedDSN {
  protocol: string;
  publicKey: string;
  host: string;
  port?: string;
  path: string;
  projectId: string;
}

interface SentryTransaction {
  type: "transaction";
  event_id: string;
  timestamp: number;
  start_timestamp: number;
  transaction: string;
  contexts: {
    trace: {
      trace_id: string;
      span_id: string;
      op: string;
      status?: "ok" | "internal_error";
    };
  };
  spans?: Array<{
    span_id: string;
    trace_id: string;
    parent_span_id?: string;
    op: string;
    description?: string;
    start_timestamp: number;
    timestamp: number;
    status?: "ok" | "internal_error";
  }>;
  tags?: Record<string, string>;
  extra?: Record<string, any>;
}

export class SentryExporter implements Exporter {
  private endpoint: string;
  private authHeader: string;
  private config: SentryExporterConfig;
  private parsedDSN: ParsedDSN;

  constructor(config: SentryExporterConfig) {
    this.config = config;
    this.parsedDSN = this.parseDSN(config.dsn);

    // Build envelope endpoint
    this.endpoint = `${this.parsedDSN.protocol}://${this.parsedDSN.host}${
      this.parsedDSN.port ? `:${this.parsedDSN.port}` : ""
    }${this.parsedDSN.path}/api/${this.parsedDSN.projectId}/envelope/`;

    // Build auth header
    this.authHeader = `Sentry sentry_version=7, sentry_client=mcpcat/1.0.0, sentry_key=${this.parsedDSN.publicKey}`;

    writeToLog(`SentryExporter: Initialized with endpoint ${this.endpoint}`);
  }

  private parseDSN(dsn: string): ParsedDSN {
    // DSN format: protocol://publicKey@host[:port]/path/projectId
    const regex = /^(https?):\/\/([a-f0-9]+)@([\w.-]+)(:\d+)?(\/.*)?\/(\d+)$/;
    const match = dsn.match(regex);

    if (!match) {
      throw new Error(`Invalid Sentry DSN: ${dsn}`);
    }

    return {
      protocol: match[1],
      publicKey: match[2],
      host: match[3],
      port: match[4]?.substring(1), // Remove leading ':'
      path: match[5] || "",
      projectId: match[6],
    };
  }

  async export(event: Event): Promise<void> {
    try {
      const transaction = this.eventToTransaction(event);
      const envelope = this.createEnvelope(transaction);

      writeToLog(
        `SentryExporter: Sending transaction ${transaction.event_id} to Sentry`,
      );

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "X-Sentry-Auth": this.authHeader,
          "Content-Type": "application/x-sentry-envelope",
        },
        body: envelope,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        writeToLog(
          `Sentry export failed - Status: ${response.status}, Body: ${errorBody}`,
        );
      } else {
        writeToLog(`Sentry export success - Event: ${event.id}`);
      }
    } catch (error) {
      writeToLog(`Sentry export error: ${error}`);
    }
  }

  private eventToTransaction(event: Event): SentryTransaction {
    // Calculate timestamps
    const endTimestamp = event.timestamp
      ? new Date(event.timestamp).getTime() / 1000
      : Date.now() / 1000;

    const startTimestamp = event.duration
      ? endTimestamp - event.duration / 1000
      : endTimestamp;

    const traceId = this.generateTraceId(event.sessionId);
    const spanId = this.generateSpanId(event.id);

    // Build transaction name
    const transactionName = event.resourceName
      ? `${event.eventType || "mcp"} - ${event.resourceName}`
      : event.eventType || "mcp.event";

    const transaction: SentryTransaction = {
      type: "transaction",
      event_id: this.generateEventId(event.id),
      timestamp: endTimestamp,
      start_timestamp: startTimestamp,
      transaction: transactionName,
      contexts: {
        trace: {
          trace_id: traceId,
          span_id: spanId,
          op: event.eventType || "mcp.event",
          status: event.isError ? "internal_error" : "ok",
        },
      },
      tags: this.buildTags(event),
      extra: this.buildExtra(event),
    };

    return transaction;
  }

  private buildTags(event: Event): Record<string, string> {
    const tags: Record<string, string> = {};

    if (this.config.environment) tags.environment = this.config.environment;
    if (this.config.release) tags.release = this.config.release;
    if (event.eventType) tags.event_type = event.eventType;
    if (event.resourceName) tags.resource = event.resourceName;
    if (event.serverName) tags.server_name = event.serverName;
    if (event.clientName) tags.client_name = event.clientName;
    if (event.identifyActorGivenId) tags.actor_id = event.identifyActorGivenId;

    return tags;
  }

  private buildExtra(event: Event): Record<string, any> {
    const extra: Record<string, any> = {};

    if (event.sessionId) extra.session_id = event.sessionId;
    if (event.projectId) extra.project_id = event.projectId;
    if (event.userIntent) extra.user_intent = event.userIntent;
    if (event.identifyActorName) extra.actor_name = event.identifyActorName;
    if (event.serverVersion) extra.server_version = event.serverVersion;
    if (event.clientVersion) extra.client_version = event.clientVersion;
    if (event.duration !== undefined) extra.duration_ms = event.duration;
    if (event.error) extra.error = event.error;

    return extra;
  }

  private createEnvelope(transaction: SentryTransaction): string {
    // Envelope header
    const envelopeHeader = {
      event_id: transaction.event_id,
      sent_at: new Date().toISOString(),
    };

    // Item header for transaction
    const itemHeader = {
      type: "transaction",
    };

    // Build envelope (newline-separated JSON)
    return [
      JSON.stringify(envelopeHeader),
      JSON.stringify(itemHeader),
      JSON.stringify(transaction),
    ].join("\n");
  }

  private generateEventId(eventId?: string): string {
    // Sentry expects 32 character hex string without dashes
    if (eventId) {
      return this.toHex32(eventId);
    }
    return this.randomHex(32);
  }

  private generateTraceId(sessionId?: string): string {
    // 32 character hex string for trace ID
    if (sessionId) {
      return this.toHex32(sessionId);
    }
    return this.randomHex(32);
  }

  private generateSpanId(eventId?: string): string {
    // 16 character hex string for span ID
    if (eventId) {
      return this.toHex16(eventId);
    }
    return this.randomHex(16);
  }

  private toHex32(str: string): string {
    // Convert string to 32 character hex
    const clean = str.replace(/[^a-f0-9]/gi, "").toLowerCase();
    if (clean.length >= 32) {
      return clean.substring(0, 32);
    }
    // Pad with deterministic hash if too short
    return (clean + this.simpleHash(str)).padEnd(32, "0").substring(0, 32);
  }

  private toHex16(str: string): string {
    // Convert string to 16 character hex
    const clean = str.replace(/[^a-f0-9]/gi, "").toLowerCase();
    if (clean.length >= 16) {
      return clean.substring(0, 16);
    }
    // Pad with deterministic hash if too short
    return (clean + this.simpleHash(str)).padEnd(16, "0").substring(0, 16);
  }

  private simpleHash(str: string): string {
    // Simple deterministic hash for padding
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private randomHex(length: number): string {
    let result = "";
    const chars = "0123456789abcdef";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * 16)];
    }
    return result;
  }
}
