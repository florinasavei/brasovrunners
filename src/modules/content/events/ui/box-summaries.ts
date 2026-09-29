import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, durationShort, formatDay, formatTime } from "@/i18n/dates";
import { isBlankValue } from "@/shared/forms/blank-value";
import { identicalInBothLanguages, isWrittenText, missingLanguage } from "@/shared/forms/both-languages";
import { fillIn } from "@/shared/forms/fill-in";
import { hasOneLanguageCoHostDescription, hasOneLanguageCoHostLabel, readCoHosts } from "@/modules/events/domain/co-hosts";
import { hasOneLanguageLabel, readEventLinks } from "@/modules/events/domain/links";
import { placeInBox } from "@/modules/events/domain/place";
import { blankStartParts } from "@/modules/events/domain/provisional-start";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { confirmationDueAtStart } from "@/modules/registrations/domain/hold-deadlines";
import { savedDurationMinutes } from "../duration";
import type { EditableEvent } from "../repository";
import { storedTextValue } from "./publish-check";

/**
 * The line each editor box shows while shut (§350): "Parcul Titulescu · hartă", "Pe site · 150
 * locuri · declarația v3". Pure functions of the saved event (or the create page's defaults),
 * rendered on the server. Words are catalogue templates (`Admin.editor.boxes.summary`, `t.raw`)
 * filled with `fillIn`; the catalogues carry no ICU plurals, so `countForm` picks among three keys.
 * Dates are the short form of `src/i18n/dates.ts` in the reader's language and the event's zone,
 * 24-hour. A one-language optional text is named as the next save's refusal, and identical long
 * texts as a question (§354).
 */

/** A counted noun, as `countForm` names its three forms. */
export type CountWords = { one: string; few: string; other: string };

export type SummaryWords = {
  filled: string;
  empty: string;
  nothing: string;
  separator: string;
  /** "de scris și în {language} (ambele limbi sau niciuna)": an optional text written in the other language only (§354). */
  oneLanguage: string;
  /** "{language} identic cu {source}": the same words in both languages (§354). */
  identical: string;
  titleSummary: { untitled: string };
  when: { none: string; tba: string; timeTba: string; raceStart: string; duration: string };
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
    declaration: string;
    noDeclaration: string;
    listHidden: string;
    listShown: string;
    external: string;
    externalUnnamed: string;
  };
  window: { range: string; fromPublication: string; soon: string; untilStart: string };
  conditions: { noDeclaration: string };
  /** The minimum age, in «Regulamentul»'s closed line (§505): "vârsta minimă {age}", or none. */
  age: { from: string; none: string };
  /** A group run's optional self-declaration, under «Regulamentul» (§448). */
  declaration: { offered: string; offeredNoText: string; notOffered: string; notAsked: string };
  confirmation: { sentence: string; atStart: string; off: string };
  /** «Kit de participare»'s closed line (§554): "Tricou: da" / "Tricou: nu". */
  kit: { shirtYes: string; shirtNo: string };
  /** «Condiții de participare»'s closed line (§557): "Informații medicale: da" / "Informații medicale: nu". */
  health: { asked: string; notAsked: string };
  bibs: { from: string; clubColour: string; allocated: string; toPrint: string; spares: string };
  bibDesign: { parts: string; footer: string };
  startList: { hidden: string; shown: string };
  course: {
    route: string;
    km: string;
    elevation: string;
    night: string;
    nightAuto: string;
    day: string;
    dayAuto: string;
    described: string;
    describedOneLanguage: string;
  };
  links: { strava: string; facebook: string; files: CountWords; none: string; labelOneLanguage: string };
  coHosts: { with: string; described: string; describedOneLanguage: string; none: string };
  promotion: { featured: string; special: string; none: string };
  address: { locked: string; none: string; seoOneLanguage: string };
};

function counted(words: CountWords, count: number, locale: string): string {
  return fillIn(words[countForm(count, locale)], { count });
}

