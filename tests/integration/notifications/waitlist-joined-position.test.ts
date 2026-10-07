import type { ReactElement, ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { withClientWords } from "../../helpers/client-words";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-035-01, BR-REQ-035-02 (§629) — „Ești pe locul 3 din 10”: the
 * `WAITLIST_JOINED` email says where the person stood when it was rendered, worded as of that moment,
 * and the registration's own page says where they stand now. Both read the position from the one
 * reader (`readWaitlistPosition`) at render time, so the line moving between the queueing and the
 * sending — or the reading — changes what they say and never what the payload carried.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let locale: "ro" | "en" = "ro";

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (namespace: string) => createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Registrations" }),
    getLocale: async () => locale,
    setRequestLocale: () => {},
  };
});

vi.mock("@/i18n/navigation", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => createElement("a", { href: typeof href === "string" ? href : "#" }, children),
  };
});

const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { default: ManageRegistrationPage } = await import("@/app/[locale]/registrations/manage/[token]/page");
const { default: MyRegistrationsPage } = await import("@/app/[locale]/registrations/mine/[token]/page");
const { issueActionToken } = await import("@/modules/action-tokens/repository");

let eventId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  locale = "ro";
  serial = 0;
  await resetTables(db);
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 1, editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
    { eventId, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
  ]);
});
afterEach(() => {
  vi.useRealTimers();
});

