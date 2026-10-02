import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import { findPublishedEventBySlug, type PublicEvent } from "@/modules/events/repository";
import { computeContentHash, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, noticeDescribesListStates } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-039-01, `DECISIONS.md` §396 (amending §32 and §143) — the rendered public list, both
 * faces of the gate.
 *
 * With a privacy notice in force that names `{{participantListStates}}` — the platform's own
 * template, in both languages — the list says where each registration stands and lists, after
 * the confirmed, the ticked ones who have not confirmed yet and then the waiting list. With an
 * older notice it is exactly today's list: confirmed names, no words, nobody else.
 *
 * Mocked as `start-list-render.test.ts` mocks it: this test's PGlite database for `getDb`, and
 * next-intl's own translator over the real catalogues for `next-intl/server` — in the language
 * the test asks for.
 */
let db: TestDatabase;
let close: () => Promise<void>;
let locale: "ro" | "en" = "ro";

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, string>>;
    return createTranslator({ locale, messages: catalogue[namespace], namespace: undefined });
  },
  getLocale: async () => locale,
}));

const { default: StartList } = await import("@/modules/events/ui/StartList");

const NOW = new Date("2026-09-24T10:00:00.000Z");
const at = (hour: number) => new Date(Date.UTC(2026, 8, 20, hour));

async function approveNotice(bodies: { ro: LegalDocumentBody; en: LegalDocumentBody }, version = 1) {
  const translations = [
    { locale: "ro" as const, title: "Nota de confidențialitate", body: bodies.ro },
    { locale: "en" as const, title: "Privacy notice", body: bodies.en },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version,
    effectiveAt: new Date(NOW.getTime() - 60_000),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

/** A notice approved before §396: it describes the confirmed names and says nothing of states. */
const OLDER_NOTICE = {
  ro: { sections: [{ heading: "4. Lista publică", paragraphs: ["Lista publică arată doar numele participanților confirmați care au bifat."] }] },
  en: { sections: [{ heading: "4. Public list", paragraphs: ["The public list shows only the names of confirmed participants who ticked."] }] },
};

/** `waitlistPublic` (§628): on unless said, so the tests below read §396's whole list as written. */
async function createEvent(waitlistPublic = true): Promise<PublicEvent> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      participantListVisibility: "NAMES",
      waitlistPublic,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "cros-stari", title: "Cros" },
    { eventId: event.id, locale: "en", slug: "cross-states", title: "Cross" },
  ]);
  // The two dates the list's period counts from (§421), beside what the list itself reads.
  return { id: event.id, participantListVisibility: "NAMES", waitlistPublic: event.waitlistPublic, startsAt: event.startsAt, endsAt: event.endsAt } as unknown as PublicEvent;
}