function join(words: SummaryWords, parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(words.separator);
}

/**
 * `Sâm., 21 nov. 2026, 09:00` in the reader's language and the event's zone (§350). `inline`
 * keeps Romanian's lower case inside a sentence.
 */
export function summaryDateTime(date: Date, zone: string, locale: string, position: "start" | "inline" | "continues" = "start"): string {
  return formatDay(date, { locale, timeZone: zone, style: "short", withTime: true, position });
}

/** `Sâm., 21 nov. 2026` — the same without the time. */
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
  /** The route / training description (§387), in the "Traseul" card; absent for a caller from before it. */
  routeDescriptionJson?: unknown;
  checklist: string | null;
  locationName: string | null;
  /** The two search-engine overrides, when the caller has them (the editor always does). */
  seoTitle?: string | null;
  seoDescription?: string | null;
};

const code = (locale: string) => locale.toUpperCase();
const docBlank = (value: unknown) => value === null || value === undefined || isBlankValue(JSON.stringify(value));
const summaryBlank = (translation: SummaryTranslation) =>
  docBlank(translation.excerptJson) && (translation.excerpt ?? "").trim() === "";

/** Whether one language's value for a box, or for one field of it, is blank. */
export type BlankTest = (translation: SummaryTranslation) => boolean;

/**
 * Which languages a box marks "· incomplet" on first paint: `required` — a watched value blank
 * here; `parity` — blank here while another language has it. Applied per field, as
 * `LocaleTabPanels` re-reads `watch.names`, so the first paint and the first keystroke agree.
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
  route: (translation: SummaryTranslation) => docBlank(translation.routeDescriptionJson),
  address: (translation: SummaryTranslation) => translation.slug.trim() === "",
} as const;

/**
 * `„Crosul Tâmpei” · „Tâmpa Cross”`. What is missing is said by the card's required line
 * (`publish-check.ts#cardGapLine`, §406), not again here.
 */
export function titleSummarySummary(words: SummaryWords, translations: readonly SummaryTranslation[]): string {
  const titles = translations.map((translation) =>
    translation.title.trim() === "" ? `${code(translation.locale)}: ${words.titleSummary.untitled}` : `„${translation.title.trim()}”`,
  );
  // The summary is the long text here (§354); two identical titles may honestly be a name.
  return join(words, [...titles, ...identicalMarks(words, translations, ["excerptBody"])]);
}

/**
 * The languages after the first whose text for any of `posted` repeats the first's word for word
 * (§354), decided by `identicalInBothLanguages`, so a short text never counts.
 */
export function identicalLocales(translations: readonly SummaryTranslation[], posted: readonly string[]): string[] {
  const [first, ...rest] = translations;
  if (!first) return [];
  return rest
    .filter((translation) => posted.some((name) => identicalInBothLanguages(storedTextValue(first, name), storedTextValue(translation, name))))
    .map((translation) => translation.locale);
}

/** `EN identic cu RO`, for each copying language, or nothing. */
function identicalMarks(words: SummaryWords, translations: readonly SummaryTranslation[], posted: readonly string[]): string[] {
  const source = translations[0];
  if (!source) return [];
  return identicalLocales(translations, posted).map((locale) => fillIn(words.identical, { language: code(locale), source: code(source.locale) }));
}

/**
 * `RO: completat · EN: gol — de scris și în EN (ambele limbi sau niciuna)`: a one-language text is
 * the next save's refusal (§352), so the line names the language that owes it; then `EN identic cu
 * RO` when both match.
 */
function perLanguageText(
  words: SummaryWords,
  translations: readonly SummaryTranslation[],
  blank: (translation: SummaryTranslation) => boolean,
  posted: string,
): string {
  const states = translations.map((translation) => `${code(translation.locale)}: ${blank(translation) ? words.empty : words.filled}`);
  const anyFilled = translations.some((translation) => !blank(translation));
  const emptyOnes = translations.filter(blank);
  const tail = anyFilled && emptyOnes.length > 0 ? ` — ${emptyOnes.map((translation) => fillIn(words.oneLanguage, { language: code(translation.locale) })).join(", ")}` : "";
  return join(words, [`${join(words, states)}${tail}`, ...identicalMarks(words, translations, [posted])]);
}

