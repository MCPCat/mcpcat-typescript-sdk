import { MCPServerLike } from "../types.js";
import { writeToLog } from "./logging.js";

// Function to log compatibility information
export function logCompatibilityWarning(): void {
  writeToLog(
    "MCPCat SDK Compatibility: This version supports MCP SDK versions v1.0 - v1.12",
  );
}

// Type guard function that validates server compatibility and returns typed server
export function isCompatibleServerType(server: any): MCPServerLike {
  if (!server || typeof server !== "object") {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server must be an object.",
    );
  }

  // Check if this is an McpServer wrapper (has a 'server' property)
  let targetServer = server;
  if (server.server && typeof server.server === "object") {
    // This looks like an McpServer instance, use the underlying server
    targetServer = server.server;
  }

  if (typeof targetServer.setRequestHandler !== "function") {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server must have a setRequestHandler method.",
    );
  }

  if (
    !targetServer._requestHandlers ||
    !(targetServer._requestHandlers instanceof Map)
  ) {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server._requestHandlers is not accessible.",
    );
  }

  // Validate that _requestHandlers contains functions with compatible signatures
  if (typeof targetServer._requestHandlers.get !== "function") {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server._requestHandlers must be a Map with a get method.",
    );
  }
  if (typeof targetServer.getClientVersion !== "function") {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server.getClientVersion must be a function.",
    );
  }

  if (
    typeof targetServer._serverInfo !== "object" ||
    !targetServer._serverInfo.name
  ) {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server._serverInfo is not accessible or missing name.",
    );
  }

  return targetServer as MCPServerLike;
}

export function getMCPCompatibleErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    try {
      return JSON.stringify(error, Object.getOwnPropertyNames(error));
    } catch {
      return "Unknown error";
    }
  } else if (typeof error === "string") {
    return error;
  } else if (typeof error === "object" && error !== null) {
    return JSON.stringify(error);
  }
  return "Unknown error";
}
