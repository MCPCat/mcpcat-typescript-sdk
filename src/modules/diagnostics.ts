// src/modules/diagnostics.ts
import { createRequire } from "module";
import { setDiagnosticsSink } from "./logging.js";
import packageJson from "../../package.json" with { type: "json" };

let enabled = false;
let initialized = false;

interface OtlpAttribute {
  key: string;
  value: { stringValue: string };
}

let staticAttributes: OtlpAttribute[] = [];

function attr(key: string, value: string | undefined | null): OtlpAttribute[] {
  return value ? [{ key, value: { stringValue: String(value) } }] : [];
}

function loadNodeModule<T>(name: string): T | null {
  try {
    return createRequire(import.meta.url)(name) as T;
  } catch {
    return null;
  }
}

function computeInstallId(): string | null {
  try {
    const os = loadNodeModule<typeof import("os")>("os");
    const crypto = loadNodeModule<typeof import("crypto")>("crypto");
    if (!os || !crypto) return null;
    const seed = `${os.hostname?.() ?? ""}|${import.meta.url}`;
    return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

function buildStaticAttributes(projectId: string | null): OtlpAttribute[] {
  const out: OtlpAttribute[] = [];
  try {
    // Identity / traceability
    if (projectId) {
      out.push(...attr("mcpcat.project_id", projectId));
    } else {
      out.push(...attr("mcpcat.install_id", computeInstallId()));
    }

    // SDK
    out.push(...attr("mcpcat.sdk.language", "typescript"));
    out.push(...attr("mcpcat.sdk.version", packageJson.version));

    // Best-effort: resolved @modelcontextprotocol/sdk (peer dep) version.
    const mcpPkg = loadNodeModule<{ version?: string }>(
      "@modelcontextprotocol/sdk/package.json",
    );
    out.push(...attr("mcpcat.mcp_sdk.version", mcpPkg?.version));

    // Runtime
    const proc = globalThis.process;
    out.push(
      ...attr("process.runtime.name", proc?.versions?.node ? "node" : "other"),
    );
    out.push(...attr("process.runtime.version", proc?.version));
    out.push(
      ...attr("process.pid", proc?.pid != null ? String(proc.pid) : null),
    );

    // OS / host
    const os = loadNodeModule<typeof import("os")>("os");
    if (os) {
      out.push(...attr("os.type", os.platform?.()));
      out.push(...attr("os.version", os.release?.()));
      out.push(...attr("host.arch", os.arch?.()));
      out.push(
        ...attr("host.cpu.count", os.cpus ? String(os.cpus().length) : null),
      );
    }

    // Deploy/CI hints
    out.push(...attr("deployment.environment", proc?.env?.NODE_ENV));
  } catch {
    // best-effort; partial attributes are fine
  }
  return out;
}

export function _getStaticAttributesForTest(): OtlpAttribute[] {
  return staticAttributes;
}

interface OtlpLogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpAttribute[];
}

function inferSeverity(entry: string): { number: number; text: string } {
  if (entry.includes("Warning:")) return { number: 13, text: "WARN" };
  if (/fail|error/i.test(entry)) return { number: 17, text: "ERROR" };
  return { number: 9, text: "INFO" };
}

function buildRecord(entry: string): OtlpLogRecord {
  const sev = inferSeverity(entry);
  return {
    timeUnixNano: (BigInt(Date.now()) * BigInt(1_000_000)).toString(),
    severityNumber: sev.number,
    severityText: sev.text,
    body: { stringValue: entry },
    attributes: [],
  };
}

export function _buildRecordForTest(entry: string): OtlpLogRecord {
  return buildRecord(entry);
}

function envDisabled(): boolean {
  try {
    return !!globalThis.process?.env?.MCPCAT_DISABLE_DIAGNOSTICS;
  } catch {
    return false;
  }
}

export function initDiagnostics(opts: {
  projectId: string | null;
  disabled?: boolean;
}): void {
  try {
    if (initialized) return;
    initialized = true;
    enabled = !opts.disabled && !envDisabled();
    if (!enabled) return;
    staticAttributes = buildStaticAttributes(opts.projectId);
    setDiagnosticsSink(capture);
  } catch {
    // diagnostics init must never throw
  }
}

function capture(_entry: string): void {
  // Filled in by later tasks.
}

export function isDiagnosticsEnabled(): boolean {
  return enabled;
}

export function _resetDiagnosticsForTest(): void {
  enabled = false;
  initialized = false;
  staticAttributes = [];
  setDiagnosticsSink(null);
}
