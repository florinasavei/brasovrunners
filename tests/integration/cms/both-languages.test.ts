import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { eventFormFieldName } from "@/modules/content/events/form-names";
import { createEvent, createEventAndPublish, saveEventAndTranslations } from "@/modules/content/events/service";
import { coHostDescription, readCoHosts } from "@/modules/events/domain/co-hosts";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * Both languages or neither (§352; the owner, 2026-09-24: "I want multi-lingual, always"), through
 * the one save and the one create the editor posts to.
 *
 * A partner's description (new with this rule), a partner link's label, and the event's optional
 * texts — the description, the rules, the programme's notes, what to bring, the two search-engine
 * overrides — are each optional, and none may be written in one language alone. A refusal names
 * the empty side's box, the way the form posts it, and writes nothing; what was typed comes back
 * to the form (§315, proven in `shared/form-outcome.test.ts`).
 */
const NOW = new Date("2026-09-24T10:00:00.000Z");
const REGISTER = ["https:/", "festival.example.test", "inscriere"].join("/");

const doc = (text: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** An event as the form posts it, the partners' boxes included; everything else left plain. */
const POSTED = {
  type: "RACE",
  surface: null,
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-09-27T10:00",
  endsAtWallTime: "",
  durationMinutes: "",
  raceStartsAtWallTime: "",
  scheduleRows: [],
  stravaEventUrl: "",
  facebookEventUrl: "",
  coHosts: [] as unknown[],
  locationName: "Piața Sfatului",
  locationAddress: null,
  difficulty: null,
  costType: null,
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  isSpecial: false,
  registrationMode: "NONE",
  capacity: "",
  bibStartNumber: "",
  bibColour: "",
  confirmationOpensDaysBefore: "",
  confirmationDeadlineDaysBefore: "",
  minAge: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  participantListVisibility: "HIDDEN" as const,
  externalProvider: "",
  externalRegistrationUrl: "",
};

const TRANSLATIONS = {
  ro: { slug: "alergam-la-festival", title: "Alergăm la festival", excerpt: "Duminică, împreună." },
  en: { slug: "running-at-the-festival", title: "Running at the festival", excerpt: "Sunday, together." },
};

const FESTIVAL = {
  name: "Brașov Running Festival",
  descriptionRo: "Alergăm împreună duminică, la festival.",
  descriptionEn: "We run together on Sunday, at the festival.",
  links: [{ kind: "REGISTRATION", url: REGISTER, labelRo: "", labelEn: "" }],
};

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
});

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const translationsOf = (id: string) => db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id));

async function refusalOf(operation: Promise<unknown>): Promise<{ code: string; fields: readonly string[] }> {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: error.fields };
    throw error;
  }
  throw new Error("expected a refusal");
}

/** The editor's one save: the event's boxes and both languages, each language's texts as given. */
async function save(eventId: string, changes: Record<string, unknown>, texts: Partial<Record<"ro" | "en", Record<string, string>>> = {}) {
  const row = await reload(eventId);
  const translations = await translationsOf(eventId);
  return saveEventAndTranslations(db, {
    actor: admin,
    eventId,
    expectedVersion: row.version,
    fields: { ...POSTED, ...changes },
    translations: translations
      .filter((translation) => translation.locale in texts || Object.keys(texts).length === 0)
      .map((translation) => ({
        translationId: translation.id,
        expectedVersion: translation.version,
        fields: { slug: translation.slug, title: translation.title, excerpt: translation.excerpt ?? "", ...texts[translation.locale] },
      })),
    acknowledgeLiveEdit: true,
    now: NOW,
  });
}

