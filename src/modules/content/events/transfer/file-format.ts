import { z } from "zod";
import { EVENT_COST_TYPES } from "@/modules/events/domain/cost";
import { EVENT_SURFACES, EVENT_TYPES } from "@/modules/events/domain/event-type";
import { WEATHER_MODES } from "@/modules/weather/domain/mode";
import { DEFAULT_PUBLIC_LIST_CLUB, PUBLIC_LIST_CLUBS } from "@/modules/registrations/domain/public-list-club";
import { RACE_DECLARATION_KEYS } from "@/modules/legal-documents/domain/keys";
import { CHECKPOINT_KINDS, CHECKPOINT_KM_MAX, CHECKPOINT_NAME_MAX, CHECKPOINT_NOTE_MAX, CHECKPOINTS_MAX, clockMinutes } from "@/modules/event-checkpoints/domain/checkpoint";
import { minutesFromClock } from "@/modules/event-checkpoints/domain/start";
import { DURATION_MAX_MINUTES } from "@/modules/content/events/duration";
import { fromWallTimeInput, toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { DEFAULT_BADGE_DESIGN, readBadgeDesign } from "@/modules/volunteers/badges/badge-design";
import { WAITLIST_CHOICES } from "../waitlist-choice";

/**
 * An event as a JSON file (§751; the owner, 2026-10-13: «I need to have an intermediate technical
 * release … where I can export and import an event as JSON so that I can test on QA the changes made
 * on PROD and I can pre-approve them»).
 *
 * The file is **one event's configuration and nothing else**: both languages' texts, the dates and
 * the zone, the place, the registration settings, the programme, the partners, the route, the bib
 * design, the lists' switches, and — by their public address, with a size and a SHA-256 — the pictures
 * and the GPX the event points to. It never carries a registration, an invitation, a participant, a
 * volunteer, an audit row, a member of staff, an email address or anything else about a person — but for
 * the categories and roles of its volunteers and the contact person the club published for each (§774) —, and
 * no identifier that only means something in one database: an event is named by its slug, a
 * declaration by the legal document's key (`EVENT_DECLARATION`, `EVENT_DECLARATION_ROAD`).
 *
 * Pure: the shapes and the reader. Writing one is `export.ts`; reading one into an event is `import.ts`.
 * A version this release does not know — and a file that is not ours at all — is refused with a plain
 * sentence before anything else is looked at (`readEventFile`).
 */

/**
 * The `format` every file carries, and the only one this release reads. Hyphenated, not dotted:
 * `docs:check` reads the club's name followed by a dot and a word as the club's own hostname.
 */
export const EVENT_FILE_FORMAT = "brasovrunners-event";

/**
 * The version this release writes. A later release that changes the shape or a value's meaning raises
 * it. **2** (§757): a race's `durationMinutes` is its «Timp limită», counted from the gun when it has
 * one (`duration.ts#durationBase`); in a version 1 file it counts from the event's start. A version 1
 * file is still read, and upgraded as it is read (`upgradeVersion1`), so a file exported by the
 * release before this one — production's, during a release — imports with the end it had.
 * **3** (§770): a checkpoint's cut-off is `cutoffMinutes`, a time limit in minutes from the start (the
 * gun on a race), where versions 1 and 2 carried `cutoff`, a time of the day. An older file is still
 * read, and its time of day converted when the event's start is in the file (`upgradeCheckpoints`),
 * otherwise left out with a word, never refused.
 */
export const EVENT_FILE_VERSION = 3;

/** Every version this release reads: the one it writes, and 1 and 2, upgraded on reading. */
export const EVENT_FILE_VERSIONS_READ: readonly number[] = [1, 2, EVENT_FILE_VERSION];

/**
 * The largest file taken: the file travels from the browser to a Server Action as text, and the
 * platform's own body limit for one is a megabyte. An event's configuration is tens of kilobytes —
 * its pictures are addresses — so this is generous; a file past it is refused with the size said.
 */
export const MAX_EVENT_FILE_BYTES = 700_000;

/** The most pictures and files one event may name — a body's pictures, the bib's, the cover and the GPX. */
export const MAX_EVENT_FILE_MEDIA = 60;

const instant = z.iso.datetime();
const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
/** A rich text document, read strictly at import by the editor's own schema (`parseRichText`); here it must be an object or null. */
const richDocument = z.record(z.string(), z.unknown()).nullable();
const crop = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict();

/** One picture or file the event points to, by its public address (§17). */
export const mediaEntrySchema = z
  .object({
    /** Where it is used: `cover`, `bib.header`, `bib.sponsors`, `bib.profile`, `bib.member.header`, `bib.member.card`, `text.<locale>.<box>`, `route.gpx`. */
    role: text(80),
    /** Its public address in the environment the file was made in. */
    url: text(2048),
    contentType: text(100),
    /** Bytes, or null when the object could not be read from the store at export — then it cannot be verified, so it is not copied. */
    size: z.number().int().min(0).nullable(),
    /** SHA-256 of the bytes, lower-case hex, or null with `size`. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  })
  .strict();

export type MediaEntry = z.infer<typeof mediaEntrySchema>;

const translationSchema = z
  .object({
    slug: text(120),
    title: text(200),
    /** The summary as plain words — what the card and the search engines carry. */
    excerpt: nullableText(500),
    /** The summary as written in the editor, a small rich document. */
    excerptBody: richDocument,
    checklist: nullableText(300),
    body: richDocument,
    rules: richDocument,
    /** The programme's notes — the rich text beneath the programme's rows (`programme`). */
    schedule: richDocument,
    routeDescription: richDocument,
    seoTitle: nullableText(200),
    seoDescription: nullableText(320),
    discountNote: nullableText(200),
    weatherNote: nullableText(200),
  })
  .strict();

export type TranslationConfig = z.infer<typeof translationSchema>;

const linkSchema = z
  .object({ kind: text(20), url: text(2048), labelRo: nullableText(80), labelEn: nullableText(80) })
  .strict();

const partnerSchema = z
  .object({
    name: text(200),
    descriptionRo: nullableText(300),
    descriptionEn: nullableText(300),
    links: z.array(linkSchema.extend({ url: text(2000) })).max(12),
  })
  .strict();

const programmeRowSchema = z
  .object({
    startsAt: instant,
    endsAt: instant.nullable(),
    label: z.object({ ro: text(200), en: text(200) }).strict(),
    place: nullableText(200),
  })
  .strict();

/**
 * One of the route's checkpoints (§757): where, its name and note in both languages, what is there and
 * its time limit in minutes from the start (§770) — the shape `event_checkpoints` holds, with no id.
 * The rules that need the event (a kilometre within the route, limits not past the event's own and in
 * order) are the import's to apply, as the editor's card applies them.
 *
 * **Read forgivingly** (§770): `kinds` are words, and a kind this release does not know — a later
 * release's — is left out when the file is read, with a word (`upgradeCheckpoints`), never a refusal of
 * the whole file; and `cutoff`, a time of the day, is what versions 1 and 2 wrote, read and converted
 * to `cutoffMinutes` where the event's start is in the file. After the read neither is in the file.
 */
const checkpointSchema = z
  .object({
    km: z.number().min(0).max(CHECKPOINT_KM_MAX),
    name: z.object({ ro: text(CHECKPOINT_NAME_MAX).min(1), en: text(CHECKPOINT_NAME_MAX).min(1) }).strict(),
    kinds: z.array(text(40)).max(40),
    cutoffMinutes: z.number().int().min(1).max(DURATION_MAX_MINUTES).nullable().default(null),
    /** The first answer's time of the day (versions 1 and 2): read, converted by `upgradeCheckpoints`, never written. */
    cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
    note: z.object({ ro: nullableText(CHECKPOINT_NOTE_MAX), en: nullableText(CHECKPOINT_NOTE_MAX) }).strict(),
    /** Whether the route's elevation profile draws the point (§802); a file made before the tick existed has none: on. */
    onProfile: z.boolean().default(true),
  })
  .strict();

/** A checkpoint as the rest of the platform reads it from a file: only the kinds this release knows, only `cutoffMinutes`. */
export type CheckpointConfig = Omit<z.infer<typeof checkpointSchema>, "kinds" | "cutoff"> & { kinds: (typeof CHECKPOINT_KINDS)[number][] };

/**
 * The configuration, in a shape that means the same in every environment: instants in ISO with the
 * event's own zone beside them, the start as its two boxes (a date or an hour may be left empty while
 * it is to be announced, §545), switches as booleans, lists as lists.
 */
export const eventConfigSchema = z
  .object({
    type: z.enum(EVENT_TYPES),
    surface: z.enum(EVENT_SURFACES).nullable(),
    timezone: text(64).min(1),
    /** The start's two boxes in the event's zone: `YYYY-MM-DD` and `HH:mm`, each null when left empty while to be announced. */
    start: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), time: z.string().regex(/^\d{2}:\d{2}$/).nullable() }).strict(),
    /** «Durata», in whole minutes — the end is the start plus this — or null. */
    durationMinutes: z.number().int().min(1).nullable(),
    raceStartsAt: instant.nullable(),
    dateToBeAnnounced: z.boolean(),
    timeToBeAnnounced: z.boolean(),
    programme: z.array(programmeRowSchema).max(50),
    place: z
      .object({
        name: z.object({ ro: nullableText(200), en: nullableText(200) }).strict(),
        address: nullableText(300),
        toBeAnnounced: z.boolean(),
        mapUrl: nullableText(2000),
        coordinates: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict().nullable(),
      })
      .strict(),
    weather: z.object({ mode: z.enum(WEATHER_MODES) }).strict(),
    route: z
      .object({
        url: nullableText(2000),
        /** Strava / Garmin Connect maps, as the ids and the strictly-patterned values the editor stores (§718). */
        maps: z.array(z.record(z.string(), z.unknown())).max(2),
        /** The GPX the club uploaded: its name, and its address among `media` (role `route.gpx`). */
        gpx: z.object({ name: text(120), url: text(2048) }).strict().nullable(),
        /** The checkpoints along the route, by distance (§757): a file made before they existed has none. */
        checkpoints: z.array(checkpointSchema).max(CHECKPOINTS_MAX).default([]),
        /** «Arată profilul traseului pe pagină» (§802, §NNN): a file made before the tick existed has none: on. */
        showRouteProfile: z.boolean().default(true),
      })
      .strict(),
    links: z.array(linkSchema).max(12),
    partners: z.array(partnerSchema).max(8),
    stravaEventUrl: nullableText(2000),
    facebookEventUrl: nullableText(2000),
    measures: z
      .object({
        distanceMeters: z.number().int().min(0).nullable(),
        distanceEstimated: z.boolean(),
        elevationGainMeters: z.number().int().min(0).nullable(),
        elevationGainEstimated: z.boolean(),
      })
      .strict(),
    /** On the club's scale of fifteen (§526), or null for «not said». */
    difficultyLevel: z.number().int().min(1).max(15).nullable(),
    nightOverride: z.boolean().nullable(),
    cost: z.object({ type: z.enum(EVENT_COST_TYPES).nullable(), amount: nullableText(120), url: nullableText(2000) }).strict(),
    offersGroupRunDeclaration: z.boolean(),
    isSpecial: z.boolean(),
    membersOnly: z.boolean(),
    /** «Copertă»: the picture's address among `media` (role `cover`) and its crop. */
    cover: z.object({ url: text(2048), crop: crop.nullable() }).strict().nullable(),
    registration: z
      .object({
        mode: z.enum(["NONE", "INTERNAL", "EXTERNAL"]),
        capacity: z.number().int().min(1).nullable(),
        waitlist: z.object({ choice: z.enum(WAITLIST_CHOICES), limit: z.number().int().min(1).nullable() }).strict(),
        waitlistAutoOffer: z.boolean(),
        opensAt: instant.nullable(),
        opensSoon: z.boolean(),
        closesAt: instant.nullable(),
        confirmationOpensDaysBefore: z.number().int().min(0).max(60),
        confirmationDeadlineDaysBefore: z.number().int().min(0).max(60),
        minAge: z.number().int().min(0).max(99),
        reminderHoursBefore: z.number().int().min(0).nullable(),
        /** The declaration by its legal document's key — never an id, which differs between environments. */
        declaration: z.object({ key: z.enum(RACE_DECLARATION_KEYS) }).strict().nullable(),
        external: z.object({ provider: nullableText(120), url: nullableText(2000) }).strict(),
        kitShirt: z.boolean(),
        askHealthNote: z.boolean(),
      })
      .strict(),
    /** The public list's switches (BR-REQ-039-01): which of them are on, never a name. */
    publicList: z
      .object({
        names: z.boolean(),
        waitlist: z.boolean(),
        waitlistCount: z.boolean(),
        count: z.boolean(),
        /** «Clubul pe lista publică» (§753): a file made before the setting existed has none, and takes the default. */
        club: z.enum(PUBLIC_LIST_CLUBS).default(DEFAULT_PUBLIC_LIST_CLUB),
      })
      .strict(),
    hiddenList: z.object({ enabled: z.boolean(), bibStart: z.number().int().min(1).nullable(), counted: z.boolean(), public: z.boolean() }).strict(),
    bib: z
      .object({
        startNumber: z.number().int().min(1),
        colour: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
        /** The design as `readBibDesign` answers: every setting, its pictures' addresses among `media` (roles `bib.*`). */
        design: z.record(z.string(), z.unknown()),
      })
      .strict(),
    /**
     * The volunteer badges' design (§764) as `readBadgeDesign` answers — its header picture's address among
     * `media` (role `badge.header`). Never a volunteer: the roles, their badge colours and their categories
     * travel under `volunteers` (§774). A file made before the badges existed has none, and reads
     * as the platform's own design, so an import over an event shows that difference before anything is kept.
     * Read forgivingly here, before the diff or the import sees the file: a colour no word reads on, a value out
     * of range and a key from a later release are what `readBadgeDesign` makes of them, so the diff shows only
     * what the import would write.
     */
    badges: z
      .object({ design: z.record(z.string(), z.unknown()).transform((design): Record<string, unknown> => ({ ...readBadgeDesign(design) })) })
      .strict()
      .default(() => ({ design: { ...DEFAULT_BADGE_DESIGN } })),
    translations: z.object({ ro: translationSchema, en: translationSchema }).strict(),
  })
  .strict();

