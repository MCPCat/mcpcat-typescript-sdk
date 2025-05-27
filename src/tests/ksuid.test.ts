import { describe, it, expect } from "vitest";
import KSUID from "../thirdparty/ksuid/index.js";

describe("KSUID", () => {
  describe("Basic functionality", () => {
    it("should create a KSUID from randomSync", () => {
      const ksuid = KSUID.randomSync();
      expect(ksuid).toBeInstanceOf(KSUID);
      expect(ksuid.string).toHaveLength(27);
      expect(ksuid.raw).toBeInstanceOf(Buffer);
      expect(ksuid.raw.length).toBe(20);
    });

    it("should create a KSUID from random async", async () => {
      const ksuid = await KSUID.random();
      expect(ksuid).toBeInstanceOf(KSUID);
      expect(ksuid.string).toHaveLength(27);
      expect(ksuid.raw).toBeInstanceOf(Buffer);
      expect(ksuid.raw.length).toBe(20);
    });

    it("should create KSUIDs with different timestamps", () => {
      const time1 = Date.now();
      const time2 = time1 + 1000;

      const ksuid1 = KSUID.randomSync(time1);
      const ksuid2 = KSUID.randomSync(time2);

      // KSUID only stores second precision, so we need to floor to seconds
      expect(ksuid1.date.getTime()).toBe(Math.floor(time1 / 1000) * 1000);
      expect(ksuid2.date.getTime()).toBe(Math.floor(time2 / 1000) * 1000);
      expect(ksuid1.compare(ksuid2)).toBeLessThan(0);
    });
  });

  describe("fromParts", () => {
    it("should create KSUID from timestamp and payload", () => {
      const timeInMs = Date.now();
      const payload = Buffer.alloc(16, 42);

      const ksuid = KSUID.fromParts(timeInMs, payload);
      expect(ksuid.date.getTime()).toBe(Math.floor(timeInMs / 1000) * 1000);
      expect(ksuid.payload).toEqual(payload);
    });

    it("should throw error for invalid timestamp", () => {
      const payload = Buffer.alloc(16);
      expect(() => KSUID.fromParts(100, payload)).toThrow();
      expect(() => KSUID.fromParts(Date.now() + 1e15, payload)).toThrow();
    });

    it("should throw error for invalid payload", () => {
      const timeInMs = Date.now();
      expect(() => KSUID.fromParts(timeInMs, Buffer.alloc(15))).toThrow();
      expect(() => KSUID.fromParts(timeInMs, Buffer.alloc(17))).toThrow();
    });
  });

  describe("String encoding/parsing", () => {
    it("should encode and parse KSUID strings correctly", () => {
      const original = KSUID.randomSync();
      const encoded = original.string;
      const parsed = KSUID.parse(encoded);

      expect(parsed.equals(original)).toBe(true);
      expect(parsed.string).toBe(encoded);
    });

    it("should handle MIN and MAX string values", () => {
      const min = KSUID.parse(KSUID.MIN_STRING_ENCODED);
      const max = KSUID.parse(KSUID.MAX_STRING_ENCODED);

      expect(min.string).toBe(KSUID.MIN_STRING_ENCODED);
      expect(max.string).toBe(KSUID.MAX_STRING_ENCODED);
      expect(min.compare(max)).toBeLessThan(0);
    });

    it("should throw error for invalid string length", () => {
      expect(() => KSUID.parse("too_short")).toThrow();
      expect(() => KSUID.parse("way_too_long_string_for_ksuid")).toThrow();
    });
  });

  describe("Comparison and equality", () => {
    it("should compare KSUIDs correctly", () => {
      const ksuid1 = KSUID.randomSync(Date.now());
      const ksuid2 = KSUID.randomSync(Date.now() + 1000);

      expect(ksuid1.compare(ksuid2)).toBeLessThan(0);
      expect(ksuid2.compare(ksuid1)).toBeGreaterThan(0);
      expect(ksuid1.compare(ksuid1)).toBe(0);
    });

    it("should check equality correctly", () => {
      const ksuid1 = KSUID.randomSync();
      const ksuid2 = KSUID.parse(ksuid1.string);
      const ksuid3 = KSUID.randomSync();

      expect(ksuid1.equals(ksuid1)).toBe(true);
      expect(ksuid1.equals(ksuid2)).toBe(true);
      expect(ksuid1.equals(ksuid3)).toBe(false);
    });
  });

  describe("Buffer validation", () => {
    it("should validate buffers correctly", () => {
      expect(KSUID.isValid(Buffer.alloc(20))).toBe(true);
      expect(KSUID.isValid(Buffer.alloc(19))).toBe(false);
      expect(KSUID.isValid(Buffer.alloc(21))).toBe(false);
      expect(KSUID.isValid(null)).toBe(false);
      expect(KSUID.isValid("not a buffer")).toBe(false);
    });

    it("should throw error for invalid buffer in constructor", () => {
      expect(() => new KSUID(Buffer.alloc(19))).toThrow();
      expect(() => new KSUID(Buffer.alloc(21))).toThrow();
    });
  });

  describe("Serialization", () => {
    it("should serialize to JSON correctly", () => {
      const ksuid = KSUID.randomSync();
      const json = JSON.stringify(ksuid);
      const parsed = JSON.parse(json);

      expect(parsed).toBe(ksuid.string);
      expect(ksuid.toJSON()).toBe(ksuid.string);
    });

    it("should have proper toString representation", () => {
      const ksuid = KSUID.randomSync();
      const str = ksuid.toString();

      expect(str).toContain("KSUID");
      expect(str).toContain(ksuid.string);
    });
  });

  describe("Properties", () => {
    it("should have correct timestamp property", () => {
      const timeInMs = Date.now();
      const ksuid = KSUID.randomSync(timeInMs);

      // Timestamp is in seconds since KSUID epoch
      const expectedTimestamp = Math.floor((timeInMs - 14e11) / 1000);
      expect(ksuid.timestamp).toBe(expectedTimestamp);
    });

    it("should have correct date property", () => {
      const timeInMs = Date.now();
      const ksuid = KSUID.randomSync(timeInMs);

      expect(ksuid.date.getTime()).toBe(Math.floor(timeInMs / 1000) * 1000);
    });

    it("should have 16-byte payload", () => {
      const ksuid = KSUID.randomSync();
      expect(ksuid.payload.length).toBe(16);
      expect(Buffer.isBuffer(ksuid.payload)).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("should handle KSUID epoch boundary", () => {
      const epochTime = 14e11; // KSUID epoch
      const ksuid = KSUID.randomSync(epochTime);

      expect(ksuid.timestamp).toBe(0);
      expect(ksuid.date.getTime()).toBe(epochTime);
    });

    it("should create unique KSUIDs", () => {
      const ksuids = Array.from({ length: 100 }, () => KSUID.randomSync());
      const strings = ksuids.map((k) => k.string);
      const uniqueStrings = new Set(strings);

      expect(uniqueStrings.size).toBe(strings.length);
    });
  });

  describe("Prefix functionality", () => {
    it("should create prefixed KSUIDs with randomSync", () => {
      const eventKsuid = KSUID.withPrefix("event");
      const id = eventKsuid.randomSync();

      expect(typeof id).toBe("string");
      expect(id).toMatch(/^event_[0-9A-Za-z]{27}$/);
    });

    it("should create prefixed KSUIDs with random async", async () => {
      const userKsuid = KSUID.withPrefix("user");
      const id = await userKsuid.random();

      expect(typeof id).toBe("string");
      expect(id).toMatch(/^user_[0-9A-Za-z]{27}$/);
    });

    it("should create prefixed KSUIDs with fromParts", () => {
      const taskKsuid = KSUID.withPrefix("task");
      const timeInMs = Date.now();
      const payload = Buffer.alloc(16, 42);

      const id = taskKsuid.fromParts(timeInMs, payload);
      expect(typeof id).toBe("string");
      expect(id).toMatch(/^task_[0-9A-Za-z]{27}$/);
    });

    it("should handle different prefixes", () => {
      const prefixes = ["event", "user", "task", "session", "req"];

      prefixes.forEach((prefix) => {
        const prefixedKsuid = KSUID.withPrefix(prefix);
        const id = prefixedKsuid.randomSync();
        expect(id).toMatch(new RegExp(`^${prefix}_[0-9A-Za-z]{27}$`));
      });
    });

    it("should create unique prefixed KSUIDs", () => {
      const eventKsuid = KSUID.withPrefix("event");
      const ids = Array.from({ length: 10 }, () => eventKsuid.randomSync());
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
      ids.forEach((id) => {
        expect(id).toMatch(/^event_[0-9A-Za-z]{27}$/);
      });
    });
  });
});
