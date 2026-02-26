# Event Truncation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Sentry-style client-side event truncation to guarantee no event exceeds 100KB before being sent to the MCPCat API.

**Architecture:** A new `truncateEvent()` function in `src/modules/truncation.ts` applies three layers: field-level limits, recursive object normalization (depth/breadth/circular-ref), and size-targeted fallback. It runs after `sanitizeEvent()` in the event queue pipeline.

**Tech Stack:** TypeScript, Vitest for testing, no new dependencies.

---

### Task 1: Core normalize() function — string truncation + non-serializable values

**Files:**

- Create: `src/modules/truncation.ts`
- Create: `src/tests/truncation.test.ts`

**Step 1: Write the failing tests**

In `src/tests/truncation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalize } from "../modules/truncation.js";

describe("normalize - string truncation", () => {
  it("should leave short strings unchanged", () => {
    expect(normalize("hello")).toBe("hello");
  });

  it("should truncate strings exceeding maxStringLength with '...'", () => {
    const long = "a".repeat(33000);
    const result = normalize(long) as string;
    expect(result.length).toBe(32768 + 3); // 32KB + "..."
    expect(result.endsWith("...")).toBe(true);
    expect(result.startsWith("a".repeat(100))).toBe(true);
  });

  it("should leave strings at exactly maxStringLength unchanged", () => {
    const exact = "a".repeat(32768);
    expect(normalize(exact)).toBe(exact);
  });
});

describe("normalize - non-serializable values", () => {
  it("should convert functions to descriptive string", () => {
    function myFunc() {}
    expect(normalize(myFunc)).toBe("[Function: myFunc]");
  });

  it("should convert anonymous functions", () => {
    expect(normalize(() => {})).toBe("[Function: <anonymous>]");
  });

  it("should convert symbols", () => {
    expect(normalize(Symbol("test"))).toBe("[Symbol(test)]");
    expect(normalize(Symbol())).toBe("[Symbol()]");
  });

  it("should convert undefined to string marker", () => {
    expect(normalize(undefined)).toBe("[undefined]");
  });

  it("should convert BigInt to string marker", () => {
    expect(normalize(BigInt(123))).toBe("[BigInt: 123]");
  });

  it("should convert NaN to string marker", () => {
    expect(normalize(NaN)).toBe("[NaN]");
  });

  it("should convert Infinity to string marker", () => {
    expect(normalize(Infinity)).toBe("[Infinity]");
    expect(normalize(-Infinity)).toBe("[-Infinity]");
  });

  it("should convert Date to ISO string", () => {
    const date = new Date("2025-01-15T12:00:00Z");
    expect(normalize(date)).toBe("2025-01-15T12:00:00.000Z");
  });

  it("should pass through numbers unchanged", () => {
    expect(normalize(42)).toBe(42);
    expect(normalize(0)).toBe(0);
    expect(normalize(-3.14)).toBe(-3.14);
  });

  it("should pass through booleans unchanged", () => {
    expect(normalize(true)).toBe(true);
    expect(normalize(false)).toBe(false);
  });

  it("should pass through null as null", () => {
    expect(normalize(null)).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/tests/truncation.test.ts`
Expected: FAIL — `normalize` doesn't exist yet

**Step 3: Write minimal implementation**

In `src/modules/truncation.ts`:

