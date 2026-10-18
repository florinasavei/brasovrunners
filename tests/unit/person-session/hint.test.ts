import { describe, expect, it } from "vitest";
import { decodeHint, encodeHint, maskAddress, PERSON_COOKIE, PERSON_HINT_COOKIE, PERSON_SESSION_DAYS, PERSON_SESSION_SECONDS, PERSON_SESSIONS_PER_ADDRESS } from "@/modules/person-session/domain/hint";
import { generateTokenSecret } from "@/modules/action-tokens/domain/token-secret";

/**
 * §NNN («Vin!» part 1) — the remembered browser's readable half. The hint cookie is read by a script on a page the CDN serves to
 * everybody, so it must hold nothing a stranger could use: the address masked, the name the person gave, and never the secret.
 */
describe("§NNN the remembered browser's hint", () => {
  it("names its two cookies and lives a year", () => {
    expect(PERSON_COOKIE).toBe("br_person");
    expect(PERSON_HINT_COOKIE).toBe("br_person_hint");
    expect(PERSON_SESSION_DAYS).toBe(365);
    expect(PERSON_SESSION_SECONDS).toBe(365 * 24 * 60 * 60);
    expect(PERSON_SESSIONS_PER_ADDRESS).toBeGreaterThan(1);
  });

  it("masks an address to its first two characters and its domain", () => {
    expect(maskAddress("ana.popescu@gmail.com")).toBe("an…@gmail.com");
    expect(maskAddress("a@b.ro")).toBe("a…@b.ro");
    expect(maskAddress("ab@b.ro")).toBe("a…@b.ro");
    expect(maskAddress("abc@b.ro")).toBe("ab…@b.ro");
    // Not an address: nothing of it survives.
    expect(maskAddress("no-at-sign")).toBe("…");
    expect(maskAddress("@x.ro")).toBe("…");
  });

  it("never lets the rest of the local part through", () => {
    const masked = maskAddress("very.long.local.part+tag@club.example");
    expect(masked).toBe("ve…@club.example");
    expect(masked).not.toContain("long");
    expect(masked).not.toContain("tag");
  });

  it("round-trips the masked address and the name as the browser gives them back: encoded once, on the wire, by the framework", () => {
    const value = encodeHint({ masked: "an…@gmail.com", name: "Ana Pop" });
    // The value is plain JSON: `cookies().set` encodes it for the header (a second encoding would be unreadable to the island).
    expect(value).toBe('{"m":"an…@gmail.com","n":"Ana Pop"}');
    const onTheWire = encodeURIComponent(value);
    expect(onTheWire).not.toMatch(/[;,\s]/);
    expect(decodeHint(onTheWire)).toEqual({ masked: "an…@gmail.com", name: "Ana Pop" });
    expect(decodeHint(encodeURIComponent(encodeHint({ masked: "an…@gmail.com", name: null })))).toEqual({ masked: "an…@gmail.com", name: null });
    // A jar that kept the value as it was set (a test's) reads too.
    expect(decodeHint(value)).toEqual({ masked: "an…@gmail.com", name: "Ana Pop" });
    // …and a name with a percent sign is not mistaken for an escape.
    expect(decodeHint(encodeURIComponent(encodeHint({ masked: "an…@gmail.com", name: "100% Ana" })))?.name).toBe("100% Ana");
  });

  it("holds no secret: a hint built from a person's data carries neither the full address nor anything token-shaped", () => {
    const secret = generateTokenSecret();
    const hint = encodeHint({ masked: maskAddress("ana.popescu@gmail.com"), name: "Ana" });
    expect(hint).not.toContain("popescu");
    expect(hint).not.toContain(secret);
    expect(hint).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it.each([undefined, null, "", "not json", "%7B", "[]", "null", encodeURIComponent(JSON.stringify({ m: 5 })), encodeURIComponent(JSON.stringify({ m: "" })), encodeURIComponent(JSON.stringify({ n: "Ana" }))])(
    "reads %j as no hint, so the island draws nothing and the typed form stands",
    (value) => {
      expect(decodeHint(value as string | null | undefined)).toBeNull();
    },
  );

  it("caps what it reads: a name past eighty characters is cut, an absurd masked value is refused", () => {
    expect(decodeHint(encodeHint({ masked: "an…@x.ro", name: "x".repeat(300) }))?.name).toHaveLength(80);
    expect(decodeHint(encodeURIComponent(JSON.stringify({ m: "x".repeat(500) })))).toBeNull();
  });
});
