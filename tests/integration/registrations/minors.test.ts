import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { isMinorOn } from "@/modules/registrations/fields";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { declarantValues, findSignedDeclaration, signedDeclarationEntry } from "@/modules/registrations/signed-declaration";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { mergeLegalBody } from "@/modules/legal-documents/domain/merge-fields";

/**
 * BR-REQ-031-04 criterion 9 (`DECISIONS.md` §108) — a parent registers a minor online.
 *
 * The rule the terms and the declaration have stated since §95 becomes a field: under
 * eighteen, the form refuses a registration with no parent or guardian named; the name is
 * kept on the row, opens the declaration as the declarant with the relation spelled out, and
 * is what the desk hands the kit to. An adult's stray entry in the folded field is dropped.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

const LABELS = {
  organization: "Brașov Runners",
  whereupon: "DREPT PENTRU CARE SEMNEZ,",
  signature: "Semnătura",
  date: "Data",
  idDocument: "Act de identitate",
  version: "Versiunea",
  generatedOn: "Generat",
  page: (n: number, total: number) => `${n}/${total}`,
  signedByLink: (when: string) => `Semnat electronic la ${when}`,
  signedOnPaper: (who: string, when: string) => `Pe hârtie; ${who} ${when}`,
  attesterRemoved: "un membru al echipei",
};

async function approve(db: TestDatabase) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationRo },
    { locale: "en", title: "Declaration", body: declarationEn },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(declaration), translations: declaration, now: NOW });
}

async function createEvent(db: TestDatabase): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 10, locationName: "Parcul Tractorul" })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul copiilor", slug: "crosul-copiilor" },
    { eventId: event.id, locale: "en", title: "The children's cross", slug: "childrens-cross" },
  ]);
  return { id: event.id, raceId: null, capacity: event.capacity, registrationMode: event.registrationMode, registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW };
}

const submission = (overrides: Record<string, unknown>) => ({
  firstName: "Maria",
  lastName: "Popescu",
  // Fifteen on the race day: a minor, and over the minimum age of fourteen (§321).
  birthDate: "2011-03-02",
  sex: "FEMALE",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  email: "maria@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
  ...overrides,
});

describe("a minor registered by a parent (§108)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  it("counts eighteen by the calendar", () => {
    expect(isMinorOn("2008-09-05", new Date("2026-09-04T10:00:00Z"))).toBe(true);
    expect(isMinorOn("2008-09-04", new Date("2026-09-04T10:00:00Z"))).toBe(false);
    expect(isMinorOn("1990-05-17", NOW)).toBe(false);
  });

  it("refuses a minor with no parent named, and names the field", async () => {
    await approve(db);
    const event = await createEvent(db);
    try {
      await submitRegistration(db, event, submission({}), NOW);
      expect.unreachable("a minor without a guardian was accepted");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("VALIDATION_ERROR");
      expect(isDomainError(error) && error.message).toContain("guardianName");
    }
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("keeps the parent's name, opens the declaration with it, and drops an adult's stray entry", async () => {
    await approve(db);
    const event = await createEvent(db);
    await submitRegistration(db, event, submission({ guardianName: "Ion Popescu" }), NOW);
    const [minor] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(minor.guardianName).toBe("Ion Popescu");
    expect(minor.registeredName).toBe("Maria Popescu");

    await confirmEmail(db, event, minor.id, NOW);
    // The parent signs, with their own document.
    await signDeclaration(db, event, minor.id, { ...(await signingInput(db, NOW, "Ion Popescu")), idDocument: "BV 654321" }, NOW);
    const signed = await findSignedDeclaration(db, minor.id);
    expect(signed?.guardianName).toBe("Ion Popescu");
    const entry = await signedDeclarationEntry(db, signed!, event.id, LABELS, "participant");
    // The entry carries the approved template and its fill-ins apart, so the PDF can set the
    // filled-in parts in bold (§225). What a reader sees is the two merged, which is what is
    // asserted here — the same function the renderer and the screen both use.
    const merged = mergeLegalBody(entry!.body, entry!.values ?? {});
    const text = merged.sections.flatMap((s) => s.paragraphs).join(" ");
    expect(text).toContain("Subsemnatul/a Ion Popescu (părinte/tutore legal al minorului Maria Popescu), posesor/posesoare al actului de identitate BV 654321");
    expect(text).not.toContain("{{");

    // An adult who typed into the folded field named nobody's guardian: nothing is kept.
    await submitRegistration(db, event, submission({ email: "adult@example.ro", firstName: "Ana", birthDate: "1990-05-17", guardianName: "Cineva" }), NOW);
    const adult = (await db.select().from(registrations).where(eq(registrations.eventId, event.id))).find((row) => row.registeredName === "Ana Popescu");
    expect(adult?.guardianName).toBeNull();
    expect(declarantValues("Ana Popescu", null, "ro")).toEqual({ declarant: "Ana Popescu", guardian: "—" });
    expect(declarantValues("Maria Popescu", "Ion Popescu", "en").declarant).toBe("Ion Popescu (parent/legal guardian of the minor Maria Popescu)");
  });

  /*
    BR-REQ-031-04 (§NNN): the privacy notice says the club keeps no Strava or Instagram of a
    minor. The form hides the two boxes once the birth date says so; the server is the rule, for
    a form posted without JavaScript or with values typed before the date was.
  */
  it("keeps no Strava or Instagram for a minor, and keeps an adult's", async () => {
    await approve(db);
    const event = await createEvent(db);
    const socials = { stravaUrl: "https://www.strava.com/athletes/12345", instagramHandle: "maria.alearga" };

    await submitRegistration(db, event, submission({ guardianName: "Ion Popescu", ...socials }), NOW);
    await submitRegistration(db, event, submission({ email: "adult@example.ro", firstName: "Ana", birthDate: "1990-05-17", ...socials }), NOW);

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const minor = rows.find((row) => row.registeredName === "Maria Popescu");
    const adult = rows.find((row) => row.registeredName === "Ana Popescu");
    expect(minor?.stravaUrl).toBeNull();
    expect(minor?.instagramHandle).toBeNull();
    expect(adult?.stravaUrl).toBe(socials.stravaUrl);
    expect(adult?.instagramHandle).toBe(socials.instagramHandle);
  });

  it("decides minor on the day of registering, as the guardian rule does", async () => {
    await approve(db);
    const event = await createEvent(db);
    // Seventeen on 4 September 2026 and eighteen by the race on 11 October: a minor when the
    // consent would be given, so no socials — and a guardian, by the same rule.
    await submitRegistration(
      db,
      event,
      submission({ birthDate: "2008-09-20", guardianName: "Ion Popescu", stravaUrl: "https://www.strava.com/athletes/9" }),
      NOW,
    );
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(row.guardianName).toBe("Ion Popescu");
    expect(row.stravaUrl).toBeNull();
  });
});