```typescript
import { Event, UnredactedEvent } from "../types.js";

// --- Constants ---
const MAX_DEPTH = 10;
const MAX_BREADTH = 100;
const MAX_STRING_LENGTH = 32_768; // 32KB
const MAX_EVENT_BYTES = 102_400; // 100KB

// --- Truncation markers ---
const TRUNCATION_SUFFIX = "...";

/**
 * Recursively normalizes a value, handling:
 * - String truncation (> MAX_STRING_LENGTH)
 * - Non-serializable values (functions, symbols, undefined, BigInt, NaN, Infinity)
 * - Date objects -> ISO string
 * - Circular reference detection
 * - Depth limiting
 * - Breadth limiting
 */
export function normalize(
  input: unknown,
  depth: number = MAX_DEPTH,
  maxBreadth: number = MAX_BREADTH,
  maxStringLength: number = MAX_STRING_LENGTH,
): unknown {
  const memo = new WeakSet<object>();
  return visit(input, depth, maxBreadth, maxStringLength, memo);
}

function visit(
  value: unknown,
  remainingDepth: number,
  maxBreadth: number,
  maxStringLength: number,
  memo: WeakSet<object>,
): unknown {
  // null
  if (value === null) return null;

  // undefined
  if (value === undefined) return "[undefined]";

  // boolean
  if (typeof value === "boolean") return value;

  // number (including NaN, Infinity)
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "[NaN]";
    if (!Number.isFinite(value))
      return value > 0 ? "[Infinity]" : "[-Infinity]";
    return value;
  }

  // bigint
  if (typeof value === "bigint") return `[BigInt: ${value}]`;

  // string
  if (typeof value === "string") {
    if (value.length > maxStringLength) {
      return value.slice(0, maxStringLength) + TRUNCATION_SUFFIX;
    }
    return value;
  }

  // symbol
  if (typeof value === "symbol") {
    const desc = value.description;
    return desc ? `[Symbol(${desc})]` : "[Symbol()]";
  }

  // function
  if (typeof value === "function") {
    const name = value.name || "<anonymous>";
    return `[Function: ${name}]`;
  }

  // Date
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Objects and arrays from here — need depth/breadth/circular checks
  if (typeof value === "object") {
    // Circular reference detection
    if (memo.has(value)) return "[Circular ~]";

    // Depth limit
    if (remainingDepth <= 0) {
      return Array.isArray(value) ? "[Array]" : "[Object]";
    }

    memo.add(value);

    let result: unknown;
    if (Array.isArray(value)) {
      result = visitArray(
        value,
        remainingDepth - 1,
        maxBreadth,
        maxStringLength,
        memo,
      );
    } else {
      result = visitObject(
        value as Record<string, unknown>,
        remainingDepth - 1,
        maxBreadth,
        maxStringLength,
        memo,
      );
    }

    memo.delete(value);
    return result;
  }

  // Fallback: coerce to string
  return String(value);
}

function visitArray(
  arr: unknown[],
  remainingDepth: number,
  maxBreadth: number,
  maxStringLength: number,
  memo: WeakSet<object>,
): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i >= maxBreadth) {
      result.push("[MaxProperties ~]");
      break;
    }
    result.push(
      visit(arr[i], remainingDepth, maxBreadth, maxStringLength, memo),
    );
  }
  return result;
}

function visitObject(
  obj: Record<string, unknown>,
  remainingDepth: number,
  maxBreadth: number,
  maxStringLength: number,
  memo: WeakSet<object>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = Object.keys(obj);
  let count = 0;

  for (const key of keys) {
    if (count >= maxBreadth) {
      result["..."] = "[MaxProperties ~]";
      break;
    }
    result[key] = visit(
      obj[key],
      remainingDepth,
      maxBreadth,
      maxStringLength,
      memo,
    );
    count++;
  }

  return result;
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/tests/truncation.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/truncation.ts src/tests/truncation.test.ts
git commit -m "feat: add normalize() with string truncation + non-serializable value handling"
```

---

### Task 2: normalize() — depth limiting, breadth limiting, circular reference detection

**Files:**

- Modify: `src/tests/truncation.test.ts`

**Step 1: Write the failing tests**

Add to `src/tests/truncation.test.ts`:

```typescript
describe("normalize - depth limiting", () => {
  it("should collapse objects beyond max depth to '[Object]'", () => {
    // Build a deeply nested object: { a: { a: { a: ... } } }
    let obj: any = { value: "deep" };
    for (let i = 0; i < 15; i++) {
      obj = { nested: obj };
    }
    const result = normalize(obj, 5) as any;
    // At depth 5, we can access 5 levels then it collapses
    expect(result.nested.nested.nested.nested.nested).toBe("[Object]");
  });

  it("should collapse arrays beyond max depth to '[Array]'", () => {
    let arr: any = ["leaf"];
    for (let i = 0; i < 15; i++) {
      arr = [arr];
    }
    const result = normalize(arr, 3) as any;
    expect(result[0][0][0]).toBe("[Array]");
  });

  it("should handle depth=0 by collapsing top-level objects", () => {
    expect(normalize({ a: 1 }, 0)).toBe("[Object]");
    expect(normalize([1, 2], 0)).toBe("[Array]");
  });

  it("should not collapse primitives regardless of depth", () => {
    expect(normalize("hello", 0)).toBe("hello");
    expect(normalize(42, 0)).toBe(42);
  });
});

describe("normalize - breadth limiting", () => {
  it("should limit object properties to maxBreadth", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 150; i++) {
      wide[`key${i}`] = i;
    }
    const result = normalize(wide, 10, 5) as Record<string, unknown>;
    const keys = Object.keys(result);
    // 5 real keys + 1 sentinel key
    expect(keys.length).toBe(6);
    expect(result["..."]).toBe("[MaxProperties ~]");
  });

  it("should limit array elements to maxBreadth", () => {
    const wide = Array.from({ length: 150 }, (_, i) => i);
    const result = normalize(wide, 10, 5) as unknown[];
    // 5 real elements + 1 sentinel
    expect(result.length).toBe(6);
    expect(result[5]).toBe("[MaxProperties ~]");
  });

  it("should leave objects within breadth limit unchanged", () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = normalize(obj, 10, 100) as Record<string, unknown>;
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });
});

describe("normalize - circular reference detection", () => {
  it("should detect circular object references", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const result = normalize(obj) as any;
    expect(result.a).toBe(1);
    expect(result.self).toBe("[Circular ~]");
  });

  it("should detect circular array references", () => {
    const arr: any[] = [1, 2];
    arr.push(arr);
    const result = normalize(arr) as any;
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(2);
    expect(result[2]).toBe("[Circular ~]");
  });

  it("should allow same object in different branches (not a cycle)", () => {
    const shared = { value: "shared" };
    const obj = { a: shared, b: shared };
    const result = normalize(obj) as any;
    expect(result.a).toEqual({ value: "shared" });
    expect(result.b).toEqual({ value: "shared" });
  });

  it("should detect deeply nested circular references", () => {
    const obj: any = { level1: { level2: { level3: {} } } };
    obj.level1.level2.level3.backToRoot = obj;
    const result = normalize(obj) as any;
    expect(result.level1.level2.level3.backToRoot).toBe("[Circular ~]");
  });
});
```

**Step 2: Run tests to verify they pass (they should already pass since Task 1 implemented the full normalize)**

Run: `pnpm vitest run src/tests/truncation.test.ts`
Expected: All PASS (normalize already handles depth, breadth, and circular refs)

**Step 3: Commit**

```bash
git add src/tests/truncation.test.ts
git commit -m "test: add depth, breadth, and circular reference tests for normalize()"
```

---

### Task 3: Field-level truncation — truncateEvent() top-level function

**Files:**

- Modify: `src/modules/truncation.ts`
- Modify: `src/tests/truncation.test.ts`

**Step 1: Write the failing tests**

Add to `src/tests/truncation.test.ts`:

```typescript
import { truncateEvent } from "../modules/truncation.js";
import { Event, StackFrame } from "../types.js";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt_1",
    sessionId: "ses_1",
    eventType: "mcp:tools/call",
    timestamp: new Date("2025-01-15T12:00:00Z"),
    ...overrides,
  } as Event;
}

describe("truncateEvent - field-level string limits", () => {
  it("should truncate userIntent exceeding 2048 chars", () => {
    const event = makeEvent({ userIntent: "x".repeat(3000) });
    const result = truncateEvent(event);
    expect(result.userIntent!.length).toBe(2048 + 3);
    expect(result.userIntent!.endsWith("...")).toBe(true);
  });

  it("should truncate resourceName exceeding 256 chars", () => {
    const event = makeEvent({ resourceName: "t".repeat(300) });
    const result = truncateEvent(event);
    expect(result.resourceName!.length).toBe(256 + 3);
    expect(result.resourceName!.endsWith("...")).toBe(true);
  });

  it("should truncate serverName, serverVersion, clientName, clientVersion exceeding 256 chars", () => {
    const event = makeEvent({
      serverName: "s".repeat(300),
      serverVersion: "v".repeat(300),
      clientName: "c".repeat(300),
      clientVersion: "cv".repeat(200),
    });
    const result = truncateEvent(event);
    expect(result.serverName!.length).toBe(256 + 3);
    expect(result.serverVersion!.length).toBe(256 + 3);
    expect(result.clientName!.length).toBe(256 + 3);
    expect(result.clientVersion!.length).toBe(256 + 3);
  });

  it("should leave short field values unchanged", () => {
    const event = makeEvent({
      userIntent: "Get weather",
      resourceName: "fetch_weather",
      serverName: "my-server",
    });
    const result = truncateEvent(event);
    expect(result.userIntent).toBe("Get weather");
    expect(result.resourceName).toBe("fetch_weather");
    expect(result.serverName).toBe("my-server");
  });

  it("should handle undefined/null fields gracefully", () => {
    const event = makeEvent({
      userIntent: undefined,
      resourceName: undefined,
      serverName: undefined,
    });
    const result = truncateEvent(event);
    expect(result.userIntent).toBeUndefined();
    expect(result.resourceName).toBeUndefined();
    expect(result.serverName).toBeUndefined();
  });
});

describe("truncateEvent - error field limits", () => {
  it("should truncate error.message exceeding 2048 chars", () => {
    const event = makeEvent({
      error: {
        message: "e".repeat(3000),
        type: "Error",
      },
    });
    const result = truncateEvent(event);
    expect(result.error!.message.length).toBe(2048 + 3);
    expect(result.error!.message.endsWith("...")).toBe(true);
  });

  it("should limit error.frames to 50 (first 25 + last 25)", () => {
    const frames: StackFrame[] = Array.from({ length: 80 }, (_, i) => ({
      filename: `file${i}.ts`,
      function: `func${i}`,
      lineno: i + 1,
      in_app: true,
    }));
    const event = makeEvent({
      error: { message: "test", frames },
    });
    const result = truncateEvent(event);
    expect(result.error!.frames!.length).toBe(50);
    // First 25 should be from the start
    expect(result.error!.frames![0].filename).toBe("file0.ts");
    expect(result.error!.frames![24].filename).toBe("file24.ts");
    // Last 25 should be from the end
    expect(result.error!.frames![25].filename).toBe("file55.ts");
    expect(result.error!.frames![49].filename).toBe("file79.ts");
  });

  it("should leave frames at exactly 50 unchanged", () => {
    const frames: StackFrame[] = Array.from({ length: 50 }, (_, i) => ({
      filename: `file${i}.ts`,
      function: `func${i}`,
      in_app: true,
    }));
    const event = makeEvent({
      error: { message: "test", frames },
    });
    const result = truncateEvent(event);
    expect(result.error!.frames!.length).toBe(50);
  });

  it("should handle error without frames", () => {
    const event = makeEvent({
      error: { message: "test" },
    });
    const result = truncateEvent(event);
    expect(result.error!.message).toBe("test");
    expect(result.error!.frames).toBeUndefined();
  });
});

describe("truncateEvent - response content text truncation", () => {
  it("should truncate text content blocks exceeding 32KB", () => {
    const event = makeEvent({
      response: {
        content: [
          { type: "text", text: "x".repeat(40000) },
          { type: "text", text: "short" },
        ],
      },
    });
    const result = truncateEvent(event);
    expect(result.response.content[0].text.length).toBe(32768 + 3);
    expect(result.response.content[0].text.endsWith("...")).toBe(true);
    expect(result.response.content[1].text).toBe("short");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/tests/truncation.test.ts`
Expected: FAIL — `truncateEvent` doesn't exist yet

**Step 3: Write minimal implementation**

Add to `src/modules/truncation.ts`:

```typescript
// --- Field-level limit constants ---
const MAX_USER_INTENT_LENGTH = 2_048;
const MAX_ERROR_MESSAGE_LENGTH = 2_048;
const MAX_RESOURCE_NAME_LENGTH = 256;
const MAX_METADATA_LENGTH = 256;
const MAX_STACK_FRAMES = 50;
const MAX_CONTENT_TEXT_LENGTH = 32_768;

function truncateString(
  str: string | undefined,
  maxLength: number,
): string | undefined {
  if (str == null) return str;
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + TRUNCATION_SUFFIX;
}

function truncateStackFrames(
  frames: StackFrame[] | undefined,
): StackFrame[] | undefined {
  if (!frames || frames.length <= MAX_STACK_FRAMES) return frames;
  const half = Math.floor(MAX_STACK_FRAMES / 2);
  return [...frames.slice(0, half), ...frames.slice(-half)];
}

function truncateResponseContent(response: any): any {
  if (response == null || typeof response !== "object") return response;
  const result = { ...response };
  if (Array.isArray(result.content)) {
    result.content = result.content.map((block: any) => {
      if (
        block?.type === "text" &&
        typeof block.text === "string" &&
        block.text.length > MAX_CONTENT_TEXT_LENGTH
      ) {
        return {
          ...block,
          text:
            block.text.slice(0, MAX_CONTENT_TEXT_LENGTH) + TRUNCATION_SUFFIX,
        };
      }
      return block;
    });
  }
  return result;
}

/**
 * Truncates an event to guarantee it fits within MAX_EVENT_BYTES (100KB).
 * Applies three layers:
 * 1. Field-level string limits
 * 2. Recursive object normalization (depth/breadth/circular-ref)
 * 3. Size-targeted fallback (progressive depth reduction)
 *
 * Pure function — returns a new object, never mutates the input.
 */
export function truncateEvent<T extends Event | UnredactedEvent>(event: T): T {
  // Layer 1: Field-level limits
  const result: any = { ...event };

  result.userIntent = truncateString(result.userIntent, MAX_USER_INTENT_LENGTH);
  result.resourceName = truncateString(
    result.resourceName,
    MAX_RESOURCE_NAME_LENGTH,
  );
  result.serverName = truncateString(result.serverName, MAX_METADATA_LENGTH);
  result.serverVersion = truncateString(
    result.serverVersion,
    MAX_METADATA_LENGTH,
  );
  result.clientName = truncateString(result.clientName, MAX_METADATA_LENGTH);
  result.clientVersion = truncateString(
    result.clientVersion,
    MAX_METADATA_LENGTH,
  );

  // Error field limits
  if (result.error != null && typeof result.error === "object") {
    result.error = { ...result.error };
    result.error.message = truncateString(
      result.error.message,
      MAX_ERROR_MESSAGE_LENGTH,
    );
    result.error.frames = truncateStackFrames(result.error.frames);
  }

  // Response content text limits
  result.response = truncateResponseContent(result.response);

  // Layer 2: Recursive normalization on user-controlled fields
  if (result.parameters != null) {
    result.parameters = normalize(result.parameters);
  }
  if (result.response != null) {
    result.response = normalize(result.response);
  }
  if (result.identifyActorData != null) {
    result.identifyActorData = normalize(result.identifyActorData);
  }
  if (result.error != null) {
    result.error = normalize(result.error);
  }

  // Layer 3: Size-targeted normalization (Task 4)
  return truncateToSize(result) as T;
}
```

Note: `truncateToSize` will be a stub in this task that just returns the input, implemented properly in Task 4.

Add stub:

```typescript
function truncateToSize(event: any): any {
  return event; // Implemented in Task 4
}
```

