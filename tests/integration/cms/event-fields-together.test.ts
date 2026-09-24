import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEventAndPublish, saveEventAndTranslations } from "@/modules/content/events/service";
import { eventFormFieldName } from "@/modules/content/events/form-names";
import { readCoHosts } from "@/modules/events/domain/co-hosts";
import { readEventLinks } from "@/modules/events/domain/links";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The 2026-09-24 third batch, integrated (§347): five branches — what a runner pays (cost amount
 * and donation), partners with many links, "Linkuri și fișiere" (§332), the place to be
 * announced (§328, §339) and the date pickers — each added boxes to the one event form (since
 * the editor's boxes, §NNN, the boxes under `content/events/ui/boxes/` that the create page and
 * the editor both render), the one reader (`admin/actions.ts#eventFieldsFrom`), the one schema
 * (`content/events/fields.ts`) and the one save (`service.ts`). Each branch proved its own
 * boxes alone; this proves them together, the way the create page and the editor post them:
 * every field in one create, every field changed in one save, and a refusal in one of them
 * writing none of the others and naming its own box.
 */
const NOW = new Date("2026-09-24T10:00:00.000Z");
const ZONE = "Europe/Bucharest";

const DONATE = "https://donate.example.test/crosul";
const PAY = "https://pay.example.test/crosul";
const GPX = "https://drive.example.test/file/d/gpx21/view";
const SITE = "https://partner.example.test";
const FACEBOOK = "https://facebook.example.test/partner";

/**
 * What the form posts for a race with every one of the five features in use, in the shape
 * `eventFieldsFrom` hands the service: the pickers' date and time boxes already joined into
 * wall-clock strings, the partner's card with its links and the spare link row, the links with
 * the spare line, the place typed and then switched to "to be announced", and a donation.
 */
const POSTED = {
  type: "RACE",
  surface: null,
  eventStatus: "SCHEDULED",
  timezone: ZONE,
  startsAtWallTime: "2026-11-21T10:00",
  endsAtWallTime: "",
  durationMinutes: "",
  raceStartsAtWallTime: "2026-11-21T10:30",
  scheduleRows: [],
  stravaEventUrl: "",
  facebookEventUrl: "",
  coHosts: [
    {
      name: "Clubul partener",
      links: [
        { kind: "SITE", url: SITE, labelRo: "", labelEn: "" },
        { kind: "FACEBOOK", url: FACEBOOK, labelRo: "Pagina lor", labelEn: "" },
        { kind: "SITE", url: "", labelRo: "", labelEn: "" },
      ],
    },
    { name: "", links: [] },
  ],
  links: [
    { kind: "GPX", url: GPX, labelRo: "Traseul", labelEn: "" },
    { kind: "OTHER", url: "", labelRo: "", labelEn: "" },
  ],
  locationName: "Sala secretă",
  locationAddress: null,
  locationToBeAnnounced: true,
  difficulty: null,
  costType: "DONATION",
  costAmount: "20 lei sugerat",
  costUrl: DONATE,
  mapUrl: "https://maps.example.test/sala",
  routeUrl: "",
  distanceMeters: "10000",
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
  ro: { slug: "crosul-impreuna", title: "Crosul împreună", excerpt: "Toate câmpurile deodată." },
  en: { slug: "together-cross", title: "Together cross", excerpt: "Every field at once." },
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

async function refusalOf(operation: Promise<unknown>): Promise<{ code: string; message: string; fields: readonly string[] }> {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, message: error.message, fields: error.fields };
    throw error;
  }
  throw new Error("expected a refusal");
}

async function saveAll(eventId: string, changes: Record<string, unknown>) {
  const row = await reload(eventId);
  const translations = await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, eventId));
  return saveEventAndTranslations(db, {
    actor: admin,
    eventId,
    expectedVersion: row.version,
    fields: { ...POSTED, ...changes },
    translations: translations.map((translation) => ({
      translationId: translation.id,
      expectedVersion: translation.version,
      fields: { slug: translation.slug, title: translation.title, excerpt: translation.excerpt ?? "" },
    })),
    now: NOW,
  });
}

