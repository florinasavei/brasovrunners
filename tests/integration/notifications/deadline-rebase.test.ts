import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { pendingFamilyEntries } from "@/db/schema/family-entries";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { formatDay } from "@/i18n/dates";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { hoursPhrase } from "@/modules/deadlines/domain/duration-words";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { STARTS_DEADLINE } from "@/modules/notifications/domain/deadline-rebase";
import { type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { createOutboxRenderer } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { countOccupied } from "@/modules/registrations/repository";
import {
  confirmEmail,
  type EventForRegistration,
  requestRegistrationLink,
  signDeclaration,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «termenul curge de când pleacă emailul»: every participant deadline an email starts is
 * counted from the moment that email is SENT, not from the moment it was queued. Under the
 * scheduled delivery (the default on QA and production) a message waits for the outbox job's next
 * tick, up to an hour at night; the declaration hold is thirty minutes.
 *
 * The request path is the real one — `submitRegistration`, `confirmEmail`, `unregister` write the
 * deadline and queue its email in one transaction — and the send is `processOutboxBatch`, what the
 * outbox job and the drain both call. The renderer is a stub where only the stored deadline is
 * asked, and the real one where the words and the link must say the moved deadline too.
 */
const T = new Date("2026-09-04T20:05:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function approveLegalDocuments(db: TestDatabase) {
  const text: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["TERMS", "PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(text),
      translations: text,
      now: T,
    });
  }
}

function submission(email: string, at: Date, person: { firstName?: string; birthDate?: string } = {}) {
  return {
    firstName: person.firstName ?? "Ana",
    lastName: "Pop",
    birthDate: person.birthDate ?? "1990-05-17",
    sex: "UNSPECIFIED",
    nationality: "RO",
    country: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    email,
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(at.getTime() - 10_000).toISOString(),
  };
}

/** A sender that takes everything, or answers each call from `outcomes` in turn first. */
function sender(outcomes: SendResult[] = []): EmailSender & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return outcomes.shift() ?? { outcome: "sent", providerMessageId: `id-${calls.length}` };
    },
  };
}

async function stub(row: OutboxRow): Promise<OutgoingEmail> {
  return { to: row.recipientEmail, subject: row.messageType, html: `<p>${row.messageType}</p>`, text: row.messageType, locale: row.locale, idempotencyKey: row.idempotencyKey };
}

