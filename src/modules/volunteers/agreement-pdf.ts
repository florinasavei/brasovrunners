import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { VOLUNTEER_AGREEMENT_KEY } from "@/modules/legal-documents/domain/keys";
import { findCurrentApprovedDocument, findVersionWithTranslations } from "@/modules/legal-documents/repository";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import { type DeclarationEntry, renderDeclarationPdf } from "@/modules/registrations/declaration-pdf";
import type { DeclarationLabels } from "@/modules/registrations/signed-declaration";
import { isUuid } from "@/shared/ids";
import { agreementBlanks, agreementBody, agreementMergeValues, readAgreementFacts, volunteerRoles } from "./agreement";
import { isVolunteerMinor } from "./domain/volunteer";

/**
 * The volunteer agreement as a PDF (§758), drawn by the race declaration's own renderer (§95, §515): the club's
 * lockup, the title, the text with its blanks filled in bold (§225), the version line, and at the foot the
 * signature block — rendered from the rows on request, never stored as a file.
 *
 * Two shapes from one function:
 * - **accepted** — the version the person accepted, in the language they accepted it in, filled with the blanks
 *   kept on their row (`agreement_facts`, the same values the fingerprint was taken over, §556), the name in the
 *   hand the page showed it in, the moment, how it was accepted, the version's hash and the text's own. The copy
 *   the person's email carries and the backoffice row downloads.
 * - **to sign on paper** — not accepted yet: the version in force in the person's language, filled for them and
 *   their role, with two signature lines, the volunteer's and the organizer's, and a date line, nothing typed in
 *   them. What the desk prints for a person entered by hand who signs there (§758's third way).
 *
 * Neither line asks for an identity document: the agreement names none (`noIdDocument`).
 *
 * **A volunteer under eighteen (§NNN)** has a parent or guardian who accepts the same text in their own name, so the
 * signature block has a second signer: the volunteer's own acceptance and the guardian's — the typed name from the link,
 * or the paper — under one date, the guardian's version, blanks and fingerprint when they accepted, and a line that says
 * the consent is still to come while it is. The sheet to sign on paper has the volunteer's line and the guardian's, in
 * place of the organizer's. The PDF for adults is unchanged.
 */

/** The PDF's own words, plain copy like the declaration's: the outbox renders it outside any request. */
const WORDS: Record<
  Locale,
  {
    signature: string;
    volunteerSignature: string;
    organizerSignature: string;
    whereupon: string;
    whereuponTogether: string;
    acceptedOnForm: string;
    acceptedByLink: string;
    acceptedOnPaper: string;
    guardianSignature: string;
    guardianByLink: string;
    guardianOnPaper: string;
    guardianPending: string;
  }
