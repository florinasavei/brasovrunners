import type { Database } from "@/db/types";
import { formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { isLegalDocumentBody, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import { maskIdDocument, renderDeclarationPdf } from "@/modules/registrations/declaration-pdf";
import { type DeclarationAudience, eventMergeValues } from "@/modules/registrations/signed-declaration";
import { groupRunMergeValues } from "./facts";
import type { SignedGroupRunDeclaration } from "./repository";
import { readSignedFacts } from "./series";

/**
 * How a group-run declaration was signed, under the signature (§393): on the run's own page, not
 * from a link sent by email — the race's words (`signedByLink`) would say something untrue. The
 * same record beneath it: typed name, tick, the moment of signing, the text's fingerprint (§86).
 *
 * «Momentul semnării», as the platform records it, never a time stamp (§534, the counsel's point 14):
 * the text it signs says the same, and the Romanian law is cited by its number alone, so no title
 * beside the moment reads as a qualified eIDAS time stamp.
 */
const SIGNED_ON_PAGE: Record<Locale, string> = {
  ro: "Semnat electronic {when}, pe pagina alergării de pe site-ul clubului: nume tastat, bifă explicită de acceptare, momentul semnării, așa cum l-a înregistrat platforma clubului, și amprenta SHA-256 a textului citit — semnătură electronică simplă în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024.",
  en: "Signed electronically on {when}, on the run's page on the club's website: typed name, explicit acceptance tick, the moment of signing as the club's platform recorded it, and the SHA-256 fingerprint of the text read — a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024.",
};

export function signedOnPageWords(locale: Locale, when: string): string {
  return SIGNED_ON_PAGE[locale].replace("{when}", when);
}

/**
 * One signed group-run declaration as a PDF (§393), drawn by the race declaration's own renderer
 * (§95): the lockup, the title, the text with its blanks filled in bold (§225), the typed name in a
 * hand, the version and the hash. Rendered from the rows on request, never stored as a file.
 *
 * `audience` as §320 decided for the race's: `participant` — the signer's own copy and the
 * backoffice's, the identity document as typed; `club` — the archive copy that leaves the platform
 * for a mailbox nothing sweeps, the document masked in the text and on the signature line alike,
 * from one value so the two cannot disagree. Required, never defaulted.
 *
 * The signer declares for themselves (adults only, §393), so `{{participant}}` and `{{declarant}}`
 * are the signer and `{{guardian}}` an em dash, as on an adult's race declaration.
 */
export async function renderGroupRunDeclarationPdf<T extends Record<string, unknown>>(
  db: Database<T>,
  signed: SignedGroupRunDeclaration,
  audience: DeclarationAudience,
  now: Date,
): Promise<Buffer | undefined> {
  const current = await eventMergeValues(db, signed.eventId, signed.locale);
  if (!current) return undefined;
  /*
    What the blanks said at the signing (§523, `signed_facts`): a date moved or renamed since never
    changes what a signed declaration says (§57). A row from before §523 kept none, and reads the
    event as it is — its text names no series field, so nothing of the series is filled or dropped.
  */
  const kept = readSignedFacts(signed.signedFacts);
  const event = { ...current, title: kept?.event ?? current.title, values: kept ? { ...current.values, ...kept } : (await groupRunMergeValues(db, signed.eventId, signed.locale, signed.body))?.values ?? current.values };
  const labels = declarationWords(signed.locale, now);
  const idDocument = audience === "club" && signed.idDocument !== null ? maskIdDocument(signed.idDocument) : signed.idDocument;
  // Inside a sentence, and under the "Data" label where it starts the value (§349).
  const when = formatDay(signed.acceptedAt, { locale: signed.locale, timeZone: event.timezone, style: "long", withTime: true, position: "inline" });
  const whenStart = formatDay(signed.acceptedAt, { locale: signed.locale, timeZone: event.timezone, style: "long", withTime: true });
  const body: LegalDocumentBody = isLegalDocumentBody(signed.body) ? signed.body : { sections: [] };
  return renderDeclarationPdf({
    entries: [
      {
        title: signed.title,
        body,
        values: {
          ...event.values,
          participant: signed.typedName,
          declarant: signed.typedName,
          guardian: "—",
          idDocument: idDocument ?? undefined,
          participantIdDocument: idDocument ?? undefined,
          guardianIdDocument: "—",
          signedAt: when,
        },
        eventTitle: event.title,
        version: signed.version,
        contentSha256: signed.contentSha256,
        effectiveAt: signed.effectiveAt,
        signature: { typedName: signed.typedName, idDocument, minor: null, signedAt: whenStart, signedAtInline: when, method: signedOnPageWords(signed.locale, when) },
      },
    ],
    locale: signed.locale,
    generatedAt: now,
    labels,
  });
}
