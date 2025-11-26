/**
 * zod-compat.ts
 * Minimal Zod v3/v4 compatibility layer for mcpcat
 * Based on patterns from @modelcontextprotocol/sdk
 */

import { z } from "zod";

// --- Internal property access helpers ---
// These types help us safely access internal properties that differ between v3 and v4

interface ZodV3Internal {
  _def?: {
    typeName?: string;
    value?: unknown;
    shape?: Record<string, unknown> | (() => Record<string, unknown>);
    description?: string;
  };
  shape?: Record<string, unknown> | (() => Record<string, unknown>);
}

interface ZodV4Internal {
  _zod?: {
    def?: {
      typeName?: string;
      value?: unknown;
      shape?: Record<string, unknown> | (() => Record<string, unknown>);
      description?: string;
    };
  };
}

/**
 * Detect if something is a Zod v4 schema
 * V4 schemas have `_zod` property; V3 schemas do not
 */
export function isZ4Schema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  return !!(schema as ZodV4Internal)._zod;
}

/**
 * Detect if something is a Zod schema (either v3 or v4)
 */
export function isZodSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;

  const asV3 = schema as ZodV3Internal;
  const asV4 = schema as ZodV4Internal;

  // Check for v3 (_def) or v4 (_zod) internal properties
  const hasInternals = asV3._def !== undefined || asV4._zod !== undefined;

  // Also require parse method to distinguish from raw shapes
  const hasParse = typeof (schema as { parse?: unknown }).parse === "function";

  return hasInternals && hasParse;
}

/**
 * Detect if it's shorthand Zod syntax (object with z.* values)
 * e.g., { a: z.number(), b: z.string() }
 */
export function isShorthandZodSyntax(schema: unknown): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }

  // If it's already a full Zod schema, it's not shorthand
  if (isZodSchema(schema)) {
    return false;
  }

  // Check if any value is a Zod schema
  return Object.values(schema as Record<string, unknown>).some((value) =>
    isZodSchema(value),
  );
}

/**
 * Get the shape from a Zod object schema (works with v3 and v4)
 */
export function getObjectShape(
  schema: unknown,
): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== "object") return undefined;

  let rawShape:
    | Record<string, unknown>
    | (() => Record<string, unknown>)
    | undefined;

  if (isZ4Schema(schema)) {
    // Zod v4: shape is at _zod.def.shape
    const v4Schema = schema as ZodV4Internal;
    rawShape = v4Schema._zod?.def?.shape;
  } else {
    // Zod v3: shape is directly on the schema
    const v3Schema = schema as ZodV3Internal;
    rawShape = v3Schema.shape;
  }

  if (!rawShape) return undefined;

  // Shape can be a function in some cases (lazy evaluation)
  if (typeof rawShape === "function") {
    try {
      return rawShape();
    } catch {
      return undefined;
    }
  }

  return rawShape;
}

/**
 * Get literal value from a schema (works with v3 and v4)
 * Used for extracting method names from request schemas
 */
export function getLiteralValue(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return undefined;

  if (isZ4Schema(schema)) {
    const v4Schema = schema as ZodV4Internal;
    return v4Schema._zod?.def?.value;
  } else {
    const v3Schema = schema as ZodV3Internal;
    return v3Schema._def?.value;
  }
}

/**
 * Check if a Zod object schema has a specific property
 */
export function schemaHasProperty(
  schema: unknown,
  propertyName: string,
): boolean {
  const shape = getObjectShape(schema);
  if (!shape) return false;
  return propertyName in shape;
}

/**
 * Extend a Zod object schema with additional properties
 * This creates a NEW schema, preserving the original
 *
 * Works with:
 * - Zod v3 object schemas
 * - Zod v4 object schemas
 * - Shorthand syntax { a: z.number() }
 */
export function extendObjectSchema(
  originalSchema: unknown,
  additionalShape: Record<string, z.ZodTypeAny>,
): unknown {
  // Handle shorthand syntax first
  if (isShorthandZodSyntax(originalSchema)) {
    // Merge shorthand with additional properties and wrap in z.object
    return z.object({
      ...(originalSchema as Record<string, z.ZodTypeAny>),
      ...additionalShape,
    });
  }

  // Handle Zod object schemas
  if (!isZodSchema(originalSchema)) {
    // Not a Zod schema, can't extend
    return originalSchema;
  }

  const existingShape = getObjectShape(originalSchema);
  if (!existingShape) {
    // Not an object schema or couldn't get shape
    return originalSchema;
  }

  // Create new z.object with merged shapes
  // This works because z from "zod" will be whatever version is installed
  return z.object({
    ...existingShape,
    ...additionalShape,
  } as z.ZodRawShape);
}
