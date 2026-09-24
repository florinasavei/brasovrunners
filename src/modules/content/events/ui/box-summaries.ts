import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay, formatTime } from "@/i18n/dates";
import { isBlankValue } from "@/shared/forms/blank-value";
import { fillIn } from "@/shared/forms/fill-in";
import { readCoHosts } from "@/modules/events/domain/co-hosts";
import { readEventLinks } from "@/modules/events/domain/links";
import { placeInBox } from "@/modules/events/domain/place";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import type { EditableEvent } from "../repository";

/**
 * The line each box of the event editor shows while it is shut (§350; the owner asked for the
 * editor to read "like the event's fact sheet"): "Parcul Titulescu · hartă", "Pe site · 150 locuri
 * · de la 14 ani · declarația v3". A closed fold that says nothing is a fold nobody opens, and a
 * fold that says its answer is one nobody has to open to check it.
 *
 * Pure functions of the saved event and its languages, rendered on the server (`Panel`'s `aside`)
 * — the editor opens with the summaries of what is stored; the create page shows the summaries of
 * the defaults. The words arrive as templates from the catalogue (`Admin.editor.boxes.summary`,
 * read with `t.raw`), filled here with `fillIn`, because the catalogues carry no ICU plurals: a
 * counted noun is three keys and `countForm` picks one.
 *
 * Dates are the site's short form (`src/i18n/dates.ts`, §350 weekday on every date) — `Sâm., 21
 * nov. 2026, 09:00` / `Sat, 21 Nov 2026, 09:00` — in the reader's language and the event's own
 * time zone, never the server's or the browser's clock; times are 24-hour.
 */

/** A counted noun, as `countForm` names its three forms. */
export type CountWords = { one: string; few: string; other: string };

export type SummaryWords = {
  filled: string;
  empty: string;
  nothing: string;
  separator: string;
  titleSummary: { missingTitle: string; missingSummary: string; untitled: string };
  description: { fallback: string };
  rules: { none: string };
  when: { none: string; raceStart: string; duration: string };
  timezone: { home: string };
  place: { tba: string; map: string; none: string; inLanguage: string };
  programme: { moments: CountWords; range: string; groupRun: string; none: string; checklist: string };
  registration: {
    groupRun: string;
    none: string;
    noneInvite: string;
    internal: string;
    places: CountWords;
    unlimited: string;
    minAge: string;
    declaration: string;
    noDeclaration: string;
    listHidden: string;
    listShown: string;
    external: string;
    externalUnnamed: string;
  };
  window: { range: string; fromPublication: string; untilStart: string };
  conditions: { noDeclaration: string };
  confirmation: { sentence: string };
  bibs: { from: string; clubColour: string; allocated: string; toPrint: string };
  bibDesign: { parts: string; footer: string };
  startList: { hidden: string; shown: string };
  course: { route: string; km: string; elevation: string };
  links: { strava: string; facebook: string; files: CountWords; none: string };
  coHosts: { with: string; described: string; describedOneLanguage: string; none: string };
  promotion: { featured: string; special: string; none: string };
  address: { locked: string; none: string };
};

function counted(words: CountWords, count: number, locale: string): string {
  return fillIn(words[countForm(count, locale)], { count });
}

function join(words: SummaryWords, parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(words.separator);
}

/**
 * `Sâm., 21 nov. 2026, 09:00` — a date and its time as the site writes them in a list or a closed
 * line (`formatDay`'s short form, §350), in the reader's language and the event's zone. `inline`
 * keeps Romanian's lower case for a date inside a sentence ("până la dum., 1 nov. 2026").
 */
export function summaryDateTime(date: Date, zone: string, locale: string, position: "start" | "inline" = "start"): string {
  return formatDay(date, { locale, timeZone: zone, style: "short", withTime: true, position });
}

/** `Sâm., 21 nov. 2026` — the same short form without the time. */
export function summaryDate(date: Date, zone: string, locale: string, position: "start" | "inline" = "start"): string {
  return formatDay(date, { locale, timeZone: zone, style: "short", position });
}

/** `09:30` on the event's clock, always 24-hour. */
function summaryTime(date: Date, zone: string, locale: string): string {
  return formatTime(date, { locale, timeZone: zone });
}