export function descriptionSummary(words: SummaryWords, translations: readonly SummaryTranslation[]): string {
  return perLanguageText(words, translations, BLANK.description, "body");
}

export function rulesSummary(words: SummaryWords, translations: readonly SummaryTranslation[]): string {
  return perLanguageText(words, translations, BLANK.rules, "rules");
}

type WhenEvent = Pick<EditableEvent, "type" | "startsAt" | "endsAt" | "raceStartsAt" | "timezone"> & Partial<Pick<EditableEvent, "dateToBeAnnounced" | "timeToBeAnnounced">>;

/** `Sâm., 21 nov. 2026, 09:00 · startul cursei 09:30 · 3 h` (duration in hours and minutes, §433). */
export function whenSummary(words: SummaryWords, event: WhenEvent | null, locale: string): string {
  if (!event) return words.when.none;
  const minutes = savedDurationMinutes(event.startsAt, event.endsAt);
  // A part left blank (§545) is not said: never the stored provisional value.
  const blank = blankStartParts(event.startsAt, event.timezone);
  return join(words, [
    // Said first while the date is held back (§533).
    event.dateToBeAnnounced ? words.when.tba : event.timeToBeAnnounced ? words.when.timeTba : null,
    blank.date ? null : blank.time ? summaryDate(event.startsAt, event.timezone, locale) : summaryDateTime(event.startsAt, event.timezone, locale),
    event.type === "RACE" && event.raceStartsAt
      ? fillIn(words.when.raceStart, { time: summaryTime(event.raceStartsAt, event.timezone, locale) })
      : null,
    minutes ? fillIn(words.when.duration, { duration: durationShort(minutes) }) : null,
  ]);
}

/** `Europe/Bucharest — ora României`, or the zone alone elsewhere. */
export function timezoneSummary(words: SummaryWords, zone: string): string {
  return zone === CLUB_TIME_ZONE ? fillIn(words.timezone.home, { zone }) : zone;
}

type PlaceEvent = Pick<EditableEvent, "locationName" | "locationAddress" | "locationToBeAnnounced" | "mapUrl">;

/**
 * `Parcul Titulescu (EN: Titulescu Park) · hartă`, or `Se anunță mai târziu`. Another language's
 * name only when it differs (§362); each language reads as its box and page do (`placeInBox`).
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

/**
 * `4 momente, 08:00–12:30 · ce să aduci: RO, EN`, or a group run's own words; then the language
 * that still owes the notes or what to bring, and `EN identic cu RO` (§354).
 */
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
  // Each field on its own (`BLANK.programme`); a group run has no notes (§111).
  const owed = incompleteLocales(translations, "parity", hasProgramme ? BLANK.programme : [BLANK.programme[1]]);
  return join(words, [
    rows,
    checklist.length > 0 ? fillIn(words.programme.checklist, { languages: checklist.join(", ") }) : null,
    ...owed.map((owing) => fillIn(words.oneLanguage, { language: code(owing) })),
    ...identicalMarks(words, translations, hasProgramme ? ["schedule", "checklist"] : ["checklist"]),
  ]);
}

type RegistrationEvent = Pick<
  EditableEvent,
  "type" | "registrationMode" | "capacity" | "minAge" | "declarationDocumentId" | "participantListVisibility" | "externalProvider" | "costType"
>;

/**
 * The cost select's start (§398): `FREE` on a new event; an edited one keeps what it has, an
 * unset "" («Nespecificat») included. The select always posts, so a create that never opens it
 * writes `FREE`.
 */
export function initialCostTypeOf(event: Pick<RegistrationEvent, "costType"> | null): string {
  return event === null ? "FREE" : (event.costType ?? "");
}

