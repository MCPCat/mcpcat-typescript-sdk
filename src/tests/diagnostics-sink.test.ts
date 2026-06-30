import { describe, it, expect, afterEach } from "vitest";
import { writeToLog, setDiagnosticsSink } from "../modules/logging.js";

describe("logging diagnostics sink", () => {
  afterEach(() => setDiagnosticsSink(null));

  it("forwards every log entry to a registered sink", () => {
    const seen: string[] = [];
    setDiagnosticsSink((entry) => seen.push(entry));
    writeToLog("hello world");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("hello world");
  });

  it("never throws when the sink throws", () => {
    setDiagnosticsSink(() => {
      throw new Error("sink boom");
    });
    expect(() => writeToLog("still fine")).not.toThrow();
  });

  it("stops forwarding after the sink is cleared", () => {
    const seen: string[] = [];
    setDiagnosticsSink((entry) => seen.push(entry));
    setDiagnosticsSink(null);
    writeToLog("ignored");
    expect(seen).toHaveLength(0);
  });
});