describe("§NNN a participant's deadline counts from the moment its email leaves", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db);
  });

  async function event(capacity: number | null): Promise<EventForRegistration> {
    const [row] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity })
      .returning();
    await db.insert(eventTranslations).values({ eventId: row.id, locale: "ro", slug: "crosul", title: "Crosul", excerpt: "x" });
    return {
      id: row.id,
      eventStatus: row.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: row.startsAt,
      registrationOpensAt: row.registrationOpensAt,
      registrationClosesAt: row.registrationClosesAt,
      capacity,
      raceId: null,
      publishedAt: T,
    };
  }

  async function registrationOf(eventId: string, email: string) {
    const [participant] = await db.select().from(participants).where(eq(participants.canonicalEmail, canonicalizeEmail(email).canonicalEmail));
    const rows = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.participantId, participant.id)));
    return rows[0];
  }

  async function reload(id: string) {
    const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
    return row;
  }

  /** Submitted and confirmed at `at`, and every email that queued sent at once — nothing to move. */
  async function enter(target: EventForRegistration, email: string, at: Date) {
    await submitRegistration(db, target, submission(email, at), at);
    const pending = await registrationOf(target.id, email);
    const confirmed = await confirmEmail(db, target, pending.id, at);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: at });
    return confirmed;
  }

  it("verified at T and sent at T+55 min: the declaration hold ends at T+55+30 min, not T+30", async () => {
    const race = await event(10);
    await submitRegistration(db, race, submission("ana@example.ro", T), T);
    const pending = await registrationOf(race.id, "ana@example.ro");
    // The verification link left at once; the click comes a few minutes later, at T.
    await processOutboxBatch(db, { sender: sender(), render: stub, now: T });
    const held = await confirmEmail(db, race, pending.id, T);
    expect(held.holdExpiresAt).toEqual(new Date(T.getTime() + 30 * MINUTE));

    // The night tick, fifty-five minutes on: the hold had already lapsed by the clock.
    const tick = new Date(T.getTime() + 55 * MINUTE);
    const summary = await processOutboxBatch(db, { sender: sender(), render: stub, now: tick });
    expect(summary.sent).toBeGreaterThan(0);
    const after = await reload(pending.id);
    expect(after.status).toBe("PENDING_DECLARATION");
    expect(after.holdExpiresAt).toEqual(new Date(tick.getTime() + 30 * MINUTE));
  });

  it("under the immediate timing — sent within seconds — the hold stays exactly as it was given", async () => {
    const race = await event(10);
    const held = await enter(race, "ana@example.ro", T);
    expect(held.holdExpiresAt).toEqual(new Date(T.getTime() + 30 * MINUTE));
    expect((await reload(held.id)).holdExpiresAt).toEqual(new Date(T.getTime() + 30 * MINUTE));
    const [declaration] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "COMPLETE_DECLARATION"));
    expect(declaration.status).toBe("SENT");
  });

  it("a waiting-list offer sent an hour late runs its twenty-four hours from the send, and its words and link say so", async () => {
    const race = await event(1);
    const first = await enter(race, "ana@example.ro", T);
    await signDeclaration(db, race, first.id, await signingInput(db, T, "Ana Pop"), T);
    const second = await enter(race, "ion@example.ro", new Date(T.getTime() + MINUTE));
    expect(second.status).toBe("WAITLISTED");
    await processOutboxBatch(db, { sender: sender(), render: stub, now: new Date(T.getTime() + MINUTE) });

    const freed = new Date(T.getTime() + HOUR);
    await unregister(db, race, first.id, "PARTICIPANT", freed);
    expect((await reload(second.id)).holdExpiresAt).toEqual(new Date(freed.getTime() + 24 * HOUR));

    const tick = new Date(freed.getTime() + HOUR);
    const mail = sender();
    await processOutboxBatch(db, { sender: mail, render: createOutboxRenderer(), now: tick });
    const moved = new Date(tick.getTime() + 24 * HOUR);
    const offered = await reload(second.id);
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(offered.holdExpiresAt).toEqual(moved);

    // The message states the moved deadline and the club's full twenty-four hours…
    const offer = mail.calls.find((call) => call.to === "ion@example.ro" && /S-a eliberat un loc/.test(call.text));
    expect(offer).toBeDefined();
    const [{ timezone }] = await db.select({ timezone: events.timezone }).from(events).where(eq(events.id, race.id));
    const when = formatDay(moved, { locale: "ro", timeZone: timezone, style: "long", withTime: true, position: "inline" });
    expect(offer?.text).toContain(`până ${when} (ai la dispoziție ${hoursPhrase("ro", DEFAULT_DEADLINES.offerHours)})`);
    // …and its link lives exactly as long as the offer does.
    const [token] = await db
      .select()
      .from(emailActionTokens)
      .where(and(eq(emailActionTokens.registrationId, second.id), eq(emailActionTokens.purpose, "WAITLIST_OFFER")));
    expect(token.expiresAt).toEqual(moved);
  });

  it("a message deferred for the spent allowance moves nothing, and moves the deadline when it finally leaves", async () => {
    const race = await event(10);
    await submitRegistration(db, race, submission("ana@example.ro", T), T);
    const pending = await registrationOf(race.id, "ana@example.ro");
    await processOutboxBatch(db, { sender: sender(), render: stub, now: T });
    await confirmEmail(db, race, pending.id, T);

    // Mailgun's allowance is spent at the first tick: deferred, not sent.
    const firstTick = new Date(T.getTime() + 15 * MINUTE);
    const resumes = new Date(T.getTime() + 40 * MINUTE);
    const deferred = await processOutboxBatch(db, {
      sender: sender([{ outcome: "throttled", error: "allowance spent", retryAfter: resumes }]),
      render: stub,
      now: firstTick,
    });
    expect(deferred.deferred).toBe(1);
    expect((await reload(pending.id)).holdExpiresAt).toEqual(new Date(T.getTime() + 30 * MINUTE));

    // It leaves at the tick after the reset: the hold runs its thirty minutes from there.
    const leaves = new Date(T.getTime() + 45 * MINUTE);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: leaves });
    expect((await reload(pending.id)).holdExpiresAt).toEqual(new Date(leaves.getTime() + 30 * MINUTE));
  });

  it("an offer already past its deadline when it finally leaves is not revived — its place may be somebody else's", async () => {
    const race = await event(1);
    const first = await enter(race, "ana@example.ro", T);
    await signDeclaration(db, race, first.id, await signingInput(db, T, "Ana Pop"), T);
    const second = await enter(race, "ion@example.ro", new Date(T.getTime() + MINUTE));
    await processOutboxBatch(db, { sender: sender(), render: stub, now: new Date(T.getTime() + MINUTE) });
    const freed = new Date(T.getTime() + HOUR);
    await unregister(db, race, first.id, "PARTICIPANT", freed);

    const late = new Date(freed.getTime() + 25 * HOUR);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: late });
    expect((await reload(second.id)).holdExpiresAt).toEqual(new Date(freed.getTime() + 24 * HOUR));
  });

  it("the verification link and the family link run their hours from the send, the family link's token with them", async () => {
    const race = await event(10);
    await submitRegistration(db, race, submission("ana@example.ro", T), T);
    const pending = await registrationOf(race.id, "ana@example.ro");
    expect(pending.emailLinkExpiresAt).toEqual(new Date(T.getTime() + 48 * HOUR));

    const tick = new Date(T.getTime() + 55 * MINUTE);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: tick });
    expect((await reload(pending.id)).emailLinkExpiresAt).toEqual(new Date(tick.getTime() + 48 * HOUR));

    // Confirmed, then the form again from the same address for another person: a kept entry.
    await confirmEmail(db, race, pending.id, tick);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: tick });
    const asked = new Date(tick.getTime() + MINUTE);
    await submitRegistration(db, race, submission("ana@example.ro", asked, { firstName: "Ion", birthDate: "1988-03-04" }), asked);
    const [entry] = await db.select().from(pendingFamilyEntries);
    expect(entry.expiresAt).toEqual(new Date(asked.getTime() + 48 * HOUR));

    const later = new Date(asked.getTime() + HOUR);
    await processOutboxBatch(db, { sender: sender(), render: createOutboxRenderer(), now: later });
    const [moved] = await db.select().from(pendingFamilyEntries);
    expect(moved.expiresAt).toEqual(new Date(later.getTime() + 48 * HOUR));
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "REGISTER_ANOTHER_PERSON"));
    expect(token.expiresAt).toEqual(moved.expiresAt);
  });

  it("moves a hold once, on the message that started it: a resend ten minutes later leaves it where the first send put it", async () => {
    const race = await event(10);
    await submitRegistration(db, race, submission("ana@example.ro", T), T);
    const pending = await registrationOf(race.id, "ana@example.ro");
    await processOutboxBatch(db, { sender: sender(), render: stub, now: T });
    await confirmEmail(db, race, pending.id, T);

    const tick = new Date(T.getTime() + 55 * MINUTE);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: tick });
    const once = new Date(tick.getTime() + 30 * MINUTE);
    expect((await reload(pending.id)).holdExpiresAt).toEqual(once);

    // «Trimite-mi linkul din nou» (§39): the same message type, queued anew — and unmarked.
    const asked = new Date(tick.getTime() + 5 * MINUTE);
    await requestRegistrationLink(db, { email: "ana@example.ro", eventId: race.id }, asked);
    const declarations = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "COMPLETE_DECLARATION"));
    const resend = declarations.find((row) => row.participantId !== null && row.status === "PENDING");
    expect(resend).toBeDefined();
    expect(resend?.payloadJson).not.toHaveProperty(STARTS_DEADLINE);
    const original = declarations.find((row) => row.participantId !== null && row.status === "SENT");
    expect(original?.payloadJson).toHaveProperty(STARTS_DEADLINE, true);

    await processOutboxBatch(db, { sender: sender(), render: stub, now: new Date(asked.getTime() + 10 * MINUTE) });
    expect((await reload(pending.id)).holdExpiresAt).toEqual(once);
  });

  it("moves an offer once: a resend after the first send changes nothing", async () => {
    const race = await event(1);
    const first = await enter(race, "ana@example.ro", T);
    await signDeclaration(db, race, first.id, await signingInput(db, T, "Ana Pop"), T);
    const second = await enter(race, "ion@example.ro", new Date(T.getTime() + MINUTE));
    await processOutboxBatch(db, { sender: sender(), render: stub, now: new Date(T.getTime() + MINUTE) });
    const freed = new Date(T.getTime() + HOUR);
    await unregister(db, race, first.id, "PARTICIPANT", freed);

    const tick = new Date(freed.getTime() + HOUR);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: tick });
    const once = new Date(tick.getTime() + 24 * HOUR);
    expect((await reload(second.id)).holdExpiresAt).toEqual(once);

    const asked = new Date(tick.getTime() + 5 * MINUTE);
    await requestRegistrationLink(db, { email: "ion@example.ro", eventId: race.id }, asked);
    const offers = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"));
    expect(offers.filter((row) => row.participantId !== null)).toHaveLength(2);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: new Date(asked.getTime() + 15 * MINUTE) });
    expect((await reload(second.id)).holdExpiresAt).toEqual(once);
  });

  it("keeps a hold whose first email is still queued: the sweep releases nothing until it has left and the full hold has run", async () => {
    const race = await event(1);
    await submitRegistration(db, race, submission("ana@example.ro", T), T);
    const ana = await registrationOf(race.id, "ana@example.ro");
    await processOutboxBatch(db, { sender: sender(), render: stub, now: T });
    const held = await confirmEmail(db, race, ana.id, T);
    expect(held.holdExpiresAt).toEqual(new Date(T.getTime() + 30 * MINUTE));

    // Somebody waits for the place — and nothing is sent: the night's hourly tick has not come.
    const joined = new Date(T.getTime() + MINUTE);
    await submitRegistration(db, race, submission("ion@example.ro", joined), joined);
    const ionPending = await registrationOf(race.id, "ion@example.ro");
    const ion = await confirmEmail(db, race, ionPending.id, joined);
    expect(ion.status).toBe("WAITLISTED");

    // T+45: past the stored deadline, but Ana's declaration email has not left yet.
    const before = new Date(T.getTime() + 45 * MINUTE);
    expect((await countOccupied(db, race.id, before)).lapsedDeclarationHolds).toBe(0);
    await runRegistrationMaintenance(db, before);
    expect((await reload(ana.id)).status).toBe("PENDING_DECLARATION");
    expect((await reload(ion.id)).status).toBe("WAITLISTED");

    // T+60: the tick sends it, and the hold runs its thirty minutes from there.
    const sent = new Date(T.getTime() + 60 * MINUTE);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: sent });
    expect((await reload(ana.id)).holdExpiresAt).toEqual(new Date(T.getTime() + 90 * MINUTE));

    await runRegistrationMaintenance(db, new Date(T.getTime() + 89 * MINUTE));
    expect((await reload(ana.id)).status).toBe("PENDING_DECLARATION");

    // T+91: lapsed for real, and wanted — released to the one who waits.
    await runRegistrationMaintenance(db, new Date(T.getTime() + 91 * MINUTE));
    expect((await reload(ana.id)).status).toBe("EXPIRED");
    expect((await reload(ion.id)).status).toBe("WAITLIST_OFFERED");
  });
});
