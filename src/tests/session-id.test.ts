import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setupTestServerAndClient,
  resetTodos,
} from "./test-utils/client-server-factory";
import { track } from "../index";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types";
import { EventCapture } from "./test-utils";
import { getServerTrackingData } from "../modules/internal";
import { HighLevelMCPServerLike } from "../types";
import {
  deriveSessionIdFromMCPSession,
  getServerSessionId,
} from "../modules/session";

describe("Session ID Management", () => {
  let server: HighLevelMCPServerLike;
  let client: any;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    resetTodos();
    const setup = await setupTestServerAndClient();
    server = setup.server;
    client = setup.client;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("Deterministic KSUID Derivation", () => {
    it("should generate deterministic session IDs from the same MCP sessionId", () => {
      const mcpSessionId = "test-session-123";
      const projectId = "proj_abc";

      const sessionId1 = deriveSessionIdFromMCPSession(mcpSessionId, projectId);
      const sessionId2 = deriveSessionIdFromMCPSession(mcpSessionId, projectId);

      expect(sessionId1).toBe(sessionId2);
      expect(sessionId1).toMatch(/^ses_/);
    });

    it("should generate different session IDs for different MCP sessionIds", () => {
      const projectId = "proj_abc";

      const sessionId1 = deriveSessionIdFromMCPSession("session-1", projectId);
      const sessionId2 = deriveSessionIdFromMCPSession("session-2", projectId);

      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1).toMatch(/^ses_/);
      expect(sessionId2).toMatch(/^ses_/);
    });

    it("should generate different session IDs for different projectIds", () => {
      const mcpSessionId = "test-session-123";

      const sessionId1 = deriveSessionIdFromMCPSession(
        mcpSessionId,
        "proj_abc",
      );
      const sessionId2 = deriveSessionIdFromMCPSession(
        mcpSessionId,
        "proj_xyz",
      );

      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1).toMatch(/^ses_/);
      expect(sessionId2).toMatch(/^ses_/);
    });

    it("should handle missing projectId gracefully", () => {
      const mcpSessionId = "test-session-123";

      const sessionId1 = deriveSessionIdFromMCPSession(mcpSessionId);
      const sessionId2 = deriveSessionIdFromMCPSession(mcpSessionId);
      const sessionId3 = deriveSessionIdFromMCPSession(mcpSessionId, undefined);

      expect(sessionId1).toBe(sessionId2);
      expect(sessionId1).toBe(sessionId3);
      expect(sessionId1).toMatch(/^ses_/);
    });

    it("should generate different session IDs when projectId is present vs absent", () => {
      const mcpSessionId = "test-session-123";

      const sessionIdWithProject = deriveSessionIdFromMCPSession(
        mcpSessionId,
        "proj_abc",
      );
      const sessionIdWithoutProject =
        deriveSessionIdFromMCPSession(mcpSessionId);

      expect(sessionIdWithProject).not.toBe(sessionIdWithoutProject);
    });
  });

  describe("MCP SessionId Prioritization", () => {
    it("should use MCP sessionId when provided in extra parameter", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-mcp";
      const mcpSessionId = "mcp-session-abc-123";

      track(server, projectId, {
        enableTracing: true,
      });

      // Get the low-level server
      const lowLevelServer = server.server;

      // Simulate MCP sessionId in extra parameter
      const extra = { sessionId: mcpSessionId };

      // Get session ID with MCP sessionId provided
      const sessionId = getServerSessionId(lowLevelServer, extra);

      // Verify it's deterministically derived
      const expectedSessionId = deriveSessionIdFromMCPSession(
        mcpSessionId,
        projectId,
      );
      expect(sessionId).toBe(expectedSessionId);

      // Verify tracking data is updated
      const data = getServerTrackingData(lowLevelServer);
      expect(data?.lastMcpSessionId).toBe(mcpSessionId);
      expect(data?.sessionSource).toBe("mcp");

      await eventCapture.stop();
    });

    it("should use MCPCat-generated sessionId when no MCP sessionId provided", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      track(server, "test-project", {
        enableTracing: true,
      });

      const lowLevelServer = server.server;

      // Get initial session ID without MCP sessionId
      const sessionId1 = getServerSessionId(lowLevelServer);
      expect(sessionId1).toMatch(/^ses_/);

      // Verify tracking data shows MCPCat source
      const data = getServerTrackingData(lowLevelServer);
      expect(data?.sessionSource).toBe("mcpcat");
      expect(data?.lastMcpSessionId).toBeUndefined();

      // Get session ID again - should be the same
      const sessionId2 = getServerSessionId(lowLevelServer);
      expect(sessionId2).toBe(sessionId1);

      await eventCapture.stop();
    });

    it("should switch to MCP-derived sessionId when MCP sessionId appears", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-switch";
      const mcpSessionId = "mcp-session-appears";

      track(server, projectId, {
        enableTracing: true,
      });

      const lowLevelServer = server.server;

      // Start with no MCP sessionId
      const mcpcatSessionId = getServerSessionId(lowLevelServer);
      expect(mcpcatSessionId).toMatch(/^ses_/);

      let data = getServerTrackingData(lowLevelServer);
      expect(data?.sessionSource).toBe("mcpcat");

      // Now provide MCP sessionId
      const extra = { sessionId: mcpSessionId };
      const mcpDerivedSessionId = getServerSessionId(lowLevelServer, extra);

      // Verify it switched to MCP-derived ID
      const expectedSessionId = deriveSessionIdFromMCPSession(
        mcpSessionId,
        projectId,
      );
      expect(mcpDerivedSessionId).toBe(expectedSessionId);
      expect(mcpDerivedSessionId).not.toBe(mcpcatSessionId);

      // Verify tracking data is updated
      data = getServerTrackingData(lowLevelServer);
      expect(data?.lastMcpSessionId).toBe(mcpSessionId);
      expect(data?.sessionSource).toBe("mcp");

      await eventCapture.stop();
    });

    it("should keep last derived sessionId when MCP sessionId disappears", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-disappear";
      const mcpSessionId = "mcp-session-disappears";

      track(server, projectId, {
        enableTracing: true,
      });

      const lowLevelServer = server.server;

      // Provide MCP sessionId
      const extra = { sessionId: mcpSessionId };
      const mcpDerivedSessionId = getServerSessionId(lowLevelServer, extra);

      const expectedSessionId = deriveSessionIdFromMCPSession(
        mcpSessionId,
        projectId,
      );
      expect(mcpDerivedSessionId).toBe(expectedSessionId);

      // Now call without MCP sessionId (it disappeared)
      const sessionIdAfterDisappear = getServerSessionId(lowLevelServer);

      // Should keep using the last derived sessionId
      expect(sessionIdAfterDisappear).toBe(mcpDerivedSessionId);

      // Verify tracking data still shows MCP source
      const data = getServerTrackingData(lowLevelServer);
      expect(data?.sessionSource).toBe("mcp");
      expect(data?.lastMcpSessionId).toBe(mcpSessionId);

      await eventCapture.stop();
    });

    it("should regenerate sessionId when MCP sessionId changes", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-change";
      const mcpSessionId1 = "mcp-session-first";
      const mcpSessionId2 = "mcp-session-second";

      track(server, projectId, {
        enableTracing: true,
      });

      const lowLevelServer = server.server;

      // Provide first MCP sessionId
      const extra1 = { sessionId: mcpSessionId1 };
      const sessionId1 = getServerSessionId(lowLevelServer, extra1);

      const expectedSessionId1 = deriveSessionIdFromMCPSession(
        mcpSessionId1,
        projectId,
      );
      expect(sessionId1).toBe(expectedSessionId1);

      // Change to second MCP sessionId
      const extra2 = { sessionId: mcpSessionId2 };
      const sessionId2 = getServerSessionId(lowLevelServer, extra2);

      const expectedSessionId2 = deriveSessionIdFromMCPSession(
        mcpSessionId2,
        projectId,
      );
      expect(sessionId2).toBe(expectedSessionId2);
      expect(sessionId2).not.toBe(sessionId1);

      // Verify tracking data is updated
      const data = getServerTrackingData(lowLevelServer);
      expect(data?.lastMcpSessionId).toBe(mcpSessionId2);
      expect(data?.sessionSource).toBe("mcp");

      await eventCapture.stop();
    });
  });

  describe("Session Timeout Behavior", () => {
    it("should NOT apply timeout to MCP-derived sessions", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-timeout";
      const mcpSessionId = "mcp-session-persistent";

      track(server, projectId, {
        enableTracing: true,
      });

      const lowLevelServer = server.server;

      // Get MCP-derived session ID
      const extra = { sessionId: mcpSessionId };
      const sessionId1 = getServerSessionId(lowLevelServer, extra);

      // Manually set lastActivity to simulate timeout (31 minutes ago)
      const data = getServerTrackingData(lowLevelServer);
      if (data) {
        data.lastActivity = new Date(Date.now() - 31 * 60 * 1000);
      }

      // Get session ID again with same MCP sessionId
      const sessionId2 = getServerSessionId(lowLevelServer, extra);

      // Should still be the same (no timeout for MCP sessions)
      expect(sessionId2).toBe(sessionId1);

      await eventCapture.stop();
    });

    it("should apply timeout to MCPCat-generated sessions", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      track(server, "test-project", {
        enableTracing: true,
      });

      const lowLevelServer = server.server;

      // Get MCPCat-generated session ID
      const sessionId1 = getServerSessionId(lowLevelServer);

      // Manually set lastActivity to simulate timeout (31 minutes ago)
      const data = getServerTrackingData(lowLevelServer);
      if (data) {
        data.lastActivity = new Date(Date.now() - 31 * 60 * 1000);
      }

      // Get session ID again without MCP sessionId
      const sessionId2 = getServerSessionId(lowLevelServer);

      // Should be different (timeout occurred)
      expect(sessionId2).not.toBe(sessionId1);
      expect(sessionId2).toMatch(/^ses_/);

      await eventCapture.stop();
    });
  });

  describe("Event Publishing with Session IDs", () => {
    it("should publish events with MCP-derived session IDs", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-events";
      const mcpSessionId = "mcp-session-for-events";

      track(server, projectId, {
        enableTracing: true,
      });

      // TODO: This test would require mocking the transport to inject sessionId into extra
      // For now, we'll verify the logic with direct function calls above
      // In a real MCP environment, the sessionId would come from the transport layer

      await eventCapture.stop();
    });
  });

  describe("Session Reconnection", () => {
    it("should reconnect user to previous session when reinitializing without MCP sessionId", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-reconnect";
      let identifyCallCount = 0;

      track(server, projectId, {
        enableTracing: true,
        identify: async (request: any, extra?: any) => {
          identifyCallCount++;
          return {
            userId: "user-123",
            userName: "Test User",
          };
        },
      });

      const lowLevelServer = server.server;

      // First initialize - creates initial session
      const request1 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request1, {});

      const data1 = getServerTrackingData(lowLevelServer);
      const firstSessionId = data1?.sessionId;
      expect(firstSessionId).toMatch(/^ses_/);
      expect(identifyCallCount).toBe(1);

      // Second initialize WITHOUT MCP sessionId - should reconnect to first session
      const request2 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request2, {});

      const data2 = getServerTrackingData(lowLevelServer);
      const secondSessionId = data2?.sessionId;

      // Should reuse the first session
      expect(secondSessionId).toBe(firstSessionId);
      expect(identifyCallCount).toBe(2);

      await eventCapture.stop();
    });

    it("should create new session if previous session expired (>30 min)", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-timeout-reconnect";
      let identifyCallCount = 0;

      track(server, projectId, {
        enableTracing: true,
        identify: async (request: any, extra?: any) => {
          identifyCallCount++;
          return {
            userId: "user-456",
            userName: "Test User",
          };
        },
      });

      const lowLevelServer = server.server;

      // First initialize
      const request1 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request1, {});

      const data1 = getServerTrackingData(lowLevelServer);
      const firstSessionId = data1?.sessionId;

      // Manually expire the session by setting lastActivity to 31 minutes ago
      // Also update the cache entry to reflect this expiration
      if (data1) {
        data1.lastActivity = new Date(Date.now() - 31 * 60 * 1000);
        // Update cache entry to 31 minutes ago
        const { _testSetUserSession } = await import("../modules/internal.js");
        _testSetUserSession(
          "user-456",
          firstSessionId!,
          Date.now() - 31 * 60 * 1000,
        );
      }

      // Second initialize - session expired, should get new session
      const request2 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request2, {});

      const data2 = getServerTrackingData(lowLevelServer);
      const secondSessionId = data2?.sessionId;

      // Should have a different session (expired)
      expect(secondSessionId).not.toBe(firstSessionId);
      expect(secondSessionId).toMatch(/^ses_/);
      expect(identifyCallCount).toBe(2);

      await eventCapture.stop();
    });

    it("should NOT reconnect when MCP sessionId is provided (MCP takes priority)", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-mcp-priority";
      const mcpSessionId1 = "mcp-session-aaa";
      const mcpSessionId2 = "mcp-session-bbb";

      track(server, projectId, {
        enableTracing: true,
        identify: async (request: any, extra?: any) => {
          return {
            userId: "user-789",
            userName: "Test User",
          };
        },
      });

      const lowLevelServer = server.server;

      // First initialize with MCP sessionId
      const request1 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request1, {
        sessionId: mcpSessionId1,
      });

      const data1 = getServerTrackingData(lowLevelServer);
      const firstSessionId = data1?.sessionId;
      const expectedSessionId1 = deriveSessionIdFromMCPSession(
        mcpSessionId1,
        projectId,
      );
      expect(firstSessionId).toBe(expectedSessionId1);

      // Second initialize with DIFFERENT MCP sessionId
      // Should use the new MCP sessionId, NOT reconnect to previous
      const request2 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request2, {
        sessionId: mcpSessionId2,
      });

      const data2 = getServerTrackingData(lowLevelServer);
      const secondSessionId = data2?.sessionId;
      const expectedSessionId2 = deriveSessionIdFromMCPSession(
        mcpSessionId2,
        projectId,
      );

      // Should use new MCP-derived session, not reconnect
      expect(secondSessionId).toBe(expectedSessionId2);
      expect(secondSessionId).not.toBe(firstSessionId);

      await eventCapture.stop();
    });

    it("should create new session when no identify function configured", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-no-identify";

      track(server, projectId, {
        enableTracing: true,
        // No identify function
      });

      const lowLevelServer = server.server;

      // First initialize
      const request1 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request1, {});

      const data1 = getServerTrackingData(lowLevelServer);
      const firstSessionId = data1?.sessionId;

      // Second initialize - no identify, should timeout and create new session
      // Simulate timeout
      if (data1) {
        data1.lastActivity = new Date(Date.now() - 31 * 60 * 1000);
      }

      const request2 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request2, {});

      const data2 = getServerTrackingData(lowLevelServer);
      const secondSessionId = data2?.sessionId;

      // Should have different session (no reconnection without identify)
      expect(secondSessionId).not.toBe(firstSessionId);

      await eventCapture.stop();
    });

    it("should handle different users reconnecting to their own sessions", async () => {
      const eventCapture = new EventCapture();
      await eventCapture.start();

      const projectId = "test-project-multi-user";
      let currentUserId = "user-alice";

      track(server, projectId, {
        enableTracing: true,
        identify: async (request: any, extra?: any) => {
          return {
            userId: currentUserId,
            userName: currentUserId === "user-alice" ? "Alice" : "Bob",
          };
        },
      });

      const lowLevelServer = server.server;

      // Alice's first session
      currentUserId = "user-alice";
      const request1 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request1, {});
      const aliceSession1 = getServerTrackingData(lowLevelServer)?.sessionId;

      // Bob's first session
      currentUserId = "user-bob";
      const request2 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request2, {});
      const bobSession1 = getServerTrackingData(lowLevelServer)?.sessionId;

      // Different users should have different sessions
      expect(aliceSession1).not.toBe(bobSession1);

      // Alice reconnects - should get her original session back
      currentUserId = "user-alice";
      const request3 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request3, {});
      const aliceSession2 = getServerTrackingData(lowLevelServer)?.sessionId;

      expect(aliceSession2).toBe(aliceSession1);

      // Bob reconnects - should get his original session back
      currentUserId = "user-bob";
      const request4 = {
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0" },
        },
      };
      await lowLevelServer._requestHandlers.get("initialize")?.(request4, {});
      const bobSession2 = getServerTrackingData(lowLevelServer)?.sessionId;

      expect(bobSession2).toBe(bobSession1);

      await eventCapture.stop();
    });
  });
});
