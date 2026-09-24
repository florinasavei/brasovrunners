import { and, desc, eq } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { legalDocuments, legalDocumentTranslations } from "@/db/schema/legal-documents";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { CLUB_LOCALITY } from "@/modules/events/domain/place";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { asksForMinorSignature, type MergeValues } from "@/modules/legal-documents/domain/merge-fields";
import { isLegalDocumentBody, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { maskIdDocument, renderDeclarationPdf, type DeclarationEntry, type DeclarationPdfInput } from "./declaration-pdf";

/**
 * Who a rendering of a signed declaration is for (§320).
 *
 * - `participant` — the whole document, the identity document as it was typed: the runner's own
 *   copy (their link, their emails) and the backoffice's operational copies, which live inside
 *   the platform and lose the identity document with the database seven days after the event (§95).
 * - `club` — a copy that leaves the platform for a club mailbox (the archive, §99, §244), where
 *   nothing sweeps it: the identity document masked (`maskIdDocument`) wherever the page prints
 *   it, in the text's `{{idDocument}}` and on the signature line alike — and for a minor both
 *   documents, the child's and the parent's (§NNN).
 *
 * Required, never defaulted, so a caller added tomorrow has to say which one it is.
 */
export type DeclarationAudience = "participant" | "club";

/**
 * A signed declaration, reassembled from what was recorded (`DECISIONS.md` §95): the exact
 * version by id and hash, the fill-ins beside it, the event, the signature. Rendered on
 * request for the runner (from their own link), for the organizer (one registration, or every
 * one of an event), and never stored as a file — the rows are the record; the PDF is a view
 * of them, reproducible for as long as they exist.
 */
/**
 * The stored body as the renderer takes it (§225).
 *
 * `mergeLegalBody` used to do this narrowing on the way past; now that the PDF merges for
 * itself, the same "an unreadable body is no sections" answer has to be given here — a
 * declaration nobody can parse prints as an empty text, never as a crash on the one document
 * somebody is waiting to sign.
 */
function asLegalBody(body: unknown): LegalDocumentBody {
  return isLegalDocumentBody(body) ? body : { sections: [] };
}

export type SignedDeclaration = {
  registrationId: string;
  registeredName: string;
  /** The parent or guardian who signed for a minor (§108); null for an adult. */
  guardianName: string | null;
  acceptedAt: Date;
  /** The declarant's signature: the adult's own, the parent's or guardian's for a minor (§314). */
  typedName: string;
  /** The declarant's identity document, as `typedName` (§95, §108). */
  idDocument: string | null;
  /**
   * The minor's own signature and identity document, beside the parent's (§NNN). Null for an
   * adult, and for a minor's acceptance recorded before two signatures were asked.
   */
  minorTypedName: string | null;
  minorIdDocument: string | null;
  method: "EMAIL_LINK" | "PAPER";
  attestedByName: string | null;
  version: number;
  contentSha256: string;
  locale: Locale;
  title: string;
  /** The template, unmerged. */
  body: unknown;
};

/** The latest acceptance of a registration, with the text it was signed against. */
/**
 * `{{declarant}}` and `{{guardian}}` (§108): for a minor, the parent or guardian with the
 * relationship spelled out; for an adult, the runner and an em dash.
 */
export function declarantValues(participant: string, guardianName: string | null | undefined, locale: Locale): { declarant: string; guardian: string } {
  if (!guardianName) return { declarant: participant, guardian: "—" };
  const relation = locale === "ro" ? `părinte/tutore legal al minorului ${participant}` : `parent/legal guardian of the minor ${participant}`;
  return { declarant: `${guardianName} (${relation})`, guardian: guardianName };
}

/**
 * `{{idDocument}}`, `{{participantIdDocument}}` and `{{guardianIdDocument}}` (§95, §NNN).
 *
 * `{{idDocument}}` stays the declarant's, as every text the club approved before two signatures
 * reads it: the adult's own, the parent's for a minor (`{{declarant}}` beside it names the same
 * person). The two newer fields name each signer's own: the participant's — the adult's, which is
 * the same document, or the minor's — and the parent's or guardian's, which for an adult is an em
 * dash, like `{{guardian}}`, so a text that names it reads "—" where no guardian signs.
 *
 * A document not yet typed (the page before signing), cleared (seven days after the event, §95)
 * or never asked for is `undefined`, which the merge prints as the paper form's dotted blank.
 */
export function identityDocumentValues(
  guardianName: string | null | undefined,
  documents: { idDocument?: string | null; minorIdDocument?: string | null },
): { idDocument: string | undefined; participantIdDocument: string | undefined; guardianIdDocument: string | undefined } {
  const declarant = documents.idDocument ?? undefined;
  if (!guardianName) return { idDocument: declarant, participantIdDocument: declarant, guardianIdDocument: "—" };
  return { idDocument: declarant, participantIdDocument: documents.minorIdDocument ?? undefined, guardianIdDocument: declarant };
}

export async function findSignedDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<SignedDeclaration | undefined> {
  const [row] = await signedDeclarationQuery(db).where(eq(declarationAcceptances.registrationId, registrationId)).orderBy(desc(declarationAcceptances.acceptedAt)).limit(1);
  return row;
}

function signedDeclarationQuery<T extends Record<string, unknown>>(db: Database<T>) {
  return db
    .select({
      registrationId: declarationAcceptances.registrationId,
      registeredName: registrations.registeredName,
      guardianName: registrations.guardianName,
      acceptedAt: declarationAcceptances.acceptedAt,
      typedName: declarationAcceptances.typedName,
      idDocument: declarationAcceptances.idDocument,
      minorTypedName: declarationAcceptances.minorTypedName,
      minorIdDocument: declarationAcceptances.minorIdDocument,
      method: declarationAcceptances.method,
      attestedByName: staffUsers.displayName,
      version: declarationAcceptances.declarationVersion,
      contentSha256: declarationAcceptances.contentSha256,
      locale: declarationAcceptances.locale,
      title: legalDocumentTranslations.title,
      body: legalDocumentTranslations.bodyJson,
    })
    .from(declarationAcceptances)
    .innerJoin(registrations, eq(registrations.id, declarationAcceptances.registrationId))
    .innerJoin(legalDocuments, eq(legalDocuments.id, declarationAcceptances.legalDocumentId))
    .innerJoin(
      legalDocumentTranslations,
      and(
        eq(legalDocumentTranslations.legalDocumentId, legalDocuments.id),
        eq(legalDocumentTranslations.locale, declarationAcceptances.locale),
      ),
    )
    .leftJoin(staffUsers, eq(staffUsers.id, declarationAcceptances.attestedByStaffUserId))
    .$dynamic();
}

/**
 * Every signed declaration of one event, oldest first — the bundle the club archives. One
 * query for the lot (two hundred runners is two hundred pages, not two hundred round trips):
 * every acceptance of the event's real registrations, then the latest per registration.
 */
export async function listSignedDeclarations<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<SignedDeclaration[]> {
  const rows = await signedDeclarationQuery(db)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "REAL")))
    .orderBy(desc(declarationAcceptances.acceptedAt));
  const latest = new Map<string, SignedDeclaration>();
  for (const row of rows) if (!latest.has(row.registrationId)) latest.set(row.registrationId, row);
  return [...latest.values()].sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime());
}

