import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inReadOnlyTransaction } from "@/db/read-only";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { hashTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import {
  consumeActionToken,
  issueActionToken,
  readActionTokenContext,
} from "@/modules/action-tokens/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-036-02 — email action tokens are safe. All five acceptance criteria.
 *
 * Priority-1 code (`docs/PRACTICES.md` §198), so these assert what the *database* does, not
 * only what the module intends. A participant has no account: one of these tokens is the
 * whole proof of who is clicking.
 */
const NOW = new Date("2026-09-03T10:00:00.000Z");
const IN_TWO_DAYS = new Date("2026-09-05T10:00:00.000Z");
const REGISTRATION_ID = "11111111-1111-4111-8111-111111111111";
// Every other fixed registration id this file uses as an opaque token scope. Each needs its
// own event, because `registrations` allows only one row per (event, participant).
const OTHER_FIXED_REGISTRATION_IDS = [
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

describe("BR-REQ-036-02 email action tokens", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  /**
   * A registration these tests can point a token at. This file tests the token module in
   * isolation, not registration behaviour, so the registration's own fields are minimal and
   * valid rather than meaningful — the token's `registration_id` foreign key just needs
   * somewhere real to point.
   */
  async function seedRegistration(id: string) {
    const [event] = await db
      .insert(events)
      .values({ kind: "COMMUNITY_RUN", startsAt: new Date("2026-10-01T09:00:00.000Z") })
      .returning();

    await db.insert(registrations).values({
      id,
      eventId: event.id,
      participantId,
      status: "PENDING_EMAIL_CONFIRMATION",
      locale: "ro",
      registeredName: "Ana Pop",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
    });
  }

  beforeEach(async () => {
    await resetTables(db);
    const identity = canonicalizeEmail("ana@example.ro");
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: "Ana Pop",
      })
      .returning();
    participantId = participant.id;

    for (const id of [REGISTRATION_ID, ...OTHER_FIXED_REGISTRATION_IDS]) {
      await seedRegistration(id);
    }
  });

  /** A registration-scoped token, which is every purpose except MANAGE_PROFILE. */
  async function issue(purpose: "MANAGE_REGISTRATION" | "COMPLETE_DECLARATION" = "MANAGE_REGISTRATION") {
    return issueActionToken(db, {
      participantId,
      registrationId: REGISTRATION_ID,
      purpose,
      expiresAt: IN_TWO_DAYS,
      now: NOW,
    });
  }

  async function rowFor(tokenId: string) {
    const [row] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.id, tokenId));
    return row;
  }

  describe("criterion 1 — only the hash is persisted", () => {
    it("stores the hash of the secret and nothing resembling the secret", async () => {
      const { secret, token } = await issue();
      const row = await rowFor(token.id);

      expect(row.tokenHash).toBe(hashTokenSecret(secret));
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      // Every column of the stored row, as text. The secret must appear in none of them.
      const stored = JSON.stringify(row);
      expect(stored).not.toContain(secret);
    });

    it("returns the secret exactly once, to the caller that will email it", async () => {
      const { secret } = await issue();

      // Nothing stored can produce it again: that is the point of hashing.
      const [found] = await db
        .select()
        .from(emailActionTokens)
        .where(eq(emailActionTokens.tokenHash, hashTokenSecret(secret)));

      expect(found).toBeDefined();
      expect(Object.values(found)).not.toContain(secret);
    });

    it("refuses a raw secret written into token_hash, even by a direct insert", async () => {
      // The guarantee has to survive a future change that bypasses `issueActionToken`.
      // base64url contains uppercase, `-` and `_`; the CHECK accepts 64 lowercase hex only.
      await expectViolation(
        db.insert(emailActionTokens).values({
          participantId,
          registrationId: REGISTRATION_ID,
          purpose: "MANAGE_REGISTRATION",
          tokenHash: "Xy-_".repeat(10) + "abc",
          expiresAt: IN_TWO_DAYS,
          createdAt: NOW,
        }),
        { code: SQLSTATE.CHECK_VIOLATION, constraint: "email_action_tokens_hash_is_sha256_hex" },
      );
    });

    it("refuses a second token with the same hash", async () => {
      const { secret } = await issue();

      await expectViolation(
        db.insert(emailActionTokens).values({
          participantId,
          registrationId: "22222222-2222-4222-8222-222222222222",
          purpose: "MANAGE_REGISTRATION",
          tokenHash: hashTokenSecret(secret),
          expiresAt: IN_TWO_DAYS,
          createdAt: NOW,
        }),
        { code: SQLSTATE.UNIQUE_VIOLATION },
      );
    });
  });

  describe("criterion 2 — a token is rejected outside its purpose", () => {
    it("refuses to consume a MANAGE_REGISTRATION token as COMPLETE_DECLARATION", async () => {
      const { secret, token } = await issue("MANAGE_REGISTRATION");

      const result = await consumeActionToken(db, {
        secret,
        purpose: "COMPLETE_DECLARATION",
        now: NOW,
      });

      expect(result).toEqual({ ok: false, code: "TOKEN_INVALID", reason: "PURPOSE_MISMATCH" });
      // And, critically, the failed attempt did not spend the token.
      expect((await rowFor(token.id)).usedAt).toBeNull();
    });

    it("refuses to read a token under the wrong purpose", async () => {
      const { secret } = await issue("MANAGE_REGISTRATION");

      expect(
        await readActionTokenContext(db, { secret, purpose: "WAITLIST_OFFER", now: NOW }),
      ).toEqual({ ok: false, code: "TOKEN_INVALID", reason: "PURPOSE_MISMATCH" });
    });

    it("still accepts the token for its own purpose afterwards", async () => {
      const { secret, token } = await issue("MANAGE_REGISTRATION");

      await consumeActionToken(db, { secret, purpose: "WAITLIST_OFFER", now: NOW });
      const result = await consumeActionToken(db, {
        secret,
        purpose: "MANAGE_REGISTRATION",
        now: NOW,
      });

      expect(result).toEqual({ ok: true, token: { ...token } });
    });

    it("answers an unknown secret exactly as it answers a wrong purpose", async () => {
      const unknown = "A".repeat(43);

      expect(
        await consumeActionToken(db, { secret: unknown, purpose: "MANAGE_REGISTRATION", now: NOW }),
      ).toEqual({ ok: false, code: "TOKEN_INVALID", reason: "NOT_FOUND" });
    });

    it("refuses a malformed secret without querying for it", async () => {
      expect(
        await consumeActionToken(db, { secret: "nonsense", purpose: "MANAGE_REGISTRATION", now: NOW }),
      ).toEqual({ ok: false, code: "TOKEN_INVALID", reason: "NOT_FOUND" });
    });

    it("binds a profile token to a participant and every other purpose to a registration", async () => {
      // The scope of AGENTS.md §13.3, refused by the database rather than by a code review.
      await expectViolation(
        db.insert(emailActionTokens).values({
          participantId,
          registrationId: REGISTRATION_ID,
          purpose: "MANAGE_PROFILE",
          tokenHash: "a".repeat(64),
          expiresAt: IN_TWO_DAYS,
          createdAt: NOW,
        }),
        {
          code: SQLSTATE.CHECK_VIOLATION,
          constraint: "email_action_tokens_registration_scope_matches_purpose",
        },
      );

      await expectViolation(
        db.insert(emailActionTokens).values({
          participantId,
          registrationId: null,
          purpose: "MANAGE_REGISTRATION",
          tokenHash: "b".repeat(64),
          expiresAt: IN_TWO_DAYS,
          createdAt: NOW,
        }),
        {
          code: SQLSTATE.CHECK_VIOLATION,
          constraint: "email_action_tokens_registration_scope_matches_purpose",
        },
      );
    });
  });

  describe("criterion 3 — expired, used or invalidated is rejected", () => {
    it("spends a token exactly once", async () => {
      const { secret, token } = await issue();

      const first = await consumeActionToken(db, {
        secret,
        purpose: "MANAGE_REGISTRATION",
        now: NOW,
      });
      const second = await consumeActionToken(db, {
        secret,
        purpose: "MANAGE_REGISTRATION",
        now: new Date(NOW.getTime() + 1000),
      });

      expect(first.ok).toBe(true);
      expect(second).toEqual({ ok: false, code: "TOKEN_INVALID", reason: "ALREADY_USED" });
      expect((await rowFor(token.id)).usedAt).toEqual(NOW);
    });

    it("rejects a token past its expiry, and does not mark it used", async () => {
      const issuedAt = new Date("2026-09-01T10:00:00.000Z");
      const expiredAt = new Date("2026-09-02T10:00:00.000Z");
      const [row] = await db
        .insert(emailActionTokens)
        .values({
          participantId,
          registrationId: REGISTRATION_ID,
          purpose: "MANAGE_REGISTRATION",
          tokenHash: hashTokenSecret("c".repeat(43)),
          expiresAt: expiredAt,
          createdAt: issuedAt,
        })
        .returning();

      const consumed = await consumeActionToken(db, {
        secret: "c".repeat(43),
        purpose: "MANAGE_REGISTRATION",
        now: NOW,
      });

      expect(consumed).toEqual({ ok: false, code: "TOKEN_EXPIRED", reason: "EXPIRED" });
      expect((await rowFor(row.id)).usedAt).toBeNull();
    });

    it("rejects a token that a reissue invalidated", async () => {
      const first = await issue();
      await issue();

      expect(
        await consumeActionToken(db, {
          secret: first.secret,
          purpose: "MANAGE_REGISTRATION",
          now: NOW,
        }),
      ).toEqual({ ok: false, code: "TOKEN_INVALID", reason: "INVALIDATED" });
    });

    it("refuses to issue a token that is already expired", async () => {
      await expect(
        issueActionToken(db, {
          participantId,
          registrationId: REGISTRATION_ID,
          purpose: "MANAGE_REGISTRATION",
          expiresAt: new Date("2026-09-03T09:59:59.000Z"),
          now: NOW,
        }),
      ).rejects.toThrow(/expiry must be in the future/);
    });

    it("refuses a stored token that expires before it was created", async () => {
      await expectViolation(
        db.insert(emailActionTokens).values({
          participantId,
          registrationId: REGISTRATION_ID,
          purpose: "MANAGE_REGISTRATION",
          tokenHash: "d".repeat(64),
          expiresAt: new Date("2026-09-01T10:00:00.000Z"),
          createdAt: NOW,
        }),
        {
          code: SQLSTATE.CHECK_VIOLATION,
          constraint: "email_action_tokens_expiry_after_creation",
        },
      );
    });
  });

  describe("criterion 4 — a GET carrying a token mutates nothing", () => {
    it("leaves every column of the row untouched when the context is read", async () => {
      const { secret, token } = await issue();
      const before = await rowFor(token.id);

      const result = await readActionTokenContext(db, {
        secret,
        purpose: "MANAGE_REGISTRATION",
        now: NOW,
      });

      expect(result).toEqual({ ok: true, token: { ...token } });
      expect(await rowFor(token.id)).toEqual(before);
    });

    it("leaves the row untouched when the read is rejected", async () => {
      const { secret, token } = await issue();
      const before = await rowFor(token.id);

      await readActionTokenContext(db, { secret, purpose: "WAITLIST_OFFER", now: NOW });

      expect(await rowFor(token.id)).toEqual(before);
    });

    it("returns no hash and no secret to the caller", async () => {
      const { secret, token } = await issue();

      const result = await readActionTokenContext(db, {
        secret,
        purpose: "MANAGE_REGISTRATION",
        now: NOW,
      });

      expect(result.ok).toBe(true);
      expect(Object.keys(result.ok ? result.token : {})).toEqual([
        "id",
        "participantId",
        "registrationId",
        "purpose",
        "expiresAt",
      ]);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(hashTokenSecret(secret));
      expect(token.id).toBe(result.ok ? result.token.id : undefined);
    });

    /**
     * The guarantee, rather than the current behaviour of one function.
     *
     * "This handler happens not to write" stops being true the moment someone adds a
     * last-seen timestamp. PostgreSQL refusing every write inside the transaction survives
     * that edit, and this is the test that proves the refusal is real.
     */
    it("makes PostgreSQL itself refuse a write inside the read-only transaction", async () => {
      await expectViolation(
        inReadOnlyTransaction(db, async (tx) =>
          tx
            .update(emailActionTokens)
            .set({ usedAt: NOW })
            .where(eq(emailActionTokens.participantId, participantId)),
        ),
        { code: SQLSTATE.READ_ONLY_TRANSACTION },
      );
    });

    it("still allows reads inside it, or the token page could not render", async () => {
      const { token } = await issue();

      const rows = await inReadOnlyTransaction(db, async (tx) =>
        tx.select().from(emailActionTokens).where(eq(emailActionTokens.id, token.id)),
      );

      expect(rows).toHaveLength(1);
    });
  });

  describe("criterion 5 — reissuing invalidates the previous active tokens", () => {
    async function activeTokens(purpose: "MANAGE_REGISTRATION" | "MANAGE_PROFILE") {
      return db
        .select()
        .from(emailActionTokens)
        .where(
          and(
            eq(emailActionTokens.purpose, purpose),
            isNull(emailActionTokens.usedAt),
            isNull(emailActionTokens.invalidatedAt),
          ),
        );
    }

    it("invalidates the previous token for the same registration and purpose", async () => {
      const first = await issue();
      const reissuedAt = new Date(NOW.getTime() + 60_000);

      const second = await issueActionToken(db, {
        participantId,
        registrationId: REGISTRATION_ID,
        purpose: "MANAGE_REGISTRATION",
        expiresAt: IN_TWO_DAYS,
        now: reissuedAt,
      });

      expect((await rowFor(first.token.id)).invalidatedAt).toEqual(reissuedAt);
      expect((await rowFor(second.token.id)).invalidatedAt).toBeNull();
      expect(await activeTokens("MANAGE_REGISTRATION")).toHaveLength(1);
    });

    it("leaves tokens for a different purpose alone", async () => {
      const manage = await issue("MANAGE_REGISTRATION");
      await issue("COMPLETE_DECLARATION");
      await issue("COMPLETE_DECLARATION");

      // Reissuing the declaration link must not kill the participant's management link.
      expect((await rowFor(manage.token.id)).invalidatedAt).toBeNull();
    });

    it("leaves tokens for a different registration alone", async () => {
      const other = await issueActionToken(db, {
        participantId,
        registrationId: "33333333-3333-4333-8333-333333333333",
        purpose: "MANAGE_REGISTRATION",
        expiresAt: IN_TWO_DAYS,
        now: NOW,
      });

      await issue();

      expect((await rowFor(other.token.id)).invalidatedAt).toBeNull();
    });

    it("scopes profile tokens to the participant, which has no registration", async () => {
      const first = await issueActionToken(db, {
        participantId,
        registrationId: null,
        purpose: "MANAGE_PROFILE",
        expiresAt: IN_TWO_DAYS,
        now: NOW,
      });
      const reissuedAt = new Date(NOW.getTime() + 60_000);
      await issueActionToken(db, {
        participantId,
        registrationId: null,
        purpose: "MANAGE_PROFILE",
        expiresAt: IN_TWO_DAYS,
        now: reissuedAt,
      });

      expect((await rowFor(first.token.id)).invalidatedAt).toEqual(reissuedAt);
      expect(await activeTokens("MANAGE_PROFILE")).toHaveLength(1);
    });

    it("does not resurrect a token that was already used", async () => {
      const { secret, token } = await issue();
      await consumeActionToken(db, { secret, purpose: "MANAGE_REGISTRATION", now: NOW });

      await issue();

      // A used token stays used; invalidation is for tokens that were still live.
      const row = await rowFor(token.id);
      expect(row.usedAt).toEqual(NOW);
      expect(row.invalidatedAt).toBeNull();
    });

    /**
     * The rule, enforced by the database rather than by `issueActionToken` remembering.
     *
     * If the invalidation above were ever removed, this partial unique index turns the
     * mistake into a refused write instead of two live links in two emails.
     */
    it("refuses a second active token for the same registration and purpose", async () => {
      await issue();

      await expectViolation(
        db.insert(emailActionTokens).values({
          participantId,
          registrationId: REGISTRATION_ID,
          purpose: "MANAGE_REGISTRATION",
          tokenHash: "e".repeat(64),
          expiresAt: IN_TWO_DAYS,
          createdAt: NOW,
        }),
        { code: SQLSTATE.UNIQUE_VIOLATION },
      );
    });

    it("refuses a second active profile token for the same participant", async () => {
      await issueActionToken(db, {
        participantId,
        registrationId: null,
        purpose: "MANAGE_PROFILE",
        expiresAt: IN_TWO_DAYS,
        now: NOW,
      });

      await expectViolation(
        db.insert(emailActionTokens).values({
          participantId,
          registrationId: null,
          purpose: "MANAGE_PROFILE",
          tokenHash: "f".repeat(64),
          expiresAt: IN_TWO_DAYS,
          createdAt: NOW,
        }),
        { code: SQLSTATE.UNIQUE_VIOLATION },
      );
    });
  });
});