async function register(
  eventId: string,
  input: {
    name: string;
    status: RegistrationStatus;
    listOptOut?: boolean;
    kind?: "REAL" | "TEST";
    club?: string;
    confirmedAt?: Date;
    emailConfirmedAt?: Date;
    waitlistedAt?: Date;
    /** The notice this registration was given (§421); 1 unless said. */
    privacyNoticeVersion?: number;
  },
) {
  const email = `${input.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: email,
      normalizedEmail: email,
      canonicalEmail: email,
      canonicalizationVersion: 1,
      defaultName: input.name,
      preferredLocale: "ro",
    })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status: input.status,
    kind: input.kind ?? "REAL",
    locale: "ro",
    registeredName: input.name,
    displayName: resolveDisplayName({ legalName: input.name }),
    clubName: input.club ?? null,
    privacyNoticeVersion: input.privacyNoticeVersion ?? 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    listOptOut: input.listOptOut ?? false,
    confirmedAt: input.confirmedAt ?? null,
    emailConfirmedAt: input.emailConfirmedAt ?? null,
    waitlistedAt: input.waitlistedAt ?? null,
  });
}

/**
 * One event with somebody in every state, ticked and not: the list must pick exactly the right
 * rows, in the right order, in the right groups.
 */
async function mixedEvent(waitlistPublic = true): Promise<PublicEvent> {
  const event = await createEvent(waitlistPublic);
  await register(event.id, { name: "Bogdan Ionescu", status: "CONFIRMED", confirmedAt: at(2), club: "CS Tâmpa" });
  await register(event.id, { name: "Ana Popescu", status: "CONFIRMED", confirmedAt: at(1) });
  await register(event.id, { name: "Ascuns Confirmat", status: "CONFIRMED", confirmedAt: at(3), listOptOut: true });
  await register(event.id, { name: "Carmen Semneaza", status: "PENDING_DECLARATION", emailConfirmedAt: at(5) });
  await register(event.id, { name: "Dan Oferta", status: "WAITLIST_OFFERED", emailConfirmedAt: at(4) });
  await register(event.id, { name: "Elena Asteapta", status: "WAITLISTED", waitlistedAt: at(9) });
  await register(event.id, { name: "Florin Primul", status: "WAITLISTED", waitlistedAt: at(6), club: "Club Munte" });
  // Never on the list, whatever the notice says.
  await register(event.id, { name: "Ascuns Asteapta", status: "WAITLISTED", waitlistedAt: at(7), listOptOut: true });
  await register(event.id, { name: "Ascuns Semneaza", status: "PENDING_DECLARATION", emailConfirmedAt: at(4), listOptOut: true });
  await register(event.id, { name: "Adresa Nedovedita", status: "PENDING_EMAIL_CONFIRMATION" });
  await register(event.id, { name: "Retras Anulat", status: "CANCELLED" });
  await register(event.id, { name: "Expirat Demult", status: "EXPIRED" });
  await register(event.id, { name: "Proba Coada", status: "WAITLISTED", waitlistedAt: at(1), kind: "TEST" });
  return event;
}

const NEVER = ["Ascuns", "Adresa Nedovedita", "Retras Anulat", "Expirat Demult", "Proba Coada"];

/** The names in the order the table prints them. */
function rowNames(html: string): string[] {
  const names = ["Ana Popescu", "Bogdan Ionescu", "Carmen Semneaza", "Dan Oferta", "Elena Asteapta", "Florin Primul"];
  return names.filter((name) => html.includes(name)).sort((a, b) => html.indexOf(a) - html.indexOf(b));
}

/** Each row's state word, in the order the rows are printed. */
function stateWords(html: string): string[] {
  return [...html.matchAll(/data-testid="start-list-state" data-state="([A-Z]+)"/g)].map((match) => match[1]);
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  locale = "ro";
  await resetTables(db);
});

describe("§396 with a notice that describes the states", () => {
  it("lists the confirmed, then the pending, then the waiting list — each with its word, in Romanian", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await mixedEvent();

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(rowNames(html)).toEqual(["Ana Popescu", "Bogdan Ionescu", "Dan Oferta", "Carmen Semneaza", "Florin Primul", "Elena Asteapta"]);
    // Two named confirmed, the anonymous confirmed one, two pending, two waiting.
    expect(stateWords(html)).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED", "PENDING", "PENDING", "WAITLISTED", "WAITLISTED"]);
    for (const word of ["Confirmat", "Înscris, în așteptarea confirmării", "Pe lista de așteptare"]) expect(html).toContain(word);
    // The heading still counts who is coming: the confirmed, named and not.
    expect(html).toContain("Cine vine (3)");
    expect(html).toContain("3 participanți confirmați");
    expect(html).toContain("2 înscriși în așteptarea confirmării · 2 pe lista de așteptare");
    // The club a waiting runner wrote is theirs to show, as a confirmed runner's is.
    expect(html).toContain("Club Munte");
    for (const name of NEVER) expect(html).not.toContain(name);
    // No position beside anybody who is not confirmed: only 1 and 2 are printed.
    expect(html).not.toMatch(/<td[^>]*>3<\/td>/);
    expect(html).toContain(ro.Event.startList.noteStates.slice(0, 40));
  });

  it("says the same in English", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await mixedEvent();
    locale = "en";

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(rowNames(html)).toEqual(["Ana Popescu", "Bogdan Ionescu", "Dan Oferta", "Carmen Semneaza", "Florin Primul", "Elena Asteapta"]);
    for (const word of ["Confirmed", "Registered, awaiting confirmation", "On the waiting list"]) expect(html).toContain(word);
    expect(html).toContain("2 registered, awaiting confirmation · 2 on the waiting list");
    for (const name of NEVER) expect(html).not.toContain(name);
  });

  /**
   * §421 — a tick given under the older notice covered confirmed names only: such a runner is not
   * published as pending or waiting, and is on the list once confirmed, as that notice said.
   */
  it("lists pending and waiting only those registered under the first notice that described the states", async () => {
    await approveNotice(OLDER_NOTICE, 1);
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn }, 2);
    const event = await createEvent();
    await register(event.id, { name: "Ana Popescu", status: "CONFIRMED", confirmedAt: at(1), privacyNoticeVersion: 1 });
    await register(event.id, { name: "Carmen Semneaza", status: "PENDING_DECLARATION", emailConfirmedAt: at(5), privacyNoticeVersion: 1 });
    await register(event.id, { name: "Elena Asteapta", status: "WAITLISTED", waitlistedAt: at(9), privacyNoticeVersion: 1 });
    await register(event.id, { name: "Dan Oferta", status: "WAITLIST_OFFERED", emailConfirmedAt: at(4), privacyNoticeVersion: 2 });
    await register(event.id, { name: "Florin Primul", status: "WAITLISTED", waitlistedAt: at(6), privacyNoticeVersion: 2 });

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(rowNames(html)).toEqual(["Ana Popescu", "Dan Oferta", "Florin Primul"]);
    expect(html).toContain("1 înscris în așteptarea confirmării · 1 pe lista de așteptare");
  });
});

describe("§396 with a notice approved before it", () => {
  it("is exactly today's list: the confirmed names, no words, nobody else", async () => {
    await approveNotice(OLDER_NOTICE);
    const event = await mixedEvent();

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(rowNames(html)).toEqual(["Ana Popescu", "Bogdan Ionescu"]);
    expect(stateWords(html)).toEqual([]);
    expect(html).not.toContain("Pe lista de așteptare");
    expect(html).not.toContain("în așteptarea confirmării");
    expect(html).not.toContain("start-list-others-summary");
    for (const name of ["Carmen", "Dan Oferta", "Elena", "Florin", ...NEVER]) expect(html).not.toContain(name);
    expect(html).toContain(ro.Event.startList.note.slice(0, 40));
  });

  it("stays off when only one language's notice names the marker — the list is one list", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: OLDER_NOTICE.en });
    const event = await mixedEvent();

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(rowNames(html)).toEqual(["Ana Popescu", "Bogdan Ionescu"]);
    expect(stateWords(html)).toEqual([]);
  });
});

/**
 * §628 — «Lista de așteptare e publică» off: the same notice, the same runners, and the waiting list is
 * nowhere — no row, no word, no count, no legend sentence, no clause in the caption or the note. The
 * pending group is the notice's alone and is unchanged.
 */
describe("§628 with the event's waiting list private", () => {
  it("lists the confirmed and the pending, and nobody waiting", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await mixedEvent(false);

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(rowNames(html)).toEqual(["Ana Popescu", "Bogdan Ionescu", "Dan Oferta", "Carmen Semneaza"]);
    expect(stateWords(html)).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED", "PENDING", "PENDING"]);
    expect(html).not.toContain("Pe lista de așteptare");
    expect(html).not.toContain('data-group="WAITLISTED"');
    expect(html).not.toContain('data-state="WAITLISTED"');
    expect(html).toContain("Apar cu numele și: 2 înscriși în așteptarea confirmării<");
    expect(html).not.toContain("Club Munte");
    for (const name of ["Elena", "Florin", ...NEVER]) expect(html).not.toContain(name);
    expect(html).toContain(ro.Event.startList.captionStatesNoWaitlist);
    expect(html).not.toContain(ro.Event.startList.captionStates);
    expect(html).toContain(ro.Event.startList.noteStatesNoWaitlist.slice(-80));
  });

  it("says the same in English", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await mixedEvent(false);
    locale = "en";

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(rowNames(html)).toEqual(["Ana Popescu", "Bogdan Ionescu", "Dan Oferta", "Carmen Semneaza"]);
    expect(html).not.toContain("On the waiting list");
    expect(html).not.toContain("on the waiting list");
    expect(html).toContain(en.Event.startList.captionStatesNoWaitlist);
  });

  it("with the older notice, the list is the confirmed alone, whichever way the switch is", async () => {
    for (const waitlistPublic of [true, false]) {
      await resetTables(db);
      await approveNotice(OLDER_NOTICE);
      const event = await mixedEvent(waitlistPublic);

      const html = renderToStaticMarkup(await StartList({ event }));

      expect(rowNames(html), String(waitlistPublic)).toEqual(["Ana Popescu", "Bogdan Ionescu"]);
      expect(stateWords(html)).toEqual([]);
      expect(html).not.toContain("start-list-others-summary");
    }
  });
});

/**
 * §NNN (amending §346) — the title counts everyone with a place. The owner, 2026-10-02, of a page
 * reading «150 de înscriși din 150 de locuri — 134 de confirmați, 16 în curs de confirmare» above
 * «Cine vine (134)»: «pune-o și pe cei care trebuie să confirme înregistrarea». On a capped event whose
 * registration is open, the people completing their registration — the places line's own «în curs de
 * confirmare», from the door's cached read — join the title, and the line under it says the split.
 *
 * These events are read as the page reads them (`findPublishedEventBySlug`) and dated from the real
 * clock, because the list asks the door with the request's own `new Date()`.
 */
describe("§NNN the title counts everyone with a place on a capped event", () => {
  const DAY = 86_400_000;

  async function openEvent(capacity: number | null) {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date(Date.now() + 60 * DAY),
        registrationMode: "INTERNAL",
        capacity,
        editorialStatus: "PUBLISHED",
        publishedAt: new Date(Date.now() - DAY),
        participantListVisibility: "NAMES",
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "cros-cu-loc", title: "Cros" },
      { eventId: event.id, locale: "en", slug: "cross-with-place", title: "Cross" },
    ]);
    return event.id;
  }

  /** Four confirmed (three named), and as many as asked holding a place with a declaration to sign. */
  async function people(eventId: string, pending: number) {
    await register(eventId, { name: "Ana Popescu", status: "CONFIRMED", confirmedAt: at(1) });
    await register(eventId, { name: "Bogdan Ionescu", status: "CONFIRMED", confirmedAt: at(2) });
    await register(eventId, { name: "Carmen Doi", status: "CONFIRMED", confirmedAt: at(3) });
    await register(eventId, { name: "Ascuns Confirmat", status: "CONFIRMED", confirmedAt: at(4), listOptOut: true });
    for (let i = 0; i < pending; i += 1) {
      await register(eventId, { name: `Semnatura Lipsa ${String.fromCharCode(97 + i)}`, status: "PENDING_DECLARATION", emailConfirmedAt: at(5) });
    }
    // Neither holds a place, so neither is in the title: an address not confirmed, the waiting list.
    await register(eventId, { name: "Adresa Nedovedita", status: "PENDING_EMAIL_CONFIRMATION" });
    await register(eventId, { name: "Elena Asteapta", status: "WAITLISTED", waitlistedAt: at(9) });
  }

  async function renderList(slug: string) {
    const event = await findPublishedEventBySlug(db, locale, slug);
    if (!event) throw new Error("the event did not publish");
    return renderToStaticMarkup(await StartList({ event: event as unknown as PublicEvent }));
  }

  const summary = (html: string) => /data-testid="start-list-summary"[^>]*>([^<]*)</.exec(html)?.[1];

  it("adds those completing their registration to the title, and says the split, in Romanian", async () => {
    await approveNotice(OLDER_NOTICE);
    await people(await openEvent(10), 2);

    const html = await renderList("cros-cu-loc");

    expect(html).toContain("Cine vine (6)");
    expect(summary(html)).toBe("6 înscriși — 4 confirmați (3 cu numele afișat), 2 în curs de confirmare");
    // The rows are unchanged: the confirmed names alone without the states notice (§396).
    expect(html).not.toContain("Semnatura Lipsa");
    expect(html).not.toContain("Adresa Nedovedita");
    expect(html).not.toContain("Elena Asteapta");
  });

  it("says the same in English", async () => {
    await approveNotice(OLDER_NOTICE);
    await people(await openEvent(10), 2);
    locale = "en";

    const html = await renderList("cross-with-place");

    expect(html).toContain("Who&#x27;s coming (6)");
    expect(summary(html)).toBe("6 registered — 4 confirmed (3 with their name shown), 2 completing their registration");
  });

  it("keeps the pending rows behind the notice's gate, and the title still counts them", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    await people(await openEvent(10), 2);

    const html = await renderList("cros-cu-loc");

    expect(html).toContain("Cine vine (6)");
    expect(summary(html)).toBe("6 înscriși — 4 confirmați (3 cu numele afișat), 2 în curs de confirmare");
    // The ticked pending by name, as before; the waiting list stays behind the event's own switch (§628), off here.
    expect(html).toContain("Apar cu numele și: 2 înscriși în așteptarea confirmării<");
    expect(html).toContain("Semnatura Lipsa a");
    expect(html).not.toContain("Elena Asteapta");
  });

  it("with nobody in progress, the title and the line are today's: the confirmed", async () => {
    await approveNotice(OLDER_NOTICE);
    await people(await openEvent(10), 0);

    const html = await renderList("cros-cu-loc");

    expect(html).toContain("Cine vine (4)");
    expect(summary(html)).toBe("4 participanți confirmați — 3 cu numele afișat");
  });

  it("with nobody confirmed yet, the title counts those in progress and the line says so above the empty sentence", async () => {
    await approveNotice(OLDER_NOTICE);
    const eventId = await openEvent(10);
    await register(eventId, { name: "Semnatura Lipsa a", status: "PENDING_DECLARATION", emailConfirmedAt: at(5) });
    await register(eventId, { name: "Semnatura Lipsa b", status: "PENDING_DECLARATION", emailConfirmedAt: at(6) });

    const html = await renderList("cros-cu-loc");

    expect(html).toContain("Cine vine (2)");
    expect(summary(html)).toBe("2 înscriși — 0 confirmați (0 cu numele afișat), 2 în curs de confirmare");
    expect(html).toContain("Încă nu și-a confirmat nimeni participarea.");
    expect(html).not.toContain("Semnatura Lipsa");
  });

  it("an event with no number of places keeps the confirmed alone (§32), whoever is in progress", async () => {
    await approveNotice(OLDER_NOTICE);
    await people(await openEvent(null), 2);

    const html = await renderList("cros-cu-loc");

    expect(html).toContain("Cine vine (4)");
    expect(summary(html)).toBe("4 participanți confirmați — 3 cu numele afișat");
  });
});

describe("§396 the marker check the backoffice reads", () => {
  it("is off with no notice, off with an older one, on with the platform's, off again if the next version drops it", async () => {
    expect(await noticeDescribesListStates(db, NOW)).toBe(false);
    await approveNotice(OLDER_NOTICE, 1);
    expect(await noticeDescribesListStates(db, NOW)).toBe(false);
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn }, 2);
    expect(await noticeDescribesListStates(db, NOW)).toBe(true);
    await approveNotice(OLDER_NOTICE, 3);
    expect(await noticeDescribesListStates(db, NOW)).toBe(false);
  });

  it("ignores a draft that names it: only the text in force switches the list", async () => {
    const translations = [
      { locale: "ro" as const, title: "Nota", body: privacyNoticeRo },
      { locale: "en" as const, title: "Notice", body: privacyNoticeEn },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: NOW,
      isApproved: false,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
    expect(await noticeDescribesListStates(db, NOW)).toBe(false);
  });
});