describe("BR-REQ-011-01 criterion 16 a partner's description, saved and read (§352)", () => {
  it("stores both languages in the partner's card and the public page reads each in its own language", async () => {
    const { event, published } = await createEventAndPublish(db, {
      actor: admin,
      fields: { ...POSTED, coHosts: [FESTIVAL], translations: TRANSLATIONS },
      publish: true,
      now: NOW,
    });
    expect(published).toBe(true);
    expect(readCoHosts(await reload(event.id))[0]).toMatchObject({
      descriptionRo: FESTIVAL.descriptionRo,
      descriptionEn: FESTIVAL.descriptionEn,
    });

    const ro = await findPublishedEventBySlug(db, "ro", TRANSLATIONS.ro.slug);
    const en = await findPublishedEventBySlug(db, "en", TRANSLATIONS.en.slug);
    expect(coHostDescription(readCoHosts(ro!)[0], "ro")).toBe(FESTIVAL.descriptionRo);
    expect(coHostDescription(readCoHosts(en!)[0], "en")).toBe(FESTIVAL.descriptionEn);
  });

  it("refuses a description in Romanian only, names the English box as the form posts it, and writes nothing", async () => {
    const event = await createEvent(db, { actor: admin, fields: { ...POSTED, translations: TRANSLATIONS }, now: NOW });
    const before = await reload(event.id);

    const refusal = await refusalOf(save(event.id, { coHosts: [{ ...FESTIVAL, descriptionEn: "" }], distanceMeters: "5000" }));
    expect(refusal.code).toBe("VALIDATION_ERROR");
    expect(refusal.fields).toEqual(["coHosts.0.descriptionEn"]);
    expect(eventFormFieldName(refusal.fields[0])).toBe("event.coHosts[0].descriptionEn");

    const after = await reload(event.id);
    expect(after.version).toBe(before.version);
    expect(after.distanceMeters).toBe(before.distanceMeters);
    expect(after.coHosts).toEqual(before.coHosts);
  });

  it("refuses the same on the create, so a new event is never born half-described", async () => {
    const refusal = await refusalOf(
      createEvent(db, { actor: admin, fields: { ...POSTED, coHosts: [{ ...FESTIVAL, descriptionRo: "" }], translations: TRANSLATIONS }, now: NOW }),
    );
    expect(refusal.fields).toEqual(["coHosts.0.descriptionRo"]);
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it("opens a card stored with one language, and refuses to save it until the other is written", async () => {
    const event = await createEvent(db, { actor: admin, fields: { ...POSTED, coHosts: [FESTIVAL], translations: TRANSLATIONS }, now: NOW });
    // Half a pair, as a hand-written UPDATE or an older release could leave it.
    await db
      .update(events)
      .set({ coHosts: [{ name: FESTIVAL.name, descriptionRo: FESTIVAL.descriptionRo, links: [] }] })
      .where(eq(events.id, event.id));
    const [stored] = readCoHosts(await reload(event.id));
    // The editor opens with the half, so it can be completed…
    expect(stored.descriptionRo).toBe(FESTIVAL.descriptionRo);
    expect(stored.descriptionEn).toBeNull();
    // …no page shows it in either language…
    expect(coHostDescription(stored, "ro")).toBeNull();
    expect(coHostDescription(stored, "en")).toBeNull();
    // …and saving it unchanged points at the empty box.
    const unchanged = { name: stored.name, descriptionRo: stored.descriptionRo ?? "", descriptionEn: "", links: [] };
    expect((await refusalOf(save(event.id, { coHosts: [unchanged] }))).fields).toEqual(["coHosts.0.descriptionEn"]);
    // Completed, it saves.
    await save(event.id, { coHosts: [{ ...unchanged, descriptionEn: FESTIVAL.descriptionEn }] });
    expect(coHostDescription(readCoHosts(await reload(event.id))[0], "en")).toBe(FESTIVAL.descriptionEn);
  });

  it("refuses a partner link's label in one language only — the kind's word covers the pair, never half of it", async () => {
    const event = await createEvent(db, { actor: admin, fields: { ...POSTED, translations: TRANSLATIONS }, now: NOW });
    const oneSided = { ...FESTIVAL, links: [{ kind: "REGISTRATION", url: REGISTER, labelRo: "Înscrie-te la festival", labelEn: "" }] };
    expect((await refusalOf(save(event.id, { coHosts: [oneSided] }))).fields).toEqual(["coHosts.0.links.0.labelEn"]);
    const eventLink = [{ kind: "GPX", url: REGISTER, labelRo: "", labelEn: "The route" }];
    expect((await refusalOf(save(event.id, { links: eventLink }))).fields).toEqual(["links.0.labelRo"]);
  });
});

describe("BR-REQ-050-01 the event's optional texts: both languages or neither (§352)", () => {
  it.each([
    ["the description", { ro: { body: doc("Traseul trece prin centru.") } }, "translations.en.body"],
    ["the rules", { en: { rules: doc("Headphones are not allowed.") } }, "translations.ro.rules"],
    ["the programme's notes", { ro: { schedule: doc("Ridicarea kiturilor de la 8.") } }, "translations.en.schedule"],
    ["what to bring", { en: { checklist: "Water and a cap." } }, "translations.ro.checklist"],
    ["the search-engine title", { ro: { seoTitle: "Crosul festivalului" } }, "translations.en.seoTitle"],
    ["the search-engine description", { en: { seoDescription: "Run with us on Sunday." } }, "translations.ro.seoDescription"],
  ])("refuses %s in one language only, naming the other language's box, and writes nothing", async (_label, oneSide, emptyBox) => {
    const event = await createEvent(db, { actor: admin, fields: { ...POSTED, translations: TRANSLATIONS }, now: NOW });
    const before = await translationsOf(event.id);
    const texts = { ro: {}, en: {}, ...oneSide };

    const refusal = await refusalOf(save(event.id, {}, texts));
    expect(refusal.code).toBe("VALIDATION_ERROR");
    expect(refusal.fields).toEqual([emptyBox]);
    // The box the summary links to is the one the form posts: a language's own boxes pass through.
    expect(eventFormFieldName(emptyBox)).toBe(emptyBox);

    const after = await translationsOf(event.id);
    expect(after.map((row) => row.version).sort()).toEqual(before.map((row) => row.version).sort());
  });

  it("saves every optional text written in both languages, and every one left empty in both", async () => {
    const event = await createEvent(db, { actor: admin, fields: { ...POSTED, translations: TRANSLATIONS }, now: NOW });
    await save(event.id, {}, { ro: { body: doc("Prin centru."), checklist: "Apă." }, en: { body: doc("Through the centre."), checklist: "Water." } });
    const rows = await translationsOf(event.id);
    expect(rows.find((row) => row.locale === "en")?.checklist).toBe("Water.");
    await save(event.id, {}, { ro: { body: "", checklist: "" }, en: { body: "", checklist: "" } });
    expect((await translationsOf(event.id)).every((row) => row.checklist === null)).toBe(true);
  });

  it("refuses the create the same way, before anything is written", async () => {
    const refusal = await refusalOf(
      createEvent(db, {
        actor: admin,
        fields: { ...POSTED, translations: { ro: { ...TRANSLATIONS.ro, rules: doc("Fără căști.") }, en: TRANSLATIONS.en } },
        now: NOW,
      }),
    );
    expect(refusal.fields).toEqual(["translations.en.rules"]);
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it("never refuses a text the save does not store: a group run's programme notes (§111, §350)", async () => {
    const event = await createEvent(db, { actor: admin, fields: { ...POSTED, type: "GROUP_RUN", translations: TRANSLATIONS }, now: NOW });
    await save(event.id, { type: "GROUP_RUN" }, { ro: { schedule: doc("Ridicarea kiturilor.") }, en: {} });
    expect((await translationsOf(event.id)).every((row) => row.scheduleJson === null)).toBe(true);
  });

  it("does not refuse a save that carries one language over the other language's text, which it cannot change", async () => {
    const event = await createEvent(db, { actor: admin, fields: { ...POSTED, translations: TRANSLATIONS }, now: NOW });
    await save(event.id, {}, { ro: { checklist: "Apă." } });
    expect((await translationsOf(event.id)).find((row) => row.locale === "ro")?.checklist).toBe("Apă.");
  });

  it("leaves the summary to its own rule, and takes an English place that says something else", async () => {
    const event = await createEvent(db, { actor: admin, fields: { ...POSTED, translations: TRANSLATIONS }, now: NOW });
    // The summary is required in both before publication (§28), not at every draft save; and the
    // place is asked in both languages by the event's own schema (§362), each in its own words.
    await save(event.id, { locationNameEn: "Council Square" }, { ro: { excerpt: "Duminică." }, en: { excerpt: "" } });
    const rows = await translationsOf(event.id);
    expect(rows.find((row) => row.locale === "en")?.locationName).toBe("Council Square");
    expect(rows.find((row) => row.locale === "ro")?.locationName).toBe("Piața Sfatului");
  });
});
