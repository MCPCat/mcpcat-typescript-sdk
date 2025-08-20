import { createHash, randomBytes } from "crypto";

class TraceContext {
  getTraceId(sessionId?: string): string {
    if (!sessionId) {
      return randomBytes(16).toString("hex");
    }

    return createHash("sha256")
      .update(sessionId)
      .digest("hex")
      .substring(0, 32);
  }

  getSpanId(eventId?: string): string {
    if (!eventId) {
      return randomBytes(8).toString("hex");
    }

    return createHash("sha256").update(eventId).digest("hex").substring(0, 16);
  }

  getDatadogTraceId(sessionId?: string): string {
    const hex = this.getTraceId(sessionId);
    return BigInt("0x" + hex.substring(16, 32)).toString();
  }

  getDatadogSpanId(eventId?: string): string {
    const hex = this.getSpanId(eventId);
    return BigInt("0x" + hex).toString();
  }
}

export const traceContext = new TraceContext();
