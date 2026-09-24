import { inflateSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentBody, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { DECLARATION_FOOTER, DECLARATION_MARGIN, DECLARATION_PAGE, renderDeclarationPdf } from "@/modules/registrations/declaration-pdf";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import {
  findSignedDeclaration,
  listSignedDeclarations,
  renderBlankDeclarationPdf,
  renderEventDeclarationsPdf,
  eventMergeValues,
  renderSignedDeclarationPdf,
  signedDeclarationEntry,
} from "@/modules/registrations/signed-declaration";
import { emailOutbox } from "@/db/schema/email-outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { BLANK, mergeLegalBody, mergeText, mergeTextSegments } from "@/modules/legal-documents/domain/merge-fields";

/**
 * `DECISIONS.md` §95 — the club's declaration: its blanks are fields, the identity document is
 * asked when the text names it, and the signed declaration is reproducible as a PDF for the
 * runner and for the club's archive.
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
  // What declarationWords writes for NOW (§349): "pe" before a date that starts with its weekday.
  generatedOn: "Generat pe vineri, 4 sept. 2026, 13:00",
  page: (n: number, total: number) => `Pagina ${n} din ${total}`,
  signedByLink: (when: string) => `Semnat electronic pe ${when}`,
  signedOnPaper: (who: string, when: string) => `Semnat pe hârtie; înregistrat de ${who} pe ${when}`,
  attesterRemoved: "un membru al echipei",
};

async function approve(db: TestDatabase, declaration: LegalDocumentTranslationInput[]) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(declaration), translations: declaration, now: NOW });
}

const CLUB_DECLARATION: LegalDocumentTranslationInput[] = [
  { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationRo },
  { locale: "en", title: "Declaration", body: declarationEn },
];
const PLAIN_DECLARATION: LegalDocumentTranslationInput[] = [
  { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Particip pe proprie răspundere."] }] } },
  { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I take part at my own risk."] }] } },
];

async function createEvent(db: TestDatabase): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    // Published, which is what an event taking registrations is — and what the confirmation's
    // calendar attachment requires (§174): an `.ics` for a draft would put an unpublished
    // page's details into somebody's calendar.
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-11T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity: 10,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul aniversar", slug: "crosul-aniversar" },
    { eventId: event.id, locale: "en", title: "The anniversary cross", slug: "anniversary-cross" },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    registrationMode: event.registrationMode,
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW, // registration opens at publication when unset
  };
}

const submission = {
  firstName: "Ana",
  lastName: "Popescu",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  email: "ana@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
};

describe("the club's declaration (§95)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function pendingRegistration(event: EventForRegistration) {
    await submitRegistration(db, event, submission, NOW);
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, row.id, NOW);
    return row;
  }

  it("asks for the identity document when the text names it, records it, and prints it", async () => {
    await approve(db, CLUB_DECLARATION);
    const event = await createEvent(db);
    const pending = await pendingRegistration(event);
    const read = await signingInput(db, NOW, "Ana Popescu");

    await expect(signDeclaration(db, event, pending.id, read, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(signDeclaration(db, event, pending.id, { ...read, idDocument: "!!" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const confirmed = await signDeclaration(db, event, pending.id, { ...read, idDocument: "bv 123456" }, NOW);
    expect(confirmed.status).toBe("CONFIRMED");
    const [acceptance] = await db.select().from(declarationAcceptances);
    expect(acceptance.idDocument).toBe("bv 123456");

    const signed = await findSignedDeclaration(db, pending.id);
    expect(signed?.typedName).toBe("Ana Popescu");
    expect(signed?.idDocument).toBe("bv 123456");
    const entry = await signedDeclarationEntry(db, signed!, event.id, LABELS, "participant");
    // The entry carries the approved template and its fill-ins apart, so the PDF can set the
    // filled-in parts in bold (§225). What a reader sees is the two merged, which is what is
    // asserted here — the same function the renderer and the screen both use.
    const merged = mergeLegalBody(entry!.body, entry!.values ?? {});
    const text = merged.sections.flatMap((s) => s.paragraphs).join(" ");
    // The blanks are filled: the person, the document, the event, its date and its place.
    expect(text).toContain("Subsemnatul/a Ana Popescu, posesor/posesoare al actului de identitate bv 123456");
    expect(text).toContain("la evenimentul Crosul aniversar, care va avea loc în data de duminică, 11 oct. 2026, în locația Parcul Tractorul");
    expect(text).not.toContain("{{");
    expect(entry!.signature?.idDocument).toBe("bv 123456");
    // Under the "Data" label the signing instant starts the value, with its weekday (§349).
    expect(entry!.signature?.signedAt).toBe("Vineri, 4 sept. 2026, 13:00");
    // An English declaration writes the event's date in English — the declaration's language.
    expect((await eventMergeValues(db, event.id, "en"))?.values.eventDate).toBe("Sunday, 11 Oct 2026");

    const pdf = await renderSignedDeclarationPdf(db, signed!, event.id, LABELS, NOW, "participant");
    const raw = pdf!.toString("latin1");
    expect(raw.startsWith("%PDF-1.")).toBe(true);
    expect(raw).toMatch(/Caveat/); // the signature in the hand the page showed it in
    expect(raw).toMatch(/Roboto/);
  });

  /**
   * BR-REQ-033-02 criterion 11 as amended by §320: the copy that leaves for a club mailbox prints
   * the identity document masked — in the text's blank and on the signature line alike — while
   * the name, the event and the signature are the participant's copy's.
   */
  it("BR-REQ-033-02 criterion 11 masks the identity document in the club's copy, everywhere the page prints it", async () => {
    await approve(db, CLUB_DECLARATION);
    const event = await createEvent(db);
    const pending = await pendingRegistration(event);
    await signDeclaration(db, event, pending.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);
    const signed = await findSignedDeclaration(db, pending.id);

    const club = await signedDeclarationEntry(db, signed!, event.id, LABELS, "club");
    const whole = await signedDeclarationEntry(db, signed!, event.id, LABELS, "participant");
    expect(club!.signature?.idDocument).toBe("BV ••••56");
    expect(club!.values?.idDocument).toBe("BV ••••56");
    expect(JSON.stringify(club)).not.toContain("123456");
    const text = mergeLegalBody(club!.body, club!.values ?? {}).sections.flatMap((s) => s.paragraphs).join(" ");
    expect(text).toContain("posesor/posesoare al actului de identitate BV ••••56");
    expect(text).not.toContain("123456");
    // Everything else is the same page.
    expect({ ...club!.signature, idDocument: null }).toEqual({ ...whole!.signature, idDocument: null });
    expect(club!.values?.participant).toBe(whole!.values?.participant);

    // A declaration with no document named has nothing to mask, and prints no line for one.
    expect((await signedDeclarationEntry(db, { ...signed!, idDocument: null }, event.id, LABELS, "club"))!.signature?.idDocument).toBeNull();
    // It still renders.
    const pdf = await renderSignedDeclarationPdf(db, signed!, event.id, LABELS, NOW, "club");
    expect(pdf!.toString("latin1").startsWith("%PDF-1.")).toBe(true);
  });

  /**
   * §320 and §330: a minor's declaration carries two documents, and the club's copy masks both —
   * in every blank of the text that prints one and on both signature lines — while the
   * participant's copy keeps both whole.
   */
  it("masks both of a minor's documents in the club's copy, and keeps both whole in the participant's", async () => {
    await approve(db, CLUB_DECLARATION);
    const event = await createEvent(db);
    // Fifteen on the race day, registered by a parent (§108, §321).
    await submitRegistration(db, event, { ...submission, firstName: "Maria", birthDate: "2011-03-02", email: "maria@example.ro", guardianName: "Ion Popescu" }, NOW);
    const [minor] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, minor.id, NOW);
    await signDeclaration(
      db,
      event,
      minor.id,
      { ...(await signingInput(db, NOW, "Ion Popescu")), idDocument: "BV 123456", minorTypedName: "Maria Popescu", minorIdDocument: "MP 654321" },
      NOW,
    );
    const signed = await findSignedDeclaration(db, minor.id);
    expect(signed).toMatchObject({ typedName: "Ion Popescu", idDocument: "BV 123456", minorTypedName: "Maria Popescu", minorIdDocument: "MP 654321" });

    const club = await signedDeclarationEntry(db, signed!, event.id, LABELS, "club");
    expect(club!.signature).toMatchObject({ idDocument: "BV ••••56", minor: { typedName: "Maria Popescu", idDocument: "MP ••••21" } });
    expect(club!.values).toMatchObject({ idDocument: "BV ••••56", participantIdDocument: "MP ••••21", guardianIdDocument: "BV ••••56" });
    expect(JSON.stringify(club)).not.toContain("123456");
    expect(JSON.stringify(club)).not.toContain("654321");
    const text = mergeLegalBody(club!.body, club!.values ?? {}).sections.flatMap((s) => s.paragraphs).join(" ");
    expect(text).toContain("Subsemnatul/a Maria Popescu, posesor/posesoare al actului de identitate MP ••••21");
    expect(text).toContain("Ion Popescu, posesor/posesoare al actului de identitate BV ••••56");

    const whole = await signedDeclarationEntry(db, signed!, event.id, LABELS, "participant");
    expect(whole!.signature).toMatchObject({ idDocument: "BV 123456", minor: { typedName: "Maria Popescu", idDocument: "MP 654321" } });
    expect(whole!.values).toMatchObject({ participantIdDocument: "MP 654321", guardianIdDocument: "BV 123456" });
    // Both render: two signature lines at the foot.
    for (const audience of ["club", "participant"] as const) {
      const pdf = await renderSignedDeclarationPdf(db, signed!, event.id, LABELS, NOW, audience);
      expect(pdf!.toString("latin1").startsWith("%PDF-1.")).toBe(true);
    }
  });

  it("does not ask for a document the text never names, and prints the blank form for the desk", async () => {
    await approve(db, PLAIN_DECLARATION);
    const event = await createEvent(db);
    const pending = await pendingRegistration(event);
    const confirmed = await signDeclaration(db, event, pending.id, await signingInput(db, NOW, pending.registeredName), NOW);
    expect(confirmed.status).toBe("CONFIRMED");
    expect((await db.select().from(declarationAcceptances))[0].idDocument).toBeNull();

    const blank = await renderBlankDeclarationPdf(db, event.id, "ro", LABELS, NOW);
    expect(blank!.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(1);
  });

  it("bundles every signed declaration of an event, oldest first, one per page at least", async () => {
    await approve(db, CLUB_DECLARATION);
    const event = await createEvent(db);
    const first = await pendingRegistration(event);
    await signDeclaration(db, event, first.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 111111" }, NOW);
    await submitRegistration(db, event, { ...submission, email: "ion@example.ro", firstName: "Ion", lastName: "Ionescu" }, NOW);
    const [second] = await db.select().from(registrations).where(eq(registrations.eventId, event.id)).then((rows) => rows.filter((r) => r.id !== first.id));
    await confirmEmail(db, event, second.id, NOW);
    await signDeclaration(db, event, second.id, { ...(await signingInput(db, NOW, "Ion Ionescu")), idDocument: "BV 222222" }, new Date(NOW.getTime() + 60_000));

    const all = await listSignedDeclarations(db, event.id);
    expect(all.map((s) => s.typedName)).toEqual(["Ana Popescu", "Ion Ionescu"]);
    const pdf = await renderEventDeclarationsPdf(db, event.id, "ro", LABELS, NOW);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(2);
    // Nothing signed is still a valid file.
    const empty = await renderDeclarationPdf({ entries: [], locale: "ro", generatedAt: NOW, labels: LABELS });
    expect(empty.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(1);
  });

  it("sends the signed declaration back by email, attached to the confirmation (§126)", async () => {
    await approve(db, CLUB_DECLARATION);
    const event = await createEvent(db);
    const pending = await pendingRegistration(event);
    await signDeclaration(db, event, pending.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);

    const queued = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, pending.id));
    const types = queued.map((row) => row.messageType);
    expect(types).toContain("REGISTRATION_CONFIRMED");
    // Since §126 the participant's copy rides on the confirmation, not as a message of its own.
    expect(types).not.toContain("DECLARATION_SIGNED");

    const row = queued.find((r) => r.messageType === "REGISTRATION_CONFIRMED")!;
    const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    expect(message.subject).toBe("Înscrierea este confirmată / Your registration is confirmed"); // bilingual, the registration's language first (§96)
    /**
     * Two attachments since §174: the event for the runner's calendar, and the declaration they
     * signed. The calendar file rides on the confirmation because that is the message somebody
     * acts on, and every phone opens an `.ics` with one tap — including the clients that will
     * not follow a link out to the site.
     */
    const byName = new Map((message.attachments ?? []).map((one) => [one.filename, one]));
    expect([...byName.keys()].sort()).toEqual(["crosul-aniversar.ics", "declaratie-semnata.pdf"]);
    expect(byName.get("declaratie-semnata.pdf")!.data.toString("latin1").startsWith("%PDF-1.")).toBe(true);

    const ics = byName.get("crosul-aniversar.ics")!;
    expect(ics.contentType).toContain("text/calendar");
    const calendar = ics.data.toString("utf8");
    expect(calendar).toContain("BEGIN:VCALENDAR");
    expect(calendar).toContain("BEGIN:VEVENT");
    // The event's own details, not a stub: the same file the page offers (§107, §159).
    expect(calendar).toContain("Crosul aniversar");
    // The same manage token serves the link to the PDF, for a client that strips attachments.
    expect(message.html).toMatch(/\/api\/registrations\/declaration\/[A-Za-z0-9_-]+/);
    expect(message.text).toContain("Declarația pe care ai semnat-o (PDF)");
  });

  /**
   * §357 — the platform's declaration grew by the risks the runner takes on (animals, terrain,
   * the dark and a headlamp, their own pace, their belongings), and every merge field it names
   * still reads filled on what is signed and printed: nothing on a signed copy is left a dotted
   * blank, and the blank form for the desk leaves dotted exactly the person's own fields.
   */
  it("fills every merge field of the platform's declaration on the signed copy, adult and minor, and dots only the person's on the blank form", async () => {
    await approve(db, CLUB_DECLARATION);
    const event = await createEvent(db);
    const adult = await pendingRegistration(event);
    await signDeclaration(db, event, adult.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);
    await submitRegistration(db, event, { ...submission, firstName: "Maria", birthDate: "2011-03-02", email: "maria@example.ro", guardianName: "Ion Popescu" }, NOW);
    const [minor] = (await db.select().from(registrations).where(eq(registrations.eventId, event.id))).filter((row) => row.id !== adult.id);
    await confirmEmail(db, event, minor.id, NOW);
    await signDeclaration(db, event, minor.id, { ...(await signingInput(db, NOW, "Ion Popescu")), idDocument: "BV 654321", minorTypedName: "Maria Popescu", minorIdDocument: "MP 111222" }, NOW);

    for (const registrationId of [adult.id, minor.id]) {
      const entry = await signedDeclarationEntry(db, (await findSignedDeclaration(db, registrationId))!, event.id, LABELS, "participant");
      const fields = entry!.body.sections.flatMap((s) => s.paragraphs).flatMap((p) => mergeTextSegments(p, entry!.values ?? {})).filter((segment) => segment.filled);
      // Every field the text names: seven, some more than once.
      expect(fields.length).toBeGreaterThanOrEqual(7);
      expect(fields.filter((segment) => segment.text === BLANK)).toEqual([]);
      const text = mergeLegalBody(entry!.body, entry!.values ?? {}).sections.flatMap((s) => s.paragraphs).join(" ");
      expect(text).not.toContain("{{");
      expect(text).toContain("lanternă frontală funcțională");
    }

    // The blank form: the event's three facts filled, the person's own fields dotted for the pen.
    const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", NOW);
    const facts = await eventMergeValues(db, event.id, "ro");
    const blank = (document!.body as LegalDocumentBody).sections.flatMap((s) => s.paragraphs).join("\n");
    const merged = mergeText(blank, facts!.values);
    expect(merged).toContain("la evenimentul Crosul aniversar, care va avea loc în data de duminică, 11 oct. 2026, în locația Parcul Tractorul");
    expect(merged).toContain(`Subsemnatul/a ${BLANK}, posesor/posesoare al actului de identitate ${BLANK}`);
    expect(merged).not.toContain("{{");
  });

  /**
   * §357 — the longer text flows onto a second page rather than being cut: every line of text on
   * every page lies between the top margin and the footer's rule, and the last page carries the
   * end of the text and the signature block, not a footer alone. Signed (adult and minor) and the
   * blank forms alike, since each is its own layout at the foot.
   */
  it("renders the longer declaration on two pages without a line cut off or drawn into the footer", async () => {
    await approve(db, CLUB_DECLARATION);
    const event = await createEvent(db);
    const adult = await pendingRegistration(event);
    await signDeclaration(db, event, adult.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: "BV 123456" }, NOW);
    await submitRegistration(db, event, { ...submission, firstName: "Maria", birthDate: "2011-03-02", email: "maria@example.ro", guardianName: "Ion Popescu" }, NOW);
    const [minor] = (await db.select().from(registrations).where(eq(registrations.eventId, event.id))).filter((row) => row.id !== adult.id);
    await confirmEmail(db, event, minor.id, NOW);
    await signDeclaration(db, event, minor.id, { ...(await signingInput(db, NOW, "Ion Popescu")), idDocument: "BV 654321", minorTypedName: "Maria Popescu", minorIdDocument: "MP 111222" }, NOW);

    const pdfs = {
      signedAdult: await renderSignedDeclarationPdf(db, (await findSignedDeclaration(db, adult.id))!, event.id, LABELS, NOW, "participant"),
      signedMinor: await renderSignedDeclarationPdf(db, (await findSignedDeclaration(db, minor.id))!, event.id, LABELS, NOW, "club"),
      blank: await renderBlankDeclarationPdf(db, event.id, "ro", LABELS, NOW),
      blankMinor: await renderBlankDeclarationPdf(db, event.id, "ro", LABELS, NOW, { forMinor: true }),
      blankEnglish: await renderBlankDeclarationPdf(db, event.id, "en", LABELS, NOW),
    };
    for (const [name, pdf] of Object.entries(pdfs)) {
      const pages = textLinesByPage(pdf!);
      expect(pages.length, name).toBe(2);
      expect(pdf!.toString("latin1").match(/\/Type \/Page\b/g)?.length, name).toBe(2);
      for (const [index, lines] of pages.entries()) {
        const page = `${name} page ${index + 1}`;
        const body = lines.filter(([, y]) => y >= FOOTER_TOP);
        const footer = lines.filter(([, y]) => y < FOOTER_TOP);
        // The footer: the club and the date, and the page count — nothing else down there, both
        // on one baseline under the footer's top and on the paper.
        expect(footer.length, `${page} footer`).toBe(2);
        expect(Math.abs(footer[0][1] - footer[1][1]), `${page} footer on one line`).toBeLessThan(0.01);
        expect(footer[0][1], `${page} footer on the paper`).toBeGreaterThan(0);
        // Text on the page, all of it between the margins.
        expect(body.length, `${page} has text`).toBeGreaterThan(5);
        for (const [x, y] of body) {
          expect(y, `${page}: a line below the bottom margin`).toBeGreaterThanOrEqual(DECLARATION_MARGIN.bottom);
          expect(y, `${page}: a line above the top margin`).toBeLessThanOrEqual(DECLARATION_PAGE.height - DECLARATION_MARGIN.top);
          expect(x, `${page}: a line left of the margin`).toBeGreaterThanOrEqual(DECLARATION_MARGIN.left - 0.5);
          expect(x, `${page}: a line starting past the right margin`).toBeLessThan(DECLARATION_PAGE.width - DECLARATION_MARGIN.right);
        }
      }
    }
  });
});

