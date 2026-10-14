import { describe, expect, it } from "vitest";
import {
  callerIp,
  callerUserAgent,
  NO_TRACE,
  readSignatureTrace,
  signatureTraceLine,
  signatureTraceSchema,
  traceColumns,
  USER_AGENT_MAX,
} from "@/modules/legal-documents/domain/signature-trace";

/**
 * §NNN (the owner, 2026-10-14) — the electronic signature's trace: the caller's IP address and browser, read the way the
 * platform reads a caller's address (the first entry of `x-forwarded-for`, which Vercel sets), kept only for an
 * electronic acceptance, and printed as one small line under the signature.
 */
const headers = (init: Record<string, string>) => new Headers(init);

describe("§NNN reading the caller's address and browser from the request", () => {
  it("takes the first entry of x-forwarded-for, trimmed — the client's, as the proxy sets it", () => {
    expect(callerIp(headers({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(callerIp(headers({ "x-forwarded-for": "  203.0.113.9 , 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.9");
    expect(callerIp(headers({ "x-forwarded-for": "2001:db8::7, 10.0.0.1" }))).toBe("2001:db8::7");
  });

  it("keeps nothing that is not an address — a label, a port, a script, an empty entry — and nothing when the header is absent", () => {
    expect(callerIp(headers({}))).toBeNull();
    expect(callerIp(headers({ "x-forwarded-for": "" }))).toBeNull();
    expect(callerIp(headers({ "x-forwarded-for": "unknown" }))).toBeNull();
    expect(callerIp(headers({ "x-forwarded-for": "203.0.113.9:4711" }))).toBeNull();
    expect(callerIp(headers({ "x-forwarded-for": "<script>alert(1)</script>" }))).toBeNull();
    expect(callerIp(headers({ "x-forwarded-for": ", 203.0.113.9" }))).toBeNull();
    // An IPv6 address with a zone id longer than the schema allows is dropped, so the writer never throws on a header.
    expect(callerIp(headers({ "x-forwarded-for": `fe80::1%${"a".repeat(80)}` }))).toBeNull();
  });

  it("keeps the browser string as printable ASCII, on one line, bounded", () => {
    expect(callerUserAgent(headers({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/127.0" }))).toBe("Mozilla/5.0 (X11; Linux x86_64) Firefox/127.0");
    expect(callerUserAgent(headers({}))).toBeNull();
    expect(callerUserAgent(headers({ "user-agent": "   " }))).toBeNull();
    // A header a proxy let a line feed through, a letter the PDF's font cannot set: both become a space, never a break or a box.
    // (A `Headers` object refuses them itself; the reader is anything with `get`, so a plain object stands in.)
    expect(callerUserAgent({ get: () => "Agent\u0000\u000a Ș\u0007x" })).toBe("Agent x");
    expect(callerUserAgent(headers({ "user-agent": "A".repeat(5000) }))?.length).toBe(USER_AGENT_MAX);
  });

  it("reads both at once, each null when its header is missing", () => {
    expect(readSignatureTrace(headers({ "x-forwarded-for": "198.51.100.5", "user-agent": "curl/8.0" }))).toEqual({ ip: "198.51.100.5", userAgent: "curl/8.0" });
    expect(readSignatureTrace(headers({ "user-agent": "curl/8.0" }))).toEqual({ ip: null, userAgent: "curl/8.0" });
    expect(readSignatureTrace(headers({}))).toEqual(NO_TRACE);
  });

});

describe("§NNN only an electronic acceptance keeps a trace", () => {
  const trace = { ip: "203.0.113.9", userAgent: "Mozilla/5.0" };

  it("keeps it for an electronic acceptance and drops it for a paper one, whatever the caller passed", () => {
    expect(traceColumns(trace, true)).toEqual(trace);
    expect(traceColumns(trace, false)).toEqual(NO_TRACE);
    expect(traceColumns(undefined, true)).toEqual(NO_TRACE);
    expect(traceColumns(undefined, false)).toEqual(NO_TRACE);
  });

  it("is a schema an action's input may carry: both parts nullable, bounded, the whole optional", () => {
    expect(signatureTraceSchema.safeParse(undefined).success).toBe(true);
    expect(signatureTraceSchema.safeParse(trace).success).toBe(true);
    expect(signatureTraceSchema.safeParse({ ip: null, userAgent: null }).success).toBe(true);
    expect(signatureTraceSchema.safeParse({ ip: "x".repeat(65), userAgent: null }).success).toBe(false);
    expect(signatureTraceSchema.safeParse({ ip: null, userAgent: "x".repeat(USER_AGENT_MAX + 1) }).success).toBe(false);
  });
});

describe("§NNN the line under the signature", () => {
  const words = { signedElectronically: (when: string) => `Semnat electronic la ${when}`, ip: "IP" };
  const when = "24.09.2026, 18:05:12";

  it("reads «Semnat electronic la … · IP … · …», the browser last", () => {
    expect(signatureTraceLine({ ip: "203.0.113.9", userAgent: "Mozilla/5.0" }, words, when)).toBe("Semnat electronic la 24.09.2026, 18:05:12 · IP 203.0.113.9 · Mozilla/5.0");
  });

  it("leaves out the part the row does not hold, with its separator", () => {
    expect(signatureTraceLine({ ip: "203.0.113.9", userAgent: null }, words, when)).toBe("Semnat electronic la 24.09.2026, 18:05:12 · IP 203.0.113.9");
    expect(signatureTraceLine({ ip: null, userAgent: "Mozilla/5.0" }, words, when)).toBe("Semnat electronic la 24.09.2026, 18:05:12 · Mozilla/5.0");
  });
});
