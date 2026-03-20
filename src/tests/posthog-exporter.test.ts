import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PostHogExporter } from "../modules/exporters/posthog.js";
import { Event } from "../types.js";
import { PublishEventRequestEventTypeEnum } from "mcpcat-api";

describe("PostHogExporter", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("ok"),
    });
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeEvent(overrides: Partial<Event> = {}): Event {
    return {
      id: "evt_test123",
      sessionId: "ses_session456",
      projectId: "proj_1",
      eventType: PublishEventRequestEventTypeEnum.mcpToolsCall,
      timestamp: new Date("2025-01-15T10:00:00Z"),
      resourceName: "get_weather",
      serverName: "weather-server",
      serverVersion: "1.0.0",
      clientName: "claude-desktop",
      clientVersion: "2.0.0",
      duration: 150,
      isError: false,
      ...overrides,
    };
  }

  it("should send correct payload structure for regular events", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(makeEvent());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];

    expect(url).toBe("https://us.i.posthog.com/batch");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.api_key).toBe("phc_test_key");
    expect(body.batch).toHaveLength(1);

    const event = body.batch[0];
    expect(event.event).toBe("mcp_tool_call");
    expect(event.type).toBe("capture");
    expect(event.distinct_id).toBe("ses_session456");
    expect(event.timestamp).toBe("2025-01-15T10:00:00.000Z");

    // Verify properties
    expect(event.properties.$session_id).toBe("ses_session456");
    expect(event.properties.tool_name).toBe("get_weather");
    expect(event.properties.resource_name).toBe("get_weather");
    expect(event.properties.duration_ms).toBe(150);
    expect(event.properties.server_name).toBe("weather-server");
    expect(event.properties.server_version).toBe("1.0.0");
    expect(event.properties.client_name).toBe("claude-desktop");
    expect(event.properties.client_version).toBe("2.0.0");
    expect(event.properties.project_id).toBe("proj_1");
    expect(event.properties.is_error).toBe(false);
  });

  it("should use custom host when provided", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
      host: "https://eu.i.posthog.com",
    });

    await exporter.export(makeEvent());

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://eu.i.posthog.com/batch");
  });

  it("should strip trailing slash from host", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
      host: "https://my-posthog.example.com/",
    });

    await exporter.export(makeEvent());

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://my-posthog.example.com/batch");
  });

  it("should use identifyActorGivenId as distinct_id when available", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(makeEvent({ identifyActorGivenId: "user_abc123" }));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.batch[0].distinct_id).toBe("user_abc123");
  });

  it("should fall back to sessionId when identifyActorGivenId is not set", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(makeEvent({ identifyActorGivenId: undefined }));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.batch[0].distinct_id).toBe("ses_session456");
  });

  it("should send $exception event alongside regular event when isError is true", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(
      makeEvent({
        isError: true,
        error: {
          message: "Connection timeout",
          type: "TimeoutError",
          stack:
            "TimeoutError: Connection timeout\n    at fetch (/app/index.js:10:5)",
        },
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.batch).toHaveLength(2);

    // First event: regular capture
    expect(body.batch[0].event).toBe("mcp_tool_call");
    expect(body.batch[0].properties.is_error).toBe(true);

    // Second event: $exception
    const exceptionEvent = body.batch[1];
    expect(exceptionEvent.event).toBe("$exception");
    expect(exceptionEvent.distinct_id).toBe("ses_session456");
    expect(exceptionEvent.properties.$exception_message).toBe(
      "Connection timeout",
    );
    expect(exceptionEvent.properties.$exception_type).toBe("TimeoutError");
    expect(exceptionEvent.properties.$exception_stacktrace).toBe(
      "TimeoutError: Connection timeout\n    at fetch (/app/index.js:10:5)",
    );
    expect(exceptionEvent.properties.$exception_source).toBe("backend");
    expect(exceptionEvent.properties.$session_id).toBe("ses_session456");
    expect(exceptionEvent.properties.resource_name).toBe("get_weather");
    expect(exceptionEvent.properties.tool_name).toBe("get_weather");
    expect(exceptionEvent.properties.server_name).toBe("weather-server");
  });

  it("should not send $exception event when isError is false", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(makeEvent({ isError: false }));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.batch).toHaveLength(1);
    expect(body.batch[0].event).toBe("mcp_tool_call");
  });

  it("should not throw when fetch fails", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));

    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    // Should not throw
    await expect(exporter.export(makeEvent())).resolves.toBeUndefined();
  });

  it("should not throw when fetch returns non-ok response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad Request"),
    });

    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await expect(exporter.export(makeEvent())).resolves.toBeUndefined();
  });

  it("should include $set person properties from identity data", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(
      makeEvent({
        identifyActorGivenId: "user_abc",
        identifyActorName: "Alice",
        identifyActorData: { email: "alice@example.com", plan: "pro" },
      }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const props = body.batch[0].properties;

    expect(props.$set).toEqual({
      name: "Alice",
      email: "alice@example.com",
      plan: "pro",
    });
  });

  it("should not include $set when no identity data is present", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(makeEvent());

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.batch[0].properties.$set).toBeUndefined();
  });

  it("should pass through parameters and response as-is (objects stay objects)", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(
      makeEvent({
        parameters: { city: "London", units: "celsius" },
        response: { temperature: 15, condition: "cloudy" },
      }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const props = body.batch[0].properties;

    expect(props.parameters).toEqual({ city: "London", units: "celsius" });
    expect(props.response).toEqual({ temperature: 15, condition: "cloudy" });
  });

  it("should pass through string parameters and response as-is", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(
      makeEvent({
        parameters: "raw input",
        response: "raw output",
      }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const props = body.batch[0].properties;

    expect(props.parameters).toBe("raw input");
    expect(props.response).toBe("raw output");
  });

  it("should only set tool_name for tools/call events", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    // tools/call should have tool_name
    await exporter.export(
      makeEvent({
        eventType: PublishEventRequestEventTypeEnum.mcpToolsCall,
        resourceName: "get_weather",
      }),
    );
    let body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.batch[0].properties.tool_name).toBe("get_weather");
    expect(body.batch[0].properties.resource_name).toBe("get_weather");

    // resources/read should NOT have tool_name
    fetchSpy.mockClear();
    await exporter.export(
      makeEvent({
        eventType: PublishEventRequestEventTypeEnum.mcpResourcesRead,
        resourceName: "my_resource",
      }),
    );
    body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.batch[0].properties.tool_name).toBeUndefined();
    expect(body.batch[0].properties.resource_name).toBe("my_resource");
  });

  it("should map event types to PostHog event names", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    const eventTypes: Record<string, string> = {
      [PublishEventRequestEventTypeEnum.mcpToolsCall]: "mcp_tool_call",
      [PublishEventRequestEventTypeEnum.mcpToolsList]: "mcp_tools_list",
      [PublishEventRequestEventTypeEnum.mcpInitialize]: "mcp_initialize",
      [PublishEventRequestEventTypeEnum.mcpResourcesRead]: "mcp_resource_read",
      [PublishEventRequestEventTypeEnum.mcpResourcesList]: "mcp_resources_list",
      [PublishEventRequestEventTypeEnum.mcpPromptsGet]: "mcp_prompt_get",
      [PublishEventRequestEventTypeEnum.mcpPromptsList]: "mcp_prompts_list",
      "mcp:custom/type": "mcp_custom_type",
    };

    for (const [input, expected] of Object.entries(eventTypes)) {
      fetchSpy.mockClear();
      await exporter.export(makeEvent({ eventType: input }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.batch[0].event).toBe(expected);
    }
  });

  it("should include customer-defined tags with mcpcat_tag_ prefix", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(
      makeEvent({
        tags: { env: "production", trace_id: "abc-123" },
      }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const props = body.batch[0].properties;
    expect(props.mcpcat_tag_env).toBe("production");
    expect(props.mcpcat_tag_trace_id).toBe("abc-123");
  });

  it("should include customer-defined properties under mcpcat_properties", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(
      makeEvent({
        properties: { device: "mobile", feature_flags: ["dark_mode"] },
      }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const props = body.batch[0].properties;
    expect(props.mcpcat_properties).toEqual({
      device: "mobile",
      feature_flags: ["dark_mode"],
    });
  });

  it("should not include tag or properties keys when not set on event", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(makeEvent());

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const props = body.batch[0].properties;
    // No mcpcat_tag_* keys
    const tagKeys = Object.keys(props).filter((k) =>
      k.startsWith("mcpcat_tag_"),
    );
    expect(tagKeys).toHaveLength(0);
    expect(props.mcpcat_properties).toBeUndefined();
  });

  it("should include userIntent in properties", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
    });

    await exporter.export(
      makeEvent({ userIntent: "Check the weather in London" }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.batch[0].properties.user_intent).toBe(
      "Check the weather in London",
    );
  });

  it("should emit $ai_span alongside regular event for tool calls when enableAITracing is true", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
      enableAITracing: true,
    });

    await exporter.export(
      makeEvent({
        eventType: PublishEventRequestEventTypeEnum.mcpToolsCall,
        resourceName: "get_weather",
        duration: 250,
        parameters: { city: "London" },
        response: { temp: 15 },
      }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.batch).toHaveLength(2); // regular + $ai_span

    const regular = body.batch[0];
    expect(regular.event).toBe("mcp_tool_call");

    const span = body.batch[1];
    expect(span.event).toBe("$ai_span");
    expect(span.type).toBe("capture");
    expect(span.distinct_id).toBe("ses_session456");
    expect(span.timestamp).toBe("2025-01-15T10:00:00.000Z");

    // Core $ai_* properties — full property schema verification
    expect(span.properties.$ai_trace_id).toBeDefined();
    expect(span.properties.$ai_span_id).toBeDefined();
    expect(span.properties.$ai_trace_id).not.toBe(span.properties.$ai_span_id);
    expect(span.properties.$ai_span_name).toBe("get_weather");
    expect(span.properties.$ai_latency).toBeCloseTo(0.25); // 250ms → 0.25s
    expect(span.properties.$ai_is_error).toBe(false);
    expect(span.properties.$ai_input_state).toEqual({ city: "London" });
    expect(span.properties.$ai_output_state).toEqual({ temp: 15 });
    expect(span.properties.$session_id).toBe("ses_session456");
    expect(span.properties.source).toBe("mcpcat");
    expect(span.properties.server_name).toBe("weather-server");
    expect(span.properties.client_name).toBe("claude-desktop");
  });

  it("should generate deterministic UUIDs for $ai_span trace and span IDs", async () => {
    const exporter = new PostHogExporter({
      type: "posthog",
      apiKey: "phc_test_key",
      enableAITracing: true,
    });

    // Export event A (evt_aaa, ses_xxx)
    await exporter.export(makeEvent({ id: "evt_aaa", sessionId: "ses_xxx" }));
    const bodyA = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const spanA = bodyA.batch.find((e: any) => e.event === "$ai_span");

    // Export event B (evt_bbb, ses_xxx) — same session, different event
    fetchSpy.mockClear();
    await exporter.export(makeEvent({ id: "evt_bbb", sessionId: "ses_xxx" }));
    const bodyB = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const spanB = bodyB.batch.find((e: any) => e.event === "$ai_span");

    // Export event A again — verify determinism
    fetchSpy.mockClear();
    await exporter.export(makeEvent({ id: "evt_aaa", sessionId: "ses_xxx" }));
    const bodyC = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const spanC = bodyC.batch.find((e: any) => e.event === "$ai_span");

    // Same sessionId → same $ai_trace_id (trace_id derived from sessionId)
    expect(spanA.properties.$ai_trace_id).toBe(spanB.properties.$ai_trace_id);

    // Different eventId → different $ai_span_id (span_id derived from eventId)
    expect(spanA.properties.$ai_span_id).not.toBe(spanB.properties.$ai_span_id);

    // Same eventId → same $ai_span_id (deterministic)
    expect(spanA.properties.$ai_span_id).toBe(spanC.properties.$ai_span_id);

    // Verify trace_id != span_id (guards against swapped inputs)
    expect(spanA.properties.$ai_trace_id).not.toBe(
      spanA.properties.$ai_span_id,
    );

    // Valid UUID format (8-4-4-4-12 with version=5 and variant=8-b)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(spanA.properties.$ai_trace_id).toMatch(uuidRegex);
    expect(spanA.properties.$ai_span_id).toMatch(uuidRegex);
  });
});
