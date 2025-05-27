import { MCPCatData, MCPServerLike } from "../types.js";

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
