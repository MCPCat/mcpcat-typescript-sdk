import {
  MCPCatData,
  MCPServerLike,
  UserIdentity,
  CompatibleRequestHandlerExtra,
  UnredactedEvent,
} from "../types.js";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";
import { publishEvent } from "./eventQueue.js";
import { writeToLog } from "./logging.js";

/**
 * Simple LRU cache for session identities.
 * Prevents memory leaks by capping at maxSize entries.
 * This cache persists across server instance restarts.
 */
class IdentityCache {
  private cache: Map<string, { identity: UserIdentity; timestamp: number }>;
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(sessionId: string): UserIdentity | undefined {
    const entry = this.cache.get(sessionId);
    if (entry) {
      // Update timestamp on access (LRU behavior)
      entry.timestamp = Date.now();
      // Move to end (most recently used)
      this.cache.delete(sessionId);
      this.cache.set(sessionId, entry);
      return entry.identity;
    }
    return undefined;
  }

  set(sessionId: string, identity: UserIdentity): void {
    // Remove if already exists (to re-add at end)
    this.cache.delete(sessionId);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(sessionId, { identity, timestamp: Date.now() });
  }

  has(sessionId: string): boolean {
    return this.cache.has(sessionId);
  }

  size(): number {
    return this.cache.size;
  }
}

// Global identity cache shared across all server instances
// This prevents duplicate identify events when server objects are recreated
const _globalIdentityCache = new IdentityCache(1000);

// Internal tracking storage
const _serverTracking = new WeakMap<MCPServerLike, MCPCatData>();

export function getServerTrackingData(
  server: MCPServerLike,
): MCPCatData | undefined {
  return _serverTracking.get(server);
}

export function setServerTrackingData(
  server: MCPServerLike,
  data: MCPCatData,
): void {
  _serverTracking.set(server, data);
}

/**
 * Deep comparison of two UserIdentity objects
 */
export function areIdentitiesEqual(a: UserIdentity, b: UserIdentity): boolean {
  if (a.userId !== b.userId) return false;
  if (a.userName !== b.userName) return false;

  // Deep compare userData objects
  const aData = a.userData || {};
  const bData = b.userData || {};

  const aKeys = Object.keys(aData);
  const bKeys = Object.keys(bData);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!(key in bData)) return false;
    if (JSON.stringify(aData[key]) !== JSON.stringify(bData[key])) return false;
  }

  return true;
}

/**
 * Merges two UserIdentity objects, overwriting userId and userName,
 * but merging userData fields
 */
export function mergeIdentities(
  previous: UserIdentity | undefined,
  next: UserIdentity,
): UserIdentity {
  if (!previous) {
    return next;
  }

  return {
    userId: next.userId,
    userName: next.userName,
    userData: {
      ...(previous.userData || {}),
      ...(next.userData || {}),
    },
  };
}

/**
 * Handles user identification for a request.
 * Calls the identify function if configured, compares with previous identity,
 * and publishes an identify event only if the identity has changed.
 *
 * @param server - The MCP server instance
 * @param data - The server tracking data
 * @param request - The request object to pass to identify function
 * @param extra - Optional extra parameters containing headers, sessionId, etc.
 */
export async function handleIdentify(
  server: MCPServerLike,
  data: MCPCatData,
  request: any,
  extra?: CompatibleRequestHandlerExtra,
): Promise<void> {
  if (!data.options.identify) {
    return;
  }

  const sessionId = data.sessionId;
  let identifyEvent: UnredactedEvent = {
    sessionId: sessionId,
    resourceName: request.params?.name || "Unknown",
    eventType: PublishEventRequestEventTypeEnum.mcpcatIdentify,
    parameters: {
      request: request,
      extra: extra,
    },
    timestamp: new Date(),
    redactionFn: data.options.redactSensitiveInformation,
  };

  try {
    const identityResult = await data.options.identify(request, extra);
    if (identityResult) {
      // Now use the (possibly updated) sessionId for all subsequent operations
      const currentSessionId = data.sessionId;

      // Check global cache first (works across server instance restarts)
      const previousIdentity = _globalIdentityCache.get(currentSessionId);

      // Merge identities (overwrite userId/userName, merge userData)
      const mergedIdentity = mergeIdentities(previousIdentity, identityResult);

      // Only publish if identity has changed
      const hasChanged =
        !previousIdentity ||
        !areIdentitiesEqual(previousIdentity, mergedIdentity);

      // Update BOTH caches to keep them in sync
      // Global cache: persists across server instances
      _globalIdentityCache.set(currentSessionId, mergedIdentity);
      // Per-server cache: used by getSessionInfo() for fast local access
      data.identifiedSessions.set(data.sessionId, mergedIdentity);

      if (hasChanged) {
        writeToLog(
          `Identified session ${currentSessionId} with identity: ${JSON.stringify(mergedIdentity)}`,
        );
        publishEvent(server, identifyEvent);
      }
    } else {
      writeToLog(
        `Warning: Supplied identify function returned null for session ${sessionId}`,
      );
    }
  } catch (error) {
    writeToLog(
      `Error: User supplied identify function threw an error while identifying session ${sessionId} - ${error}`,
    );
  }
}