/** `Pe site · 150 locuri · gratuit · declarația v3 · lista ascunsă`. */
export function registrationSummary(
  words: SummaryWords,
  event: RegistrationEvent | null,
  options: {
    takesRegistrations: boolean;
    declarationVersion: number | null;
    locale: string;
    creating: boolean;
  },
): string {
  if (!options.takesRegistrations) return join(words, [words.registration.groupRun]);
  const mode = event?.registrationMode ?? "NONE";
  if (mode === "EXTERNAL") {
    const provider = (event?.externalProvider ?? "").trim();
    return join(words, [provider ? fillIn(words.registration.external, { provider }) : words.registration.externalUnnamed]);
  }
  if (mode !== "INTERNAL") return join(words, [options.creating ? words.registration.noneInvite : words.registration.none]);
  return join(words, [
    words.registration.internal,
    event?.capacity === null || event?.capacity === undefined ? words.registration.unlimited : counted(words.registration.places, event.capacity, options.locale),
    options.declarationVersion !== null ? fillIn(words.registration.declaration, { version: options.declarationVersion }) : words.registration.noDeclaration,
    event?.participantListVisibility === "NAMES" ? words.registration.listShown : words.registration.listHidden,
  ]);
}

type WindowEvent = Pick<EditableEvent, "registrationOpensAt" | "registrationClosesAt" | "timezone"> &
  Partial<Pick<EditableEvent, "registrationOpensSoon">>;

/**
 * `Joi, 1 oct. 2026, 10:00 – joi, 19 nov. 2026, 23:59`, `De la publicare – până la start`, or `Se
 * deschid în curând – până la start` (§451). The second date keeps the language's own case.
 */
export function registrationWindowSummary(words: SummaryWords, event: WindowEvent | null, locale: string): string {
  const from = event?.registrationOpensSoon
    ? words.window.soon
    : event?.registrationOpensAt
      ? summaryDateTime(event.registrationOpensAt, event.timezone, locale)
      : words.window.fromPublication;
  const to = event?.registrationClosesAt ? summaryDateTime(event.registrationClosesAt, event.timezone, locale, "continues") : words.window.untilStart;
  return fillIn(words.window.range, { from, to });
}

/**
 * The minimum age in «Regulamentul»'s closed line (§505): `vârsta minimă 16 ani`, or `fără vârstă
 * minimă` for zero. `yearsPhrase` handles «20 de ani».
 */
export function minAgeSummary(words: SummaryWords, minAge: number, locale: string): string {
  return minAge > 0 ? fillIn(words.age.from, { age: yearsPhrase(minAge, locale) }) : words.age.none;
}

type DeclarationEvent = Pick<EditableEvent, "registrationMode" | "offersGroupRunDeclaration">;

/**
 * The declaration card's line (§448): a group run's `declarație trail` / `fără declarație`, or a
 * site-registering race's `declarația v3` or its gap. Null when no declaration is asked.
 */
export function declarationSummary(
  words: SummaryWords,
  event: DeclarationEvent | null,
  options: {
    takesRegistrations: boolean;
    declarationVersion: number | null;
    surface: string | null;
    /**
     * Whether an approved, not withdrawn text of the run's surface is in force (§393, §483); ticked
     * with none, the line says the button will not show. Absent reads as in force.
     */
    groupRunTextInForce?: boolean;
  },
): string | null {
  if (!options.takesRegistrations) {
    if (!event?.offersGroupRunDeclaration || !options.surface) return words.declaration.notOffered;
    return fillIn(options.groupRunTextInForce === false ? words.declaration.offeredNoText : words.declaration.offered, {
      surface: options.surface,
    });
  }
  if ((event?.registrationMode ?? "NONE") !== "INTERNAL") return null;
  return options.declarationVersion !== null
    ? fillIn(words.registration.declaration, { version: options.declarationVersion })
    : words.conditions.noDeclaration;
}

