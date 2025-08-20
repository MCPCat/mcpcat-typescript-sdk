import {
  Configuration,
  EventsApi,
  PublishEventRequest,
  PublishEventRequestEventTypeEnum,
} from "mcpcat-api";
import { Event, UnredactedEvent, MCPServerLike } from "../types.js";
import { writeToLog } from "./logging.js";
import { getServerTrackingData } from "./internal.js";
import { getSessionInfo } from "./session.js";
import { redactEvent } from "./redaction.js";
import KSUID from "../thirdparty/ksuid/index.js";
import { getMCPCompatibleErrorMessage } from "./compatibility.js";
import { TelemetryManager } from "./telemetry.js";

class EventQueue {
  private queue: UnredactedEvent[] = [];
  private processing = false;
  private maxRetries = 3;
  private maxQueueSize = 10000; // Prevent unbounded growth
  private concurrency = 5; // Max parallel requests
  private activeRequests = 0;
  private apiClient: EventsApi;
  private telemetryManager?: TelemetryManager;

  constructor() {
    const config = new Configuration({ basePath: "https://api.mcpcat.io" });
    this.apiClient = new EventsApi(config);
  }

  setTelemetryManager(telemetryManager: TelemetryManager): void {
    this.telemetryManager = telemetryManager;
  }

  add(event: UnredactedEvent): void {
    // Drop oldest events if queue is full (or implement your preferred strategy)
    if (this.queue.length >= this.maxQueueSize) {
      writeToLog("Event queue full, dropping oldest event");
      this.queue.shift();
    }

    this.queue.push(event);
    this.process();
  }

  private async process(): Promise<void> {
    if (this.processing) return;

    this.processing = true;

    while (this.queue.length > 0 && this.activeRequests < this.concurrency) {
      const event = this.queue.shift();
      if (event?.redactionFn) {
        // Redact sensitive information if a redaction function is provided
        try {
          const redactedEvent = await redactEvent(event, event.redactionFn);
          event.redactionFn = undefined; // Clear the function to avoid reprocessing
          Object.assign(event, redactedEvent);
        } catch (error) {
          writeToLog(`Failed to redact event: ${error}`);
          continue; // Skip this event if redaction fails
        }
      }

      if (event) {
        event.id = event.id || (await KSUID.withPrefix("evt").random());
        this.activeRequests++;
        this.sendEvent(event as Event).finally(() => {
          this.activeRequests--;
          // Try to process more events
          this.process();
        });
      }
    }

    this.processing = false;
  }

  private toPublishEventRequest(event: Event): PublishEventRequest {
    return {
      // Core fields
      id: event.id,
      projectId: event.projectId,
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      duration: event.duration,

      // Event data
      eventType: event.eventType as PublishEventRequestEventTypeEnum,
      resourceName: event.resourceName,
      parameters: event.parameters,
      response: event.response,
      userIntent: event.userIntent,
      isError: event.isError,
      error: event.error,

      // Actor fields
      identifyActorGivenId: event.identifyActorGivenId,
      identifyActorName: event.identifyActorName,
      identifyData: event.identifyActorData,

      // Session info
      ipAddress: event.ipAddress,
      sdkLanguage: event.sdkLanguage,
      mcpcatVersion: event.mcpcatVersion,
      serverName: event.serverName,
      serverVersion: event.serverVersion,
      clientName: event.clientName,
      clientVersion: event.clientVersion,

      // Legacy fields
      actorId: event.actorId || event.identifyActorGivenId,
      eventId: event.eventId,
    };
  }

  private async sendEvent(event: Event, retries = 0): Promise<void> {
    // Export to telemetry if configured (fire-and-forget)
    if (this.telemetryManager) {
      this.telemetryManager.export(event).catch((error) => {
        writeToLog(
          `Telemetry export error: ${getMCPCompatibleErrorMessage(error)}`,
        );
      });
    }

    // Send to MCPCat API if projectId is provided
    if (event.projectId) {
      try {
        const publishRequest = this.toPublishEventRequest(event);
        await this.apiClient.publishEvent({
          publishEventRequest: publishRequest,
        });
        writeToLog(
          `Successfully sent event ${event.id} | ${event.eventType} | ${event.projectId} | ${event.duration} ms | ${event.identifyActorGivenId || "anonymous"}`,
        );
        writeToLog(`Event details: ${JSON.stringify(event)}`);
      } catch (error) {
        writeToLog(
          `Failed to send event ${event.id}, retrying... [Error: ${getMCPCompatibleErrorMessage(error)}]`,
        );
        if (retries < this.maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          await this.delay(Math.pow(2, retries) * 1000);
          return this.sendEvent(event, retries + 1);
        }
        throw error;
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Get queue stats for monitoring
  getStats() {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      isProcessing: this.processing,
    };
  }

  // Graceful shutdown - wait for active requests
  async destroy(): Promise<void> {
    // Stop accepting new events
    this.add = () => {
      writeToLog("Queue is shutting down, event dropped");
    };

    // Wait for queue to drain (with timeout)
    const timeout = 5000; // 5 seconds
    const start = Date.now();

    while (
      (this.queue.length > 0 || this.activeRequests > 0) &&
      Date.now() - start < timeout
    ) {
      await this.delay(100);
    }

    if (this.queue.length > 0) {
      writeToLog(
        `Shutting down with ${this.queue.length} events still in queue`,
      );
    }
  }
}

export const eventQueue = new EventQueue();
process.once("SIGINT", () => eventQueue.destroy());
process.once("SIGTERM", () => eventQueue.destroy());
process.once("beforeExit", () => eventQueue.destroy());

export function setTelemetryManager(telemetryManager: TelemetryManager): void {
  eventQueue.setTelemetryManager(telemetryManager);
}

export function publishEvent(
  server: MCPServerLike,
  eventInput: UnredactedEvent,
): void {
  const data = getServerTrackingData(server);
  if (!data) {
    writeToLog(
      "Warning: Server tracking data not found. Event will not be published.",
    );
    return;
  }

  const sessionInfo = getSessionInfo(server, data);

  // Calculate duration if not provided
  const duration =
    eventInput.duration ||
    (eventInput.timestamp
      ? new Date().getTime() - eventInput.timestamp.getTime()
      : undefined);

  // Build complete Event object with all fields explicit
  const fullEvent: UnredactedEvent = {
    // Core fields (id will be generated later in the queue)
    id: eventInput.id || "",
    sessionId: eventInput.sessionId || data.sessionId,
    projectId: data.projectId,

    // Event metadata
    eventType: eventInput.eventType || "",
    timestamp: eventInput.timestamp || new Date(),
    duration: duration,

    // Session context from sessionInfo
    ipAddress: sessionInfo.ipAddress,
    sdkLanguage: sessionInfo.sdkLanguage,
    mcpcatVersion: sessionInfo.mcpcatVersion,
    serverName: sessionInfo.serverName,
    serverVersion: sessionInfo.serverVersion,
    clientName: sessionInfo.clientName,
    clientVersion: sessionInfo.clientVersion,

    // Actor information from sessionInfo
    identifyActorGivenId: sessionInfo.identifyActorGivenId,
    identifyActorName: sessionInfo.identifyActorName,
    identifyActorData: sessionInfo.identifyActorData,

    // Event-specific data from input
    resourceName: eventInput.resourceName,
    parameters: eventInput.parameters,
    response: eventInput.response,
    userIntent: eventInput.userIntent,
    isError: eventInput.isError,
    error: eventInput.error,

    // Preserve redaction function
    redactionFn: eventInput.redactionFn,
  };

  eventQueue.add(fullEvent);
}
