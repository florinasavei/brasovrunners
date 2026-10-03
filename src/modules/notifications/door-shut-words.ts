import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import { hoursPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";

/**
 * The two Administrators' emails of the door (§NNN), in both languages: «Site-ul nu se găsește după
 * nume» while it is shut, and «Ceasul termenelor a stat pe loc» once it is open again and the deadlines
 * have moved.
 *
 * The window's facts — its instants, its stop, the club's cap, the counts, from the payload the job
 * wrote (`registrations/door-shut.ts`) — are the message's bold line; the paragraphs are the
 * platform's sentences alone, so the club's own wording of them (§247, §359) never stores a date or a
 * count. Nothing about a person.
 */
export type DoorShutFacts = {
  startedAt: string;
  endedAt: string | null;
  source: string;
  stoppedMinutes: number | null;
  maxHours: number;
  moved: number;
  outside: number;
};

type Lang = "ro" | "en";
type Forms = Record<"one" | "few" | "other", string>;

function at(iso: string | null, locale: Lang): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : formatDay(date, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
}

const MOVED: Record<Lang, Forms> = {
  ro: { one: "un termen mutat", few: "{n} termene mutate", other: "{n} de termene mutate" },
  en: { one: "one deadline moved", few: "{n} deadlines moved", other: "{n} deadlines moved" },
};
const OUTSIDE: Record<Lang, Forms> = {
  ro: { one: "o înscriere pe «Lista de invitați speciali»", few: "{n} înscrieri pe «Lista de invitați speciali»", other: "{n} de înscrieri pe «Lista de invitați speciali»" },
  en: { one: "one registration on «Special guests list»", few: "{n} registrations on «Special guests list»", other: "{n} registrations on «Special guests list»" },
};

function counted(words: Record<Lang, Forms>, locale: Lang, n: number): string {
  return words[locale][countForm(n, locale)].replace("{n}", String(n));
}

/** «Site-ul nu se găsește după nume»'s bold line: since when, and the club's cap on the stop. */
export function doorShutFactsLine(locale: Lang, facts: DoorShutFacts): string {
  const max = hoursPhrase(locale, facts.maxHours);
  return locale === "en"
    ? `Not found since ${at(facts.startedAt, locale)} · the clock stands still for at most ${max}`
    : `Negăsit din ${at(facts.startedAt, locale)} · ceasul stă pe loc cel mult ${max}`;
}

/** «Ceasul termenelor a stat pe loc»'s bold line: from when to when, how it was seen, the stop and the counts. */
export function doorShutMovedFactsLine(locale: Lang, facts: DoorShutFacts): string {
  const stopped = minutesPhrase(locale, facts.stoppedMinutes ?? 0);
  const seen =
    facts.source === "pings"
      ? locale === "en"
        ? "no scheduled call"
        : "nicio verificare programată"
      : locale === "en"
        ? "the name not found"
        : "numele negăsit";
  const parts = [
    `${at(facts.startedAt, locale)} – ${at(facts.endedAt, locale)} (${seen})`,
    locale === "en" ? `stopped ${stopped}` : `oprit ${stopped}`,
    counted(MOVED, locale, facts.moved),
    ...(facts.outside > 0 ? [counted(OUTSIDE, locale, facts.outside)] : []),
  ];
  return parts.join(" · ");
}

export function doorShutBody(locale: Lang): string[] {
  if (locale === "en") {
    return [
      "The site's name no longer resolves: nobody can open the site, the backoffice or an email's links by it.",
      "While it stays so nothing lapses: no address link, held place, offer, invitation or family form.",
      "Once the name answers again, the deadlines that were running move later by as long as it lasted, at most what «Deadlines» says.",
      "Check the domain at the registrar: the account, the contact verification emails, the renewal. A second email says what moved.",
    ];
  }
  return [
    "Numele site-ului nu se mai găsește: nimeni nu poate deschide site-ul, backoffice-ul sau linkurile din emailuri.",
    "Cât timp e așa nu expiră nimic: niciun link de confirmare, loc ținut, ofertă, invitație sau formular de familie.",
    "Când numele răspunde din nou, termenele care curgeau se mută mai târziu cu cât a durat, cel mult cât spune «Termene».",
    "Verifică domeniul la registrar: contul, emailurile de verificare a datelor de contact, reînnoirea. Un al doilea email spune ce s-a mutat.",
  ];
}

export function doorShutMovedBody(locale: Lang): string[] {
  if (locale === "en") {
    return [
      "The site could not be opened in the stretch above: its name did not resolve, or no scheduled call reached the platform.",
      "The participants' deadlines that were running then moved later by as long as the clock stood still, at most what «Deadlines» says.",
      "Whoever had lost the place to somebody else meanwhile is on «Special guests list», above the advertised places: nobody loses a place to the outage.",
      "Nobody was emailed about it: the new deadline is on the person's own page and in each registration's history.",
    ];
  }
  return [
    "Site-ul nu s-a putut deschide în intervalul de mai sus: numele lui nu se găsea, sau nicio verificare programată nu a ajuns la platformă.",
    "Termenele participanților care curgeau atunci s-au mutat mai târziu cu cât a stat ceasul, cel mult cât spune «Termene».",
    "Cine își pierduse între timp locul în favoarea altcuiva e pe «Lista de invitați speciali», peste locurile anunțate: nimeni nu pierde locul din cauza întreruperii.",
    "Participanților nu li s-a trimis nimic: termenul nou e în pagina lor și în istoricul fiecărei înscrieri.",
  ];
}

/** The payload as the job wrote it, read leniently: a field it cannot read is the empty one. */
export function readDoorShutFacts(payload: unknown): DoorShutFacts {
  const value = (payload ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  const whole = (key: string) => (typeof value[key] === "number" && Number.isInteger(value[key]) ? (value[key] as number) : null);
  return {
    startedAt: text("startedAt") ?? "",
    endedAt: text("endedAt"),
    source: text("source") ?? "name",
    stoppedMinutes: whole("stoppedMinutes"),
    maxHours: whole("maxHours") ?? 0,
    moved: whole("moved") ?? 0,
    outside: whole("outside") ?? 0,
  };
}