> = {
  ro: {
    signature: "Semnătura voluntarului",
    volunteerSignature: "Semnătura voluntarului",
    organizerSignature: "Pentru organizator (nume și semnătură)",
    whereupon: "DREPT PENTRU CARE SEMNEZ,",
    whereuponTogether: "DREPT PENTRU CARE SEMNĂM,",
    acceptedOnForm:
      "Acceptat electronic {when}, pe pagina evenimentului de pe site-ul clubului: numele, bifa explicită de acceptare, momentul acceptării, așa cum l-a înregistrat platforma clubului, și amprenta SHA-256 a textului citit — semnătură electronică simplă în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024.",
    acceptedByLink:
      "Acceptat electronic {when}, din linkul unic trimis pe adresa de email a voluntarului: numele, bifa explicită de acceptare, momentul acceptării, așa cum l-a înregistrat platforma clubului, și amprenta SHA-256 a textului citit — semnătură electronică simplă în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024.",
    acceptedOnPaper: "Semnat pe hârtie, la organizatori; înregistrat de {who}, {when}. Originalul semnat este păstrat de club.",
    guardianSignature: "Semnătura părintelui sau tutorelui",
    guardianByLink:
      "Acordul părintelui sau tutorelui, {guardian}, acceptat electronic {when}, din linkul unic trimis pe adresa lui de email: numele scris, bifa explicită de acceptare, momentul acceptării, așa cum l-a înregistrat platforma clubului, și amprenta SHA-256 a textului citit — semnătură electronică simplă în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024.",
    guardianOnPaper: "Acordul părintelui sau tutorelui, {guardian}, semnat pe hârtie, la organizatori; înregistrat de {who}, {when}. Originalul semnat este păstrat de club.",
    guardianPending: "Acordul părintelui sau tutorelui, {guardian}: încă neprimit.",
  },
  en: {
    signature: "Volunteer's signature",
    volunteerSignature: "Volunteer's signature",
    organizerSignature: "For the organiser (name and signature)",
    whereupon: "IN WITNESS WHEREOF, I SIGN,",
    whereuponTogether: "IN WITNESS WHEREOF, WE SIGN,",
    acceptedOnForm:
      "Accepted electronically on {when}, on the event's page on the club's website: the name, the explicit acceptance tick, the moment of acceptance as the club's platform recorded it, and the SHA-256 fingerprint of the text read — a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024.",
    acceptedByLink:
      "Accepted electronically on {when}, from the single-use link sent to the volunteer's email address: the name, the explicit acceptance tick, the moment of acceptance as the club's platform recorded it, and the SHA-256 fingerprint of the text read — a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024.",
    acceptedOnPaper: "Signed on paper, with the organisers; recorded by {who} on {when}. The club keeps the signed original.",
    guardianSignature: "Parent's or guardian's signature",
    guardianByLink:
      "The parent's or guardian's consent, {guardian}, accepted electronically on {when}, from the single-use link sent to their email address: the typed name, the explicit acceptance tick, the moment of acceptance as the club's platform recorded it, and the SHA-256 fingerprint of the text read — a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024.",
    guardianOnPaper: "The parent's or guardian's consent, {guardian}, signed on paper, with the organisers; recorded by {who} on {when}. The club keeps the signed original.",
    guardianPending: "The parent's or guardian's consent, {guardian}: not received yet.",
  },
};

/**
 * The declaration's labels with the agreement's own signature words in place (pure, for its test). For a volunteer under
 * eighteen (§NNN) the second line is the parent's or guardian's — the organizer's is for an adult's desk copy — and a
 * single guardian's signature, while the volunteer has not accepted their own, reads as theirs.
 */
export function volunteerAgreementLabels(locale: Locale, now: Date, guardian = false): DeclarationLabels {
  const words = WORDS[locale];
  return {
    ...declarationWords(locale, now),
    signature: guardian ? words.guardianSignature : words.signature,
    minorSignature: words.volunteerSignature,
    guardianSignature: guardian ? words.guardianSignature : words.organizerSignature,
    whereupon: words.whereupon,
    whereuponTogether: words.whereuponTogether,
  };
}

/** How the agreement was accepted, under the signature: the form, the link, or the paper and who recorded it. */
export function acceptedHowWords(locale: Locale, method: "FORM" | "LINK" | "PAPER", when: string, recordedBy: string | null): string {
  const words = WORDS[locale];
  if (method === "PAPER") return words.acceptedOnPaper.replace("{who}", recordedBy ?? declarationWords(locale, new Date(0)).attesterRemoved).replace("{when}", when);
  return (method === "LINK" ? words.acceptedByLink : words.acceptedOnForm).replace("{when}", when);
}

/** How the guardian accepted, under the signature (§NNN): the link or the paper, with the guardian's name and, on paper, who recorded it. */
export function guardianHowWords(
  locale: Locale,
  method: "LINK" | "PAPER",
  when: string,
  guardianName: string,
  recordedBy: string | null,
): string {
  const words = WORDS[locale];
  const sentence = method === "PAPER" ? words.guardianOnPaper : words.guardianByLink;
  return sentence
    .replace("{guardian}", guardianName)
    .replace("{who}", recordedBy ?? declarationWords(locale, new Date(0)).attesterRemoved)
    .replace("{when}", when);
}

/** The line that says the guardian's consent is still to come (§NNN), under the volunteer's own acceptance. */
export function guardianPendingWords(locale: Locale, guardianName: string): string {
  return WORDS[locale].guardianPending.replace("{guardian}", guardianName);
}

/** The file's name, the same in both languages: plain ASCII travels through every mail client. */
export const VOLUNTEER_AGREEMENT_PDF_NAME = "contract-voluntariat.pdf";

/**
 * One volunteer's agreement as a PDF, or undefined when there is nothing to draw: no such volunteer, or — for one
 * who has not accepted — no agreement in force in their language to print.
 */
