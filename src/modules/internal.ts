import { MCPCatData, MCPServerLike, UserIdentity } from "../types.js";

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