Also add `import { StackFrame } from "../types.js";` at the top.

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/tests/truncation.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/truncation.ts src/tests/truncation.test.ts
git commit -m "feat: add truncateEvent() with field-level limits and object normalization"
```

---

### Task 4: Size-targeted normalization — truncateToSize()

**Files:**

- Modify: `src/modules/truncation.ts`
- Modify: `src/tests/truncation.test.ts`

**Step 1: Write the failing tests**

Add to `src/tests/truncation.test.ts`:

```typescript
describe("truncateEvent - size targeting", () => {
  it("should leave small events unchanged", () => {
    const event = makeEvent({
      parameters: { query: "hello" },
      response: { content: [{ type: "text", text: "world" }] },
    });
    const result = truncateEvent(event);
    expect(JSON.stringify(result).length).toBeLessThan(102_400);
    expect((result.parameters as any).query).toBe("hello");
  });

  it("should reduce depth progressively for events exceeding 100KB", () => {
    // Create a deeply nested structure that's large
    const bigNested: any = {};
    let current = bigNested;
    for (let i = 0; i < 8; i++) {
      current.data = "x".repeat(15000); // 15KB per level = ~120KB total
      current.next = {};
      current = current.next;
    }
    current.data = "leaf";

    const event = makeEvent({ parameters: bigNested });
    const result = truncateEvent(event);

    const size = new TextEncoder().encode(JSON.stringify(result)).length;
    expect(size).toBeLessThanOrEqual(102_400);
  });

  it("should truncate largest string fields as last resort", () => {
    // Create event with a single huge string that exceeds 100KB even at depth 1
    const event = makeEvent({
      parameters: { data: "x".repeat(120_000) },
    });
    const result = truncateEvent(event);

    const size = new TextEncoder().encode(JSON.stringify(result)).length;
    expect(size).toBeLessThanOrEqual(102_400);
  });

  it("should guarantee 100KB max for pathological payloads", () => {
    // Wide + deep + large strings
    const wide: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      wide[`key${i}`] = "v".repeat(3000);
    }
    const event = makeEvent({
      parameters: wide,
      response: { data: "r".repeat(30000) },
    });
    const result = truncateEvent(event);

    const size = new TextEncoder().encode(JSON.stringify(result)).length;
    expect(size).toBeLessThanOrEqual(102_400);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/tests/truncation.test.ts`
Expected: FAIL — the size targeting tests fail because `truncateToSize` is a stub

**Step 3: Write implementation**

Replace the `truncateToSize` stub in `src/modules/truncation.ts`:

```typescript
/**
 * Calculates the UTF-8 byte size of a JSON-serialized value.
 */
function jsonByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Finds and truncates the largest string values in an object to fit within a byte budget.
 * Last-resort mechanism when depth reduction alone isn't enough.
 */
function truncateLargestFields(obj: any, maxBytes: number): any {
  const serialized = JSON.stringify(obj);
  const currentSize = new TextEncoder().encode(serialized).length;
  if (currentSize <= maxBytes) return obj;

  const excess = currentSize - maxBytes;

  // Find all string values and their sizes, sorted largest first
  const stringPaths: Array<{ path: string[]; length: number }> = [];
  collectStringPaths(obj, [], stringPaths);
  stringPaths.sort((a, b) => b.length - a.length);

  // Distribute the reduction across the largest strings
  let remaining = excess + 100; // small buffer for JSON overhead changes
  const result = JSON.parse(JSON.stringify(obj)); // deep clone

  for (const { path, length } of stringPaths) {
    if (remaining <= 0) break;
    const reduction = Math.min(remaining, Math.floor(length * 0.5));
    if (reduction < 10) continue; // not worth truncating tiny strings
    const newLength = length - reduction;
    setNestedValue(
      result,
      path,
      getNestedValue(result, path).slice(0, newLength) + TRUNCATION_SUFFIX,
    );
    remaining -= reduction;
  }

  return result;
}

function collectStringPaths(
  obj: any,
  currentPath: string[],
  results: Array<{ path: string[]; length: number }>,
): void {
  if (typeof obj === "string" && obj.length > 100) {
    results.push({ path: [...currentPath], length: obj.length });
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) =>
      collectStringPaths(item, [...currentPath, String(i)], results),
    );
    return;
  }
  if (obj != null && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      collectStringPaths(value, [...currentPath, key], results);
    }
  }
}

function getNestedValue(obj: any, path: string[]): any {
  let current = obj;
  for (const key of path) current = current[key];
  return current;
}