/**
 * The page's geometry is `declaration-pdf.ts`'s own, imported, and the file's positions are in
 * PDF's bottom-up points. The footer's line has its top `gap` under the bottom margin, so every
 * run lower than that is the footer and every run above it is the text — without knowing the
 * face's ascent, which only says how far under that top the baseline falls. A text run's
 * position is its baseline, which lies above the bottom margin whenever the line fits above it.
 *
 * The right edge is held only as far as every run *starting* left of it: the end of a line is not
 * in these positions (Roboto is drawn by glyph id, so a width would need the font's advances), and
 * that no line runs past the right margin is pdfkit's wrapping at the text width, which this test
 * does not measure.
 */
const FOOTER_TOP = DECLARATION_MARGIN.bottom - DECLARATION_FOOTER.gap;

/**
 * Where each line of text starts, page by page, read out of the file (§357).
 *
 * pdfkit deflates its content streams and draws Roboto by glyph id, so the words are not in the
 * bytes — but the position of every line is: each run of text is set with `1 0 0 1 x y Tm` in
 * the page's own bottom-up coordinates. One content stream per page, in page order.
 */
function textLinesByPage(pdf: Buffer): Array<Array<[number, number]>> {
  const raw = pdf.toString("latin1");
  const pages: Array<Array<[number, number]>> = [];
  for (const match of raw.matchAll(/(?<![d])stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    let content: string;
    try {
      content = inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
    } catch {
      continue; // a font or the lockup, not a page
    }
    if (!content.includes(" Tm")) continue;
    pages.push([...content.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)].map((m) => [Number(m[1]), Number(m[2])]));
  }
  return pages;
}
