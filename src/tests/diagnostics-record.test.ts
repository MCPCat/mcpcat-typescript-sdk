// src/tests/diagnostics-record.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initDiagnostics,
  _buildRecordForTest,
  _resetDiagnosticsForTest,
} from "../modules/diagnostics.js";

describe("diagnostics record building", () => {
  beforeEach(() => {
    _resetDiagnosticsForTest();
    initDiagnostics({ projectId: "proj_1" });
  });
  afterEach(() => _resetDiagnosticsForTest());

  it("carries the raw message as the body, verbatim", () => {
    const rec = _buildRecordForTest("[2026-01-01T00:00:00Z] Warning: boom");
    expect(rec.body.stringValue).toBe("[2026-01-01T00:00:00Z] Warning: boom");
  });

  it("infers severity from message content", () => {
    expect(_buildRecordForTest("Warning: x").severityText).toBe("WARN");
    expect(_buildRecordForTest("Failed to send event").severityText).toBe(
      "ERROR",
    );
    expect(_buildRecordForTest("Some error happened").severityText).toBe(
      "ERROR",
    );
    expect(_buildRecordForTest("Initialized telemetry").severityText).toBe(
      "INFO",
    );
  });

  it("sets a nanosecond timestamp string", () => {
    const rec = _buildRecordForTest("hello");
    expect(rec.timeUnixNano).toMatch(/^\d+$/);
  });
});
