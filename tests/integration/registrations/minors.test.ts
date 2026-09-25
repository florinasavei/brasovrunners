import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { confirmRegistrationByStaff } from "@/modules/registrations/admin-service";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import {
  declarationAsksMinorToSign,
  declarationAsksMinorToSignByLocale,
  insertLegalDocumentVersion,
} from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { isMinorOn } from "@/modules/registrations/fields";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import {
  declarantValues,
  findSignedDeclaration,
  renderBlankDeclarationPdf,
  renderSignedDeclarationPdf,
  signedDeclarationEntry,
} from "@/modules/registrations/signed-declaration";
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
  whereuponTogether: "DREPT PENTRU CARE SEMNĂM,",
  signature: "Semnătura",
  minorSignature: "Semnătura minorului",
  guardianSignature: "Semnătura părintelui sau tutorelui",
  date: "Data",
  idDocument: "Act de identitate",
  version: "Versiunea",
  generatedOn: "Generat",
  page: (n: number, total: number) => `${n}/${total}`,
  signedByLink: (when: string) => `Semnat electronic pe ${when}`,
  signedOnPaper: (who: string, when: string) => `Pe hârtie; ${who} ${when}`,
  attesterRemoved: "un membru al echipei",
};

/**
 * The PDF labels, watched (§330): which of them the renderer read says which signature block it
 * drew — `whereuponTogether` and `minorSignature` only for the two-signer one — where the
 * compressed page itself cannot be read back.
 */
function trackedLabels() {
  const read = new Set<string>();
  const labels = new Proxy(LABELS, {
    get(target, key, receiver) {
      read.add(String(key));
      return Reflect.get(target, key, receiver);
    },
  });
  return { labels, read };
}

/**
 * A declaration approved before two signatures were asked (§330): the shape of the platform's text
 * until then, and of production's approved one — the parent declares, with the parent's document,
 * and nothing names the minor's own.
 */
const legacyBody = (text: string): LegalDocumentTranslationInput["body"] => ({ sections: [{ paragraphs: [text] }] });
const LEGACY_DECLARATION: LegalDocumentTranslationInput[] = [
  { locale: "ro", title: "Declarație", body: legacyBody("Subsemnatul/a {{declarant}}, posesor/posesoare al actului de identitate {{idDocument}}, declar că particip la {{event}}.") },
  { locale: "en", title: "Declaration", body: legacyBody("I, {{declarant}}, holder of identity document {{idDocument}}, take part in {{event}}.") },
];

