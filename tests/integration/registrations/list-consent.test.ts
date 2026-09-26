import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { issueActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import {
  consumeAndSetListConsent,
  readListConsent,
  setListConsent,
  setListConsentFromManageLink,
  setListConsentFromMyRegistrations,
} from "@/modules/registrations/list-consent";
import { listActiveRegistrationsForParticipant } from "@/modules/registrations/my-registrations";
import { countAnonymousStartListEntries, listPublicStartList } from "@/modules/registrations/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-09-04T10:00:00.000Z");
const RACE_DAY = new Date("2026-10-01T09:00:00.000Z");

/**
 * BR-REQ-039-01 — the participant's own switch for the public list, after registration
 * (`DECISIONS.md` §32, §143, §186), and BR-REQ-036-02 for the link that carries it.
 *
 * What is protected: a confirmed runner who ticked the box is listed, leaves the list the
 * moment they say so and returns the same way; the trail names the change and never the
 * person; the same answer twice is one change. The `LIST_CONSENT` link: a GET reads and
 * changes nothing, a POST sets the answer, is spent, and hands back a fresh link; a token of
 * another purpose is refused and changes nothing. The two other doors — the manage link and
 * "Înscrierile mele" — set the same answer without spending their link, and only on the
 * holder's own registration.
 */
