# Event Truncation Design

## Problem

The MCPCat backend needs protection from oversized event payloads. Currently, user-controlled fields (`parameters`, `response`, `identifyActorData`, `error`, `userIntent`) have no size limits. A single event could contain megabytes of text, deeply nested objects, or thousands of properties.

## Approach: Full Sentry-Style Normalization

Three layers of truncation applied in sequence, guaranteeing no event exceeds 100KB.

### Pipeline Position

```
event dequeued
  -> customer redaction (if configured)   [Layer 1: redaction.ts]
  -> content sanitization                 [Layer 2: sanitization.ts]
  -> event truncation                     [Layer 3: truncation.ts - NEW]
  -> generate event ID
  -> send to API / exporters
```

New file: `src/modules/truncation.ts`
Integration point: `src/modules/eventQueue.ts` (after `sanitizeEvent()`)

### Contract

- Synchronous (no async)
- Pure function — returns new object, never mutates input
- Handles null/undefined gracefully
- Applied unconditionally to every event
- All limits hard-coded (no configuration surface)

## Layer 1: Field-Level Limits

| Field                                                        | Limit                          | Marker |
| ------------------------------------------------------------ | ------------------------------ | ------ |
| `userIntent`                                                 | 2,048 chars                    | `...`  |
| `response.content[].text`                                    | 32,768 chars (32KB)            | `...`  |
| `error.message`                                              | 2,048 chars                    | `...`  |
| `error.frames[]`                                             | 50 frames (first 25 + last 25) | —      |
| `resourceName`                                               | 256 chars                      | `...`  |
| `serverName`, `serverVersion`, `clientName`, `clientVersion` | 256 chars each                 | `...`  |

## Layer 2: Recursive Object Normalization

Applied to user-controlled object fields only:

- `parameters`
- `response`
- `identifyActorData`
- `error`

### Parameters (hard-coded)

| Parameter         | Value                    |
| ----------------- | ------------------------ |
| Max depth         | 10                       |
| Max breadth       | 100 properties per level |
| Max string length | 32,768 chars (32KB)      |

### Behaviors

1. **Depth limiting:** Objects/arrays beyond max depth -> `"[Object]"` / `"[Array]"`
2. **Breadth limiting:** Properties beyond max -> `"[MaxProperties ~]"` sentinel
3. **Circular references:** WeakSet detection -> `"[Circular ~]"`
4. **String truncation:** Exceeding max length -> truncated with `...`
5. **Non-serializable values:**
   - Functions -> `"[Function: name]"`
   - Symbols -> `"[Symbol(description)]"`
   - `undefined` -> `"[undefined]"`
   - `BigInt` -> `"[BigInt: value]"`
   - `NaN` / `Infinity` -> `"[NaN]"` / `"[Infinity]"`
6. **Date objects:** -> ISO string

### Fields NOT normalized (SDK-controlled)

`id`, `sessionId`, `projectId`, `eventType`, `timestamp`, `duration`, `sdkLanguage`, `mcpcatVersion`, `ipAddress`, `isError`

## Layer 3: Size-Targeted Normalization

Final safety net guaranteeing 100KB max event size.

```
truncateToSize(event, maxBytes = 102_400):
    normalized = applyNormalization(event, depth=10)

    while jsonByteSize(normalized) > maxBytes AND depth > 1:
        depth -= 1
        normalized = applyNormalization(event, depth)

    if jsonByteSize(normalized) > maxBytes:
        truncateLargestFields(normalized, maxBytes)

    return normalized
```

Progressive depth reduction preserves top-level structure while collapsing deeply nested details first.

## Test Plan

File: `src/tests/truncation.test.ts`

1. String truncation — fields exceeding limits get `...` appended
2. Stack frame limiting — >50 frames trimmed to first 25 + last 25
3. Depth limiting — deeply nested objects get `[Object]` / `[Array]` markers
4. Breadth limiting — wide objects get `[MaxProperties ~]` sentinel
5. Circular reference detection — cycles get `[Circular ~]` marker
6. Non-serializable values — functions, symbols, BigInt get descriptive strings
7. Size targeting — events >100KB get progressively reduced
8. Non-mutation — original event object is never modified
9. Integration — sanitization + truncation pipeline works end-to-end
10. Edge cases — null/undefined fields, empty events, already-small events pass unchanged

## Design Principles (from Sentry)

1. **Truncate early, client-side** — reduces network, server, and storage costs simultaneously
2. **Preserve what matters most** — top-level structure over deeply nested details
3. **Mark, don't silently drop** — every truncation leaves a visible marker
4. **Hard-coded where reasonable** — no configuration surface; can add later if customers ask
5. **Defense in depth** — three independent layers (field limits, normalization, size target)