/** What a box needs of one language, stored or blank. */
export type SummaryTranslation = {
  locale: string;
  title: string;
  slug: string;
  excerpt: string | null;
  excerptJson: unknown;
  bodyJson: unknown;
  rulesJson: unknown;
  scheduleJson: unknown;
  checklist: string | null;
  locationName: string | null;
};

const code = (locale: string) => locale.toUpperCase();
const docBlank = (value: unknown) => value === null || value === undefined || isBlankValue(JSON.stringify(value));
const summaryBlank = (translation: SummaryTranslation) =>
  docBlank(translation.excerptJson) && (translation.excerpt ?? "").trim() === "";

/** Whether one language's value for a box, or for one field of it, is blank. */
export type BlankTest = (translation: SummaryTranslation) => boolean;

/**
 * Which languages a box marks "· incomplet" on first paint (the strip re-reads as it is typed):
 * `required` — a watched value blank here; `parity` — blank here while another language has it.
 *
 * A box that watches several fields passes one test per field, and the rule applies to each field
 * on its own — exactly what `LocaleTabPanels` does as it re-reads `watch.names` — so the first
 * paint and the first keystroke agree: a programme with the notes in Romanian and the checklist in
 * English marks both tabs from the start, not only once somebody types.
 */
export function incompleteLocales(
  translations: readonly SummaryTranslation[],
  rule: "required" | "parity",
  blank: BlankTest | readonly BlankTest[],
): string[] {
  const tests = typeof blank === "function" ? [blank] : blank;
  return translations
    .filter((translation) =>
      tests.some((test) => {
        if (!test(translation)) return false;
        if (rule === "required") return true;
        return translations.some((other) => other.locale !== translation.locale && !test(other));
      }),
    )
    .map((translation) => translation.locale);
}

/** Blank tests per box, shared by the first paint's marks and the summaries. */
export const BLANK = {
  titleSummary: (translation: SummaryTranslation) => translation.title.trim() === "" || summaryBlank(translation),
  description: (translation: SummaryTranslation) => docBlank(translation.bodyJson),
  // One test per field the strip watches (`schedule`, `checklist`), in that order.
  programme: [
    (translation: SummaryTranslation) => docBlank(translation.scheduleJson),
    (translation: SummaryTranslation) => (translation.checklist ?? "").trim() === "",
  ],
  rules: (translation: SummaryTranslation) => docBlank(translation.rulesJson),
  address: (translation: SummaryTranslation) => translation.slug.trim() === "",
} as const;

/** Box 2: `„Crosul Tâmpei” · „Tâmpa Cross”`, or what is missing and where. */
export function titleSummarySummary(words: SummaryWords, translations: readonly SummaryTranslation[]): string {
  const titles = translations.map((translation) =>
    translation.title.trim() === "" ? `${code(translation.locale)}: ${words.titleSummary.untitled}` : `„${translation.title.trim()}”`,
  );
  const missing = translations.flatMap((translation) => [
    ...(translation.title.trim() === "" ? [fillIn(words.titleSummary.missingTitle, { language: code(translation.locale) })] : []),
    ...(summaryBlank(translation) ? [fillIn(words.titleSummary.missingSummary, { language: code(translation.locale) })] : []),
  ]);
  return join(words, [...titles, ...missing]);
}

/** Boxes 3 and 7: `RO: completat · EN: gol — …` with what the empty language's page shows. */
function perLanguageText(
  words: SummaryWords,
  translations: readonly SummaryTranslation[],
  blank: (translation: SummaryTranslation) => boolean,
  whenEmpty: string,
): string {
  const states = translations.map((translation) => `${code(translation.locale)}: ${blank(translation) ? words.empty : words.filled}`);
  const anyFilled = translations.some((translation) => !blank(translation));
  const emptyOnes = translations.filter(blank);
  const tail = anyFilled && emptyOnes.length > 0 ? ` — ${emptyOnes.map((translation) => fillIn(whenEmpty, { language: code(translation.locale) })).join(", ")}` : "";
  return `${join(words, states)}${tail}`;
}

export function descriptionSummary(words: SummaryWords, translations: readonly SummaryTranslation[]): string {
  return perLanguageText(words, translations, BLANK.description, words.description.fallback);
}

export function rulesSummary(words: SummaryWords, translations: readonly SummaryTranslation[]): string {
  return perLanguageText(words, translations, BLANK.rules, words.rules.none);
}

