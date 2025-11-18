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
import { INACTIVITY_TIMEOUT_IN_MINUTES } from "./constants.js";
import { captureException } from "./exceptions.js";

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

/**
 * Maps userId to recent session IDs for reconnection support.
 * When a user reconnects (new initialize without MCP sessionId),
 * we can reuse their previous session if it's recent enough.
 */
class UserSessionCache {
  private cache: Map<string, { sessionId: string; lastSeen: number }>;
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  getRecentSession(userId: string, timeoutMs: number): string | undefined {
    const entry = this.cache.get(userId);
    if (!entry) return undefined;

    // Check if session has expired
    if (Date.now() - entry.lastSeen > timeoutMs) {
      this.cache.delete(userId);
      return undefined;
    }

    return entry.sessionId;
  }

  set(userId: string, sessionId: string): void {
    // Remove if already exists (to re-add at end for LRU)
    this.cache.delete(userId);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(userId, { sessionId, lastSeen: Date.now() });
  }
}

// Global user session cache for reconnection support
const _globalUserSessionCache = new UserSessionCache(1000);

/**
 * FOR TESTING ONLY: Manually set a user session cache entry with custom lastSeen timestamp
 */
export function _testSetUserSession(
  userId: string,
  sessionId: string,
  lastSeenMs: number,
): void {
  (_globalUserSessionCache as any).cache.set(userId, {
    sessionId,
    lastSeen: lastSeenMs,
  });
}

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
      // Check for session reconnection (if no MCP sessionId provided in extra)
      // If this user had a recent session, switch to it instead of creating new one
      if (!extra?.sessionId && identityResult.userId) {
        const timeoutMs = INACTIVITY_TIMEOUT_IN_MINUTES * 60 * 1000;
        const previousSessionId = _globalUserSessionCache.getRecentSession(
          identityResult.userId,
          timeoutMs,
        );

        if (previousSessionId && previousSessionId !== data.sessionId) {
          // User has a previous session - reconnect to it
          const currentSessionIdentity = _globalIdentityCache.get(
            data.sessionId,
          );

          if (!currentSessionIdentity) {
            // Current session is brand new (no identity) - reconnect to previous session
            data.sessionId = previousSessionId;
            data.lastActivity = new Date();
            setServerTrackingData(server, data);

            writeToLog(
              `Reconnected user ${identityResult.userId} to previous session ${previousSessionId} (current session was new)`,
            );
          } else if (currentSessionIdentity.userId !== identityResult.userId) {
            // Current session belongs to different user - reconnect to user's previous session
            data.sessionId = previousSessionId;
            data.lastActivity = new Date();
            setServerTrackingData(server, data);

            writeToLog(
              `Reconnected user ${identityResult.userId} to previous session ${previousSessionId}`,
            );
          }
          // If current session already belongs to this user, no need to do anything
        } else if (!previousSessionId) {
          // User has NO previous session - check if current session belongs to someone else
          const currentSessionIdentity = _globalIdentityCache.get(
            data.sessionId,
          );
          if (
            currentSessionIdentity &&
            currentSessionIdentity.userId !== identityResult.userId
          ) {
            // Current session belongs to different user - create new session
            const { newSessionId } = await import("./session.js");
            data.sessionId = newSessionId();
            data.sessionSource = "mcpcat";
            data.lastActivity = new Date();
            setServerTrackingData(server, data);

            writeToLog(
              `Created new session ${data.sessionId} for user ${identityResult.userId} (previous session belonged to ${currentSessionIdentity.userId})`,
            );
          }
        }
      }

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

      // Track userId → sessionId mapping for reconnection support
      _globalUserSessionCache.set(mergedIdentity.userId, currentSessionId);

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
      `Warning: Supplied identify function threw an error while identifying session ${sessionId} - ${error}`,
    );
    identifyEvent.duration =
      (identifyEvent.timestamp &&
        new Date().getTime() - identifyEvent.timestamp.getTime()) ||
      undefined;
    identifyEvent.isError = true;
    identifyEvent.error = captureException(error);
    publishEvent(server, identifyEvent);
  }
}