export async function renderVolunteerAgreementPdf<T extends Record<string, unknown>>(
  db: Database<T>,
  volunteerId: string,
  now: Date,
  /**
   * `sheet`: the copy to sign on paper even though the volunteer has accepted (§NNN) — the desk's sheet for the parent or
   * guardian of a volunteer under eighteen, whose consent is still to come. Honoured only for such a volunteer.
   */
  options: { sheet?: boolean } = {},
): Promise<{ pdf: Buffer; accepted: boolean } | undefined> {
  if (!isUuid(volunteerId)) return undefined;
  const guardianStaff = alias(staffUsers, "guardian_staff");
  const [row] = await db
    .select({
      eventId: eventVolunteers.eventId,
      name: eventVolunteers.name,
      locale: eventVolunteers.locale,
      acceptedAt: eventVolunteers.agreementAcceptedAt,
      documentId: eventVolunteers.agreementDocumentId,
      method: eventVolunteers.agreementMethod,
      agreementLocale: eventVolunteers.agreementLocale,
      textHash: eventVolunteers.agreementTextHash,
      facts: eventVolunteers.agreementFacts,
      recordedBy: staffUsers.displayName,
      timezone: events.timezone,
      roleId: eventVolunteers.roleId,
      age: eventVolunteers.age,
      guardianName: eventVolunteers.guardianName,
      guardianDocumentId: eventVolunteers.guardianDocumentId,
      guardianAcceptedAt: eventVolunteers.guardianAcceptedAt,
      guardianMethod: eventVolunteers.guardianMethod,
      guardianLocale: eventVolunteers.guardianLocale,
      guardianTextHash: eventVolunteers.guardianTextHash,
      guardianFacts: eventVolunteers.guardianFacts,
      guardianTypedName: eventVolunteers.guardianTypedName,
      guardianRecordedBy: guardianStaff.displayName,
    })
    .from(eventVolunteers)
    .innerJoin(events, eq(events.id, eventVolunteers.eventId))
    .leftJoin(staffUsers, eq(staffUsers.id, eventVolunteers.agreementRecordedByStaffUserId))
    .leftJoin(guardianStaff, eq(guardianStaff.id, eventVolunteers.guardianRecordedByStaffUserId))
    .where(eq(eventVolunteers.id, volunteerId))
    .limit(1);
  if (!row) return undefined;

  // A volunteer under eighteen has a parent or guardian beside them (§NNN); their consent is done when the row says so whole.
  const guardianName = isVolunteerMinor(row.age) ? row.guardianName : null;
  const guardianDone =
    guardianName !== null && row.guardianAcceptedAt !== null && row.guardianDocumentId !== null && row.guardianMethod !== null && row.guardianLocale !== null;
  // The desk's sheet for the guardian: the text to sign though the volunteer accepted, while the guardian's consent is to come.
  const sheet = options.sheet === true && guardianName !== null && !guardianDone;

  // The guardian accepted (§NNN): the text THEY read — their version, their blanks, their fingerprint — with both signers on it:
  // the volunteer's own acceptance when they gave it, and the guardian's, under the guardian's date.
  if (guardianName !== null && guardianDone && row.guardianDocumentId && row.guardianAcceptedAt && row.guardianMethod && row.guardianLocale) {
    const version = await findVersionWithTranslations(db, row.guardianDocumentId);
    if (!version) return undefined;
    const locale = row.guardianLocale;
    const translation = version.translations.find((candidate) => candidate.locale === locale) ?? version.translations[0];
    if (!translation) return undefined;
    const facts = readAgreementFacts(row.guardianFacts);
    const signedAt = formatDay(row.guardianAcceptedAt, { locale, timeZone: row.timezone, style: "long", withTime: true });
    const signedAtInline = facts?.signedAt ?? formatDay(row.guardianAcceptedAt, { locale, timeZone: row.timezone, style: "long", withTime: true, position: "inline" });
    const volunteerAccepted = row.acceptedAt !== null && row.method !== null;
    const volunteerSentence =
      row.acceptedAt && row.method
        ? acceptedHowWords(locale, row.method, formatDay(row.acceptedAt, { locale, timeZone: row.timezone, style: "long", withTime: true, position: "inline" }), row.recordedBy)
        : null;
    const entry: DeclarationEntry = {
      title: translation.title,
      body: agreementBody(translation.body),
      values: agreementMergeValues(facts ?? {}),
      eventTitle: facts?.event ?? "",
      version: version.version,
      contentSha256: version.contentSha256,
      effectiveAt: version.effectiveAt,
      textHash: row.guardianTextHash,
      noIdDocument: true,
      signature: {
        typedName: row.guardianTypedName ?? guardianName,
        idDocument: null,
        // The volunteer's own line, when they accepted theirs; the guardian's alone otherwise.
        minor: volunteerAccepted ? { typedName: readAgreementFacts(row.facts)?.volunteer ?? row.name, idDocument: null } : null,
        signedAt,
        signedAtInline,
        acceptedAt: row.guardianAcceptedAt,
        method: [volunteerSentence, guardianHowWords(locale, row.guardianMethod, signedAtInline, guardianName, row.guardianRecordedBy)].filter(Boolean).join("\n"),
      },
    };
    const pdf = await renderDeclarationPdf({ entries: [entry], locale, generatedAt: now, labels: volunteerAgreementLabels(locale, now, true) });
    return { pdf, accepted: true };
  }

  if (!sheet && row.acceptedAt && row.documentId && row.method && row.agreementLocale) {
    const version = await findVersionWithTranslations(db, row.documentId);
    if (!version) return undefined;
    const locale = row.agreementLocale;
    const translation = version.translations.find((candidate) => candidate.locale === locale) ?? version.translations[0];
    if (!translation) return undefined;
    const facts = readAgreementFacts(row.facts);
    // Under the «Data» label the moment starts the value; inside the method's sentence it continues it (§349).
    const signedAt = formatDay(row.acceptedAt, { locale, timeZone: row.timezone, style: "long", withTime: true });
    const signedAtInline = facts?.signedAt ?? formatDay(row.acceptedAt, { locale, timeZone: row.timezone, style: "long", withTime: true, position: "inline" });
    const entry: DeclarationEntry = {
      title: translation.title,
      body: agreementBody(translation.body),
      // The blanks as the person accepted them — the values the fingerprint was taken over (§556).
      values: agreementMergeValues(facts ?? {}),
      eventTitle: facts?.event ?? "",
      version: version.version,
      contentSha256: version.contentSha256,
      effectiveAt: version.effectiveAt,
      textHash: row.textHash,
      noIdDocument: true,
      signature: {
        typedName: facts?.volunteer ?? row.name,
        idDocument: null,
        minor: null,
        signedAt,
        signedAtInline,
        acceptedAt: row.acceptedAt,
        // A volunteer under eighteen whose guardian has not accepted yet says so under their own acceptance (§NNN).
        method: [acceptedHowWords(locale, row.method, signedAtInline, row.recordedBy), guardianName !== null ? guardianPendingWords(locale, guardianName) : null]
          .filter(Boolean)
          .join("\n"),
      },
    };
    const pdf = await renderDeclarationPdf({ entries: [entry], locale, generatedAt: now, labels: volunteerAgreementLabels(locale, now) });
    return { pdf, accepted: true };
  }

  // Not accepted — or, for a volunteer under eighteen, the guardian's sheet: the copy to sign at the desk, in the person's
  // language, filled for them and their roles — the one given, else the ones chosen (§761); «Semnat pe hârtie» posts the same
  // back (`agreementRolesStamp`). Under eighteen the second line is the parent's or guardian's, whose name is in the minors' clause.
  const document = await findCurrentApprovedDocument(db, VOLUNTEER_AGREEMENT_KEY, row.locale, now);
  if (!document) return undefined;
  const roles = await volunteerRoles(db, { id: volunteerId, roleId: row.roleId });
  const blanks = await agreementBlanks(db, { eventId: row.eventId, name: row.name, roles, locale: row.locale, body: document.body, guardianName });
  const entry: DeclarationEntry = {
    title: document.title,
    body: agreementBody(document.body),
    values: agreementMergeValues(blanks.facts),
    eventTitle: blanks.facts.event,
    version: document.version,
    contentSha256: document.contentSha256,
    effectiveAt: document.effectiveAt,
    // Two signature lines — the volunteer's, then the organizer's (the parent's or guardian's, under eighteen) — and the date, written by hand.
    forMinor: true,
    noIdDocument: true,
  };
  const pdf = await renderDeclarationPdf({
    entries: [entry],
    locale: row.locale,
    generatedAt: now,
    labels: volunteerAgreementLabels(row.locale, now, guardianName !== null),
  });
  return { pdf, accepted: false };
}
