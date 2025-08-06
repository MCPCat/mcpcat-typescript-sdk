import { HighLevelMCPServerLike, MCPServerLike } from "../types.js";
import { writeToLog } from "./logging.js";

// Function to log compatibility information
export function logCompatibilityWarning(): void {
  writeToLog(
    "MCPCat SDK Compatibility: This version supports MCP SDK versions v1.0 - v1.12",
  );
}

// Check if server has high-level structure (wrapper with .server property)
export function isHighLevelServer(server: any): boolean {
  return (
    server &&
    typeof server === "object" &&
    server.server &&
    typeof server.server === "object"
  );
}

// Check if server has low-level structure (no .server property)
export function isLowLevelServer(server: any): boolean {
  return server && typeof server === "object" && !server.server;
}

// Type guard function that validates server compatibility and returns typed server
export function isCompatibleServerType(
  server: any,
): MCPServerLike | HighLevelMCPServerLike {
  if (!server || typeof server !== "object") {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server must be an object.",
    );
  }

  if (isHighLevelServer(server)) {
    // Validate high-level server requirements
    if (
      !server._registeredTools ||
      typeof server._registeredTools !== "object"
    ) {
      logCompatibilityWarning();
      throw new Error(
        "MCPCat SDK compatibility error: High-level server must have _registeredTools object.",
      );
    }
    if (typeof server.tool !== "function") {
      logCompatibilityWarning();
      throw new Error(
        "MCPCat SDK compatibility error: High-level server must have tool() method.",
      );
    }

    // Validate the underlying low-level server
    const targetServer = server.server;
    validateLowLevelServer(targetServer);

    return server as HighLevelMCPServerLike;
  } else {
    // Direct low-level server validation
    validateLowLevelServer(server);
    return server as MCPServerLike;
  }
}

// Helper function to validate low-level server requirements
function validateLowLevelServer(server: any): void {
  if (typeof server.setRequestHandler !== "function") {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server must have a setRequestHandler method.",
    );
  }

  if (!server._requestHandlers || !(server._requestHandlers instanceof Map)) {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server._requestHandlers is not accessible.",
    );
  }

  // Validate that _requestHandlers contains functions with compatible signatures
  if (typeof server._requestHandlers.get !== "function") {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server._requestHandlers must be a Map with a get method.",
    );
  }

  if (typeof server.getClientVersion !== "function") {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server.getClientVersion must be a function.",
    );
  }

  if (
    !server._serverInfo ||
    typeof server._serverInfo !== "object" ||
    !server._serverInfo.name
  ) {
    logCompatibilityWarning();
    throw new Error(
      "MCPCat SDK compatibility error: Server._serverInfo is not accessible or missing name.",
    );
  }
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