/**
 * `Cerută cu 7 zile înainte, termen cu 2 zile înainte`; `…, termen la start` for a zero deadline
 * (§407, `confirmationDueAtStart`); or the no-window sentence (§104's `confirmationWindow`).
 */
export function confirmationSummary(words: SummaryWords, opens: number, due: number): string {
  if (opens <= 0 || opens <= due) return words.confirmation.off;
  return fillIn(confirmationDueAtStart({ days: due }) ? words.confirmation.atStart : words.confirmation.sentence, { opens, due });
}

/** «Kit de participare» (§554): whether the event gives a T-shirt — the one thing the card holds for now. */
export function kitSummary(words: SummaryWords, kitShirt: boolean): string {
  return kitShirt ? words.kit.shirtYes : words.kit.shirtNo;
}

/** «Condiții de participare» (§557): whether the form asks the health note — the card's one tick for now. */
export function healthNoteSummary(words: SummaryWords, askHealthNote: boolean): string {
  return askHealthNote ? words.health.asked : words.health.notAsked;
}

/** Sub-card 8.4: `De la 100 · verde · rezervă 900–949 · 42 alocate, 2 de tipărit`. */
export function bibsSummary(
  words: SummaryWords,
  start: number,
  colourLabel: string | null,
  counts: { allocated: number; unprinted: number } | null,
  /** The desk's spares (§444), when the club set a band. */
  spare: { from: number; to: number } | null = null,
): string {
  return join(words, [
    fillIn(words.bibs.from, { number: start }),
    colourLabel ?? words.bibs.clubColour,
    spare ? fillIn(words.bibs.spares, { from: spare.from, to: spare.to }) : null,
    counts && counts.allocated > 0
      ? `${fillIn(words.bibs.allocated, { count: counts.allocated })}${counts.unprinted > 0 ? `, ${fillIn(words.bibs.toPrint, { count: counts.unprinted })}` : ""}`
      : null,
  ]);
}

/**
 * `Numele alergătorului, Data · subsol: Partenerii` — the ticks that are on, in their boxes' own
 * words, so the summary cannot drift from the panel.
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

/** `Ascunsă`, or what a published list shows. */
export function startListSummary(words: SummaryWords, visibility: string | null | undefined): string {
  return visibility === "NAMES" ? words.startList.shown : words.startList.hidden;
}

type CourseEvent = Pick<EditableEvent, "distanceMeters" | "elevationGainMeters" | "routeUrl" | "nightOverride">;

/**
 * The night word on the closed "Traseul" card (§394): `de noapte` / `de zi` for Da / Nu, with
 * `(automat)` when automatic — "Automat" is always a choice, never a blank.
 */
export function nightSummary(words: SummaryWords, nightOverride: boolean | null | undefined, computedNight: boolean): string | null {
  if (nightOverride === true) return words.course.night;
  if (nightOverride === false) return words.course.day;
  return computedNight ? words.course.nightAuto : words.course.dayAuto;
}

/** `12 km`, `10,5 km` — the distance to one decimal, or null when none is stored. */
function distanceWords(words: SummaryWords, distanceMeters: number | null | undefined): string | null {
  const km = distanceMeters ? Math.round(distanceMeters / 100) / 10 : null;
  return km ? fillIn(words.course.km, { km: String(km).replace(".", ",") }) : null;
}

/**
 * `Trail · 12 km · +450 m · de noapte (automat) · traseu · cu descriere`, or `Nimic completat`.
 * `labels.night` is the caller's automatic answer (§394). The route description (§387) adds `cu
 * descriere`, `descriere într-o singură limbă` (§352) or `EN identic cu RO` (§354).
 */
