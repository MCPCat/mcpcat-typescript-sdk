import { CallToolResult } from "@modelcontextprotocol/sdk/types";

export interface MCPCatOptions {
  enableReportMissing?: boolean;
  enableTracing?: boolean;
  enableToolCallContext?: boolean;
  customContextDescription?: string;
  identify?: (
    request: any,
    extra?: CompatibleRequestHandlerExtra,
  ) => Promise<UserIdentity | null>;
  redactSensitiveInformation?: RedactFunction;
  exporters?: Record<string, ExporterConfig>;
}

export type ToolCallback =
  | ((
      args: any,
      extra: CompatibleRequestHandlerExtra,
    ) => CallToolResult | Promise<CallToolResult>)
  | ((
      extra: CompatibleRequestHandlerExtra,
    ) => CallToolResult | Promise<CallToolResult>);

export type RegisteredTool = {
  description?: string;
  inputSchema?: any;
  callback: ToolCallback;
  update?: (...args: any[]) => any;
};

export type RedactFunction = (text: string) => Promise<string>;

export interface ExporterConfig {
  type: string;
  [key: string]: any;
}

export interface Exporter {
  export(event: Event): Promise<void>;
}

export enum MCPCatIDPrefixes {
  Session = "ses",
  Event = "evt",
}

export interface Event {
  // Core identification
  id: string;
  sessionId: string;
  projectId?: string; // Optional for telemetry-only mode

  // Event metadata
  eventType: string; // Changed from enum to string for flexibility
  timestamp: Date;
  duration?: number;

  // Session context (from SessionInfo)
  ipAddress?: string;
  sdkLanguage?: string;
  mcpcatVersion?: string;
  serverName?: string;
  serverVersion?: string;
  clientName?: string;
  clientVersion?: string;

  // Actor/identity information
  identifyActorGivenId?: string;
  identifyActorName?: string;
  identifyActorData?: object;

  // Event-specific data
  resourceName?: string; // Tool/resource name
  parameters?: any;
  response?: any;
  userIntent?: string;

  // Error tracking
  isError?: boolean;
  error?: object;

  // Legacy fields for MCPCat API compatibility
  actorId?: string; // Maps to identifyActorGivenId in some contexts
  eventId?: string; // Custom event ID
  identifyData?: object; // Legacy name for identifyActorData
}

export interface UnredactedEvent extends Partial<Event> {
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

export interface HighLevelMCPServerLike {
  _registeredTools: { [name: string]: RegisteredTool };
  server: MCPServerLike;
  // Tool registration methods - simplified signatures without Zod dependency
  tool?(name: string, cb: ToolCallback): void;
  tool?(name: string, description: string, cb: ToolCallback): void;
  tool?(name: string, paramsSchema: any, cb: ToolCallback): void;
  tool?(
    name: string,
    description: string,
    paramsSchema: any,
    cb: ToolCallback,
  ): void;
  registerTool?(
    name: string,
    config: {
      description?: string;
      inputSchema?: any;
    },
    handler: ToolCallback,
  ): void;
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
