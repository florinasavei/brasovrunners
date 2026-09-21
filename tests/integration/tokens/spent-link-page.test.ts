import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-036-02 — a spent email link says where the person is, and still does nothing.
 *
 * The bug this covers, with its evidence. A tester confirmed her address at 19:36; the token
 * was spent and the declaration email went out three seconds later. At 21:37 she opened the
 * *same* verify link again and read "this link is no longer valid", took it for a failure,
 * reported the confirm button as broken, and never signed her declaration.
 *
 * Two properties are asserted together here because either one alone is the wrong system:
 *
 * 1. The second GET **tells her where she is** — confirmed, declaration outstanding.
 * 2. The second GET **performs nothing**: no state change, no token minted, no token
 *    un-spent, no email queued. A reusable link would be a standing authorization sitting in
 *    a forwarded inbox; this is idempotence, not reuse.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const LATER = new Date("2026-09-04T12:00:00.000Z");
const RACE_DAY = new Date("2026-10-01T09:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

// A getter, so it resolves when the module under test calls it rather than when this factory
// is built. `token-actions.ts` reaches the database through `getDb()` and nothing else.
vi.mock("@/db/client", () => ({ getDb: () => db }));

const { issueActionToken } = await import("@/modules/action-tokens/repository");
const { consumeAndCancel, consumeAndConfirmEmail, readRegistrationTokenContext, readSpentRegistrationLink } =
  await import("@/modules/registrations/token-actions");

describe("BR-REQ-036-02 a spent action link", () => {
  let participantId: string;
  let eventId: string;
  let registrationId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

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

    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        startsAt: RACE_DAY,
        registrationMode: "INTERNAL",
        editorialStatus: "PUBLISHED",
        publishedAt: NOW,
      })
      .returning();
    eventId = event.id;
    await db.insert(eventTranslations).values([
      { eventId, locale: "ro", slug: "crosul-brasovului", title: "Crosul Brașovului" },
      { eventId, locale: "en", slug: "brasov-cross", title: "Brașov Cross" },
    ]);

    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId,
        status: "PENDING_EMAIL_CONFIRMATION",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
      })
      .returning();
    registrationId = registration.id;
  });

  const mint = async (purpose: "VERIFY_REGISTRATION_EMAIL" | "COMPLETE_DECLARATION" | "MANAGE_REGISTRATION") =>
    (
      await issueActionToken(db, {
        participantId,
        registrationId,
        purpose,
        expiresAt: RACE_DAY,
        now: NOW,
      })
    ).secret;

  /** Everything a second GET must not disturb, in one row. */
  async function snapshot() {
    const tokens = await db.select().from(emailActionTokens);
    const outbox = await db.select().from(emailOutbox);
    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId));
    return {
      tokens: tokens
        .map((row) => `${row.purpose}:${row.usedAt?.toISOString() ?? "-"}:${row.invalidatedAt?.toISOString() ?? "-"}`)
        .sort(),
      outbox: outbox.map((row) => row.messageType).sort(),
      status: registration.status,
      confirmedAt: registration.confirmedAt?.toISOString() ?? null,
    };
  }

  it("tells the person who presses the same verify link twice that the declaration is next, and changes nothing", async () => {
    const secret = await mint("VERIFY_REGISTRATION_EMAIL");

    const confirmed = await consumeAndConfirmEmail(secret, NOW);
    expect(confirmed.ok).toBe(true);

    const after = await snapshot();
    expect(after.status).toBe("PENDING_DECLARATION");
    // The declaration mail she never opened, queued by the confirmation itself.
    expect(after.outbox).toEqual(["COMPLETE_DECLARATION"]);

    // Two hours later, the same link.
    const context = await readRegistrationTokenContext(secret, "VERIFY_REGISTRATION_EMAIL");
    expect(context).toMatchObject({ ok: false, reason: "ALREADY_USED" });

    const spent = await readSpentRegistrationLink(
      secret,
      [{ purpose: "VERIFY_REGISTRATION_EMAIL", reason: "ALREADY_USED" }],
      "ro",
      LATER,
    );
    expect(spent).toEqual({
      message: "SIGN_DECLARATION",
      next: "RESEND",
      step: "declare",
      eventTitle: "Crosul Brașovului",
      eventSlug: "crosul-brasovului",
    });

    // The whole point: a status page is a read. Nothing moved.
    expect(await snapshot()).toEqual(after);
  });

  it("refuses to re-perform the action the spent link once performed", async () => {
    const secret = await mint("VERIFY_REGISTRATION_EMAIL");
    await consumeAndConfirmEmail(secret, NOW);
    const after = await snapshot();

    const second = await consumeAndConfirmEmail(secret, LATER);
    expect(second).toMatchObject({ ok: false, reason: "ALREADY_USED" });
    expect(await snapshot()).toEqual(after);
  });

  it("says the registration is cancelled when the spent link is the one that cancelled it", async () => {
    // Confirm first, so there is a live registration for the manage link to act on.
    await consumeAndConfirmEmail(await mint("VERIFY_REGISTRATION_EMAIL"), NOW);
    const manage = await mint("MANAGE_REGISTRATION");

    const cancelled = await consumeAndCancel(manage, LATER);
    expect(cancelled.ok).toBe(true);
    const after = await snapshot();
    expect(after.status).toBe("CANCELLED");

    const spent = await readSpentRegistrationLink(
      manage,
      [{ purpose: "MANAGE_REGISTRATION", reason: "ALREADY_USED" }],
      "ro",
      LATER,
    );
    expect(spent).toMatchObject({ message: "CANCELLED", next: "REGISTER_AGAIN", step: null });
    expect(await snapshot()).toEqual(after);
  });

  /**
   * §13.2's generic answer still covers everything but `ALREADY_USED`. These four are the
   * cases the status page must *not* open for, asserted against the database rather than
   * against the pure table, because the repository re-evaluates the row itself.
   */
  it("gives nothing away for a token that was never used", async () => {
    const live = await mint("MANAGE_REGISTRATION");

    // Live: there is nothing spent to report.
    expect(
      await readSpentRegistrationLink(live, [{ purpose: "MANAGE_REGISTRATION", reason: "ALREADY_USED" }], "ro", NOW),
    ).toBeNull();

    // Expired: never used, so the work was never done.
    const expiring = (
      await issueActionToken(db, {
        participantId,
        registrationId,
        purpose: "COMPLETE_DECLARATION",
        expiresAt: new Date(NOW.getTime() + 60_000),
        now: NOW,
      })
    ).secret;
    expect(
      await readSpentRegistrationLink(
        expiring,
        [{ purpose: "COMPLETE_DECLARATION", reason: "EXPIRED" }],
        "ro",
        LATER,
      ),
    ).toBeNull();

    // Superseded by a newer link: `invalidated_at`, which also carries "revoked for cause".
    await mint("COMPLETE_DECLARATION");
    expect(
      await readSpentRegistrationLink(
        expiring,
        [{ purpose: "COMPLETE_DECLARATION", reason: "INVALIDATED" }],
        "ro",
        LATER,
      ),
    ).toBeNull();

    // A value that is not a token at all.
    expect(
      await readSpentRegistrationLink(
        "not-a-token",
        [{ purpose: "MANAGE_REGISTRATION", reason: "ALREADY_USED" }],
        "ro",
        LATER,
      ),
    ).toBeNull();
  });

  /**
   * The declaration page presents one link against two purposes (§15.7). A spent
   * `MANAGE_REGISTRATION` link pasted there must stay indistinguishable from a token that does
   * not exist — `PURPOSE_MISMATCH` is never eligible, and the repository re-checks the purpose
   * against the row rather than trusting what the page passed.
   */
  it("keeps a spent link for another purpose indistinguishable from nothing", async () => {
    await consumeAndConfirmEmail(await mint("VERIFY_REGISTRATION_EMAIL"), NOW);
    const manage = await mint("MANAGE_REGISTRATION");
    await consumeAndCancel(manage, LATER);

    expect(
      await readSpentRegistrationLink(
        manage,
        [
          { purpose: "COMPLETE_DECLARATION", reason: "PURPOSE_MISMATCH" },
          { purpose: "WAITLIST_OFFER", reason: "PURPOSE_MISMATCH" },
        ],
        "ro",
        LATER,
      ),
    ).toBeNull();

    // And a caller that claims the wrong purpose with the right reason gets nothing either.
    expect(
      await readSpentRegistrationLink(
        manage,
        [{ purpose: "COMPLETE_DECLARATION", reason: "ALREADY_USED" }],
        "ro",
        LATER,
      ),
    ).toBeNull();
  });
});