export function courseSummary(
  words: SummaryWords,
  event: CourseEvent | null,
  labels: { surface: string | null; night?: boolean },
  translations: readonly SummaryTranslation[] = [],
): string {
  const described = translations.filter((translation) => !BLANK.route(translation)).length;
  const line = join(words, [
    labels.surface,
    distanceWords(words, event?.distanceMeters),
    event?.elevationGainMeters ? fillIn(words.course.elevation, { m: event.elevationGainMeters }) : null,
    event ? nightSummary(words, event.nightOverride, labels.night === true) : null,
    event?.routeUrl ? words.course.route : null,
    described === 0 ? null : described === translations.length ? words.course.described : words.course.describedOneLanguage,
    ...identicalMarks(words, translations, ["routeDescription"]),
  ]);
  return line || words.nothing;
}

type LinksEvent = Pick<EditableEvent, "stravaEventUrl" | "facebookEventUrl" | "links">;

/**
 * `Strava · Facebook · 3 fișiere (GPX, Hartă, Rezultate)`, or `Niciun link`, plus `etichetă
 * într-o singură limbă` for a one-language label, which the next save refuses (§354).
 */
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
    rows.some(hasOneLanguageLabel) ? words.links.labelOneLanguage : null,
  ]);
  return line || words.links.none;
}

type CoHostEvent = Parameters<typeof readCoHosts>[0];

/**
 * `Împreună cu Brașov Running Festival · 2 linkuri · cu descriere`, or `Fără parteneri`. Links are
 * counted across cards. A half-written description (§352) or one-language link label (§354) is
 * named as the next save's refusal; an identical description as `EN identic cu RO`.
 */
export function coHostsSummary(words: SummaryWords, event: CoHostEvent | null, locale: string): string {
  const hosts = readCoHosts(event ?? { coHosts: null, coHostName: null, coHostUrl: null });
  if (hosts.length === 0) return words.coHosts.none;
  const names = fillIn(words.coHosts.with, {
    names: new Intl.ListFormat(locale === "ro" ? "ro" : "en", { type: "conjunction" }).format(hosts.map((host) => host.name)),
  });
  const links = hosts.reduce((count, host) => count + host.links.length, 0);
  const oneLanguage = hosts.some(hasOneLanguageCoHostDescription);
  const described = hosts.some((host) => host.descriptionRo !== null && host.descriptionEn !== null);
  const copied = hosts.some((host) => identicalInBothLanguages(host.descriptionRo, host.descriptionEn));
  return join(words, [
    names,
    links > 0 ? counted(words.links.files, links, locale) : null,
    hosts.some((host) => host.links.some(hasOneLanguageCoHostLabel)) ? words.links.labelOneLanguage : null,
    oneLanguage ? words.coHosts.describedOneLanguage : described ? words.coHosts.described : null,
    copied ? fillIn(words.identical, { language: "EN", source: "RO" }) : null,
  ]);
}

/** `Eveniment principal · Ediție specială`, or `Nimic în evidență`. */
export function promotionSummary(words: SummaryWords, event: Pick<EditableEvent, "featured" | "isSpecial"> | null): string {
  const line = join(words, [event?.featured ? words.promotion.featured : null, event?.isSpecial ? words.promotion.special : null]);
  return line || words.promotion.none;
}

/**
 * `/ro/evenimente/crosul-tampei · /en/events/tampa-cross · blocată după publicare`, plus `SEO
 * într-o singură limbă` for a one-language override (§354).
 */
export function addressSummary(
  words: SummaryWords,
  translations: readonly SummaryTranslation[],
  paths: Readonly<Record<string, string>>,
  locked: boolean,
): string {
  const addresses = translations.map((translation) =>
    translation.slug.trim() === "" ? `${code(translation.locale)}: ${words.address.none}` : `${paths[translation.locale] ?? ""}/${translation.slug}`,
  );
  const [ro, en] = [translations.find((row) => row.locale === "ro"), translations.find((row) => row.locale === "en")];
  const seoOneLanguage =
    ro !== undefined &&
    en !== undefined &&
    (["seoTitle", "seoDescription"] as const).some((field) => missingLanguage({ ro: ro[field], en: en[field] }, isWrittenText) !== null);
  return join(words, [...addresses, locked ? words.address.locked : null, seoOneLanguage ? words.address.seoOneLanguage : null]);
}
