import { isIP } from "node:net";
import { z } from "zod";

/**
 * The trace of an electronic signature (§NNN, amending §418, §330 and §769; the owner, 2026-10-14, after a SportID
 * «Consimțământ electronic» he received for a trail race): the caller's IP address and browser at the moment a
 * person signs, kept on the row of the acceptance as proof that the typed name was typed by whoever held the
 * session — «Semnat electronic la … · IP … · …» under the signature of the PDF.
 *
 * Only an **electronic** acceptance has one. A paper acceptance is recorded by a member of staff from a sheet the
 * person signed by hand: the staff member's address and browser say nothing about the signer, and storing them
 * would be personal data kept for nothing (GDPR art. 5(1)(c)). Every writer therefore takes the trace only on
 * its electronic road, and the paper roads never name it.
 *
 * The address is read the way the whole platform reads a caller's address (the contact form's and the sign-ups'
 * Turnstile check: the first entry of `x-forwarded-for`, which Vercel sets and a client cannot prepend to), never a
 * literal and never a socket's. A value that is not an IP address is dropped, not stored: nothing the caller typed
 * reaches a column or a PDF through this door but a bounded, printable browser string. A missing header leaves a
 * null, and a null is printed as nothing — never a dash that looks like a measurement.
 *
 * Pure: the headers arrive as an object with `get`, so a unit test needs no request.
 */

/** The longest browser string kept: real ones are 100–250 characters; the rest is a script's. */
export const USER_AGENT_MAX = 300;

export type SignatureTrace = { ip: string | null; userAgent: string | null };

/** No trace: what a paper acceptance, and an electronic one that arrived without the headers, keep. */
export const NO_TRACE: SignatureTrace = { ip: null, userAgent: null };

/** The shape an action may hand a service; both parts optional, so a test or a script passes nothing. */
export const signatureTraceSchema = z
  .object({ ip: z.string().max(64).nullable(), userAgent: z.string().max(USER_AGENT_MAX).nullable() })
  .optional();

type HeaderReader = { get(name: string): string | null };

/** The caller's address from `x-forwarded-for` (the house way), or null when absent or not an address. */
export function callerIp(headers: HeaderReader): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  // `isIP` accepts v4 and v6 and nothing else — no port, no brackets, no label — so only an address is kept.
  return first !== "" && isIP(first) !== 0 ? first : null;
}

/**
 * The browser string, printable ASCII only (RFC 9110 gives a product token no other), bounded; null when absent or empty.
 * A control character (a line feed in a header a proxy let through) would break a PDF line and a log line alike, and
 * a letter outside the PDF's subset of Roboto would print as a box.
 */
export function callerUserAgent(headers: HeaderReader): string | null {
  const cleaned = (headers.get("user-agent") ?? "").replace(/[^\x20-\x7e]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned.slice(0, USER_AGENT_MAX);
}

/** The trace of the request in hand: its address and its browser. */
export function readSignatureTrace(headers: HeaderReader): SignatureTrace {
  return { ip: callerIp(headers), userAgent: callerUserAgent(headers) };
}

/**
 * What a table's two columns take: the trace of an electronic acceptance, or nothing. `electronic: false` is a
 * paper record, which keeps no trace whatever the caller passed — the rule lives here once, so a writer cannot forget it.
 */
export function traceColumns(trace: SignatureTrace | undefined, electronic: boolean): SignatureTrace {
  if (!electronic || !trace) return NO_TRACE;
  return { ip: trace.ip, userAgent: trace.userAgent };
}

/**
 * The line under the signature of a signed PDF (§NNN): «Semnat electronic la 24.09.2026, 18:05:12 · IP 203.0.113.9 ·
 * Mozilla/5.0 …». The parts the row does not hold are left out, with their separators; the label and the words of
 * «IP» arrive translated. Pure, for its test.
 */
export function signatureTraceLine(
  trace: SignatureTrace,
  words: { signedElectronically: (when: string) => string; ip: string },
  when: string,
): string {
  return [words.signedElectronically(when), trace.ip ? `${words.ip} ${trace.ip}` : null, trace.userAgent].filter(Boolean).join(" · ");
}
