// src/modules/diagnostics.ts
import { setDiagnosticsSink } from "./logging.js";

let enabled = false;
let initialized = false;

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
  setDiagnosticsSink(null);
}
