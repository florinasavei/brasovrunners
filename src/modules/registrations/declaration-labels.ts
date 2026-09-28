import { CLUB_TIME_ZONE, formatDateInWords, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { CLUB_NAME } from "@/theme/brand";
import type { DeclarationLabels } from "./signed-declaration";

/**
 * The PDF's words, in the declaration's own language (`DECISIONS.md` §95). Plain copy rather
 * than `next-intl`, like the email templates: the outbox worker renders the PDF outside any
 * request, where there is no locale context to ask.
 */
const WORDS: Record<Locale, Omit<DeclarationLabels, "generatedOn" | "page" | "signedByLink" | "signedOnPaper" | "idDocumentsNotice" | "versionInForce" | "signedWhen"> & {
  versionInForce: string;
  signedWhen: string;
  generatedOn: string;
  page: string;
  signedByLink: string;
  signedOnPaper: string;
  idDocumentsNotice: string;
}> = {
  ro: {
    // The club's name in the PDF's footer and metadata is the platform's constant (§215), not a literal (§357).
    organization: CLUB_NAME,
    whereupon: "DREPT PENTRU CARE SEMNEZ,",
    whereuponTogether: "DREPT PENTRU CARE SEMNĂM,",
    signature: "Semnătura",
    minorSignature: "Semnătura minorului",
    guardianSignature: "Semnătura părintelui sau tutorelui",
    date: "Data",
    idDocument: "Act de identitate",
    version: "Versiunea",
    // The signing pages' own words (`Legal.inForce`), so the page and the PDF name the version alike (§499).
    versionInForce: "Versiunea {version}, în vigoare din {date}",
    // No preposition: {when} starts with its weekday, "semnată joi, 24 sept. 2026, la 18:05" (§452).
    signedWhen: "semnată {when}",
    // No preposition before {date} and {when}: each starts with a weekday — "Generat joi, 24 sept.
    // 2026, la 18:05" (§452, reversing §349's "pe").
    generatedOn: "Generat {date}",
    page: "Pagina {n} din {total}",
    signedByLink:
      "Semnat electronic {when}, din linkul unic trimis pe adresa de email a înscrierii: nume tastat, bifă explicită de acceptare, momentul și amprenta SHA-256 a textului citit — semnătură electronică simplă în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024 privind utilizarea semnăturii electronice, a mărcii temporale și prestarea serviciilor de încredere bazate pe acestea.",
    signedOnPaper: "Semnat pe hârtie, la masa de înscrieri; înregistrat de {who}, {when}. Originalul semnat este păstrat de club.",
    attesterRemoved: "un membru al echipei (cont șters)",
    // The event's bundle, while it carries whole identity documents (§418; privacy notice §7).
    idDocumentsNotice: "Conține seria și numărul actelor de identitate — ștergeți fișierul în cel mult șapte zile de la eveniment.",
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
    versionInForce: "Version {version}, in force since {date}",
    signedWhen: "signed on {when}",
    generatedOn: "Generated on {date}",
    page: "Page {n} of {total}",
    signedByLink:
      "Signed electronically on {when}, from the single-use link sent to the registration's email address: typed name, explicit acceptance tick, the instant and the SHA-256 fingerprint of the text read — a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024 on the use of electronic signatures, time stamps and the provision of trust services based on them.",
    signedOnPaper: "Signed on paper at the registration desk; recorded by {who} on {when}. The club keeps the signed original.",
    attesterRemoved: "a team member (account removed)",
    idDocumentsNotice: "Contains identity document numbers — delete this file within seven days of the event.",
  },
};

export function declarationWords(locale: Locale, now: Date): DeclarationLabels {
  const words = WORDS[locale];
  // "Generat joi, 24 sept. 2026, la 18:05" (§349, §452).
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
    // The day the version took effect, on the club's clock as `/admin/legal` and the signing pages show it (§499) —
    // the whole date, the month in words, no weekday: «Versiunea 6, în vigoare din 28 septembrie 2026» (§534).
    versionInForce: (version, effectiveAt) =>
      words.versionInForce
        .replace("{version}", String(version))
        .replace("{date}", formatDateInWords(effectiveAt, { locale, timeZone: CLUB_TIME_ZONE })),
    signedWhen: (when) => words.signedWhen.replace("{when}", when),
    generatedOn: words.generatedOn.replace("{date}", generated),
    page: (n, total) => words.page.replace("{n}", String(n)).replace("{total}", String(total)),
    signedByLink: (when) => words.signedByLink.replace("{when}", when),
    signedOnPaper: (who, when) => words.signedOnPaper.replace("{who}", who).replace("{when}", when),
    attesterRemoved: words.attesterRemoved,
    idDocumentsNotice: words.idDocumentsNotice,
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
