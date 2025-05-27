import { describe, it, expect } from "vitest";
import {
  setupTestServerAndClient,
  resetTodos,
} from "./test-utils/client-server-factory";
import {
  ListToolsResultSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

describe("Basic Server Test", () => {
  it("should be able to call tools without tracking", async () => {
    resetTodos();
    const { server, client, cleanup } = await setupTestServerAndClient();

    try {
      // List tools first to ensure they're available
      const toolsResponse = await client.request(
        {
          method: "tools/list",
          params: {},
        },
        ListToolsResultSchema,
      );

      expect(toolsResponse.tools).toBeDefined();
      expect(toolsResponse.tools.length).toBeGreaterThan(0);

      // Call add_todo
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "add_todo",
            arguments: {
              text: "Test todo",
            },
          },
        },
        CallToolResultSchema,
      );

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain("Added todo");
    } finally {
      await cleanup();
    }
  });

  it("should be able to access server info from regular Server instance", async () => {
    const { server, cleanup } = await setupTestServerAndClient();

    try {
      // Access _serverInfo even though it might be private
      const serverInfo = (server as any)._serverInfo;

      expect(serverInfo).toBeDefined();
      expect(serverInfo.name).toBe("test server");
      expect(serverInfo.version).toBe("1.0");
    } finally {
      await cleanup();
    }
  });

  it("should be able to access server info with McpServer if available", async () => {
    // Try to import McpServer
    let McpServer: any;
    let hasCompatibleVersion = false;

    try {
      const { McpServer: ImportedMcpServer } = await import(
        "@modelcontextprotocol/sdk/server/mcp.js"
      );
      McpServer = ImportedMcpServer;
      hasCompatibleVersion = true;
    } catch (error) {
      // McpServer not available in this version
      hasCompatibleVersion = false;
    }

    if (!hasCompatibleVersion) {
      console.log(
        "Skipping McpServer server info test - requires @modelcontextprotocol/sdk v1.3.0 or higher",
      );
      return;
    }

    // Create McpServer instance
    const mcpServer = new McpServer({
      name: "test-mcp-server-info",
      version: "2.0.0",
    });

    // Access server info from the underlying server
    const underlyingServer = mcpServer.server;
    const serverInfo = (underlyingServer as any)._serverInfo;

    expect(serverInfo).toBeDefined();
    expect(serverInfo.name).toBe("test-mcp-server-info");
    expect(serverInfo.version).toBe("2.0.0");
  });

  it("should verify that server info is used by isCompatibleServerType", async () => {
    const { server, cleanup } = await setupTestServerAndClient();

    try {
      // Import our compatibility function
      const { isCompatibleServerType } = await import(
        "../modules/compatibility.js"
      );

      // This should not throw since our test server has proper _serverInfo
      const result = isCompatibleServerType(server);
      expect(result).toBe(server);

      // Verify we can still access server info after compatibility check
      const serverInfo = (result as any)._serverInfo;
      expect(serverInfo).toBeDefined();
      expect(serverInfo.name).toBe("test server");
    } finally {
      await cleanup();
    }
  });
});