type WhenEvent = Pick<EditableEvent, "type" | "startsAt" | "endsAt" | "raceStartsAt" | "timezone">;

/** Box 4: `Sâm., 21 nov. 2026, 09:00 · startul cursei 09:30 · 180 min`. */
export function whenSummary(words: SummaryWords, event: WhenEvent | null, locale: string): string {
  if (!event) return words.when.none;
  const minutes = event.endsAt ? Math.round((event.endsAt.getTime() - event.startsAt.getTime()) / 60_000) : null;
  return join(words, [
    summaryDateTime(event.startsAt, event.timezone, locale),
    event.type === "RACE" && event.raceStartsAt
      ? fillIn(words.when.raceStart, { time: summaryTime(event.raceStartsAt, event.timezone, locale) })
      : null,
    minutes && minutes > 0 ? fillIn(words.when.duration, { minutes }) : null,
  ]);
}

/** Sub-card 4.1: `Europe/Bucharest — ora României`, or the zone alone elsewhere. */
export function timezoneSummary(words: SummaryWords, zone: string): string {
  return zone === CLUB_TIME_ZONE ? fillIn(words.timezone.home, { zone }) : zone;
}

type PlaceEvent = Pick<EditableEvent, "locationName" | "locationAddress" | "locationToBeAnnounced" | "mapUrl">;

/**
 * Box 5: `Parcul Titulescu (EN: Titulescu Park) · hartă`, or `Se anunță mai târziu`.
 *
 * The Romanian name first — the event's own meeting point — and another language's only when it
 * says something else (§NNN): "Stadionul Tineretului" twice over would be the redundancy the box
 * was rebuilt to remove. Each language reads as its box and its page do (`placeInBox`), so an
 * event saved before §NNN, whose English row is empty, summarises as the one name it shows.
 */
export function placeSummary(words: SummaryWords, event: PlaceEvent | null, translations: readonly SummaryTranslation[]): string {
  if (!event) return words.place.tba;
  if (event.locationToBeAnnounced) return words.place.tba;
  const inLanguage = (locale: string) => placeInBox(event, translations.find((translation) => translation.locale === locale)?.locationName);
  const name = inLanguage("ro");
  if (name === "") return words.place.none;
  const others = translations
    .filter((translation) => translation.locale !== "ro")
    .map((translation) => ({ locale: translation.locale, place: inLanguage(translation.locale) }))
    .filter((other) => other.place !== "" && other.place !== name)
    .map((other) => fillIn(words.place.inLanguage, { language: code(other.locale), name: other.place }));
  return join(words, [others.length > 0 ? `${name} (${others.join(", ")})` : name, event.mapUrl ? words.place.map : null]);
}

type ProgrammeEvent = Pick<EditableEvent, "scheduleItems" | "timezone">;

/** Box 6: `4 momente, 08:00–12:30 · ce să aduci: RO, EN`, or a group run's own words. */
export function programmeSummary(
  words: SummaryWords,
  event: ProgrammeEvent | null,
  hasProgramme: boolean,
  translations: readonly SummaryTranslation[],
  locale: string,
): string {
  const items = event ? readScheduleItems(event.scheduleItems) : [];
  const checklist = translations.filter((translation) => (translation.checklist ?? "").trim() !== "").map((translation) => code(translation.locale));
  let rows: string;
  if (!hasProgramme) rows = words.programme.groupRun;
  else if (items.length === 0 || !event) rows = words.programme.none;
  else {
    const first = summaryTime(new Date(items[0].startsAt), event.timezone, locale);
    const lastItem = items[items.length - 1];
    const last = summaryTime(new Date(lastItem.endsAt ?? lastItem.startsAt), event.timezone, locale);
    rows = `${counted(words.programme.moments, items.length, locale)}${first === last ? `, ${first}` : `, ${fillIn(words.programme.range, { from: first, to: last })}`}`;
  }
  return join(words, [rows, checklist.length > 0 ? fillIn(words.programme.checklist, { languages: checklist.join(", ") }) : null]);
}

type RegistrationEvent = Pick<
  EditableEvent,
  "type" | "registrationMode" | "capacity" | "minAge" | "declarationDocumentId" | "participantListVisibility" | "externalProvider" | "costType"
>;

