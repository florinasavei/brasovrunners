import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import type { PublicEvent } from "@/modules/events/repository";
import { computeContentHash, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, noticeDescribesListNumbers } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-039-01, `DECISIONS.md` §613 (amending §396) — the rendered public list with the race
 * number in a «BIB» column, both faces of the gate.
 *
 * With the platform's privacy notice in force — it names `{{participantListNumbers}}` — and at
 * least one listed confirmed runner wearing a number, the table gains a column between the
 * position and the name: the number beside each named confirmed runner, «—» for one without, «—»
 * for the pending and waiting rows (§396's groups), and an empty cell on a hidden row (§186). With
 * a notice in force that does not name it, or with nobody on the page numbered, the table is exactly what it was. Mocked as
 * `start-list-states.test.ts` mocks it.
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
const MARKER = "{{participantListNumbers}}";

let nextVersion = 1;

async function approveNotice(bodies: { ro: LegalDocumentBody; en: LegalDocumentBody }) {
  const translations = [
    { locale: "ro" as const, title: "Nota de confidențialitate", body: bodies.ro },
    { locale: "en" as const, title: "Privacy notice", body: bodies.en },
  ];
  // Each later version a minute later, so the newest is the one in force.
  const version = nextVersion++;
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version,
    effectiveAt: new Date(NOW.getTime() - 600_000 + version * 60_000),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

/** The platform's notice with one marker taken out — what a notice approved before it reads like. */
function without(marker: string): { ro: LegalDocumentBody; en: LegalDocumentBody } {
  const strip = (body: LegalDocumentBody) => JSON.parse(JSON.stringify(body).split(marker).join("")) as LegalDocumentBody;
  return { ro: strip(privacyNoticeRo), en: strip(privacyNoticeEn) };
}

/** A notice approved before §396: confirmed names only, no states, no socials, no numbers. */
const OLDER_NOTICE = {
  ro: { sections: [{ heading: "4. Lista publică", paragraphs: ["Lista publică arată doar numele participanților confirmați care au bifat."] }] },
  en: { sections: [{ heading: "4. Public list", paragraphs: ["The public list shows only the names of confirmed participants who ticked."] }] },
};

async function createEvent(): Promise<PublicEvent> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      participantListVisibility: "NAMES",
      // The waiting row below is on the list only with the event's own switch (§NNN).
      waitlistPublic: true,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "cros-numere", title: "Cros" },
    { eventId: event.id, locale: "en", slug: "cross-numbers", title: "Cross" },
  ]);
  return { id: event.id, participantListVisibility: "NAMES", waitlistPublic: true, startsAt: event.startsAt, endsAt: event.endsAt } as unknown as PublicEvent;
}

