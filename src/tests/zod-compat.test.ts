import { describe, it, expect } from "vitest";
import {
  isZodSchema,
  isZ4Schema,
  isShorthandZodSyntax,
  getObjectShape,
  getLiteralValue,
  schemaHasProperty,
  extendObjectSchema,
} from "../modules/zod-compat";
import { z } from "zod";

describe("Zod Compatibility Layer", () => {
  describe("isZodSchema", () => {
    it("should detect Zod object schemas", () => {
      const schema = z.object({ a: z.number() });
      expect(isZodSchema(schema)).toBe(true);
    });

    it("should detect Zod string schemas", () => {
      const schema = z.string();
      expect(isZodSchema(schema)).toBe(true);
    });

    it("should detect Zod number schemas", () => {
      const schema = z.number();
      expect(isZodSchema(schema)).toBe(true);
    });

    it("should detect Zod array schemas", () => {
      const schema = z.array(z.string());
      expect(isZodSchema(schema)).toBe(true);
    });

    it("should not detect plain objects as Zod schemas", () => {
      expect(isZodSchema({ a: 1 })).toBe(false);
    });

    it("should not detect null/undefined as Zod schemas", () => {
      expect(isZodSchema(null)).toBe(false);
      expect(isZodSchema(undefined)).toBe(false);
    });

    it("should not detect arrays as Zod schemas", () => {
      expect(isZodSchema([1, 2, 3])).toBe(false);
    });

    it("should not detect JSON Schema objects as Zod schemas", () => {
      const jsonSchema = {
        type: "object",
        properties: { a: { type: "number" } },
      };
      expect(isZodSchema(jsonSchema)).toBe(false);
    });
  });

  describe("isZ4Schema", () => {
    it("should return false for Zod v3 schemas (current installed version)", () => {
      // With Zod v3 installed, all schemas should return false for isZ4Schema
      const schema = z.object({ a: z.number() });
      expect(isZ4Schema(schema)).toBe(false);
    });

    it("should return false for null/undefined", () => {
      expect(isZ4Schema(null)).toBe(false);
      expect(isZ4Schema(undefined)).toBe(false);
    });

    it("should return false for plain objects", () => {
      expect(isZ4Schema({ a: 1 })).toBe(false);
    });
  });

  describe("isShorthandZodSyntax", () => {
    it("should detect shorthand Zod syntax", () => {
      const shorthand = { a: z.number(), b: z.string() };
      expect(isShorthandZodSyntax(shorthand)).toBe(true);
    });

    it("should detect shorthand with mixed Zod types", () => {
      const shorthand = {
        name: z.string(),
        count: z.number(),
        active: z.boolean(),
      };
      expect(isShorthandZodSyntax(shorthand)).toBe(true);
    });

    it("should not detect z.object as shorthand", () => {
      const schema = z.object({ a: z.number() });
      expect(isShorthandZodSyntax(schema)).toBe(false);
    });

    it("should not detect plain objects as shorthand", () => {
      expect(isShorthandZodSyntax({ a: 1, b: "test" })).toBe(false);
    });

    it("should not detect arrays as shorthand", () => {
      expect(isShorthandZodSyntax([z.number()])).toBe(false);
    });

    it("should not detect null/undefined as shorthand", () => {
      expect(isShorthandZodSyntax(null)).toBe(false);
      expect(isShorthandZodSyntax(undefined)).toBe(false);
    });

    it("should not detect JSON Schema as shorthand", () => {
      const jsonSchema = {
        type: "object",
        properties: { a: { type: "number" } },
      };
      expect(isShorthandZodSyntax(jsonSchema)).toBe(false);
    });
  });

  describe("getObjectShape", () => {
    it("should extract shape from Zod object schema", () => {
      const schema = z.object({ a: z.number(), b: z.string() });
      const shape = getObjectShape(schema);
      expect(shape).toBeDefined();
      expect("a" in shape!).toBe(true);
      expect("b" in shape!).toBe(true);
    });

    it("should return undefined for non-object Zod schemas", () => {
      const schema = z.string();
      expect(getObjectShape(schema)).toBeUndefined();
    });

    it("should return undefined for null", () => {
      expect(getObjectShape(null)).toBeUndefined();
    });

    it("should return undefined for undefined", () => {
      expect(getObjectShape(undefined)).toBeUndefined();
    });

    it("should return undefined for plain objects", () => {
      // Plain objects don't have a Zod shape
      expect(getObjectShape({ a: 1 })).toBeUndefined();
    });
  });

  describe("getLiteralValue", () => {
    it("should extract literal string value", () => {
      const schema = z.literal("test");
      expect(getLiteralValue(schema)).toBe("test");
    });

    it("should extract literal number value", () => {
      const schema = z.literal(42);
      expect(getLiteralValue(schema)).toBe(42);
    });

    it("should extract literal boolean value", () => {
      const schema = z.literal(true);
      expect(getLiteralValue(schema)).toBe(true);
    });

    it("should return undefined for non-literal schemas", () => {
      const schema = z.string();
      expect(getLiteralValue(schema)).toBeUndefined();
    });

    it("should return undefined for null/undefined", () => {
      expect(getLiteralValue(null)).toBeUndefined();
      expect(getLiteralValue(undefined)).toBeUndefined();
    });
  });

  describe("schemaHasProperty", () => {
    it("should detect existing properties", () => {
      const schema = z.object({ a: z.number(), b: z.string() });
      expect(schemaHasProperty(schema, "a")).toBe(true);
      expect(schemaHasProperty(schema, "b")).toBe(true);
    });

    it("should return false for non-existing properties", () => {
      const schema = z.object({ a: z.number() });
      expect(schemaHasProperty(schema, "b")).toBe(false);
      expect(schemaHasProperty(schema, "nonexistent")).toBe(false);
    });

    it("should return false for non-object schemas", () => {
      const schema = z.string();
      expect(schemaHasProperty(schema, "a")).toBe(false);
    });

    it("should return false for null/undefined", () => {
      expect(schemaHasProperty(null, "a")).toBe(false);
      expect(schemaHasProperty(undefined, "a")).toBe(false);
    });
  });

  describe("extendObjectSchema", () => {
    it("should extend Zod object schema with new properties", () => {
      const original = z.object({ a: z.number() });
      const extended = extendObjectSchema(original, {
        context: z.string(),
      });

      expect(isZodSchema(extended)).toBe(true);
      expect(schemaHasProperty(extended, "a")).toBe(true);
      expect(schemaHasProperty(extended, "context")).toBe(true);
    });

    it("should extend shorthand syntax", () => {
      const shorthand = { a: z.number() };
      const extended = extendObjectSchema(shorthand, {
        context: z.string(),
      });

      expect(isZodSchema(extended)).toBe(true);
      expect(schemaHasProperty(extended, "a")).toBe(true);
      expect(schemaHasProperty(extended, "context")).toBe(true);
    });

    it("should preserve all original properties when extending", () => {
      const original = z.object({
        a: z.number(),
        b: z.string(),
        c: z.boolean(),
      });
      const extended = extendObjectSchema(original, {
        d: z.array(z.string()),
      });

      expect(schemaHasProperty(extended, "a")).toBe(true);
      expect(schemaHasProperty(extended, "b")).toBe(true);
      expect(schemaHasProperty(extended, "c")).toBe(true);
      expect(schemaHasProperty(extended, "d")).toBe(true);
    });

    it("should not modify the original schema", () => {
      const original = z.object({ a: z.number() });
      extendObjectSchema(original, { context: z.string() });

      // Original should not have context
      expect(schemaHasProperty(original, "context")).toBe(false);
    });

    it("should return non-Zod schemas unchanged", () => {
      const notZod = { type: "object", properties: {} };
      const result = extendObjectSchema(notZod, { context: z.string() });

      // Should return the same object reference
      expect(result).toBe(notZod);
    });

    it("should create valid Zod schema that can parse data", () => {
      const original = z.object({ a: z.number() });
      const extended = extendObjectSchema(original, {
        context: z.string(),
      }) as z.ZodObject<any>;

      // Should be able to parse valid data
      const result = extended.safeParse({ a: 42, context: "test" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.a).toBe(42);
        expect(result.data.context).toBe("test");
      }
    });

    it("should create schema that rejects invalid data", () => {
      const original = z.object({ a: z.number() });
      const extended = extendObjectSchema(original, {
        context: z.string(),
      }) as z.ZodObject<any>;

      // Should reject when context is wrong type
      const result = extended.safeParse({ a: 42, context: 123 });
      expect(result.success).toBe(false);
    });
  });
});