describe("BR-REQ-039-01 the participant's own switch for the public list", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;
  let otherParticipantId: string;
  let eventId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  async function seedParticipant(email: string, name: string): Promise<string> {
    const identity = canonicalizeEmail(email);
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: name,
      })
      .returning();
    return participant.id;
  }

  async function seedEvent(): Promise<string> {
    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        startsAt: RACE_DAY,
        registrationMode: "INTERNAL",
        editorialStatus: "PUBLISHED",
        publishedAt: NOW,
        participantListVisibility: "NAMES",
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "crosul-ro", title: "crosul RO" },
      { eventId: event.id, locale: "en", slug: "crosul-en", title: "crosul EN" },
    ]);
    return event.id;
  }

  /** A confirmed, real registration that ticked "I want to appear" — the row the list publishes. */
  async function seedRegistration(owner = participantId, displayName = "Ana P."): Promise<string> {
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: owner,
        status: "CONFIRMED",
        locale: "ro",
        registeredName: "Ana Popescu",
        displayName,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        confirmedAt: NOW,
        checkinCode: newCheckinCode(),
      })
      .returning();
    return registration.id;
  }

  async function row(id: string) {
    const [registration] = await db.select().from(registrations).where(eq(registrations.id, id));
    return registration;
  }

  const listToken = async (registrationId: string) =>
    (await issueActionToken(db, { participantId, registrationId, purpose: "LIST_CONSENT", expiresAt: RACE_DAY, now: NOW })).secret;
  const manageToken = async (registrationId: string) =>
    (await issueActionToken(db, { participantId, registrationId, purpose: "MANAGE_REGISTRATION", expiresAt: RACE_DAY, now: NOW })).secret;

  function confirmationRow(registrationId: string) {
    return {
      id: `row-${registrationId}`,
      participantId,
      registrationId,
      messageType: "REGISTRATION_CONFIRMED" as const,
      locale: "ro" as const,
      recipientEmail: "ana@example.ro",
      payloadJson: {},
      idempotencyKey: `test:${registrationId}`,
      requestedByStaffUserId: null,
      isManualResend: false,
      status: "PROCESSING" as const,
      attemptCount: 1,
      nextAttemptAt: null,
      lockedAt: NOW,
      providerMessageId: null,
      transport: null,
      recipientCount: null,
      lastError: null,
      createdAt: NOW,
      sentAt: null,
    };
  }

  beforeEach(async () => {
    await resetTables(db);
    participantId = await seedParticipant("ana@example.ro", "Ana Popescu");
    otherParticipantId = await seedParticipant("ion@example.ro", "Ion Ionescu");
    eventId = await seedEvent();
  });

  /*
    The column's default since migration 0060 (§323): the list is a disclosure, so a row written
    without the person's answer — a script, a seed, a door added later — is off it, not on it.
    Every insert in the code states the answer; this is the direction the gap fails in.
  */
  it("keeps a registration written without an answer off the list", async () => {
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId,
        status: "CONFIRMED",
        locale: "ro",
        registeredName: "Ana Popescu",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        confirmedAt: NOW,
        checkinCode: newCheckinCode(),
      })
      .returning();
    expect(registration.listOptOut).toBe(true);
    expect(await listPublicStartList(db, eventId)).toEqual([]);
  });

  it("takes a confirmed runner off the list and puts them back; the trail names the change, never the person", async () => {
    const id = await seedRegistration();
    expect((await listPublicStartList(db, eventId)).map((entry) => entry.displayName)).toEqual(["Ana P."]);

    expect(await setListConsent(db, id, false, "LIST_LINK", NOW)).toEqual({ listed: false, changed: true });
    expect(await listPublicStartList(db, eventId)).toEqual([]);
    // §186: counted as "Participant (nume ascuns)", never named.
    expect(await countAnonymousStartListEntries(db, eventId)).toBe(1);

    const later = new Date(NOW.getTime() + 60_000);
    expect(await setListConsent(db, id, true, "MANAGE_LINK", later)).toEqual({ listed: true, changed: true });
    expect((await listPublicStartList(db, eventId)).map((entry) => entry.displayName)).toEqual(["Ana P."]);
    expect(await countAnonymousStartListEntries(db, eventId)).toBe(0);

    const trail = await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt));
    expect(trail.map((entry) => [entry.action, entry.actorStaffUserId, entry.participantId, entry.entityId, entry.metadataJson])).toEqual([
      ["registration.list_consent_changed", null, participantId, id, { from: "LISTED", to: "NOT_LISTED", via: "LIST_LINK" }],
      ["registration.list_consent_changed", null, participantId, id, { from: "NOT_LISTED", to: "LISTED", via: "MANAGE_LINK" }],
    ]);
    // AGENTS.md §12.12: the shape of the change, never who went on or came off the list.
    expect(JSON.stringify(trail)).not.toMatch(/Ana|Popescu|@/);
  });

  it("treats the same answer twice as one change and one audit row", async () => {
    const id = await seedRegistration();
    await setListConsent(db, id, false, "LIST_LINK", NOW);
    expect(await setListConsent(db, id, false, "LIST_LINK", NOW)).toEqual({ listed: false, changed: false });
    expect(await db.select().from(auditLogs)).toHaveLength(1);
    expect((await row(id)).listOptOut).toBe(true);
  });

  it("GET: the link reads the choice and the event in the page's language, and leaves the row and the token untouched", async () => {
    const id = await seedRegistration();
    const before = await row(id);
    const secret = await listToken(id);

    expect(await readListConsent(db, secret, "en", NOW)).toEqual({
      ok: true,
      registrationId: id,
      listed: true,
      eventTitle: "crosul EN",
      eventSlug: "crosul-en",
    });

    // BR-REQ-036-02 criterion 4: a GET mutates nothing — not the row, not the token.
    expect(await row(id)).toEqual(before);
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "LIST_CONSENT"));
    expect(token.usedAt).toBeNull();
    expect((await readListConsent(db, secret, "ro", NOW)).ok).toBe(true);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("POST: the link sets the answer, is spent, and hands back a fresh link for the way back", async () => {
    const id = await seedRegistration();
    const secret = await listToken(id);

    const result = await consumeAndSetListConsent(db, secret, false, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listed).toBe(false);
    expect((await row(id)).listOptOut).toBe(true);
    expect(await listPublicStartList(db, eventId)).toEqual([]);

    // Single use (§12.8): the spent link neither reads nor writes any more.
    expect((await readListConsent(db, secret, "ro", NOW)).ok).toBe(false);
    expect((await consumeAndSetListConsent(db, secret, true, NOW)).ok).toBe(false);
    expect((await row(id)).listOptOut).toBe(true);

    // The fresh link reads the new state and reverses it.
    const fresh = await readListConsent(db, result.nextSecret, "ro", NOW);
    expect(fresh.ok && fresh.listed).toBe(false);
    const back = await consumeAndSetListConsent(db, result.nextSecret, true, NOW);
    expect(back.ok && back.listed).toBe(true);
    expect((await listPublicStartList(db, eventId)).map((entry) => entry.displayName)).toEqual(["Ana P."]);

    // One live LIST_CONSENT link per registration at any moment (BR-REQ-036-02 criterion 5).
    const live = await db
      .select()
      .from(emailActionTokens)
      .where(and(eq(emailActionTokens.purpose, "LIST_CONSENT"), isNull(emailActionTokens.usedAt), isNull(emailActionTokens.invalidatedAt)));
    expect(live).toHaveLength(1);
    expect(live[0].registrationId).toBe(id);
  });

  it("refuses a token of another purpose and a malformed one, and changes nothing", async () => {
    const id = await seedRegistration();
    const manage = await manageToken(id);

    expect((await readListConsent(db, manage, "ro", NOW)).ok).toBe(false);
    expect((await consumeAndSetListConsent(db, manage, false, NOW)).ok).toBe(false);
    expect((await readListConsent(db, "not-a-token", "ro", NOW)).ok).toBe(false);
    expect((await consumeAndSetListConsent(db, "not-a-token", false, NOW)).ok).toBe(false);

    expect((await row(id)).listOptOut).toBe(false);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
    // The manage link is untouched by the refusal.
    expect((await readActionTokenContext(db, { secret: manage, purpose: "MANAGE_REGISTRATION", now: NOW })).ok).toBe(true);
  });

  it("puts the switch on the confirmation email, worded by the row, under its own token", async () => {
    const id = await seedRegistration();

    const listed = await renderOutboxMessage(confirmationRow(id), db, NOW);
    expect(listed.html).toMatch(/\/inregistrari\/lista\//);
    expect(listed.html).toContain("Nu vreau să apar pe lista publică de participanți");
    const tokens = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "LIST_CONSENT"));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].registrationId).toBe(id);
    expect(tokens[0].participantId).toBe(participantId);

    await setListConsent(db, id, false, "LIST_LINK", NOW);
    const notListed = await renderOutboxMessage(confirmationRow(id), db, NOW);
    expect(notListed.html).toContain("Vreau să apar pe lista publică de participanți");
    expect(notListed.html).not.toContain("Nu vreau să apar");

    // The resent confirmation supersedes the earlier link: one live token per registration.
    const live = await db
      .select()
      .from(emailActionTokens)
      .where(and(eq(emailActionTokens.purpose, "LIST_CONSENT"), isNull(emailActionTokens.invalidatedAt)));
    expect(live).toHaveLength(1);
  });

  it("sets the answer from the registration's own manage link without spending it", async () => {
    const id = await seedRegistration();
    const manage = await manageToken(id);

    expect(await setListConsentFromManageLink(db, manage, false, NOW)).toEqual({ ok: true, listed: false, changed: true });
    expect((await row(id)).listOptOut).toBe(true);
    expect((await readActionTokenContext(db, { secret: manage, purpose: "MANAGE_REGISTRATION", now: NOW })).ok).toBe(true);

    const [entry] = await db.select().from(auditLogs);
    expect(entry.metadataJson).toEqual({ from: "LISTED", to: "NOT_LISTED", via: "MANAGE_LINK" });
    // A LIST_CONSENT link presented here is the wrong purpose, and says nothing.
    expect((await setListConsentFromManageLink(db, await listToken(id), true, NOW)).ok).toBe(false);
    expect((await row(id)).listOptOut).toBe(true);
  });

  it("sets the answer from 'my registrations' for the holder's own registration only, without spending the link", async () => {
    const mine = await seedRegistration();
    const theirs = await seedRegistration(otherParticipantId, "Ion I.");
    const profile = (
      await issueActionToken(db, { participantId, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: RACE_DAY, now: NOW })
    ).secret;

    const notMine = await setListConsentFromMyRegistrations(db, profile, theirs, false, NOW).catch((e: unknown) => e);
    expect(isDomainError(notMine) && notMine.code).toBe("NOT_FOUND");
    expect((await row(theirs)).listOptOut).toBe(false);

    expect(await setListConsentFromMyRegistrations(db, profile, mine, false, NOW)).toEqual({ ok: true, listed: false, changed: true });
    expect((await row(mine)).listOptOut).toBe(true);
    expect((await readActionTokenContext(db, { secret: profile, purpose: "MANAGE_PROFILE", now: NOW })).ok).toBe(true);

    // The page reads the same column, so the button on it is worded by what was just set.
    const items = await listActiveRegistrationsForParticipant(db, participantId, "ro", NOW);
    expect(items.map((item) => [item.id, item.listed])).toEqual([[mine, false]]);
    // Ion is still on the list; only Ana left it.
    expect((await listPublicStartList(db, eventId)).map((entry) => entry.displayName)).toEqual(["Ion I."]);
  });
});
