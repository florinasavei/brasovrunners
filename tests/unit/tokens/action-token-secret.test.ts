import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateTokenSecret,
  hashTokenSecret,
  isWellFormedTokenSecret,
  TOKEN_HASH_LENGTH,
  TOKEN_SECRET_BYTES,
  TOKEN_SECRET_LENGTH,
} from "@/modules/action-tokens/domain/token-secret";

/**
 * BR-REQ-036-02 criterion 1 — the secret half.
 *
 * These assert the two properties everything else depends on: the secret is unguessable, and
 * the stored form cannot be turned back into it. The integration tests prove the database
 * only ever receives the second one.
 */
describe("BR-REQ-036-02 action token secrets", () => {
  it("is 32 bytes of base64url, per AGENTS.md §13.2", () => {
    const secret = generateTokenSecret();

    expect(secret).toHaveLength(TOKEN_SECRET_LENGTH);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(secret, "base64url")).toHaveLength(TOKEN_SECRET_BYTES);
  });

  it("never repeats a secret", () => {
    const secrets = new Set(Array.from({ length: 1000 }, generateTokenSecret));

    // A collision here means the generator is not random, which is the whole security claim.
    expect(secrets.size).toBe(1000);
  });

  it("hashes to SHA-256 hex, which is the only form the database accepts", () => {
    const secret = generateTokenSecret();
    const hash = hashTokenSecret(secret);

    expect(hash).toHaveLength(TOKEN_HASH_LENGTH);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update(secret, "utf8").digest("hex"));
  });

  it("produces a hash that does not contain the secret", () => {
    const secret = generateTokenSecret();

    expect(hashTokenSecret(secret)).not.toContain(secret);
  });

  it("hashes the same secret to the same value, so a lookup by hash can work at all", () => {
    const secret = generateTokenSecret();

    expect(hashTokenSecret(secret)).toBe(hashTokenSecret(secret));
  });

  it("refuses anything that is not the shape this application issues", () => {
    const rejected = [
      "",
      "short",
      // Right alphabet, wrong length: 42 and 44 characters.
      "a".repeat(42),
      "a".repeat(44),
      // Right length, characters base64url does not contain.
      `${"a".repeat(42)}+`,
      `${"a".repeat(42)}/`,
      `${"a".repeat(42)}=`,
      `${"a".repeat(42)} `,
      // A padded or wrapped value that a URL might carry.
      `${"a".repeat(42)}\n`,
    ];

    for (const input of rejected) {
      expect(isWellFormedTokenSecret(input), input).toBe(false);
      expect(() => hashTokenSecret(input)).toThrow();
    }
  });

  it("keeps the rejected input out of the error message, because errors are logged", () => {
    const secretish = "z".repeat(50);

    expect(() => hashTokenSecret(secretish)).toThrow(
      /^Action token secret is not the expected shape$/,
    );
  });

  it("accepts what it generates", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(isWellFormedTokenSecret(generateTokenSecret())).toBe(true);
    }
  });
});