async function person(status: RegistrationStatus, waitlistedAt: Date | null) {
  serial += 1;
  const identity = canonicalizeEmail(`runner${serial}@example.ro`);
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: identity.deliveryEmail,
      normalizedEmail: identity.normalizedEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      defaultName: `Runner ${serial}`,
    })
    .returning();
  const [registration] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      status,
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: `Runner ${serial}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      listOptOut: false,
      resultsConsentVersion: 1,
      waitlistedAt,
    })
    .returning();
  return { registration, participant };
}

function row(messageType: EmailMessageType, registrationId: string, participantId: string, rowLocale: "ro" | "en" = "ro", payloadJson: Record<string, unknown> = {}) {
  return {
    id: `row-${messageType}`,
    participantId,
    registrationId,
    messageType,
    locale: rowLocale,
    recipientEmail: "runner@example.ro",
    payloadJson,
    idempotencyKey: `test:${messageType}`,
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

describe("§629 the WAITLIST_JOINED email says where the person stood when it was rendered", () => {
  it("adds one sentence after the existing text, in both halves, worded as of that moment", async () => {
    await person("WAITLISTED", at(1));
    const mine = await person("WAITLISTED", at(2));
    await person("WAITLISTED", at(3));
    const message = await renderOutboxMessage(row("WAITLIST_JOINED", mine.registration.id, mine.participant.id), db, NOW);
    // The email's own text stays.
    expect(message.text).toContain("este complet momentan, așa că te-am adăugat pe lista de așteptare");
    expect(message.text).toContain("Te vom anunța dacă se eliberează un loc.");
    // The new sentence: of that moment, never «ești», in each half's own language.
    expect(message.text).toContain("Când am trimis acest email, erai pe locul 2 din 3.");
    expect(message.text).toContain("When we sent this email, you were number 2 of 3.");
    expect(message.html).toContain("Când am trimis acest email, erai pe locul 2 din 3.");
    expect(message.text).not.toContain("Ești pe locul");
    // After the body, before the button's own words.
    expect(message.text.indexOf("Te vom anunța")).toBeLessThan(message.text.indexOf("Când am trimis acest email"));
  });

  it("reads the line at render time with the ids the row carries, not a number from queueing: the line moved", async () => {
    const ahead = await person("WAITLISTED", at(1));
    const mine = await person("WAITLISTED", at(2));
    const queued = row("WAITLIST_JOINED", mine.registration.id, mine.participant.id);
    expect((await renderOutboxMessage(queued, db, NOW)).text).toContain("erai pe locul 2 din 2.");
    // The person ahead is offered the place; the same outbox row, rendered again, says the line as it is.
    await db.update(registrations).set({ status: "WAITLIST_OFFERED" }).where(eq(registrations.id, ahead.registration.id));
    // Alone in the line, in either reading of the setting: never «locul 1 din 1».
    const alone = (await renderOutboxMessage(queued, db, NOW)).text;
    expect(alone).toContain("Când am trimis acest email, erai singura persoană pe lista de așteptare.");
    expect(alone).not.toContain("locul 1 din 1");
  });

  it("says it in English for an English registration, and names nobody else", async () => {
    await person("WAITLISTED", at(1));
    const mine = await person("WAITLISTED", at(2));
    const message = await renderOutboxMessage(row("WAITLIST_JOINED", mine.registration.id, mine.participant.id, "en"), db, NOW);
    expect(message.text).toContain("When we sent this email, you were number 2 of 2.");
    expect(message.text).not.toContain("Runner 1");
  });

  it("with offers handed out by hand, says how many others waited and no position, in both halves", async () => {
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, eventId));
    await person("WAITLISTED", at(1));
    const mine = await person("WAITLISTED", at(2));
    await person("WAITLISTED", at(3));
    const message = await renderOutboxMessage(row("WAITLIST_JOINED", mine.registration.id, mine.participant.id), db, NOW);
    expect(message.text).toContain("Când am trimis acest email, pe lista de așteptare mai așteptau alte 2 persoane.");
    expect(message.text).toContain("When we sent this email, 2 other people were on the waiting list.");
    expect(message.html).toContain("pe lista de așteptare mai așteptau alte 2 persoane.");
    expect(message.text).not.toContain("erai pe locul");
    expect(message.text).not.toContain("you were number");
    expect(message.text).not.toContain("Ești pe");
  });

  it("with offers by hand, reads Romanian's forms of the others' count and the alone case", async () => {
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, eventId));
    const mine = await person("WAITLISTED", at(1));
    const queued = row("WAITLIST_JOINED", mine.registration.id, mine.participant.id);
    expect((await renderOutboxMessage(queued, db, NOW)).text).toContain("Când am trimis acest email, erai singura persoană pe lista de așteptare.");
    expect((await renderOutboxMessage({ ...queued, locale: "en" }, db, NOW)).text).toContain("you were the only person on the waiting list.");
    await person("WAITLISTED", at(2));
    const one = await renderOutboxMessage(queued, db, NOW);
    expect(one.text).toContain("mai aștepta o altă persoană.");
    expect((await renderOutboxMessage({ ...queued, locale: "en" }, db, NOW)).text).toContain("1 other person was on the waiting list.");
    for (let i = 0; i < 18; i += 1) await person("WAITLISTED", at(3 + i));
    expect((await renderOutboxMessage(queued, db, NOW)).text).toContain("mai așteptau alte 19 persoane.");
    await person("WAITLISTED", at(30));
    expect((await renderOutboxMessage(queued, db, NOW)).text).toContain("mai așteptau alte 20 de persoane.");
  });

  it("says nothing of the line once the person is no longer waiting, and on no other message", async () => {
    const mine = await person("WAITLISTED", at(1));
    await db.update(registrations).set({ status: "CANCELLED" }).where(eq(registrations.id, mine.registration.id));
    const joined = await renderOutboxMessage(row("WAITLIST_JOINED", mine.registration.id, mine.participant.id), db, NOW);
    expect(joined.text).not.toContain("Când am trimis acest email");
    const other = await person("WAITLISTED", at(2));
    const offerExpired = await renderOutboxMessage(row("WAITLIST_OFFER_EXPIRED", other.registration.id, other.participant.id), db, NOW);
    expect(offerExpired.text).not.toContain("Când am trimis acest email");
  });

  it("says nothing of the line once the event is cancelled: no offer will go out (§331)", async () => {
    await person("WAITLISTED", at(1));
    const mine = await person("WAITLISTED", at(2));
    const queued = row("WAITLIST_JOINED", mine.registration.id, mine.participant.id);
    expect((await renderOutboxMessage(queued, db, NOW)).text).toContain("erai pe locul 2 din 2.");
    // The cancellation keeps the registration waiting (§331.6); the email, rendered after it, has no sentence about the line.
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, eventId));
    const message = await renderOutboxMessage(queued, db, NOW);
    expect(message.text).toContain("Te vom anunța dacă se eliberează un loc.");
    expect(message.text).not.toContain("Când am trimis acest email");
    expect(message.text).not.toContain("When we sent this email");
    expect(message.html).not.toContain("Când am trimis acest email");
  });

  it("counts a TEST registration in the line like a real one (§12.6)", async () => {
    const test = await person("WAITLISTED", at(1));
    await db.update(registrations).set({ kind: "TEST" }).where(eq(registrations.id, test.registration.id));
    const mine = await person("WAITLISTED", at(2));
    const message = await renderOutboxMessage(row("WAITLIST_JOINED", mine.registration.id, mine.participant.id), db, NOW);
    expect(message.text).toContain("erai pe locul 2 din 2.");
  });
});

describe("§629 the registration's own page says where the person stands, and how freed places go", () => {
  async function manage(registrationId: string, participantId: string) {
    const { secret } = await issueActionToken(db, {
      purpose: "MANAGE_REGISTRATION",
      participantId,
      registrationId,
      expiresAt: new Date("2026-10-11T07:00:00.000Z"),
      now: NOW,
    });
    const element = (await ManageRegistrationPage({ params: Promise.resolve({ locale, token: secret }), searchParams: Promise.resolve({}) })) as ReactElement;
    return renderToStaticMarkup(element);
  }

  it("shows the place, the line's length and the order, in Romanian and English", async () => {
    await person("WAITLISTED", at(1));
    const mine = await person("WAITLISTED", at(2));
    const html = await manage(mine.registration.id, mine.participant.id);
    expect(html).toContain('data-testid="waitlist-position"');
    expect(html).toContain("Ești pe locul 2 din 2 persoane de pe lista de așteptare. Locurile eliberate se oferă în ordine.");
    expect(html).toContain("Pe lista de așteptare");
    locale = "en";
    const en = await manage(mine.registration.id, mine.participant.id);
    expect(en).toContain("You are number 2 of 2 on the waiting list. Freed places are offered in order.");
  });

  it("does not promise an order when the club chooses who is offered a freed place", async () => {
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, eventId));
    const mine = await person("WAITLISTED", at(1));
    const html = await manage(mine.registration.id, mine.participant.id);
    expect(html).toContain("Ești singura persoană pe lista de așteptare. Clubul alege cui oferă un loc eliberat.");
    expect(html).not.toContain("se oferă în ordine");
    expect(html).not.toContain("locul 1");
  });

  it("with offers by hand, shows the count of others and no position, in both languages", async () => {
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, eventId));
    await person("WAITLISTED", at(1));
    const mine = await person("WAITLISTED", at(2));
    await person("WAITLISTED", at(3));
    const html = await manage(mine.registration.id, mine.participant.id);
    expect(html).toContain("Ești pe lista de așteptare, împreună cu alte 2 persoane. Clubul alege cui oferă un loc eliberat.");
    expect(html).not.toContain("locul 2");
    expect(html).not.toContain("din 3");
    locale = "en";
    const en = await manage(mine.registration.id, mine.participant.id);
    expect(en).toContain("You are on the waiting list, with 2 others. The club chooses whom to offer a freed place.");
    expect(en).not.toContain("number 2");
  });

  it("«Toate înscrierile mele» says the same sentence on a waiting row, and none on a row that is not", async () => {
    const other = await person("WAITLISTED", at(1));
    const mine = await person("WAITLISTED", at(2));
    const { secret } = await issueActionToken(db, {
      purpose: "MANAGE_PROFILE",
      participantId: mine.participant.id,
      registrationId: null,
      expiresAt: new Date("2026-10-11T07:00:00.000Z"),
      now: NOW,
    });
    const page = async () => {
      const element = (await MyRegistrationsPage({ params: Promise.resolve({ locale, token: secret }), searchParams: Promise.resolve({}) })) as ReactElement;
      const stream = await renderToReadableStream(withClientWords(element, locale));
      await stream.allReady;
      return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    };
    const html = await page();
    expect(html).toContain('data-testid="waitlist-position"');
    expect(html).toContain("Ești pe locul 2 din 2 persoane de pe lista de așteptare. Locurile eliberate se oferă în ordine.");
    expect(html).not.toContain(other.registration.registeredName);
    locale = "en";
    expect(await page()).toContain("You are number 2 of 2 on the waiting list. Freed places are offered in order.");
    // The person is offered a place: they have left the line, and the page says nothing of one.
    locale = "ro";
    await db.update(registrations).set({ status: "WAITLIST_OFFERED", holdExpiresAt: at(60 * 24) }).where(eq(registrations.id, mine.registration.id));
    expect(await page()).not.toContain("waitlist-position");
  });

  it("«Toate înscrierile mele» gives no position either when the club chooses", async () => {
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, eventId));
    await person("WAITLISTED", at(1));
    const mine = await person("WAITLISTED", at(2));
    const { secret } = await issueActionToken(db, {
      purpose: "MANAGE_PROFILE",
      participantId: mine.participant.id,
      registrationId: null,
      expiresAt: new Date("2026-10-11T07:00:00.000Z"),
      now: NOW,
    });
    const page = async () => {
      const element = (await MyRegistrationsPage({ params: Promise.resolve({ locale, token: secret }), searchParams: Promise.resolve({}) })) as ReactElement;
      const stream = await renderToReadableStream(withClientWords(element, locale));
      await stream.allReady;
      return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    };
    const html = await page();
    expect(html).toContain("Ești pe lista de așteptare, împreună cu o altă persoană. Clubul alege cui oferă un loc eliberat.");
    expect(html).not.toContain("locul 2");
    locale = "en";
    expect(await page()).toContain("You are on the waiting list, with 1 other. The club chooses whom to offer a freed place.");
  });

  it("on a cancelled event the page says it is cancelled and no sentence about the line or about freed places", async () => {
    await person("WAITLISTED", at(1));
    const mine = await person("WAITLISTED", at(2));
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, eventId));
    const html = await manage(mine.registration.id, mine.participant.id);
    expect(html).not.toContain("waitlist-position");
    expect(html).not.toContain("locul 2");
    expect(html).not.toContain("se oferă în ordine");
    expect(html).not.toContain("Clubul alege");
    // «Toate înscrierile mele» says none either, in either reading of the setting.
    const { secret } = await issueActionToken(db, {
      purpose: "MANAGE_PROFILE",
      participantId: mine.participant.id,
      registrationId: null,
      expiresAt: new Date("2026-10-11T07:00:00.000Z"),
      now: NOW,
    });
    const page = async () => {
      const element = (await MyRegistrationsPage({ params: Promise.resolve({ locale, token: secret }), searchParams: Promise.resolve({}) })) as ReactElement;
      const stream = await renderToReadableStream(withClientWords(element, locale));
      await stream.allReady;
      return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    };
    expect(await page()).not.toContain("waitlist-position");
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, eventId));
    expect(await page()).not.toContain("waitlist-position");
    expect(await manage(mine.registration.id, mine.participant.id)).not.toContain("waitlist-position");
  });

  it("says nothing of a line for a registration that is not waiting, and no name of another person", async () => {
    const other = await person("WAITLISTED", at(1));
    const mine = await person("PENDING_DECLARATION", null);
    const html = await manage(mine.registration.id, mine.participant.id);
    expect(html).not.toContain("waitlist-position");
    expect(html).not.toContain(other.registration.registeredName);
  });
});

/**
 * §634 — «Arată public câți așteaptă» off (the owner, 2026-10-02: «să nu le zicem oamenilor al câtelea
 * sunt în listă»): the waiting person's own sentences say no length of the line and no place in it, in
 * either reading — the newest is last, so their place would be the length; only that they wait, and the
 * setting's sentence. «Ești singura persoană» says one, so it is not said either. The email says what the page says.
 */
describe("§634 the count kept private: the person's own page, «Toate înscrierile mele» and the email", () => {
  async function manage(registrationId: string, participantId: string) {
    const { secret } = await issueActionToken(db, {
      purpose: "MANAGE_REGISTRATION",
      participantId,
      registrationId,
      expiresAt: new Date("2026-10-11T07:00:00.000Z"),
      now: NOW,
    });
    const element = (await ManageRegistrationPage({ params: Promise.resolve({ locale, token: secret }), searchParams: Promise.resolve({}) })) as ReactElement;
    return renderToStaticMarkup(element);
  }
  async function mine(participantId: string) {
    const { secret } = await issueActionToken(db, {
      purpose: "MANAGE_PROFILE",
      participantId,
      registrationId: null,
      expiresAt: new Date("2026-10-11T07:00:00.000Z"),
      now: NOW,
    });
    const element = (await MyRegistrationsPage({ params: Promise.resolve({ locale, token: secret }), searchParams: Promise.resolve({}) })) as ReactElement;
    const stream = await renderToReadableStream(withClientWords(element, locale));
    await stream.allReady;
    return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
  }
  const hidden = () => db.update(events).set({ waitlistCountPublic: false }).where(eq(events.id, eventId));

  it("with offers in order, says no place and no «din N», on both pages and in the email, in both languages", async () => {
    await hidden();
    await person("WAITLISTED", at(1));
    await person("WAITLISTED", at(2));
    // The newest is last: their place would be the line's length, so no place is said.
    const me = await person("WAITLISTED", at(3));
    const page = await manage(me.registration.id, me.participant.id);
    expect(page).toContain("Ești pe lista de așteptare. Locurile eliberate se oferă în ordine.");
    expect(page).not.toContain("locul 3");
    expect(page).not.toContain("din 3");
    const list = await mine(me.participant.id);
    expect(list).toContain("Ești pe lista de așteptare. Locurile eliberate se oferă în ordine.");
    expect(list).not.toContain("locul 3");
    const message = await renderOutboxMessage(row("WAITLIST_JOINED", me.registration.id, me.participant.id), db, NOW);
    expect(message.text).toContain("Când am trimis acest email, erai pe lista de așteptare; locurile eliberate se oferă în ordine.");
    expect(message.text).toContain("When we sent this email, you were on the waiting list; freed places are offered in order.");
    expect(message.html).toContain("erai pe lista de așteptare; locurile eliberate se oferă în ordine.");
    expect(message.text).not.toContain("locul 3");
    expect(message.text).not.toContain("number 3");
    expect(message.text).not.toContain("din 3");
    expect(message.text).not.toContain("of 3");
    locale = "en";
    expect(await manage(me.registration.id, me.participant.id)).toContain("You are on the waiting list. Freed places are offered in order.");
    expect(await mine(me.participant.id)).toContain("You are on the waiting list. Freed places are offered in order.");
  });

  it("with the club choosing, says no position and no count of others, on both pages and in the email", async () => {
    await hidden();
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, eventId));
    await person("WAITLISTED", at(1));
    const me = await person("WAITLISTED", at(2));
    await person("WAITLISTED", at(3));
    const page = await manage(me.registration.id, me.participant.id);
    expect(page).toContain("Ești pe lista de așteptare. Clubul alege cui oferă un loc eliberat.");
    expect(page).not.toContain("împreună cu");
    expect(page).not.toContain("locul 2");
    expect(await mine(me.participant.id)).toContain("Ești pe lista de așteptare. Clubul alege cui oferă un loc eliberat.");
    const message = await renderOutboxMessage(row("WAITLIST_JOINED", me.registration.id, me.participant.id), db, NOW);
    expect(message.text).toContain("Când am trimis acest email, erai pe lista de așteptare; clubul alege cui oferă un loc eliberat.");
    expect(message.text).toContain("When we sent this email, you were on the waiting list; the club chooses whom to offer a freed place.");
    expect(message.text).not.toContain("alte 2");
    expect(message.text).not.toContain("2 other");
    locale = "en";
    const en = await manage(me.registration.id, me.participant.id);
    expect(en).toContain("You are on the waiting list. The club chooses whom to offer a freed place.");
    expect(en).not.toContain("with 2 others");
  });

  it("alone in the line, never says «singura persoană» nor «locul 1» — each is a count of one", async () => {
    await hidden();
    const me = await person("WAITLISTED", at(1));
    const page = await manage(me.registration.id, me.participant.id);
    expect(page).toContain("Ești pe lista de așteptare. Locurile eliberate se oferă în ordine.");
    expect(page).not.toContain("singura persoană");
    expect(page).not.toContain("locul 1");
    const auto = await renderOutboxMessage(row("WAITLIST_JOINED", me.registration.id, me.participant.id), db, NOW);
    expect(auto.text).toContain("Când am trimis acest email, erai pe lista de așteptare; locurile eliberate se oferă în ordine.");
    expect(auto.text).not.toContain("locul 1");
    expect(auto.text).not.toContain("singura persoană");
    expect(auto.text).not.toContain("only person");
    await db.update(events).set({ waitlistAutoOffer: false }).where(eq(events.id, eventId));
    expect(await manage(me.registration.id, me.participant.id)).toContain("Ești pe lista de așteptare. Clubul alege cui oferă un loc eliberat.");
    const club = await renderOutboxMessage(row("WAITLIST_JOINED", me.registration.id, me.participant.id), db, NOW);
    expect(club.text).toContain("Când am trimis acest email, erai pe lista de așteptare; clubul alege cui oferă un loc eliberat.");
    expect(club.text).not.toContain("singura persoană");
  });

  it("says the same behind a TEST row as behind a real one (§12.6)", async () => {
    await hidden();
    const test = await person("WAITLISTED", at(1));
    await db.update(registrations).set({ kind: "TEST" }).where(eq(registrations.id, test.registration.id));
    const me = await person("WAITLISTED", at(2));
    const page = await manage(me.registration.id, me.participant.id);
    expect(page).toContain("Ești pe lista de așteptare. Locurile eliberate se oferă în ordine.");
    expect(page).not.toContain("locul 2");
    const message = await renderOutboxMessage(row("WAITLIST_JOINED", me.registration.id, me.participant.id), db, NOW);
    expect(message.text).toContain("erai pe lista de așteptare; locurile eliberate se oferă în ordine.");
    expect(message.text).not.toContain("locul 2");
  });

  it("§669 says the same with «Arată public numărătoarea» unticked, whatever the waiting count's own switch says", async () => {
    await db.update(events).set({ participantCountPublic: false, waitlistCountPublic: true }).where(eq(events.id, eventId));
    await person("WAITLISTED", at(1));
    const me = await person("WAITLISTED", at(2));
    const page = await manage(me.registration.id, me.participant.id);
    expect(page).toContain("Ești pe lista de așteptare. Locurile eliberate se oferă în ordine.");
    expect(page).not.toContain("locul 2");
    expect(await mine(me.participant.id)).not.toContain("din 2");
    const message = await renderOutboxMessage(row("WAITLIST_JOINED", me.registration.id, me.participant.id), db, NOW);
    expect(message.text).toContain("Când am trimis acest email, erai pe lista de așteptare; locurile eliberate se oferă în ordine.");
    expect(message.text).not.toContain("locul 2");
    // The parent ticked again: today's sentence, the child having been left ticked.
    await db.update(events).set({ participantCountPublic: true }).where(eq(events.id, eventId));
    expect(await manage(me.registration.id, me.participant.id)).toContain(
      "Ești pe locul 2 din 2 persoane de pe lista de așteptare. Locurile eliberate se oferă în ordine.",
    );
  });

  it("switched on again, says today's sentences byte for byte", async () => {
    await hidden();
    await db.update(events).set({ waitlistCountPublic: true }).where(eq(events.id, eventId));
    await person("WAITLISTED", at(1));
    const me = await person("WAITLISTED", at(2));
    expect(await manage(me.registration.id, me.participant.id)).toContain(
      "Ești pe locul 2 din 2 persoane de pe lista de așteptare. Locurile eliberate se oferă în ordine.",
    );
    expect((await renderOutboxMessage(row("WAITLIST_JOINED", me.registration.id, me.participant.id), db, NOW)).text).toContain(
      "Când am trimis acest email, erai pe locul 2 din 2.",
    );
  });
});
