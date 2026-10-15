import type { EmailLocale } from "@/infrastructure/email/adapter";
import type { Road } from "./domain/road-failover";
import { SUBJECT_TAGS_OF, tagSubject } from "./domain/subject-tags";

/**
 * The words of the platform's two notices to the Administrators about the visitors' messages (§778, amending §622):
 * «a road is down» — a message had to leave by the other road — and «a message could not be delivered» — a day passed
 * and neither road carried it, and its words are deleted. Both in Romanian and English, in the language of the
 * person's own row; nothing here names the club (the sender line does), a visitor's words or an address — only the
 * form, the roads and their short error codes. A small module of its own, like `fallback-notice-words.ts`.
 */

export type RelayNoticeKind = "roadDown" | "lost";

export const ROAD_NAMES: Readonly<Record<EmailLocale, Readonly<Record<Road, string>>>> = {
  ro: { gmail: "Gmail-ul clubului", mailgun: "Mailgun" },
  en: { gmail: "the club's Gmail", mailgun: "Mailgun" },
};

/** The two forms a message comes from, by the name the page gives them. */
const FORM_NAMES: Readonly<Record<EmailLocale, Readonly<Record<"contact" | "feedback", string>>>> = {
  ro: { contact: "„Scrie-ne”", feedback: "„Spune-ne ceva”" },
  en: { contact: "“Write to us”", feedback: "“Tell us something”" },
};

export type RelayNoticeFacts = {
  /** The road that failed (roadDown) or the one chosen for the message (lost). */
  road: Road;
  /** The road that carried the message instead (roadDown only). */
  carriedBy?: Road;
  /** Which form the message came from (lost only). */
  form?: "contact" | "feedback";
  /** The two roads' last short error codes (lost only): `smtp EAUTH`, `mailgun 503`. */
  errors?: Partial<Record<Road, string>>;
  /** Where the Administrator goes: the page that shows the roads, as an absolute address from `APP_BASE_URL`. */
  pageUrl: string;
};

export function relayNoticeWords(kind: RelayNoticeKind, locale: EmailLocale, facts: RelayNoticeFacts): { subject: string; paragraphs: string[] } {
  const road = ROAD_NAMES[locale];
  const errorLine = (errors: RelayNoticeFacts["errors"]) =>
    (["gmail", "mailgun"] as const)
      .filter((name) => errors?.[name])
      .map((name) => `${road[name]}: ${errors?.[name]}`)
      .join(" · ");

  if (kind === "roadDown") {
    const carriedBy = facts.carriedBy ?? facts.road;
    const error = facts.errors?.[facts.road];
    return locale === "en"
      ? {
          subject: `${road[facts.road]} did not carry a message: it left by ${road[carriedBy]}`,
          paragraphs: [
            `A message from the site could not leave by ${road[facts.road]}, so it went by ${road[carriedBy]} and reached its reader.`,
            ...(error ? [`What ${road[facts.road]} answered: ${error}.`] : []),
            "Nothing is lost while one road works, but a road that stays down needs a person: check the key or the app password, or the service's own status page.",
            `The state of both roads is on this page: ${facts.pageUrl}`,
          ],
        }
      : {
          subject: `${road[facts.road]} nu a trimis un mesaj: a plecat prin ${road[carriedBy]}`,
          paragraphs: [
            `Un mesaj de pe site nu a putut pleca prin ${road[facts.road]}, așa că a plecat prin ${road[carriedBy]} și a ajuns la cine îl citește.`,
            ...(error ? [`Ce a răspuns ${road[facts.road]}: ${error}.`] : []),
            "Cât timp merge o cale, nu se pierde nimic, dar o cale care rămâne căzută are nevoie de un om: verifică cheia sau parola de aplicație, sau pagina de stare a serviciului.",
            `Starea celor două căi este pe această pagină: ${facts.pageUrl}`,
          ],
        };
  }

  const form = FORM_NAMES[locale][facts.form ?? "contact"];
  const errors = errorLine(facts.errors);
  return locale === "en"
    ? {
        subject: "A message from the site could not be delivered",
        paragraphs: [
          `A message from ${form} could not leave. Its words are deleted and cannot be recovered; the site keeps no copy.`,
          ...(errors ? [`The last answers: ${errors}.`] : []),
          "Others may follow today without another email: the list on this page shows every one.",
          "Check the two roads, and the address that receives this form.",
          `The state of both roads is on this page: ${facts.pageUrl}`,
        ],
      }
    : {
        subject: "Un mesaj de pe site nu a putut fi trimis",
        paragraphs: [
          `Un mesaj din ${form} nu a putut pleca. Textul lui este șters și nu mai poate fi recuperat; site-ul nu păstrează nicio copie.`,
          ...(errors ? [`Ultimele răspunsuri: ${errors}.`] : []),
          "Mai pot urma azi și altele, fără alt e-mail: lista de pe această pagină le arată pe toate.",
          "Verifică cele două căi și adresa care primește formularul.",
          `Starea celor două căi este pe această pagină: ${facts.pageUrl}`,
        ],
      };
}

/** The notice as a plain message: the paragraphs as text, and as escaped HTML. */
export function relayNoticeContent(
  kind: RelayNoticeKind,
  locale: EmailLocale,
  facts: RelayNoticeFacts,
): { subject: string; text: string; html: string } {
  const { subject, paragraphs } = relayNoticeWords(kind, locale, facts);
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return {
    // `[livrare] Mailgun nu a trimis…` (§NNN): the notice is the club's own mail, so its subject starts with its tag.
    subject: tagSubject(SUBJECT_TAGS_OF.RELAY_NOTICE, subject),
    text: paragraphs.join("\n\n"),
    html: paragraphs.map((paragraph) => `<p>${escape(paragraph)}</p>`).join(""),
  };
}