async function register(
  eventId: string,
  input: {
    name: string;
    status?: RegistrationStatus;
    listOptOut?: boolean;
    confirmedAt?: Date;
    waitlistedAt?: Date;
    emailConfirmedAt?: Date;
    bibNumber?: number;
    provisionalBibNumber?: number;
    privacyNoticeVersion?: number;
  },
) {
  const email = `${input.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: input.name, preferredLocale: "ro" })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status: input.status ?? "CONFIRMED",
    kind: "REAL",
    locale: "ro",
    registeredName: input.name,
    displayName: resolveDisplayName({ legalName: input.name }),
    clubName: input.name === "Ana Popescu" ? "CS Rapid" : null,
    privacyNoticeVersion: input.privacyNoticeVersion ?? 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    listOptOut: input.listOptOut ?? false,
    confirmedAt: input.status && input.status !== "CONFIRMED" ? null : (input.confirmedAt ?? at(1)),
    waitlistedAt: input.waitlistedAt ?? null,
    emailConfirmedAt: input.emailConfirmedAt ?? at(0),
    bibNumber: input.bibNumber ?? null,
    provisionalBibNumber: input.provisionalBibNumber ?? null,
  });
}

/**
 * Everyone the column must tell apart: a numbered runner, a confirmed one without a number yet, a
 * hidden one who wears a number, a pending one and a waiting one.
 */
async function mixedEvent(): Promise<PublicEvent> {
  const event = await createEvent();
  await register(event.id, { name: "Ana Popescu", confirmedAt: at(1), bibNumber: 117 });
  await register(event.id, { name: "Bogdan Ionescu", confirmedAt: at(2) });
  await register(event.id, { name: "Ascuns Confirmat", confirmedAt: at(3), listOptOut: true, bibNumber: 9431 });
  await register(event.id, { name: "Carmen Semneaza", status: "PENDING_DECLARATION", emailConfirmedAt: at(4) });
  await register(event.id, { name: "Florin Asteapta", status: "WAITLISTED", waitlistedAt: at(6) });
  return event;
}

/** The markup without Emotion's style tags, whose CSS text would otherwise read as a cell's words. */
function markup(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, "");
}

const text = (fragment: string) =>
  fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The table's header cells' words, in order. */
function headers(html: string): string[] {
  return [...markup(html).matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((match) => text(match[1]));
}

/** Each body row's cells' words, in order. */
function rows(html: string): string[][] {
  const body = markup(html).match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => text(cell[1])));
}

function caption(html: string): string {
  return text(markup(html).match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/)?.[1] ?? "");
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  locale = "ro";
  nextVersion = 1;
  await resetTables(db);
});

describe("§613 with a notice that describes the race number", () => {
  it("shows a «BIB» column after the position: the number, «—» without one or before the confirmation, nothing on a hidden row", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await mixedEvent();

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(headers(html)).toEqual(["#", "BIB", "Nume", "Club"]);
    // The whole word, for a screen reader and on hover.
    expect(html).toMatch(/<th[^>]*aria-label="numărul de concurs"/);
    expect(html).toMatch(/<abbr[^>]*title="numărul de concurs"[^>]*>BIB<\/abbr>/);
    expect(rows(html)).toEqual([
      ["1", "117", "Ana Popescu Confirmat", "CS Rapid"],
      ["2", "—", "Bogdan Ionescu Confirmat", ""],
      // Hidden: no position, no number, not even a dash (§186).
      ["", "", "Participant (nume ascuns) Confirmat", ""],
      // Pending and waiting (§396's groups): no number exists before the confirmation (§548).
      ["", "—", "Carmen Semneaza Înscris, în așteptarea confirmării", ""],
      ["", "—", "Florin Asteapta Pe lista de așteptare", ""],
    ]);
    expect(markup(html)).not.toContain("9431");
    // The caption names the number, only now.
    expect(caption(html)).toBe(ro.Event.startList.captionStatesNumbers);
  });

  it("says the same in English", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await mixedEvent();
    locale = "en";

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(headers(html)).toEqual(["#", "BIB", "Name", "Club"]);
    expect(html).toMatch(/<th[^>]*aria-label="race number"/);
    expect(rows(html).map((row) => row[1])).toEqual(["117", "—", "", "—", "—"]);
    expect(caption(html)).toBe(en.Event.startList.captionStatesNumbers);
  });

  it("without the states' marker: the confirmed with their numbers, and the caption that says so", async () => {
    await approveNotice(without("{{participantListStates}}"));
    const event = await mixedEvent();

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(headers(html)).toEqual(["#", "BIB", "Nume", "Club"]);
    expect(rows(html)).toEqual([
      ["1", "117", "Ana Popescu", "CS Rapid"],
      ["2", "—", "Bogdan Ionescu", ""],
      ["", "", "Participant (nume ascuns)", ""],
    ]);
    expect(caption(html)).toBe(ro.Event.startList.captionNumbers);
  });

  it("never shows a provisional number (§214): a row holding only that one reads «—»", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await createEvent();
    await register(event.id, { name: "Ana Popescu", confirmedAt: at(1), bibNumber: 117 });
    await register(event.id, { name: "Bogdan Ionescu", confirmedAt: at(2), provisionalBibNumber: 4321 });

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(rows(html).map((row) => row[1])).toEqual(["117", "—"]);
    expect(markup(html)).not.toContain("4321");
  });

  it("with nobody on the page numbered, keeps today's table exactly: no column of dashes", async () => {
    // The same rows, with the numbers taken off, under a notice without the marker and then with it.
    const event = await mixedEvent();
    await db.update(registrations).set({ bibNumber: null }).where(eq(registrations.eventId, event.id));
    await approveNotice(without(MARKER));
    const before = renderToStaticMarkup(await StartList({ event }));
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    expect(await noticeDescribesListNumbers(db, NOW)).toBe(true);

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(html).toBe(before);
    expect(headers(html)).toEqual(["#", "Nume", "Club"]);
    expect(html).not.toContain('data-col="number"');
    expect(caption(html)).toBe(ro.Event.startList.captionStates);
  });
});

describe("§613 a runner who registered under an older notice shows the number too (the owner, 2026-10-01)", () => {
  it("shows the number of a confirmed runner whatever notice their registration recorded, in both languages", async () => {
    // Version 1 does not name the number; version 2 does. The club tells the earlier runners beforehand.
    await approveNotice(without(MARKER));
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await createEvent();
    await register(event.id, { name: "Ana Popescu", confirmedAt: at(1), bibNumber: 117, privacyNoticeVersion: 1 });
    await register(event.id, { name: "Bogdan Ionescu", confirmedAt: at(2), bibNumber: 118, privacyNoticeVersion: 2 });

    const ro_ = renderToStaticMarkup(await StartList({ event }));
    expect(rows(ro_).map((row) => row[1])).toEqual(["117", "118"]);
    locale = "en";
    const en_ = renderToStaticMarkup(await StartList({ event }));
    expect(headers(en_)).toEqual(["#", "BIB", "Name", "Club"]);
    expect(rows(en_).map((row) => row[1])).toEqual(["117", "118"]);
  });

  it("still shows «—» for an older-notice confirmed runner who has no number", async () => {
    await approveNotice(without(MARKER));
    await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
    const event = await createEvent();
    await register(event.id, { name: "Ana Popescu", confirmedAt: at(1), privacyNoticeVersion: 1 });
    await register(event.id, { name: "Bogdan Ionescu", confirmedAt: at(2), bibNumber: 118, privacyNoticeVersion: 1 });

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(rows(html).map((row) => row[1])).toEqual(["—", "118"]);
  });
});

describe("§613 with a notice that does not describe it", () => {
  it("is exactly today's list: no column, no number, whatever the rows wear", async () => {
    await approveNotice(OLDER_NOTICE);
    const event = await mixedEvent();
    const numbered = renderToStaticMarkup(await StartList({ event }));
    await db.update(registrations).set({ bibNumber: null }).where(eq(registrations.eventId, event.id));

    // Not a cell of difference from the same rows wearing no number at all.
    expect(renderToStaticMarkup(await StartList({ event }))).toBe(numbered);
    expect(headers(numbered)).toEqual(["#", "Nume", "Club"]);
    expect(rows(numbered)).toEqual([
      ["1", "Ana Popescu", "CS Rapid"],
      ["2", "Bogdan Ionescu", ""],
      ["", "Participant (nume ascuns)", ""],
    ]);
    expect(markup(numbered)).not.toContain("117");
    expect(caption(numbered)).toBe(ro.Event.startList.caption);
  });

  it("stays off when only one language's notice names the marker — the list is one list", async () => {
    await approveNotice({ ro: privacyNoticeRo, en: without(MARKER).en });
    const event = await mixedEvent();

    const html = renderToStaticMarkup(await StartList({ event }));

    expect(await noticeDescribesListNumbers(db, NOW)).toBe(false);
    expect(headers(html)).toEqual(["#", "Nume", "Club"]);
    expect(markup(html)).not.toContain("117");
  });

  it("is off with no notice at all", async () => {
    expect(await noticeDescribesListNumbers(db, NOW)).toBe(false);
  });
});
