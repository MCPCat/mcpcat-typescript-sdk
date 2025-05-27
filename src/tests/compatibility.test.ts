import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isCompatibleServerType,
  getMCPCompatibleErrorMessage,
  logCompatibilityWarning,
} from "../modules/compatibility";

// Mock the logging module
vi.mock("../modules/logging", () => ({
  writeToLog: vi.fn(),
}));

// Import after mocking
import { writeToLog } from "../modules/logging";

describe("Compatibility Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isCompatibleServerType", () => {
    it("should validate a fully compatible server", () => {
      const validServer = {
        setRequestHandler: vi.fn(),
        _requestHandlers: new Map([["test", vi.fn()]]),
        getClientVersion: vi.fn(),
        _serverInfo: { name: "TestServer" },
      };

      const result = isCompatibleServerType(validServer);
      expect(result).toBe(validServer);
      expect(writeToLog).not.toHaveBeenCalled();
    });

    it("should throw error and log warning for null server", () => {
      expect(() => isCompatibleServerType(null)).toThrow(
        "MCPCat SDK compatibility error: Server must be an object.",
      );
      expect(writeToLog).toHaveBeenCalledWith(
        "MCPCat SDK Compatibility: This version supports MCP SDK versions v1.0 - v1.12",
      );
    });

    it("should throw error and log warning for undefined server", () => {
      expect(() => isCompatibleServerType(undefined)).toThrow(
        "MCPCat SDK compatibility error: Server must be an object.",
      );
      expect(writeToLog).toHaveBeenCalledWith(
        "MCPCat SDK Compatibility: This version supports MCP SDK versions v1.0 - v1.12",
      );
    });

    it("should throw error and log warning for non-object server", () => {
      expect(() => isCompatibleServerType("not an object")).toThrow(
        "MCPCat SDK compatibility error: Server must be an object.",
      );
      expect(writeToLog).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      expect(() => isCompatibleServerType(42)).toThrow(
        "MCPCat SDK compatibility error: Server must be an object.",
      );
      expect(writeToLog).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      expect(() => isCompatibleServerType(true)).toThrow(
        "MCPCat SDK compatibility error: Server must be an object.",
      );
      expect(writeToLog).toHaveBeenCalledTimes(1);
    });

    it("should throw error and log warning when setRequestHandler is missing", () => {
      const server = {
        _requestHandlers: new Map(),
        getClientVersion: vi.fn(),
        _serverInfo: { name: "TestServer" },
      };

      expect(() => isCompatibleServerType(server)).toThrow(
        "MCPCat SDK compatibility error: Server must have a setRequestHandler method.",
      );
      expect(writeToLog).toHaveBeenCalledWith(
        "MCPCat SDK Compatibility: This version supports MCP SDK versions v1.0 - v1.12",
      );
    });

    it("should throw error and log warning when setRequestHandler is not a function", () => {
      const server = {
        setRequestHandler: "not a function",
        _requestHandlers: new Map(),
        getClientVersion: vi.fn(),
        _serverInfo: { name: "TestServer" },
      };

      expect(() => isCompatibleServerType(server)).toThrow(
        "MCPCat SDK compatibility error: Server must have a setRequestHandler method.",
      );
      expect(writeToLog).toHaveBeenCalled();
    });

    it("should throw error and log warning when _requestHandlers is missing", () => {
      const server = {
        setRequestHandler: vi.fn(),
        getClientVersion: vi.fn(),
        _serverInfo: { name: "TestServer" },
      };

      expect(() => isCompatibleServerType(server)).toThrow(
        "MCPCat SDK compatibility error: Server._requestHandlers is not accessible.",
      );
      expect(writeToLog).toHaveBeenCalled();
    });

    it("should throw error and log warning when _requestHandlers is not a Map", () => {
      const server = {
        setRequestHandler: vi.fn(),
        _requestHandlers: {},
        getClientVersion: vi.fn(),
        _serverInfo: { name: "TestServer" },
      };

      expect(() => isCompatibleServerType(server)).toThrow(
        "MCPCat SDK compatibility error: Server._requestHandlers is not accessible.",
      );
      expect(writeToLog).toHaveBeenCalled();
    });

    it("should throw error and log warning when _requestHandlers.get is not a function", () => {
      const server = {
        setRequestHandler: vi.fn(),
        _requestHandlers: { get: "not a function" },
        getClientVersion: vi.fn(),
        _serverInfo: { name: "TestServer" },
      };

      expect(() => isCompatibleServerType(server)).toThrow(
        "MCPCat SDK compatibility error: Server._requestHandlers is not accessible.",
      );
      expect(writeToLog).toHaveBeenCalled();
    });

    it("should throw error and log warning when getClientVersion is missing", () => {
      const server = {
        setRequestHandler: vi.fn(),
        _requestHandlers: new Map(),
        _serverInfo: { name: "TestServer" },
      };

      expect(() => isCompatibleServerType(server)).toThrow(
        "MCPCat SDK compatibility error: Server.getClientVersion must be a function.",
      );
      expect(writeToLog).toHaveBeenCalled();
    });

    it("should throw error and log warning when getClientVersion is not a function", () => {
      const server = {
        setRequestHandler: vi.fn(),
        _requestHandlers: new Map(),
        getClientVersion: "not a function",
        _serverInfo: { name: "TestServer" },
      };

      expect(() => isCompatibleServerType(server)).toThrow(
        "MCPCat SDK compatibility error: Server.getClientVersion must be a function.",
      );
      expect(writeToLog).toHaveBeenCalled();
    });

    it("should throw error and log warning when _serverInfo is missing", () => {
      const server = {
        setRequestHandler: vi.fn(),
        _requestHandlers: new Map(),
        getClientVersion: vi.fn(),
      };

      expect(() => isCompatibleServerType(server)).toThrow(
        "MCPCat SDK compatibility error: Server._serverInfo is not accessible or missing name.",
      );
      expect(writeToLog).toHaveBeenCalled();
    });

    it("should throw error and log warning when _serverInfo is not an object", () => {
      const server = {
        setRequestHandler: vi.fn(),
        _requestHandlers: new Map(),
        getClientVersion: vi.fn(),
        _serverInfo: "not an object",
      };

      expect(() => isCompatibleServerType(server)).toThrow(
        "MCPCat SDK compatibility error: Server._serverInfo is not accessible or missing name.",
      );
      expect(writeToLog).toHaveBeenCalled();
    });

    it("should throw error and log warning when _serverInfo.name is missing", () => {
      const server = {
        setRequestHandler: vi.fn(),
        _requestHandlers: new Map(),
        getClientVersion: vi.fn(),
        _serverInfo: {},
      };

      expect(() => isCompatibleServerType(server)).toThrow(
        "MCPCat SDK compatibility error: Server._serverInfo is not accessible or missing name.",
      );
      expect(writeToLog).toHaveBeenCalled();
    });
  });

  describe("getMCPCompatibleErrorMessage", () => {
    it("should handle Error instances with standard properties", () => {
      const error = new Error("Test error message");
      const result = getMCPCompatibleErrorMessage(error);
      const parsed = JSON.parse(result);

      expect(parsed.message).toBe("Test error message");
      // Note: name property might not be enumerable in all environments
      if (parsed.name !== undefined) {
        expect(parsed.name).toBe("Error");
      }
      expect(parsed.stack).toBeDefined();
    });

    it("should handle Error instances with custom properties", () => {
      const error: any = new Error("Test error");
      error.code = "CUSTOM_ERROR";
      error.statusCode = 500;

      const result = getMCPCompatibleErrorMessage(error);
      const parsed = JSON.parse(result);

      expect(parsed.message).toBe("Test error");
      expect(parsed.code).toBe("CUSTOM_ERROR");
      expect(parsed.statusCode).toBe(500);
    });

    it("should handle string errors", () => {
      const result = getMCPCompatibleErrorMessage("String error message");
      expect(result).toBe("String error message");
    });

    it("should handle plain objects", () => {
      const errorObj = { code: "ERROR_CODE", details: "Some details" };
      const result = getMCPCompatibleErrorMessage(errorObj);
      expect(result).toBe(JSON.stringify(errorObj));
    });

    it("should handle null", () => {
      const result = getMCPCompatibleErrorMessage(null);
      expect(result).toBe("Unknown error");
    });

    it("should handle undefined", () => {
      const result = getMCPCompatibleErrorMessage(undefined);
      expect(result).toBe("Unknown error");
    });

    it("should handle numbers", () => {
      const result = getMCPCompatibleErrorMessage(42);
      expect(result).toBe("Unknown error");
    });

    it("should handle booleans", () => {
      const result = getMCPCompatibleErrorMessage(false);
      expect(result).toBe("Unknown error");
    });

    it("should handle circular reference errors", () => {
      const error: any = new Error("Circular error");
      error.circular = error; // Create circular reference

      const result = getMCPCompatibleErrorMessage(error);
      expect(result).toBe("Unknown error");
    });

    it("should handle arrays", () => {
      const errorArray = ["error1", "error2"];
      const result = getMCPCompatibleErrorMessage(errorArray);
      expect(result).toBe(JSON.stringify(errorArray));
    });
  });

  describe("McpServer compatibility", () => {
    it("should handle McpServer instances with server property", () => {
      const underlyingServer = {
        setRequestHandler: vi.fn(),
        _requestHandlers: new Map([["test", vi.fn()]]),
        getClientVersion: vi.fn(),
        _serverInfo: { name: "TestServer" },
      };

      const mcpServerWrapper = {
        server: underlyingServer,
        // Other McpServer properties
        requestContext: {},
        toolCallId: "test-id",
      };

      const result = isCompatibleServerType(mcpServerWrapper);
      expect(result).toBe(underlyingServer);
      expect(writeToLog).not.toHaveBeenCalled();
    });

    it("should validate the underlying server when McpServer wrapper is provided", () => {
      const invalidUnderlyingServer = {
        // Missing setRequestHandler
        _requestHandlers: new Map(),
        getClientVersion: vi.fn(),
        _serverInfo: { name: "TestServer" },
      };

      const mcpServerWrapper = {
        server: invalidUnderlyingServer,
      };

      expect(() => isCompatibleServerType(mcpServerWrapper)).toThrow(
        "MCPCat SDK compatibility error: Server must have a setRequestHandler method.",
      );
      expect(writeToLog).toHaveBeenCalled();
    });

    it("should handle objects with server property that is not an object", () => {
      const mcpServerWrapper = {
        server: "not an object",
        setRequestHandler: vi.fn(),
        _requestHandlers: new Map(),
        getClientVersion: vi.fn(),
        _serverInfo: { name: "TestServer" },
      };

      // Should use the wrapper itself since server property is not an object
      const result = isCompatibleServerType(mcpServerWrapper);
      expect(result).toBe(mcpServerWrapper);
      expect(writeToLog).not.toHaveBeenCalled();
    });

    it("should handle objects with null server property", () => {
      const mcpServerWrapper = {
        server: null,
        setRequestHandler: vi.fn(),
        _requestHandlers: new Map(),
        getClientVersion: vi.fn(),
        _serverInfo: { name: "TestServer" },
      };

      // Should use the wrapper itself since server property is null
      const result = isCompatibleServerType(mcpServerWrapper);
      expect(result).toBe(mcpServerWrapper);
      expect(writeToLog).not.toHaveBeenCalled();
    });

    it("should validate all required properties on the underlying server", () => {
      const testCases = [
        {
          name: "missing _requestHandlers",
          server: {
            setRequestHandler: vi.fn(),
            getClientVersion: vi.fn(),
            _serverInfo: { name: "TestServer" },
          },
          expectedError:
            "MCPCat SDK compatibility error: Server._requestHandlers is not accessible.",
        },
        {
          name: "missing getClientVersion",
          server: {
            setRequestHandler: vi.fn(),
            _requestHandlers: new Map(),
            _serverInfo: { name: "TestServer" },
          },
          expectedError:
            "MCPCat SDK compatibility error: Server.getClientVersion must be a function.",
        },
        {
          name: "missing _serverInfo",
          server: {
            setRequestHandler: vi.fn(),
            _requestHandlers: new Map(),
            getClientVersion: vi.fn(),
          },
          expectedError:
            "MCPCat SDK compatibility error: Server._serverInfo is not accessible or missing name.",
        },
      ];

      testCases.forEach((testCase) => {
        vi.clearAllMocks();
        const mcpServerWrapper = { server: testCase.server };

        expect(() => isCompatibleServerType(mcpServerWrapper)).toThrow(
          testCase.expectedError,
        );
        expect(writeToLog).toHaveBeenCalledWith(
          "MCPCat SDK Compatibility: This version supports MCP SDK versions v1.0 - v1.12",
        );
      });
    });
  });

  describe("logCompatibilityWarning", () => {
    it("should log the correct compatibility message to the log file", () => {
      logCompatibilityWarning();

      expect(writeToLog).toHaveBeenCalledWith(
        "MCPCat SDK Compatibility: This version supports MCP SDK versions v1.0 - v1.12",
      );
      expect(writeToLog).toHaveBeenCalledTimes(1);
    });
  });

  describe("McpServer integration tests", () => {
    // Dynamically check if McpServer is available (v1.3.0+)
    let McpServer: any;
    let hasCompatibleVersion = false;

    beforeEach(async () => {
      try {
        // Try to import McpServer - it's available in v1.3.0+
        const { McpServer: ImportedMcpServer } = await import(
          "@modelcontextprotocol/sdk/server/mcp.js"
        );
        McpServer = ImportedMcpServer;
        hasCompatibleVersion = true;
      } catch (error) {
        // McpServer not available in this version
        hasCompatibleVersion = false;
      }
    });

    it("should work with real McpServer instances if available", async () => {
      if (!hasCompatibleVersion) {
        console.log(
          "Skipping McpServer test - requires @modelcontextprotocol/sdk v1.3.0 or higher",
        );
        return;
      }

      // Create a real McpServer instance with server info
      const mcpServer = new McpServer({
        name: "test-mcp-server",
        version: "1.0.0",
      });

      // Test that isCompatibleServerType correctly handles it
      const result = isCompatibleServerType(mcpServer);

      // Should return the underlying server
      expect(result).toBe(mcpServer.server);
      expect(result).toBeDefined();
      expect(typeof result.setRequestHandler).toBe("function");
      expect(result._requestHandlers).toBeInstanceOf(Map);
      // Note: _serverInfo exists but may be private - our compatibility check should handle this
    });

    it("should validate real McpServer underlying server properties", async () => {
      if (!hasCompatibleVersion) {
        console.log(
          "Skipping McpServer validation test - requires @modelcontextprotocol/sdk v1.3.0 or higher",
        );
        return;
      }

      const mcpServer = new McpServer({
        name: "test-validation-server",
        version: "1.0.0",
      });
      const underlyingServer = mcpServer.server;

      // Verify all required properties exist on the real server
      expect(underlyingServer).toBeDefined();
      expect(typeof underlyingServer.setRequestHandler).toBe("function");
      expect(underlyingServer._requestHandlers).toBeInstanceOf(Map);
      expect(typeof underlyingServer.getClientVersion).toBe("function");

      // Check if _serverInfo exists (it might be private but still accessible)
      // TypeScript will complain but JavaScript can still access it
      const serverInfo = (underlyingServer as any)._serverInfo;
      if (serverInfo) {
        expect(serverInfo).toBeDefined();
        expect(serverInfo.name).toBe("test-validation-server");
        expect(serverInfo.version).toBe("1.0.0");
      } else {
        // If truly private and inaccessible, we should update our compatibility check
        console.log(
          "Note: _serverInfo is not accessible in this MCP SDK version",
        );
      }
    });

    it("should show compatibility message when McpServer is not available", () => {
      if (hasCompatibleVersion) {
        console.log("Skipping version check test - McpServer is available");
        return;
      }

      // This test only runs on older versions
      expect(hasCompatibleVersion).toBe(false);
      console.log(
        "McpServer not available - using @modelcontextprotocol/sdk < v1.3.0",
      );
    });
  });
});
