import { Event, Exporter, ExporterConfig } from "../types.js";
import { writeToLog } from "./logging.js";
import { OTLPExporter } from "./exporters/otlp.js";
import { DatadogExporter } from "./exporters/datadog.js";
import { SentryExporter } from "./exporters/sentry.js";

export class TelemetryManager {
  private exporters: Map<string, Exporter> = new Map();

  constructor(exporterConfigs?: Record<string, ExporterConfig>) {
    if (!exporterConfigs) return;

    for (const [name, config] of Object.entries(exporterConfigs)) {
      try {
        const exporter = this.createExporter(name, config);
        if (exporter) {
          this.exporters.set(name, exporter);
          writeToLog(`Initialized telemetry exporter: ${name}`);
        }
      } catch (error) {
        writeToLog(`Failed to initialize exporter ${name}: ${error}`);
      }
    }
  }

  private createExporter(
    name: string,
    config: ExporterConfig,
  ): Exporter | null {
    switch (config.type) {
      case "console":
        return new ConsoleExporter();
      case "otlp":
        return new OTLPExporter(config as any);
      case "datadog":
        return new DatadogExporter(config as any);
      case "sentry":
        return new SentryExporter(config as any);
      default:
        writeToLog(`Unknown exporter type: ${config.type}`);
        return null;
    }
  }

  async export(event: Event): Promise<void> {
    if (this.exporters.size === 0) return;

    // Fire-and-forget pattern for each exporter
    for (const [name, exporter] of this.exporters) {
      exporter.export(event).catch((error) => {
        writeToLog(`Telemetry export failed for ${name}: ${error}`);
      });
    }
  }

  getExporterCount(): number {
    return this.exporters.size;
  }
}

// Simple console exporter for testing
class ConsoleExporter implements Exporter {
  async export(event: Event): Promise<void> {
    console.error("[MCPCat Telemetry]", JSON.stringify(event, null, 2));
  }
}
