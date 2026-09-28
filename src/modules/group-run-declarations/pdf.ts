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
 * The signing method under the signature (§393, §86): on the run's page, not by an emailed link as
 * the race's `signedByLink` says. «Momentul semnării», never "time stamp", and the law cited by
 * number alone, so nothing reads as a qualified eIDAS time stamp (§534).
 */
const SIGNED_ON_PAGE: Record<Locale, string> = {
  ro: "Semnat electronic {when}, pe pagina alergării de pe site-ul clubului: nume tastat, bifă explicită de acceptare, momentul semnării, așa cum l-a înregistrat platforma clubului, și amprenta SHA-256 a textului citit — semnătură electronică simplă în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024.",
  en: "Signed electronically on {when}, on the run's page on the club's website: typed name, explicit acceptance tick, the moment of signing as the club's platform recorded it, and the SHA-256 fingerprint of the text read — a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024.",
};

export function signedOnPageWords(locale: Locale, when: string): string {
  return SIGNED_ON_PAGE[locale].replace("{when}", when);
}

/**
 * A signed group-run declaration as a PDF through the race's renderer (§393, §95), rendered on
 * request, never stored. `audience` as §320: `club` is the archive copy, identity document masked in
 * text and signature line from one value; required, never defaulted. Adults only, so the signer is
 * both participant and declarant.
 */
export async function renderGroupRunDeclarationPdf<T extends Record<string, unknown>>(
  db: Database<T>,
  signed: SignedGroupRunDeclaration,
  audience: DeclarationAudience,
  now: Date,
): Promise<Buffer | undefined> {
  const current = await eventMergeValues(db, signed.eventId, signed.locale);
  if (!current) return undefined;
  // The facts as signed (`signed_facts`, §523, §57); a row from before §523 reads the event as it is.
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