/** Box 8: `Pe site · 150 locuri · de la 14 ani · gratuit · declarația v3 · lista ascunsă`. */
export function registrationSummary(
  words: SummaryWords,
  event: RegistrationEvent | null,
  options: {
    takesRegistrations: boolean;
    costLabel: string | null;
    declarationVersion: number | null;
    defaultMinAge: number;
    locale: string;
    creating: boolean;
  },
): string {
  const cost = options.costLabel;
  if (!options.takesRegistrations) return join(words, [words.registration.groupRun, cost]);
  const mode = event?.registrationMode ?? "NONE";
  if (mode === "EXTERNAL") {
    const provider = (event?.externalProvider ?? "").trim();
    return join(words, [provider ? fillIn(words.registration.external, { provider }) : words.registration.externalUnnamed, cost]);
  }
  if (mode !== "INTERNAL") return join(words, [options.creating ? words.registration.noneInvite : words.registration.none, cost]);
  return join(words, [
    words.registration.internal,
    event?.capacity === null || event?.capacity === undefined ? words.registration.unlimited : counted(words.registration.places, event.capacity, options.locale),
    fillIn(words.registration.minAge, { age: event?.minAge ?? options.defaultMinAge }),
    cost,
    options.declarationVersion !== null ? fillIn(words.registration.declaration, { version: options.declarationVersion }) : words.registration.noDeclaration,
    event?.participantListVisibility === "NAMES" ? words.registration.listShown : words.registration.listHidden,
  ]);
}

type WindowEvent = Pick<EditableEvent, "registrationOpensAt" | "registrationClosesAt" | "timezone">;

/**
 * Sub-card 8.1: `Joi, 1 oct. 2026, 10:00 – joi, 19 nov. 2026, 23:59`, or `De la publicare – până
 * la start`. The second date continues the first, so it keeps the language's own case, as
 * `formatDayRange` writes a span.
 */
export function registrationWindowSummary(words: SummaryWords, event: WindowEvent | null, locale: string): string {
  const from = event?.registrationOpensAt ? summaryDateTime(event.registrationOpensAt, event.timezone, locale) : words.window.fromPublication;
  const to = event?.registrationClosesAt ? summaryDateTime(event.registrationClosesAt, event.timezone, locale, "inline") : words.window.untilStart;
  return fillIn(words.window.range, { from, to });
}

/** Sub-card 8.2: `de la 14 ani · Declarația v3`, or what is missing. */
export function conditionsSummary(
  words: SummaryWords,
  minAge: number,
  declaration: { version: number; title: string } | null,
): string {
  return join(words, [
    fillIn(words.registration.minAge, { age: minAge }),
    declaration ? fillIn(words.registration.declaration, { version: declaration.version }) : words.conditions.noDeclaration,
  ]);
}

/** Sub-card 8.3: `Cerută cu 7 zile înainte, termen cu 2 zile înainte`. */
export function confirmationSummary(words: SummaryWords, opens: number, due: number): string {
  return fillIn(words.confirmation.sentence, { opens, due });
}

/** Sub-card 8.4: `De la 100 · verde · 42 alocate, 2 de tipărit`. */
export function bibsSummary(
  words: SummaryWords,
  start: number,
  colourLabel: string | null,
  counts: { allocated: number; unprinted: number } | null,
): string {
  return join(words, [
    fillIn(words.bibs.from, { number: start }),
    colourLabel ?? words.bibs.clubColour,
    counts && counts.allocated > 0
      ? `${fillIn(words.bibs.allocated, { count: counts.allocated })}${counts.unprinted > 0 ? `, ${fillIn(words.bibs.toPrint, { count: counts.unprinted })}` : ""}`
      : null,
  ]);
}

/**
 * Sub-sub-card 8.4.1: `Numele alergătorului, Data · subsol: Partenerii` — the ticks that are on,
 * in the words of their own boxes, so the summary cannot drift from the panel.
 */
export function bibDesignSummary(
  words: SummaryWords,
  on: readonly string[],
  footerOn: readonly string[],
): string {
  return join(words, [
    on.length > 0 ? fillIn(words.bibDesign.parts, { parts: on.join(", ") }) : null,
    footerOn.length > 0 ? fillIn(words.bibDesign.footer, { parts: footerOn.join(", ") }) : null,
  ]) || words.nothing;
}

