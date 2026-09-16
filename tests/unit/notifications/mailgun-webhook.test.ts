import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidMailgunSignature } from "@/infrastructure/email/mailgun-webhook";

/** AGENTS.md §16.5 — verify the Mailgun signature, reject stale or malformed requests. */
describe("Mailgun webhook signature", () => {
  const signingKey = "test-signing-key-not-a-real-secret";
  const now = new Date("2026-09-04T10:00:00.000Z");

  function sign(timestamp: string, token: string): string {
    return createHmac("sha256", signingKey).update(timestamp + token).digest("hex");
  }

  it("accepts a correctly signed, fresh request", () => {
    const timestamp = String(Math.floor(now.getTime() / 1000) - 10);
    const token = "a".repeat(50);
    expect(
      isValidMailgunSignature(signingKey, { timestamp, token, signature: sign(timestamp, token) }, now),
    ).toBe(true);
  });

  it("rejects a signature computed with the wrong key", () => {
    const timestamp = String(Math.floor(now.getTime() / 1000) - 10);
    const token = "a".repeat(50);
    const wrongSignature = createHmac("sha256", "a-different-key").update(timestamp + token).digest("hex");
    expect(isValidMailgunSignature(signingKey, { timestamp, token, signature: wrongSignature }, now)).toBe(false);
  });

  it("rejects a stale timestamp", () => {
    const timestamp = String(Math.floor(now.getTime() / 1000) - 3600); // one hour old
    const token = "a".repeat(50);
    expect(
      isValidMailgunSignature(signingKey, { timestamp, token, signature: sign(timestamp, token) }, now),
    ).toBe(false);
  });

  it("rejects a timestamp from the future", () => {
    const timestamp = String(Math.floor(now.getTime() / 1000) + 3600);
    const token = "a".repeat(50);
    expect(
      isValidMailgunSignature(signingKey, { timestamp, token, signature: sign(timestamp, token) }, now),
    ).toBe(false);
  });

  it("rejects a malformed timestamp without hashing anything", () => {
    expect(
      isValidMailgunSignature(signingKey, { timestamp: "not-a-number", token: "t", signature: "s" }, now),
    ).toBe(false);
  });

  it("rejects an empty token or signature", () => {
    const timestamp = String(Math.floor(now.getTime() / 1000) - 10);
    expect(isValidMailgunSignature(signingKey, { timestamp, token: "", signature: "s" }, now)).toBe(false);
    expect(isValidMailgunSignature(signingKey, { timestamp, token: "t", signature: "" }, now)).toBe(false);
  });
});
