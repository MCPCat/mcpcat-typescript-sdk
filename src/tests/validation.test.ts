import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logging before importing validation
vi.mock("../modules/logging.js", () => ({
  writeToLog: vi.fn(),
}));

import { validateTags } from "../modules/validation.js";
import { writeToLog } from "../modules/logging.js";

describe("validateTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass through valid tags unchanged", () => {
    const tags = {
      env: "production",
      trace_id: "abc-123",
      region: "us-east-1",
    };
    expect(validateTags(tags)).toEqual(tags);
  });

  it("should return null for empty object", () => {
    expect(validateTags({})).toBeNull();
  });

  it("should drop keys with invalid characters", () => {
    const tags = {
      valid_key: "value",
      "invalid!key": "value",
      "good.key": "value",
    };
    const result = validateTags(tags);
    expect(result).toEqual({ valid_key: "value", "good.key": "value" });
    expect(writeToLog).toHaveBeenCalledWith(
      expect.stringContaining("invalid!key"),
    );
  });

  it("should drop keys longer than 32 characters", () => {
    const longKey = "a".repeat(33);
    const tags = { [longKey]: "value", short: "value" };
    const result = validateTags(tags);
    expect(result).toEqual({ short: "value" });
    expect(writeToLog).toHaveBeenCalledWith(
      expect.stringContaining("exceeds max length"),
    );
  });

  it("should drop values longer than 200 characters", () => {
    const longValue = "a".repeat(201);
    const tags = { key1: longValue, key2: "short" };
    const result = validateTags(tags);
    expect(result).toEqual({ key2: "short" });
    expect(writeToLog).toHaveBeenCalledWith(
      expect.stringContaining("exceeds max length"),
    );
  });

  it("should drop values containing newlines", () => {
    const tags = { key1: "has\nnewline", key2: "clean" };
    const result = validateTags(tags);
    expect(result).toEqual({ key2: "clean" });
    expect(writeToLog).toHaveBeenCalledWith(expect.stringContaining("newline"));
  });

  it("should drop non-string values at runtime", () => {
    const tags = { key1: 123, key2: "valid" } as any;
    const result = validateTags(tags);
    expect(result).toEqual({ key2: "valid" });
    expect(writeToLog).toHaveBeenCalledWith(
      expect.stringContaining("non-string"),
    );
  });

  it("should drop empty string keys", () => {
    const tags = { "": "empty-key-value", valid: "value" };
    const result = validateTags(tags);
    expect(result).toEqual({ valid: "value" });
  });

  it("should keep only first 50 entries when exceeding limit", () => {
    const tags: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      tags[`key${String(i).padStart(3, "0")}`] = `value${i}`;
    }
    const result = validateTags(tags);
    expect(result).not.toBeNull();
    expect(Object.keys(result!).length).toBe(50);
    expect(writeToLog).toHaveBeenCalledWith(
      expect.stringContaining("Dropping 10"),
    );
  });

  it("should return null when all entries are invalid", () => {
    const tags = { "!!!": "value", "###": "value" };
    expect(validateTags(tags)).toBeNull();
  });

  it("should allow keys with periods, colons, dashes, spaces, and dollar signs", () => {
    const tags = {
      "my.tag": "value",
      "my:tag": "value",
      "my-tag": "value",
      "my tag": "value",
      $ai_trace_id: "trace-1",
      my$key: "value",
    };
    expect(validateTags(tags)).toEqual(tags);
  });
});
