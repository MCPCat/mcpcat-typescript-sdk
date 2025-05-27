import {
  MCPCatData,
  MCPServerLike,
  ServerClientInfoLike,
  SessionInfo,
} from "../types.js";
import { getServerTrackingData, setServerTrackingData } from "./internal.js";
import KSUID from "../thirdparty/ksuid/index.js";
import packageJson from "../../package.json" with { type: "json" };

import { INACTIVITY_TIMEOUT_IN_MINUTES } from "./constants.js";

export function newSessionId(): string {
  return KSUID.withPrefix("ses").randomSync();
}

export function getServerSessionId(server: MCPServerLike): string {
  const data = getServerTrackingData(server);

  if (!data) {
    throw new Error("Server tracking data not found");
  }

  const now = Date.now();
  const timeoutMs = INACTIVITY_TIMEOUT_IN_MINUTES * 60 * 1000;
  // If last activity timed out
  if (now - data.lastActivity.getTime() > timeoutMs) {
    data.sessionId = newSessionId();
    setServerTrackingData(server, data);
  }
  setLastActivity(server);

  return data.sessionId;
}

export function setLastActivity(server: MCPServerLike): void {
  const data = getServerTrackingData(server);

  if (!data) {
    throw new Error("Server tracking data not found");
  }

  data.lastActivity = new Date();
  setServerTrackingData(server, data);
}

export function getSessionInfo(
  server: MCPServerLike,
  data: MCPCatData | undefined,
): SessionInfo {
  let clientInfo: ServerClientInfoLike | undefined = {
    name: undefined,
    version: undefined,
  };
  if (!data?.sessionInfo.clientName) {
    clientInfo = server.getClientVersion();
  }
  const actorInfo = data?.identifiedSessions.get(data.sessionId);

  const sessionInfo: SessionInfo = {
    ipAddress: undefined, // grab from django
    sdkLanguage: "TypeScript", // hardcoded for now
    mcpcatVersion: packageJson.version,
    serverName: server._serverInfo?.name,
    serverVersion: server._serverInfo?.version,
    clientName: clientInfo?.name,
    clientVersion: clientInfo?.version,
    identifyActorGivenId: actorInfo?.userId,
    identifyActorName: actorInfo?.userData?.name,
    identifyActorData: actorInfo?.userData || {},
  };

  if (!data) {
    return sessionInfo;
  }

  data.sessionInfo = sessionInfo;
  setServerTrackingData(server, data);
  return data.sessionInfo;
}