function setNestedValue(obj: any, path: string[], value: any): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) current = current[path[i]];
  current[path[path.length - 1]] = value;
}

/**
 * Ensures an event fits within MAX_EVENT_BYTES by progressively reducing
 * normalization depth, then truncating largest string fields as a last resort.
 */
function truncateToSize(event: any): any {
  // Check if already within budget
  if (jsonByteSize(event) <= MAX_EVENT_BYTES) return event;

  // Progressive depth reduction
  for (let depth = MAX_DEPTH - 1; depth >= 1; depth--) {
    const reduced: any = { ...event };
    if (reduced.parameters != null)
      reduced.parameters = normalize(reduced.parameters, depth);
    if (reduced.response != null)
      reduced.response = normalize(reduced.response, depth);
    if (reduced.identifyActorData != null)
      reduced.identifyActorData = normalize(reduced.identifyActorData, depth);
    if (reduced.error != null) reduced.error = normalize(reduced.error, depth);

    if (jsonByteSize(reduced) <= MAX_EVENT_BYTES) return reduced;
  }

  // Last resort: truncate largest string fields
  const minimal: any = { ...event };
  if (minimal.parameters != null)
    minimal.parameters = normalize(minimal.parameters, 1);
  if (minimal.response != null)
    minimal.response = normalize(minimal.response, 1);
  if (minimal.identifyActorData != null)
    minimal.identifyActorData = normalize(minimal.identifyActorData, 1);
  if (minimal.error != null) minimal.error = normalize(minimal.error, 1);

  return truncateLargestFields(minimal, MAX_EVENT_BYTES);
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/tests/truncation.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/modules/truncation.ts src/tests/truncation.test.ts
git commit -m "feat: add size-targeted normalization with progressive depth reduction"
```

---

### Task 5: Non-mutation guarantee and edge case tests

**Files:**

- Modify: `src/tests/truncation.test.ts`

**Step 1: Write the tests**

Add to `src/tests/truncation.test.ts`:

```typescript
describe("truncateEvent - non-mutation", () => {
  it("should not mutate the original event object", () => {
    const longIntent = "x".repeat(3000);
    const event = makeEvent({
      userIntent: longIntent,
      parameters: { deep: { nested: { data: "y".repeat(40000) } } },
      error: {
        message: "e".repeat(3000),
        frames: Array.from({ length: 80 }, (_, i) => ({
          filename: `file${i}.ts`,
          function: `func${i}`,
          in_app: true,
        })),
      },
    });

    // Deep clone for comparison
    const originalJson = JSON.stringify(event);
    truncateEvent(event);

    expect(JSON.stringify(event)).toBe(originalJson);
  });
});

describe("truncateEvent - edge cases", () => {
  it("should handle empty event with minimal fields", () => {
    const event = makeEvent({});
    const result = truncateEvent(event);
    expect(result.id).toBe("evt_1");
    expect(result.sessionId).toBe("ses_1");
  });

  it("should pass through already-small events unchanged", () => {
    const event = makeEvent({
      userIntent: "Get weather",
      resourceName: "fetch_weather",
      parameters: { location: "SF" },
      response: { content: [{ type: "text", text: "65F" }] },
    });
    const result = truncateEvent(event);
    expect(result.userIntent).toBe("Get weather");
    expect(result.resourceName).toBe("fetch_weather");
    expect((result.parameters as any).location).toBe("SF");
  });

  it("should handle event with null parameters and response", () => {
    const event = makeEvent({
      parameters: null,
      response: null,
      error: null as any,
    });
    const result = truncateEvent(event);
    expect(result.parameters).toBeNull();
    expect(result.response).toBeNull();
  });

  it("should preserve SDK-controlled fields exactly", () => {
    const ts = new Date("2025-01-15T12:00:00Z");
    const event = makeEvent({
      id: "evt_abc123",
      sessionId: "ses_xyz789",
      projectId: "proj_test",
      eventType: "mcp:tools/call",
      timestamp: ts,
      duration: 342,
      sdkLanguage: "typescript",
      mcpcatVersion: "0.1.12",
      ipAddress: "192.168.1.1",
      isError: false,
    });
    const result = truncateEvent(event);
    expect(result.id).toBe("evt_abc123");
    expect(result.sessionId).toBe("ses_xyz789");
    expect(result.projectId).toBe("proj_test");
    expect(result.eventType).toBe("mcp:tools/call");
    expect(result.timestamp).toBe(ts);
    expect(result.duration).toBe(342);
    expect(result.sdkLanguage).toBe("typescript");
    expect(result.mcpcatVersion).toBe("0.1.12");
    expect(result.ipAddress).toBe("192.168.1.1");
    expect(result.isError).toBe(false);
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `pnpm vitest run src/tests/truncation.test.ts`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/tests/truncation.test.ts
git commit -m "test: add non-mutation and edge case tests for truncateEvent()"
```

---

### Task 6: Integrate truncateEvent() into the event queue pipeline

**Files:**

- Modify: `src/modules/eventQueue.ts:67` (add truncateEvent call after sanitizeEvent)
- Modify: `src/tests/truncation.test.ts` (add integration test)

**Step 1: Write the failing integration test**

Add to `src/tests/truncation.test.ts`:

```typescript
import { sanitizeEvent } from "../modules/sanitization.js";

describe("truncateEvent - integration with sanitization pipeline", () => {
  it("should work correctly after sanitizeEvent in the pipeline", () => {
    const event = makeEvent({
      userIntent: "x".repeat(3000),
      parameters: {
        imageData: "A".repeat(12000) + "=", // large base64 — sanitization will redact this
        query: "hello",
        nested: { deep: { value: "y".repeat(40000) } },
      },
      response: {
        content: [
          { type: "text", text: "z".repeat(40000) },
          { type: "image", data: "base64img", mimeType: "image/png" },
        ],
      },
    });

    // Simulate pipeline: sanitize then truncate
    const sanitized = sanitizeEvent(event);
    const result = truncateEvent(sanitized);

    // Sanitization should have redacted the base64 and image
    expect((result.parameters as any).imageData).toBe(
      "[binary data redacted - not supported by MCPcat]",
    );
    expect(result.response.content[1]).toEqual({
      type: "text",
      text: "[image content redacted - not supported by MCPcat]",
    });

    // Truncation should have capped the remaining fields
    expect(result.userIntent!.length).toBe(2048 + 3);
    expect(result.response.content[0].text.length).toBeLessThanOrEqual(
      32768 + 3,
    );
    expect((result.parameters as any).query).toBe("hello");
  });
});
```

**Step 2: Run test to verify it passes (truncateEvent works standalone)**

Run: `pnpm vitest run src/tests/truncation.test.ts`
Expected: PASS (this is a standalone test of the two functions composed together)

**Step 3: Integrate into eventQueue.ts**

In `src/modules/eventQueue.ts`, add import at the top:

```typescript
import { truncateEvent } from "./truncation.js";
```

Then after line 67 (`Object.assign(event, sanitizeEvent(event));`), add:

```typescript
Object.assign(event, truncateEvent(event));
```

So the pipeline becomes:

```typescript
      // Layer 1: Customer redaction
      if (event.redactionFn) { ... }
      // Layer 2: Content sanitization
      Object.assign(event, sanitizeEvent(event));
      // Layer 3: Event truncation
      Object.assign(event, truncateEvent(event));
      // Generate event ID
      event.id = event.id || (await KSUID.withPrefix("evt").random());
```

**Step 4: Run all tests to verify nothing broke**

Run: `pnpm vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/modules/eventQueue.ts src/tests/truncation.test.ts
git commit -m "feat: integrate truncateEvent() into event queue pipeline after sanitization"
```

---

### Task 7: Final verification — lint, typecheck, full test suite

**Files:**

- No new files

**Step 1: Run linter**

Run: `pnpm run lint`
Expected: No errors (fix any lint issues found)

**Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: No type errors

**Step 3: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests PASS

**Step 4: Commit any lint/type fixes**

```bash
git add -A
git commit -m "chore: fix lint and type issues in truncation module"
```

(Skip if no fixes needed)