export type DeclarationLabels = DeclarationPdfInput["labels"] & {
  /** "Signed electronically from the link sent by email, on {when}" / "Signed on paper, recorded by {who} on {when}". */
  signedByLink: (when: string) => string;
  signedOnPaper: (who: string, when: string) => string;
  attesterRemoved: string;
};

function dateFormatter(locale: Locale, timeZone: string, withTime: boolean) {
  return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
    dateStyle: "long",
    ...(withTime ? { timeStyle: "short", hourCycle: "h23" } : {}),
    timeZone,
  });
}

/** The event's facts as the declaration's fill-ins, formatted for its locale. */
export async function eventMergeValues<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  locale: Locale,
): Promise<{ values: MergeValues; title: string; timezone: string } | undefined> {
  const event = await findEventNotificationDetails(db, eventId, locale);
  if (!event) return undefined;
  return {
    values: {
      event: event.title,
      eventDate: dateFormatter(locale, event.timezone, false).format(event.startsAt),
      // The city while the place is to be announced (§NNN), never the typed place: a signed PDF
      // is a copy the runner keeps and forwards, and "în locația Brașov" is a sentence one signs.
      eventLocation: event.locationToBeAnnounced ? CLUB_LOCALITY : event.locationName,
    },
    title: event.title,
    timezone: event.timezone,
  };
}

/** One signed declaration as an entry of the PDF — the fill-ins merged, the signature set. */
export async function signedDeclarationEntry<T extends Record<string, unknown>>(
  db: Database<T>,
  signed: SignedDeclaration,
  eventId: string,
  labels: DeclarationLabels,
  audience: DeclarationAudience,
): Promise<DeclarationEntry | undefined> {
  return signedEntry(signed, await eventMergeValues(db, eventId, signed.locale), labels, audience);
}