describe("§347 the event form's five new boxes, created and saved together", () => {
  it("creates and publishes an event with every one of them at once, each written once", async () => {
    const result = await createEventAndPublish(db, {
      actor: admin,
      fields: { ...POSTED, translations: TRANSLATIONS },
      publish: true,
      now: NOW,
    });
    // The place is to be announced, so a blank-looking public place does not stop publication.
    expect(result.refusal).toBeNull();
    expect(result.published).toBe(true);

    const row = await reload(result.event.id);
    // The pickers' boxes, joined by the reader, in the event's own zone.
    expect(row.startsAt.toISOString()).toBe("2026-11-21T08:00:00.000Z");
    expect(row.raceStartsAt?.toISOString()).toBe("2026-11-21T08:30:00.000Z");
    // The donation: its kind, what is suggested and where it is given.
    expect(row).toMatchObject({ costType: "DONATION", costAmount: "20 lei sugerat", costUrl: DONATE });
    // The partner's card: the name and its two links, the spare row and the spare card dropped.
    expect(readCoHosts(row)).toEqual([
      {
        name: "Clubul partener",
        links: [
          { kind: "SITE", url: SITE, labelRo: null, labelEn: null },
          { kind: "FACEBOOK", url: FACEBOOK, labelRo: "Pagina lor", labelEn: null },
        ],
      },
    ]);
    // The links, without the spare line.
    expect(readEventLinks(row.links)).toEqual([{ kind: "GPX", url: GPX, labelRo: "Traseul", labelEn: null }]);
    // The place: kept as typed for staff, and marked as not announced.
    expect(row).toMatchObject({ locationName: "Sala secretă", locationToBeAnnounced: true, mapUrl: "https://maps.example.test/sala" });

    // And the public read: everything but the place, which it withholds (§328).
    const page = await findPublishedEventBySlug(db, "ro", "crosul-impreuna");
    expect(page).toMatchObject({ costType: "DONATION", costAmount: "20 lei sugerat", costUrl: DONATE, locationToBeAnnounced: true });
    expect(page?.locationName).toBeNull();
    expect(page?.mapUrl).toBeNull();
    expect(readCoHosts(page ?? { coHosts: null, coHostName: null, coHostUrl: null })[0].links).toHaveLength(2);
    expect(readEventLinks(page?.links)).toHaveLength(1);
  });

  it("changes every one of them in one editor save", async () => {
    const { event } = await createEventAndPublish(db, { actor: admin, fields: { ...POSTED, translations: TRANSLATIONS }, publish: false, now: NOW });

    await saveAll(event.id, {
      startsAtWallTime: "2026-11-22T09:15",
      raceStartsAtWallTime: "",
      costType: "PAID",
      costAmount: "50 lei",
      costUrl: PAY,
      coHosts: [{ name: "Alt partener", links: [{ kind: "STRAVA", url: "https://strava.example.test/clubs/1", labelRo: "", labelEn: "" }] }],
      links: [],
      locationToBeAnnounced: false,
      locationName: "Parcul Tractorul",
    });

    const row = await reload(event.id);
    expect(row.startsAt.toISOString()).toBe("2026-11-22T07:15:00.000Z");
    expect(row.raceStartsAt).toBeNull();
    expect(row).toMatchObject({ costType: "PAID", costAmount: "50 lei", costUrl: PAY });
    expect(readCoHosts(row).map((host) => host.name)).toEqual(["Alt partener"]);
    // The editor always posts the links' marker, so an empty list is "no links", not "untouched".
    expect(row.links).toBeNull();
    expect(row).toMatchObject({ locationToBeAnnounced: false, locationName: "Parcul Tractorul" });
  });

  it.each([
    [
      "a partner's link with no address",
      { coHosts: [{ name: "Clubul partener", links: [{ kind: "SITE", url: "", labelRo: "Site", labelEn: "" }] }] },
      "coHosts.0.links.0.url",
      "event.coHosts[0].links[0].url",
    ],
    ["a link that is not https", { links: [{ kind: "GPX", url: "http://drive.example.test/x", labelRo: "", labelEn: "" }] }, "links.0.url", "event.links[0].url"],
    ["a paid event that does not say how much", { costType: "PAID", costAmount: "", costUrl: "" }, "costAmount", "event.costAmount"],
    ["a donation with no link", { costType: "DONATION", costUrl: "" }, "costUrl", "event.costUrl"],
    ["a blank place while it is announced", { locationToBeAnnounced: false, locationName: "" }, "locationName", "event.locationName"],
  ])("refuses %s by its own box, and writes none of the others", async (_label, bad, path, posted) => {
    const { event } = await createEventAndPublish(db, { actor: admin, fields: { ...POSTED, translations: TRANSLATIONS }, publish: false, now: NOW });
    const before = await reload(event.id);

    // Every other box changed at the same time: none of it may land.
    const refusal = await refusalOf(saveAll(event.id, { startsAtWallTime: "2026-12-01T08:00", distanceMeters: "21000", ...bad }));
    expect(refusal.code).toBe("VALIDATION_ERROR");
    expect(refusal.fields).toContain(path);
    // And the summary's link lands on the box the form actually posts (§315).
    expect(eventFormFieldName(path)).toBe(posted);

    const after = await reload(event.id);
    expect(after.version).toBe(before.version);
    expect(after.startsAt.toISOString()).toBe(before.startsAt.toISOString());
    expect(after.distanceMeters).toBe(before.distanceMeters);
    expect(after).toMatchObject({ costType: before.costType, costAmount: before.costAmount, costUrl: before.costUrl, links: before.links });
  });
});
