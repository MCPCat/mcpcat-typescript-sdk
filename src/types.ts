import { PublishEventRequest } from "mcpcat-api";

export interface MCPCatOptions {
  enableReportMissing?: boolean;
  enableTracing?: boolean;
  enableToolCallContext?: boolean;
  identify?: (
    request: any,
    extra?: CompatibleRequestHandlerExtra,
  ) => Promise<UserIdentity | null>;
  redactSensitiveInformation?: RedactFunction;
}

export type RedactFunction = (text: string) => Promise<string>;

export enum MCPCatIDPrefixes {
  Session = "ses",
  Event = "evt",
}

export interface Event extends PublishEventRequest {}

export interface UnredactedEvent extends Event {
  redactionFn?: RedactFunction; // Optional redaction function for sensitive data
}

// Use our own minimal interface for what we actually need
export interface CompatibleRequestHandlerExtra {
  sessionId?: string;
  headers?: Record<string, string | string[]>;
  [key: string]: any;
}

export interface ServerClientInfoLike {
  name?: string;
  version?: string;
}

export interface MCPServerLike {
  setRequestHandler(
    schema: any,
    handler: (
      request: any,
      extra?: CompatibleRequestHandlerExtra,
    ) => Promise<any>,
  ): void;
  _requestHandlers: Map<
    string,
    (request: any, extra?: CompatibleRequestHandlerExtra) => Promise<any>
  >;
  _serverInfo?: ServerClientInfoLike;
  getClientVersion(): ServerClientInfoLike | undefined;
}

export interface UserIdentity {
  userId: string; // Unique identifier for the user
  userName?: string; // Optional user name
  userData?: Record<string, any>; // Additional user data
}

export interface SessionInfo {
  ipAddress?: string;
  sdkLanguage?: string;
  mcpcatVersion?: string;
  serverName?: string;
  serverVersion?: string;
  clientName?: string;
  clientVersion?: string;
  identifyActorGivenId?: string; // Actor ID for mcpcat:identify events
  identifyActorName?: string; // Actor name for mcpcat:identify events
  identifyActorData?: object;
}

export interface MCPCatData {
  projectId: string; // Project ID for MCPCat
  sessionId: string; // Unique identifier for the session
  lastActivity: Date; // Last activity timestamp
  identifiedSessions: Map<string, UserIdentity>;
  sessionInfo: SessionInfo;
  options: MCPCatOptions;
}
