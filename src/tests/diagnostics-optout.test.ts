// src/tests/diagnostics-optout.test.ts
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  initDiagnostics,
  isDiagnosticsEnabled,
  _resetDiagnosticsForTest,
} from "../modules/diagnostics.js";

describe("diagnostics opt-out", () => {
  beforeEach(() => _resetDiagnosticsForTest());
  afterEach(() => {
    _resetDiagnosticsForTest();
    delete process.env.DISABLE_DIAGNOSTICS;
  });

  it("is enabled by default", () => {
    initDiagnostics({ projectId: "proj_1" });
    expect(isDiagnosticsEnabled()).toBe(true);
  });

  it("is disabled via the option", () => {
    initDiagnostics({ projectId: "proj_1", disabled: true });
    expect(isDiagnosticsEnabled()).toBe(false);
  });

  it("is disabled via the env var", () => {
    process.env.DISABLE_DIAGNOSTICS = "1";
    initDiagnostics({ projectId: "proj_1" });
    expect(isDiagnosticsEnabled()).toBe(false);
  });
});