async function approve(
  db: TestDatabase,
  declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationRo },
    { locale: "en", title: "Declaration", body: declarationEn },
  ],
) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "TERMS", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
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
  termsAccepted: true,
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
    // The minor and the parent sign together (§330), each with their own name and document.
    await signDeclaration(
      db,
      event,
      minor.id,
      { ...(await signingInput(db, NOW, "Ion Popescu")), idDocument: "BV 654321", minorTypedName: "Maria Popescu", minorIdDocument: "MP 123456" },
      NOW,
    );
    const signed = await findSignedDeclaration(db, minor.id);
    expect(signed?.guardianName).toBe("Ion Popescu");
    const entry = await signedDeclarationEntry(db, signed!, event.id, LABELS, "participant");
    // The entry carries the approved template and its fill-ins apart, so the PDF can set the
    // filled-in parts in bold (§225). What a reader sees is the two merged, which is what is
    // asserted here — the same function the renderer and the screen both use.
    const merged = mergeLegalBody(entry!.body, entry!.values ?? {});
    const text = merged.sections.flatMap((s) => s.paragraphs).join(" ");
    // The platform's text since §330: the minor declares with their own document, and the parent
    // is named with theirs in a sentence of its own.
    expect(text).toContain("Subsemnatul/a Maria Popescu, posesor/posesoare al/a actului de identitate MP 123456");
    expect(text).toContain("părintele sau tutorele legal: Ion Popescu, posesor/posesoare al/a actului de identitate BV 654321");
    expect(text).not.toContain("{{");
    // Both signatures, each with its document, under the one instant.
    expect(entry!.signature).toMatchObject({ typedName: "Ion Popescu", idDocument: "BV 654321", minor: { typedName: "Maria Popescu", idDocument: "MP 123456" } });

    // An adult who typed into the folded field named nobody's guardian: nothing is kept.
    await submitRegistration(db, event, submission({ email: "adult@example.ro", firstName: "Ana", birthDate: "1990-05-17", guardianName: "Cineva" }), NOW);
    const adult = (await db.select().from(registrations).where(eq(registrations.eventId, event.id))).find((row) => row.registeredName === "Ana Popescu");
    expect(adult?.guardianName).toBeNull();
    expect(declarantValues("Ana Popescu", null, "ro")).toEqual({ declarant: "Ana Popescu", guardian: "—" });
    expect(declarantValues("Maria Popescu", "Ion Popescu", "en").declarant).toBe("Ion Popescu (parent/legal guardian of the minor Maria Popescu)");
  });

  /**
   * §330 — the production gate. A text the club approved before two signatures were asked names
   * `{{declarant}}` and `{{idDocument}}` and not `{{participantIdDocument}}` — production's
   * approved declaration is one, and the privacy notice approved beside it says nothing of a
   * minor's own identity number. Under it a minor's declaration is exactly what it was (§108,
   * §314): signed once, by the parent, with one document, the parent's. The minor is not asked,
   * and nothing of the minor's is kept even when a hand-made post carries it. It reads as it did,
   * and prints one signature.
   */
  it("under a text approved before two signatures, asks the parent alone with one document and keeps nothing of the minor's", async () => {
    await approve(db, LEGACY_DECLARATION);
    const event = await createEvent(db);
    await submitRegistration(db, event, submission({ guardianName: "Ion Popescu" }), NOW);
    await submitRegistration(db, event, submission({ guardianName: "Ion Popescu", firstName: "Ioana", email: "ioana@example.ro" }), NOW);
    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const minor = rows.find((row) => row.registeredName === "Maria Popescu")!;
    const sister = rows.find((row) => row.registeredName === "Ioana Popescu")!;
    await confirmEmail(db, event, minor.id, NOW);
    await confirmEmail(db, event, sister.id, NOW);

    const read = await signingInput(db, NOW, "Ion Popescu");
    // The one document the text names is the parent's, and it is still required — on its own field.
    await expect(signDeclaration(db, event, minor.id, read, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["idDocument"] });
    // The parent's box is checked as before: the child's name in it is refused, and only it (§314).
    await expect(signDeclaration(db, event, minor.id, { ...read, typedName: "Maria Popescu", idDocument: "BV 654321" }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["typedName"],
    });
    expect(await db.select().from(declarationAcceptances)).toHaveLength(0);

    // One signature, one document: signed — no minor's box is asked for.
    expect((await signDeclaration(db, event, minor.id, { ...read, idDocument: "BV 654321" }, NOW)).status).toBe("CONFIRMED");
    // A hand-made post carrying the minor's boxes signs just the same, and they are not kept.
    await signDeclaration(db, event, sister.id, { ...read, idDocument: "BV 654321", minorTypedName: "Ioana Popescu", minorIdDocument: "MP 123456" }, NOW);
    const acceptances = await db.select().from(declarationAcceptances);
    for (const id of [minor.id, sister.id]) {
      expect(acceptances.find((row) => row.registrationId === id)).toMatchObject({
        typedName: "Ion Popescu",
        idDocument: "BV 654321",
        minorTypedName: null,
        minorIdDocument: null,
      });
    }

    const signed = await findSignedDeclaration(db, minor.id);
    const entry = await signedDeclarationEntry(db, signed!, event.id, LABELS, "participant");
    const text = mergeLegalBody(entry!.body, entry!.values ?? {}).sections.flatMap((s) => s.paragraphs).join(" ");
    expect(text).toBe("Subsemnatul/a Ion Popescu (părinte/tutore legal al minorului Maria Popescu), posesor/posesoare al actului de identitate BV 654321, declar că particip la Crosul copiilor.");
    // One signature, the parent's, with the parent's document — the PDF prints the one block.
    expect(entry!.signature).toMatchObject({ typedName: "Ion Popescu", idDocument: "BV 654321", minor: null });
    const drawn = trackedLabels();
    const pdf = await renderSignedDeclarationPdf(db, signed!, event.id, drawn.labels, NOW, "participant");
    expect(pdf!.toString("latin1").startsWith("%PDF-1.")).toBe(true);
    expect(drawn.read.has("whereupon")).toBe(true);
    expect(drawn.read.has("minorSignature")).toBe(false);
    expect(drawn.read.has("whereuponTogether")).toBe(false);
  });

  /**
   * §330 — the same text, with the platform's template in effect: a minor must sign beside the
   * parent, and a post without the minor's box or document — what the page asked before — is
   * refused on that box alone, with nothing recorded.
   */
  it("under the platform's text, refuses a minor's declaration signed by the parent alone", async () => {
    await approve(db);
    const event = await createEvent(db);
    await submitRegistration(db, event, submission({ guardianName: "Ion Popescu" }), NOW);
    const [minor] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, minor.id, NOW);

    const read = await signingInput(db, NOW, "Ion Popescu");
    await expect(signDeclaration(db, event, minor.id, { ...read, idDocument: "BV 654321" }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["minorTypedName"],
    });
    await expect(signDeclaration(db, event, minor.id, { ...read, idDocument: "BV 654321", minorTypedName: "Maria Popescu" }, NOW)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["minorIdDocument"],
    });
    expect(await db.select().from(declarationAcceptances)).toHaveLength(0);
  });

  /**
   * §67, §330 — "Confirmă pe hârtie" for a minor, under the platform's text (it asks the minor to
   * sign). The paper at the desk carries both signatures, and what the press records is exactly
   * that: the parent as the declarant and the minor beside them, the volunteer as the one who saw
   * the paper. Nobody on staff signs; the documents stay on the paper, as they always did.
   */
  it("records both signers when the desk confirms a minor on paper, and the staff member who saw it", async () => {
    await approve(db);
    const event = await createEvent(db);
    const [volunteer] = await db.insert(staffUsers).values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" }).returning();
    await submitRegistration(db, event, submission({ guardianName: "Ion Popescu" }), NOW);
    await submitRegistration(db, event, submission({ email: "adult@example.ro", firstName: "Ana", birthDate: "1990-05-17" }), NOW);
    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const minor = rows.find((row) => row.guardianName !== null)!;
    const adult = rows.find((row) => row.guardianName === null)!;

    expect((await confirmRegistrationByStaff(db, volunteer, minor.id, NOW)).status).toBe("CONFIRMED");
    expect((await confirmRegistrationByStaff(db, volunteer, adult.id, NOW)).status).toBe("CONFIRMED");

    const acceptances = await db.select().from(declarationAcceptances);
    expect(acceptances.find((row) => row.registrationId === minor.id)).toMatchObject({
      method: "PAPER",
      attestedByStaffUserId: volunteer.id,
      typedName: "Ion Popescu",
      minorTypedName: "Maria Popescu",
      idDocument: null,
      minorIdDocument: null,
    });
    // An adult's paper is unchanged: one signature, the registered name.
    expect(acceptances.find((row) => row.registrationId === adult.id)).toMatchObject({
      method: "PAPER",
      typedName: "Ana Popescu",
      minorTypedName: null,
    });

    // The signed PDF of the paper acceptance prints both lines; the blank form for a minor, too.
    const signed = await findSignedDeclaration(db, minor.id);
    expect((await signedDeclarationEntry(db, signed!, event.id, LABELS, "participant"))!.signature?.minor).toEqual({ typedName: "Maria Popescu", idDocument: null });
    const drawn = trackedLabels();
    const blank = await renderBlankDeclarationPdf(db, event.id, "ro", drawn.labels, NOW, { forMinor: true });
    expect(blank!.toString("latin1").startsWith("%PDF-1.")).toBe(true);
    // The minor's form: two signature lines under "we sign".
    expect(drawn.read.has("whereuponTogether")).toBe(true);
    expect(drawn.read.has("minorSignature")).toBe(true);
  });

  /**
   * §67, §330 — the same press under a text approved before two signatures. The paper is the one
   * the parent signed alone, and the row records that and nothing more: the parent as the
   * declarant, no minor's name. The minor's printable form is the one-signature form there,
   * whatever was asked for, since the text does not ask the minor to sign.
   */
  it("records the parent alone when the desk confirms a minor on paper under an older text, and prints no minor's form", async () => {
    await approve(db, LEGACY_DECLARATION);
    const event = await createEvent(db);
    const [volunteer] = await db.insert(staffUsers).values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" }).returning();
    await submitRegistration(db, event, submission({ guardianName: "Ion Popescu" }), NOW);
    const [minor] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));

    expect((await confirmRegistrationByStaff(db, volunteer, minor.id, NOW)).status).toBe("CONFIRMED");
    const [acceptance] = await db.select().from(declarationAcceptances);
    expect(acceptance).toMatchObject({
      registrationId: minor.id,
      method: "PAPER",
      attestedByStaffUserId: volunteer.id,
      typedName: "Ion Popescu",
      minorTypedName: null,
      idDocument: null,
      minorIdDocument: null,
    });
    const signed = await findSignedDeclaration(db, minor.id);
    expect((await signedDeclarationEntry(db, signed!, event.id, LABELS, "participant"))!.signature?.minor).toBeNull();

    const drawn = trackedLabels();
    const blank = await renderBlankDeclarationPdf(db, event.id, "ro", drawn.labels, NOW, { forMinor: true });
    expect(blank!.toString("latin1").startsWith("%PDF-1.")).toBe(true);
    expect(drawn.read.has("whereupon")).toBe(true);
    expect(drawn.read.has("whereuponTogether")).toBe(false);
    expect(drawn.read.has("minorSignature")).toBe(false);
  });

  /** §330 — the gate the desk and the registration's page read before the press, per language. */
  it("says per language whether the declaration in effect asks a minor to sign", async () => {
    expect(await declarationAsksMinorToSignByLocale(db, NOW)).toEqual({ ro: false, en: false });
    await approve(db, LEGACY_DECLARATION);
    expect(await declarationAsksMinorToSignByLocale(db, NOW)).toEqual({ ro: false, en: false });
    // The club approves a declaration made from the platform's text: on by itself, in both.
    const current: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationRo },
      { locale: "en", title: "Declaration", body: declarationEn },
    ];
    await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 2, effectiveAt: new Date("2026-02-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(current), translations: current, now: NOW });
    expect(await declarationAsksMinorToSignByLocale(db, NOW)).toEqual({ ro: true, en: true });
    expect(await declarationAsksMinorToSign(db, "en", NOW)).toBe(true);
  });

  /*
    BR-REQ-031-04 (§323): the privacy notice says the club keeps no Strava or Instagram of a
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
