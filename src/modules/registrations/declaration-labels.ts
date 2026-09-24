import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { CLUB_NAME } from "@/theme/brand";
import type { DeclarationLabels } from "./signed-declaration";

/**
 * The PDF's words, in the declaration's own language (`DECISIONS.md` §95). Plain copy rather
 * than `next-intl`, like the email templates: the outbox worker renders the PDF outside any
 * request, where there is no locale context to ask.
 */
const WORDS: Record<Locale, Omit<DeclarationLabels, "generatedOn" | "page" | "signedByLink" | "signedOnPaper"> & {
  generatedOn: string;
  page: string;
  signedByLink: string;
  signedOnPaper: string;
}> = {
  ro: {
    // The club's name in the PDF's footer and metadata is the platform's constant (§215), not a literal (§NNN).
    organization: CLUB_NAME,
    whereupon: "DREPT PENTRU CARE SEMNEZ,",
    whereuponTogether: "DREPT PENTRU CARE SEMNĂM,",
    signature: "Semnătura",
    minorSignature: "Semnătura minorului",
    guardianSignature: "Semnătura părintelui sau tutorelui",
    date: "Data",
    idDocument: "Act de identitate",
    version: "Versiunea",
    // "pe", not "la": {date} and {when} start with a weekday — "Generat pe joi, 24 sept. 2026,
    // 18:05" (§349).
    generatedOn: "Generat pe {date}",
    page: "Pagina {n} din {total}",
    signedByLink:
      "Semnat electronic pe {when}, din linkul trimis pe adresa de email confirmată a participantului: nume tastat, bifă explicită de acceptare, momentul și amprenta SHA-256 a textului citit — semnătură electronică simplă în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024.",
    signedOnPaper: "Semnat pe hârtie, la masa de înscrieri; înregistrat de {who} pe {when}. Originalul semnat este păstrat de club.",
    attesterRemoved: "un membru al echipei (cont șters)",
  },
  en: {
    organization: CLUB_NAME,
    whereupon: "IN WITNESS WHEREOF, I SIGN,",
    whereuponTogether: "IN WITNESS WHEREOF, WE SIGN,",
    signature: "Signature",
    minorSignature: "Minor's signature",
    guardianSignature: "Parent's or guardian's signature",
    date: "Date",
    idDocument: "Identity document",
    version: "Version",
    generatedOn: "Generated on {date}",
    page: "Page {n} of {total}",
    signedByLink:
      "Signed electronically on {when}, from the link sent to the participant's confirmed email address: typed name, explicit acceptance tick, the instant and the SHA-256 fingerprint of the text read — a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024.",
    signedOnPaper: "Signed on paper at the registration desk; recorded by {who} on {when}. The club keeps the signed original.",
    attesterRemoved: "a team member (account removed)",
  },
};

export function declarationWords(locale: Locale, now: Date): DeclarationLabels {
  const words = WORDS[locale];
  // "Generat pe joi, 24 sept. 2026, 18:05" (§349).
  const generated = formatDay(now, { locale, timeZone: CLUB_TIME_ZONE, style: "long", withTime: true, position: "inline" });
  return {
    organization: words.organization,
    whereupon: words.whereupon,
    whereuponTogether: words.whereuponTogether,
    signature: words.signature,
    minorSignature: words.minorSignature,
    guardianSignature: words.guardianSignature,
    date: words.date,
    idDocument: words.idDocument,
    version: words.version,
    generatedOn: words.generatedOn.replace("{date}", generated),
    page: (n, total) => words.page.replace("{n}", String(n)).replace("{total}", String(total)),
    signedByLink: (when) => words.signedByLink.replace("{when}", when),
    signedOnPaper: (who, when) => words.signedOnPaper.replace("{who}", who).replace("{when}", when),
    attesterRemoved: words.attesterRemoved,
  };
}

export function pdfResponse(pdf: Buffer, filename: string, disposition: "inline" | "attachment" = "inline"): Response {
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Length": String(pdf.byteLength),
      // A signed declaration names a person: never in a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