function signedEntry(
  signed: SignedDeclaration,
  event: Awaited<ReturnType<typeof eventMergeValues>>,
  labels: DeclarationLabels,
  audience: DeclarationAudience,
): DeclarationEntry | undefined {
  if (!event) return undefined;
  const when = dateFormatter(signed.locale, event.timezone, true).format(signed.acceptedAt);
  /*
    Masked once, here, so the text's blanks and the signature lines cannot disagree (§320) — both
    documents of a minor's declaration (§NNN), the parent's and the child's, each wherever the
    page prints it: `{{idDocument}}`, `{{participantIdDocument}}`, `{{guardianIdDocument}}` and
    the two signature lines are all drawn from these two values.
  */
  const mask = (value: string | null) => (audience === "club" && value !== null ? maskIdDocument(value) : value);
  const idDocument = mask(signed.idDocument);
  const minorIdDocument = mask(signed.minorIdDocument);
  // The minor's own signature, when a minor signed beside the parent (§NNN). A minor's acceptance
  // recorded before two signatures were asked carries the parent's alone, and prints as it did.
  const minor = signed.guardianName && signed.minorTypedName !== null ? { typedName: signed.minorTypedName, idDocument: minorIdDocument } : null;
  return {
    title: signed.title,
    // The template and its values, kept apart so the PDF can set the fill-ins in bold (§225).
    body: asLegalBody(signed.body),
    values: {
      ...event.values,
      // The runner's name, and who declares (§108): the guardian for a minor, the runner otherwise.
      participant: signed.registeredName,
      ...declarantValues(signed.registeredName, signed.guardianName, signed.locale),
      ...identityDocumentValues(signed.guardianName, { idDocument, minorIdDocument }),
      signedAt: when,
    },
    eventTitle: event.title,
    version: signed.version,
    contentSha256: signed.contentSha256,
    signature: {
      typedName: signed.typedName,
      idDocument,
      minor,
      signedAt: when,
      method:
        signed.method === "PAPER"
          ? labels.signedOnPaper(signed.attestedByName ?? labels.attesterRemoved, when)
          : labels.signedByLink(when),
    },
  };
}

/** One signed declaration as a PDF — the runner's copy, the organizer's record, the club's archive copy. */
export async function renderSignedDeclarationPdf<T extends Record<string, unknown>>(
  db: Database<T>,
  signed: SignedDeclaration,
  eventId: string,
  labels: DeclarationLabels,
  now: Date,
  audience: DeclarationAudience,
): Promise<Buffer | undefined> {
  const entry = await signedDeclarationEntry(db, signed, eventId, labels, audience);
  if (!entry) return undefined;
  return renderDeclarationPdf({ entries: [entry], locale: signed.locale, generatedAt: now, labels });
}

/**
 * Every signed declaration of an event in one PDF, oldest first — what the club archives.
 *
 * Whole, identity documents included (§320): it is downloaded by signed-in staff from the
 * backoffice, and it is operational for exactly as long as the database keeps the identity
 * document — seven days after the event (§95) — after which the same bundle prints without it.
 */
export async function renderEventDeclarationsPdf<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  locale: Locale,
  labels: DeclarationLabels,
  now: Date,
  /** Told how many declarations the file holds, for the audit row the route writes (§324). */
  onCount?: (count: number) => void,
): Promise<Buffer> {
  const entries: DeclarationEntry[] = [];
  const facts = new Map<Locale, Awaited<ReturnType<typeof eventMergeValues>>>();
  for (const signed of await listSignedDeclarations(db, eventId)) {
    if (!facts.has(signed.locale)) facts.set(signed.locale, await eventMergeValues(db, eventId, signed.locale));
    const entry = signedEntry(signed, facts.get(signed.locale), labels, "participant");
    if (entry) entries.push(entry);
  }
  onCount?.(entries.length);
  return renderDeclarationPdf({ entries, locale, generatedAt: now, labels });
}

/**
 * The blank form for one event, on the current approved declaration — for the desk.
 *
 * `forMinor` (§NNN) prints the form a minor signs with a parent or guardian: two signature lines
 * and two identity-document lines, the minor's and the parent's, under "DREPT PENTRU CARE SEMNĂM".
 * The text is the same approved one — it names nobody, so its blanks stay dotted either way.
 *
 * Only where that text asks the minor to sign (`asksForMinorSignature`, the production gate of
 * §NNN): under a text approved before it the parent signs a minor's paper alone, and the form
 * printed is the one-signature form whatever was asked for — the minor's identity number is not
 * collected on paper either while the approved notice does not describe it.
 */
export async function renderBlankDeclarationPdf<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  locale: Locale,
  labels: DeclarationPdfInput["labels"],
  now: Date,
  { forMinor = false }: { forMinor?: boolean } = {},
): Promise<Buffer | undefined> {
  const [document, event] = await Promise.all([
    findCurrentApprovedDocument(db, "EVENT_DECLARATION", locale, now),
    eventMergeValues(db, eventId, locale),
  ]);
  if (!document || !event) return undefined;
  return renderDeclarationPdf({
    entries: [
      {
        title: document.title,
        body: asLegalBody(document.body),
        values: event.values,
        eventTitle: event.title,
        version: document.version,
        contentSha256: document.contentSha256,
        forMinor: forMinor && asksForMinorSignature(document.body),
      },
    ],
    locale,
    generatedAt: now,
    labels,
  });
}
