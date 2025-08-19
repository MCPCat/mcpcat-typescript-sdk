/**
 * Shared trace context management for all exporters.
 * Maintains one trace ID per session for proper observability tool correlation.
 */

class TraceContext {
  private sessionTraces = new Map<string, string>();

  /**
   * Get or create a trace ID for a session.
   * Returns the same trace ID for all events in a session.
   */
  getTraceId(sessionId?: string): string {
    if (!sessionId) {
      // No session, return random trace ID
      return this.randomHex(32);
    }

    if (!this.sessionTraces.has(sessionId)) {
      // First event in session, create new trace ID
      this.sessionTraces.set(sessionId, this.randomHex(32));
    }

    return this.sessionTraces.get(sessionId)!;
  }

  /**
   * Generate a random span ID.
   * Always returns a new random ID for uniqueness.
   */
  generateSpanId(): string {
    return this.randomHex(16);
  }

  /**
   * Generate random hex string of specified length.
   * Uses Math.random() for performance (same as OpenTelemetry).
   */
  private randomHex(length: number): string {
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * 16)];
    }
    return result;
  }
}

// Export singleton instance
export const traceContext = new TraceContext();