export type EventConfig = z.infer<typeof eventConfigSchema>;

/**
 * Where the file came from, and how its event repeated there — **information only**. A series' rule is
 * exported so the person reading the file can see it, and is never applied: a copy is one date, as a
 * duplicate is (`copiedEventValues`), and a rule that was imported would start making dates on its own at
 * the next maintenance pass, in an environment nobody meant a series in. The safer of the two answers
 * the brief offered; `DECISIONS.md` §751 says why.
 */
const seriesSchema = z
  .object({
    /** The date was made by a series' rule, or is a series' source. */
    partOfASeries: z.boolean(),
    rule: z
      .object({ cadence: text(20), weekdays: z.array(z.number().int().min(1).max(7)).max(7), until: z.string().nullable() })
      .strict()
      .nullable(),
  })
  .strict();

/**
 * An event's volunteer categories and roles (§774, amending §751 and §754) — the words, never a person: see `volunteers.ts`. A role names
 * its category by its place in `categories` (null for «Alte activități»), never by an id; a place that points at none is read as null. A file
 * made before the categories existed has none, and reads as an event with no roles to bring.
 */
export const volunteersFileSchema = z
  .object({
    categories: z
      .array(
        z
          .object({
            name: z.object({ ro: text(80), en: text(80) }).strict(),
            /** The contact person the club set for the category's volunteers, or null while none is set. */
            contact: z.object({ name: nullableText(120), phone: nullableText(40), email: nullableText(320) }).strict().nullable(),
          })
          .strict(),
      )
      .max(12),
    roles: z
      .array(
        z
          .object({
            name: z.object({ ro: text(80), en: text(80) }).strict(),
            /** How many people the role needs; null is «fără număr» (§784): any number, never full. */
            needed: z.number().int().min(1).max(1000).nullable(),
            /** The description's document in each language, both or neither; read strictly by the editor's own schema at import. */
            description: z.object({ ro: richDocument, en: richDocument }).strict(),
            colour: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
            category: z.number().int().nullable(),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export type VolunteersFile = z.infer<typeof volunteersFileSchema>;

export const eventFileSchema = z
  .object({
    format: z.literal(EVENT_FILE_FORMAT),
    version: z.literal(EVENT_FILE_VERSION),
    exportedAt: instant,
    exportedFrom: z.object({ environment: text(40), baseline: text(40) }).strict(),
    series: seriesSchema,
    event: eventConfigSchema,
    /** The volunteer categories and roles (§774): applied where an event is made new, never over an existing one. */
    volunteers: volunteersFileSchema.default(() => ({ categories: [], roles: [] })),
    media: z.array(mediaEntrySchema).max(MAX_EVENT_FILE_MEDIA),
  })
  .strict();

export type EventFile = z.infer<typeof eventFileSchema>;

/** A version 1 file: the same shape, its race's `durationMinutes` counted from the event's start. */
const eventFileVersion1Schema = eventFileSchema.extend({ version: z.literal(1) });
type EventFileVersion1 = z.infer<typeof eventFileVersion1Schema>;

/** A version 2 file: the same shape, its checkpoints' cut-off a time of the day (§757) where a version 3's is minutes. */
const eventFileVersion2Schema = eventFileSchema.extend({ version: z.literal(2) });

/**
 * A version 1 file as this release's version (§757): a race with a gun and a start whose hour is in
 * the file gets its `durationMinutes` counted from the gun — the minutes from the start less the
 * minutes from the start to the gun — so the import stores the same end the file's event had. Null
 * when that leaves no time limit at all (the old end at or before the gun): such a file is refused
 * rather than imported with a time limit nobody chose.
 */
export function upgradeVersion1(file: EventFileVersion1): EventFile | null {
  const event = file.event;
  let durationMinutes = event.durationMinutes;
  if (event.type === "RACE" && event.raceStartsAt && event.start.date && event.start.time && durationMinutes !== null) {
    const start = fromWallTimeInput(`${event.start.date}T${event.start.time}`, event.timezone);
    if (start) {
      const gunAfterStart = Math.round((new Date(event.raceStartsAt).getTime() - start.getTime()) / 60_000);
      durationMinutes -= gunAfterStart;
      if (durationMinutes <= 0) return null;
    }
  }
  return { ...file, version: EVENT_FILE_VERSION, event: { ...event, durationMinutes } };
}

/**
 * The file's checkpoints as this release means them (§770), whatever version wrote them: a kind this
 * release does not know is left out, and a cut-off written as a time of the day (versions 1 and 2) is
 * converted to minutes from the start by the platform's one converter (`start.ts#minutesFromClock`), when
 * the file says the event's start — the gun on a race that has one, else the start's date and hour — and
 * the clock is after it; otherwise it is left out. **Never a refusal**: each count comes back as a note the
 * page says in words. A cut-off already in minutes is kept as it is, and a file that carries both keeps the
 * minutes.
 */
export function upgradeCheckpoints(file: EventFile): { file: EventFile; notes: FileNote[] } {
  const event = file.event;
  if (event.route.checkpoints.length === 0) return { file, notes: [] };
  const zone = event.timezone;
  const eventStart = event.start.date && event.start.time ? fromWallTimeInput(`${event.start.date}T${event.start.time}`, zone) : null;
  const start = event.type === "RACE" && event.raceStartsAt ? new Date(event.raceStartsAt) : eventStart;
  const startMinutes = start ? clockMinutes(toWallTimeInput(start, zone).slice(11, 16)) : null;
  let kindsDropped = 0;
  let limitsDropped = 0;
  const known = new Set<string>(CHECKPOINT_KINDS);
  const checkpoints = event.route.checkpoints.map((row) => {
    const kinds = row.kinds.filter((kind) => known.has(kind));
    kindsDropped += row.kinds.length - kinds.length;
    let cutoffMinutes = row.cutoffMinutes;
    if (cutoffMinutes === null && row.cutoff) {
      cutoffMinutes = startMinutes === null ? null : minutesFromClock(row.cutoff, startMinutes, event.durationMinutes);
      if (cutoffMinutes === null) limitsDropped += 1;
    }
    // The time of day is read and gone: what comes out has minutes and no `cutoff`.
    return { km: row.km, name: row.name, kinds, cutoffMinutes, note: row.note, onProfile: row.onProfile };
  });
  const notes: FileNote[] = [];
  if (kindsDropped > 0) notes.push({ code: "checkpointKindsDropped", count: kindsDropped });
  if (limitsDropped > 0) notes.push({ code: "checkpointLimitsDropped", count: limitsDropped });
  return { file: { ...file, event: { ...event, route: { ...event.route, checkpoints } } }, notes };
}

/**
 * The file as it is downloaded: readable, two spaces, a newline at the end. The size the reader measures is this one's.
 *
 * A checkpoint's tick «Arată pe profilul traseului» (`onProfile`, §802) is written only when it is **off**: «on» is what a
 * file without it means, and leaving it out keeps a file whose points are all ticked readable by the release before the tick
 * existed (its checkpoint schema refuses a key it does not know) — QA ships a day before production, and its files travel.
 * The same for the route's `showRouteProfile` (§802, §NNN): written only when it is **off**; the file's version stays 3,
 * because a reader without the key reads «on» and a file with it, when off, is the only one an older release would refuse.
 */
export const serializeEventFile = (file: EventFile): string =>
  `${JSON.stringify(file, (key, value) => ((key === "onProfile" || key === "showRouteProfile") && value === true ? undefined : value), 2)}\n`;

/** Why a file was refused, as a code the page says in words (`Admin.eventJson.refusals.<code>`). */
export type EventFileRefusal = "tooLarge" | "notJson" | "notAnEventFile" | "unknownVersion" | "invalid";

/**
 * What reading adjusted, said in `Admin.eventJson.notes.<code>` (§770): the file is read forgivingly, and a
 * person is told what was left out rather than finding the checkpoints different afterwards.
 */
export type FileNote =
  /** `count` kinds this release does not know were left out of the checkpoints. */
  | { code: "checkpointKindsDropped"; count: number }
  /** `count` cut-offs of an older file could not be counted from the start (none in the file, or at or before it) and were left out. */
  | { code: "checkpointLimitsDropped"; count: number };

export type ReadEventFile = { ok: true; file: EventFile; notes: FileNote[] } | { ok: false; refusal: EventFileRefusal; detail?: string };

/**
 * The file's text read into an event file, or the reason it is not one — in the order a person would
 * ask: is it small enough, is it JSON, is it one of ours, is it a version this release reads, and does
 * every part have the shape. The detail of an `invalid` file is the paths that did not fit, never a value.
 */
export function readEventFile(raw: string): ReadEventFile {
  if (new TextEncoder().encode(raw).byteLength > MAX_EVENT_FILE_BYTES) return { ok: false, refusal: "tooLarge" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, refusal: "notJson" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || (parsed as { format?: unknown }).format !== EVENT_FILE_FORMAT) {
    return { ok: false, refusal: "notAnEventFile" };
  }
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "number" || !EVENT_FILE_VERSIONS_READ.includes(version)) return { ok: false, refusal: "unknownVersion" };
  const checked = version === 1 ? eventFileVersion1Schema.safeParse(parsed) : version === 2 ? eventFileVersion2Schema.safeParse(parsed) : eventFileSchema.safeParse(parsed);
  if (!checked.success) {
    const paths = [...new Set(checked.error.issues.map((issue) => issue.path.join(".")).filter((path) => path !== ""))].slice(0, 8);
    return { ok: false, refusal: "invalid", detail: paths.join(", ") };
  }
  let file: EventFile;
  if (checked.data.version === 1) {
    const upgraded = upgradeVersion1(checked.data);
    if (!upgraded) return { ok: false, refusal: "invalid", detail: "event.durationMinutes" };
    file = upgraded;
  } else {
    file = { ...checked.data, version: EVENT_FILE_VERSION };
  }
  const { file: read, notes } = upgradeCheckpoints(file);
  return { ok: true, file: read, notes };
}