/** Sub-card 8.5: `Ascunsă`, or what a published list shows. */
export function startListSummary(words: SummaryWords, visibility: string | null | undefined): string {
  return visibility === "NAMES" ? words.startList.shown : words.startList.hidden;
}

type CourseEvent = Pick<EditableEvent, "distanceMeters" | "elevationGainMeters" | "routeUrl">;

/** Box 10: `Trail · Mediu · 12 km · +450 m · traseu`, or `Nimic completat`. */
export function courseSummary(
  words: SummaryWords,
  event: CourseEvent | null,
  labels: { surface: string | null; difficulty: string | null },
): string {
  const km = event?.distanceMeters ? Math.round(event.distanceMeters / 100) / 10 : null;
  const line = join(words, [
    labels.surface,
    labels.difficulty,
    km ? fillIn(words.course.km, { km: String(km).replace(".", ",") }) : null,
    event?.elevationGainMeters ? fillIn(words.course.elevation, { m: event.elevationGainMeters }) : null,
    event?.routeUrl ? words.course.route : null,
  ]);
  return line || words.nothing;
}

type LinksEvent = Pick<EditableEvent, "stravaEventUrl" | "facebookEventUrl" | "links">;

/** Box 11: `Strava · Facebook · 3 fișiere (GPX, Hartă, Rezultate)`, or `Niciun link`. */
export function linksSummary(
  words: SummaryWords,
  event: LinksEvent | null,
  kindLabels: Readonly<Record<string, string>>,
  locale: string,
): string {
  const rows = readEventLinks(event?.links ?? null);
  const line = join(words, [
    event?.stravaEventUrl ? words.links.strava : null,
    event?.facebookEventUrl ? words.links.facebook : null,
    rows.length > 0
      ? `${counted(words.links.files, rows.length, locale)} (${[...new Set(rows.map((row) => kindLabels[row.kind] ?? row.kind))].join(", ")})`
      : null,
  ]);
  return line || words.links.none;
}

type CoHostEvent = Parameters<typeof readCoHosts>[0];

/**
 * Box 12: `Împreună cu Brașov Running Festival · 2 linkuri · cu descriere`, or `Fără parteneri`.
 *
 * The links are counted across every card; the description (§352) is one word — "cu descriere"
 * when a card carries it in both languages — and says "descriere într-o singură limbă" instead
 * whenever a card holds half a pair, because that card is the one the next save will refuse and
 * the closed line is where the organizer sees it first.
 */
export function coHostsSummary(words: SummaryWords, event: CoHostEvent | null, locale: string): string {
  const hosts = readCoHosts(event ?? { coHosts: null, coHostName: null, coHostUrl: null });
  if (hosts.length === 0) return words.coHosts.none;
  const names = fillIn(words.coHosts.with, {
    names: new Intl.ListFormat(locale === "ro" ? "ro" : "en", { type: "conjunction" }).format(hosts.map((host) => host.name)),
  });
  const links = hosts.reduce((count, host) => count + host.links.length, 0);
  const oneLanguage = hosts.some((host) => (host.descriptionRo === null) !== (host.descriptionEn === null));
  const described = hosts.some((host) => host.descriptionRo !== null && host.descriptionEn !== null);
  return join(words, [
    names,
    links > 0 ? counted(words.links.files, links, locale) : null,
    oneLanguage ? words.coHosts.describedOneLanguage : described ? words.coHosts.described : null,
  ]);
}

/** Box 13: `Eveniment principal · Ediție specială`, or `Nimic în evidență`. */
export function promotionSummary(words: SummaryWords, event: Pick<EditableEvent, "featured" | "isSpecial"> | null): string {
  const line = join(words, [event?.featured ? words.promotion.featured : null, event?.isSpecial ? words.promotion.special : null]);
  return line || words.promotion.none;
}

/** Box 14: `/ro/evenimente/crosul-tampei · /en/events/tampa-cross · blocată după publicare`. */
export function addressSummary(
  words: SummaryWords,
  translations: readonly SummaryTranslation[],
  paths: Readonly<Record<string, string>>,
  locked: boolean,
): string {
  const addresses = translations.map((translation) =>
    translation.slug.trim() === "" ? `${code(translation.locale)}: ${words.address.none}` : `${paths[translation.locale] ?? ""}/${translation.slug}`,
  );
  return join(words, [...addresses, locked ? words.address.locked : null]);
}
