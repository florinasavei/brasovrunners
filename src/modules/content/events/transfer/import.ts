import { and, eq, ne } from "drizzle-orm";
import { eventTranslations } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { routing, type Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { findCurrentApprovedVersionId } from "@/modules/legal-documents/repository";
import type { RaceDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { readBibDesign, DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import { DEFAULT_BADGE_DESIGN, readBadgeDesign } from "@/modules/volunteers/badges/badge-design";
import { countRegistrationsForEvent } from "@/modules/registrations/repository";
import { canTransferEvents } from "@/modules/staff-identity/domain/roles";
import { getStorage, type Storage } from "@/modules/media/storage";
import { readRouteGpx, type RouteGpx } from "@/modules/events/domain/route-gpx";
import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";
import { replaceCheckpoints } from "@/modules/event-checkpoints/checkpoints";
import { type CheckpointInput, CheckpointRefusal, checkpointContext, prepareCheckpoints } from "@/modules/event-checkpoints/domain/checkpoint";
import { splitDuration } from "../duration";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { missingPublicFields, translationFieldsSchema } from "../fields";
import { type EditableEvent, type EditableTranslation, findTakenSlugs } from "../repository";
import { createEvent, missingPublicEventFields, saveEventAndTranslations, translationColumnsFrom } from "../service";
import { storeRouteGpx } from "../route-gpx";
import { comparable, type ConfigChange, diffConfigs } from "./diff";
import { readEventConfig } from "./export";
import type { EventConfig, EventFile, FileNote } from "./file-format";
import { eventFieldsFromConfig, translationFieldsFromConfig } from "./fields-from-config";
import { importVolunteersFile } from "./volunteers";
import {
  collectMediaRefs,
  describeMedia,
  fetchVerifiedMedium,
  type MediaFailure,
  mapMediaUrls,
  mediaRoleKey,
  type MediaRoleKey,
  readStoredMedium,
  storeCopiedPicture,
} from "./media";

/**
 * Bringing an event in from a JSON file (§751): as a new draft, or over an event after its diff.
 *
 * Both go through the editor's own service — `createEvent` and `saveEventAndTranslations`, behind the
 * posted shape of `fields-from-config.ts` — so the same validation refuses what the editor refuses, the
 * same audit rows are written, a changed capacity goes through the same allocator path (the lock, the
 * count of the places taken, the offers a raised capacity makes), and nothing here is a raw `UPDATE`.
 * What an import never touches, whichever of the two it is: a registration, an invitation, a race
 * number already given, the event's publication state or its status (§28, §331), the site's featured
 * event, and a series' rule.
 *
 * The media are copied first (`media.ts`), before any transaction opens: a download is never held
 * inside the editor's save, which holds the event's lock. A picture copied for an import that the save
 * then refuses is a stored picture nothing names, which the pictures' sweep takes after a week.
 */

type Actor = Pick<StaffUser, "id" | "role">;

/** Why a medium was left out, with the place that named it. */
export type MediaProblem = { role: string; roleKey: MediaRoleKey; reason: MediaFailure };

export type MediaOutcome = { copied: number; reused: number; problems: MediaProblem[] };

/** What the import adjusted on the way, said in `Admin.eventJson.notes.<code>`. */
export type ImportNote =
  | { code: "slugSuffixed"; locale: Locale; slug: string }
  | { code: "publicListOff" }
  | { code: "seriesNotApplied" }
  /** `count` of the file's volunteer categories, contacts or roles the card's own rules refused, so the new event lacks them (§774). */
  | { code: "volunteersSkipped"; count: number }
  /** What reading the file left out of its checkpoints (§770): a kind this release does not know, a time of day that could not be counted from the start. */
  | FileNote;

const allowsHttp = () => env.APP_ENV === "local" || env.APP_ENV === "test";

// --- Media -------------------------------------------------------------------------------------

/** Pictures and files of a target a file's identical ones are not copied again from — by the hash of their bytes. */
type Reusable = {
  images: Map<string, { src: string; assetId: string | null }>;
  gpx: Map<string, RouteGpx>;
};

const NO_REUSE: Reusable = { images: new Map(), gpx: new Map() };

/** A stored picture's address as a text or a design keeps it: site-relative where the store is this site's. */
const storedSrcOf = (url: string) => {
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  return url.startsWith(`${base}/api/media/`) ? url.slice(base.length) : url;
};

/** What the target already holds, by hash, so an import over it copies only what differs. */
async function reusableOf(storage: Storage | null, event: EditableEvent, config: EventConfig, digests: Map<string, string>): Promise<Reusable> {
  const reuse: Reusable = { images: new Map(), gpx: new Map() };
  if (!storage) return reuse;
  const gpx = readRouteGpx(event.routeGpx);
  for (const ref of collectMediaRefs(config)) {
    const digest = digests.get(ref.url);
    if (!digest) continue;
    if (ref.kind === "gpx") {
      if (gpx) reuse.gpx.set(digest, gpx);
    } else if (!reuse.images.has(digest) || ref.role === "cover") {
      reuse.images.set(digest, { src: storedSrcOf(ref.url), assetId: ref.role === "cover" ? event.coverMediaAssetId : null });
    }
  }
  return reuse;
}

type ResolvedMedia = {
  /** The configuration with every picture's address this environment's own; a picture that could not be had is taken out of it. */
  config: EventConfig;
  coverAssetId: string | null;
  routeGpx: RouteGpx | null;
  outcome: MediaOutcome;
};

/**
 * Every medium the file names, made this environment's own: reused from the target when the bytes are
 * the same, fetched, checked and stored otherwise. A medium that cannot be had is listed, never a reason
 * to refuse the event here — the callers decide (a new event leaves it empty; an import over an event
 * refuses, so nothing the event holds is emptied because another site was unreachable).
 */
async function resolveMedia<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; file: EventFile; reuse?: Reusable; fetchImpl?: typeof fetch; now: Date },
): Promise<ResolvedMedia> {
  const { file } = input;
  const reuse = input.reuse ?? NO_REUSE;
  const refs = collectMediaRefs(file.event);
  const storage = refs.length > 0 ? storageOrNull() : null;
  const srcByUrl = new Map<string, string | null>();
  const assetByUrl = new Map<string, string | null>();
  const gpxByUrl = new Map<string, RouteGpx | null>();
  const problems: MediaProblem[] = [];
  let copied = 0;
  let reused = 0;

  for (const ref of refs) {
    const known = ref.kind === "gpx" ? gpxByUrl.has(ref.url) : srcByUrl.has(ref.url);
    if (known) continue;
    const entry = file.media.find((candidate) => candidate.url === ref.url);
    const same = entry?.sha256 ?? null;
    if (ref.kind === "gpx") {
      const found = same ? reuse.gpx.get(same) : undefined;
      if (found) {
        gpxByUrl.set(ref.url, found);
        reused += 1;
        continue;
      }
    } else {
      const found = same ? reuse.images.get(same) : undefined;
      // The cover is held by its id: the same bytes under a text's address are no cover to point it at.
      if (found && (ref.role !== "cover" || found.assetId !== null)) {
        srcByUrl.set(ref.url, found.src);
        assetByUrl.set(ref.url, found.assetId);
        reused += 1;
        continue;
      }
    }
    // A deployed environment without its bucket (SETUP.md §32) can copy nothing: said, not thrown.
    if (!storage) {
      problems.push({ role: ref.role, roleKey: mediaRoleKey(ref.role), reason: "noStorage" });
      if (ref.kind === "gpx") gpxByUrl.set(ref.url, null);
      else srcByUrl.set(ref.url, null);
      continue;
    }
    const fetched = await fetchVerifiedMedium(entry, ref, { allowHttp: allowsHttp(), fetchImpl: input.fetchImpl });
    if (!fetched.ok) {
      problems.push({ role: ref.role, roleKey: mediaRoleKey(ref.role), reason: fetched.reason });
      if (ref.kind === "gpx") gpxByUrl.set(ref.url, null);
      else srcByUrl.set(ref.url, null);
      continue;
    }
    if (ref.kind === "gpx") {
      try {
        gpxByUrl.set(ref.url, await storeRouteGpx(storage as Storage, { bytes: fetched.bytes, name: file.event.route.gpx?.name ?? "traseu.gpx", environment: env.APP_ENV, now: input.now }));
        copied += 1;
      } catch {
        gpxByUrl.set(ref.url, null);
        problems.push({ role: ref.role, roleKey: mediaRoleKey(ref.role), reason: "notAPicture" });
      }
      continue;
    }
    const stored = await storeCopiedPicture(db, storage as Storage, { actorId: input.actor.id, bytes: fetched.bytes, originalFilename: `${ref.role}.webp`, now: input.now });
    if ("refused" in stored) {
      srcByUrl.set(ref.url, null);
      problems.push({ role: ref.role, roleKey: mediaRoleKey(ref.role), reason: stored.refused });
    } else {
      srcByUrl.set(ref.url, stored.src);
      assetByUrl.set(ref.url, stored.assetId);
      copied += 1;
    }
  }

  const cover = file.event.cover;
  const gpx = file.event.route.gpx;
  const config = mapMediaUrls(file.event, (url, kind) => (kind === "gpx" ? url : (srcByUrl.get(url) ?? null)));
  return {
    config,
    coverAssetId: cover ? (assetByUrl.get(cover.url) ?? null) : null,
    routeGpx: gpx ? (gpxByUrl.get(gpx.url) ?? null) : null,
    outcome: { copied, reused, problems },
  };
}

// --- The route's checkpoints ------------------------------------------------------------------

/**
 * The file's checkpoints as rows to write (§757), held to the editor's card's own rules against the
 * file's event — a kilometre within the typed distance, time limits not longer than the event's own
 * «Timp limită» (counted from the gun on a race, else the event's start) and in order along the route —
 * **before anything is written**, so a file whose list the card would refuse is refused whole, naming
 * the rule, and no half-imported event is left behind. The GPX's own length is not read
 * here (the store is not asked before the copy); the typed distance is the length the card measures
 * against first anyway. The file was read forgivingly already (`file-format.ts#upgradeCheckpoints`): an
 * old time of day is minutes by now, or left out with a word.
 */
export function importedCheckpoints(config: EventConfig): Omit<CheckpointInput, "id">[] {
  if (config.route.checkpoints.length === 0) return [];
  const zone = config.timezone;
  const eventStart = config.start.date && config.start.time ? fromWallTimeInput(`${config.start.date}T${config.start.time}`, zone) : null;
  const gun = config.type === "RACE" && config.raceStartsAt ? new Date(config.raceStartsAt) : null;
  const start = gun ?? eventStart;
  // A time limit is a duration, true with or without an hour to count it from: a file made from an event whose hour is
  // «se anunță mai târziu» carries its saved limits, and an import must give them back (the round trip, §770).
  const context = { ...checkpointContext({ distanceMeters: config.measures.distanceMeters, gpxMeters: null, start, limitMinutes: config.durationMinutes }), startKnown: true };
  try {
    return prepareCheckpoints(
      config.route.checkpoints.map((row, index) => ({
        id: "",
        nameRo: row.name.ro,
        nameEn: row.name.en,
        km: String(row.km),
        kinds: row.kinds,
        cutoffHours: splitDuration(row.cutoffMinutes).hours,
        cutoffMinutesPart: splitDuration(row.cutoffMinutes).minutes,
        noteRo: row.note.ro ?? "",
        noteEn: row.note.en ?? "",
        onProfile: row.onProfile,
        remove: false,
        index,
      })),
      context,
    ).map((row) => ({
      nameRo: row.nameRo,
      nameEn: row.nameEn,
      km: row.km,
      kinds: row.kinds,
      cutoffMinutes: row.cutoffMinutes,
      noteRo: row.noteRo,
      noteEn: row.noteEn,
      onProfile: row.onProfile,
    }));
  } catch (error) {
    if (!(error instanceof CheckpointRefusal)) throw error;
    const said = Object.entries(error.values)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ");
    throw new DomainError("VALIDATION_ERROR", `route.checkpoints: the file's checkpoints break the editor's rule ${error.reason} (${said})`, ["route.checkpoints"]);
  }
}

// --- What the declaration, the slugs and the public list become here ---------------------------

async function declarationIdFor<T extends Record<string, unknown>>(db: Database<T>, key: RaceDeclarationKey | null, now: Date): Promise<string | null> {
  if (!key) return null;
  return (await findCurrentApprovedVersionId(db, key, now)) ?? null;
}

/** The first free slug in one language: the file's own, else it with `-2`, `-3`, … — asked of the database, never assumed. */
async function freeSlug<T extends Record<string, unknown>>(db: Database<T>, locale: Locale, slug: string): Promise<string> {
  const candidates = [slug, ...Array.from({ length: 50 }, (_, index) => `${slug.slice(0, 115)}-${index + 2}`)];
  const taken = await findTakenSlugs(db, locale, candidates);
  const free = candidates.find((candidate) => !taken.has(candidate));
  if (!free) throw new DomainError("VALIDATION_ERROR", `there are already 50 copies of "${slug}" in ${locale}; rename one before importing another`, [`translations.${locale}.slug`]);
  return free;
}

/** Which slugs a new event from this file would get, for the page to say before the press. */
export async function slugsForNewEvent<T extends Record<string, unknown>>(db: Database<T>, config: EventConfig): Promise<Record<Locale, string>> {
  const slugs = {} as Record<Locale, string>;
  for (const locale of routing.locales) slugs[locale] = await freeSlug(db, locale, config.translations[locale].slug);
  return slugs;
}

// --- As a new event ----------------------------------------------------------------------------

export type ImportAsNewInput = {
  actor: Actor;
  file: EventFile;
  /** Only for tests: a `fetch` stand-in, for the media and for the YouTube posters. */
  fetchImpl?: typeof fetch;
  now?: Date;
};

export type ImportAsNewResult = { eventId: string; slugs: Record<Locale, string>; media: MediaOutcome; notes: ImportNote[] };

/**
 * «Ca eveniment nou»: a new event, **always a draft** — `createEvent` creates nothing else — with a free
 * slug in each language, its pictures copied into this environment's store, and what the club's own
 * rules say here applied rather than the file's: the declaration is this environment's version in force
 * for the file's key; the public list stays off where the privacy notice that describes it is not yet in
 * force (BR-REQ-039-01); the event is scheduled, a cancellation being its own act; and it is not the one
 * the site leads with.
 */
export async function importEventAsNew<T extends Record<string, unknown>>(db: Database<T>, input: ImportAsNewInput): Promise<ImportAsNewResult> {
  if (!canTransferEvents(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not import an event`);
  }
  const now = input.now ?? new Date();
  const { file } = input;
  const notes: ImportNote[] = [];

  const slugs = await slugsForNewEvent(db, file.event);
  for (const locale of routing.locales) {
    if (slugs[locale] !== file.event.translations[locale].slug) notes.push({ code: "slugSuffixed", locale, slug: slugs[locale] });
  }
  if (file.series.partOfASeries || file.series.rule) notes.push({ code: "seriesNotApplied" });

  const names = file.event.publicList.names;
  const noticeInForce = names ? Boolean(await findCurrentApprovedVersionId(db, "PRIVACY_NOTICE", now)) : true;
  if (names && !noticeInForce) notes.push({ code: "publicListOff" });

  // The checkpoints are held to the card's rules first: a list the card would refuse refuses the file, before any copy.
  const checkpoints = importedCheckpoints(file.event);
  const resolved = await resolveMedia(db, { actor: input.actor, file, fetchImpl: input.fetchImpl, now });
  const declarationDocumentId = await declarationIdFor(db, file.event.registration.declaration?.key ?? null, now);
  const design = readBibDesign(resolved.config.bib.design);

  const fields = eventFieldsFromConfig({
    config: resolved.config,
    coverAssetId: resolved.coverAssetId,
    routeGpx: resolved.routeGpx,
    declarationDocumentId,
    featured: false,
    includeBibDesign: JSON.stringify(design) !== JSON.stringify(DEFAULT_BIB_DESIGN),
    // The volunteer badges' look (§764), by the bib's rule: a new event's column stays null on the platform's own.
    includeBadgeDesign: JSON.stringify(readBadgeDesign(resolved.config.badges.design)) !== JSON.stringify(DEFAULT_BADGE_DESIGN),
    participantListNames: names && noticeInForce,
    eventStatus: "SCHEDULED",
  });
  const created = await createEvent(db, {
    actor: input.actor,
    fields: {
      ...fields,
      translations: {
        ro: translationFieldsFromConfig(resolved.config.translations.ro, slugs.ro),
        en: translationFieldsFromConfig(resolved.config.translations.en, slugs.en),
      },
    },
    now,
    fetchImpl: input.fetchImpl,
  });
  // The route's checkpoints (§757): their own table, written after the event exists, as the card writes them.
  if (checkpoints.length > 0) await replaceCheckpoints(db, input.actor, created.id, checkpoints, now);
  // The volunteers' categories and roles (§774): the card's own services, in the file's order, on the new event alone.
  const volunteers = await importVolunteersFile(db, input.actor, created.id, file.volunteers, now);
  if (volunteers.skipped > 0) notes.push({ code: "volunteersSkipped", count: volunteers.skipped });

  await recordAuditEvent(db, {
    actorStaffUserId: input.actor.id,
    action: "event.imported_as_new",
    entityType: "event",
    entityId: created.id,
    metadata: {
      from: file.exportedFrom,
      exportedAt: file.exportedAt,
      copied: resolved.outcome.copied,
      missing: resolved.outcome.problems.length,
      adjusted: notes.map((note) => note.code),
      volunteerCategories: volunteers.categories,
      volunteerRoles: volunteers.roles,
      volunteersSkipped: volunteers.skipped,
    },
    now,
  });
  return { eventId: created.id, slugs, media: resolved.outcome, notes };
}

// --- Over an existing event --------------------------------------------------------------------

/** The hash of every medium of a configuration, read from this environment's store, by address. */
async function digestsOf(config: EventConfig, storage: Storage | null): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  const entries = await describeMedia(collectMediaRefs(config), async (ref) => (storage ? readStoredMedium(storage, ref) : null));
  for (const entry of entries) if (entry.sha256) digests.set(entry.url, entry.sha256);
  return digests;
}

function storageOrNull(): Storage | null {
  try {
    return getStorage();
  } catch {
    return null;
  }
}

/** The file's own hashes by address — what it says its media are, not what anything holds now. */
const fileDigests = (file: EventFile): Map<string, string> =>
  new Map(file.media.flatMap((entry) => (entry.sha256 ? [[entry.url, entry.sha256] as [string, string]] : [])));

/** Whether the file carries any volunteer category or role (§774). */
export const hasVolunteers = (file: EventFile): boolean =>
  file.volunteers.categories.length > 0 || file.volunteers.roles.length > 0 || file.volunteers.access !== "ANYONE";

/** Both sides of the comparison for a target: the changes, and the digests the pictures were read by. */
async function compare<T extends Record<string, unknown>>(
  db: Database<T>,
  file: EventFile,
  eventId: string,
): Promise<{
  changes: ConfigChange[];
  target: NonNullable<Awaited<ReturnType<typeof readEventConfig>>>;
  targetDigests: Map<string, string>;
  storage: Storage | null;
  /** The event has been public: its page addresses stay, whatever the file says (§11.5), and the diff does not show them as changes. */
  slugsKept: boolean;
}> {
  const target = await readEventConfig(db, eventId);
  if (!target) throw new DomainError("NOT_FOUND", "no such event");
  const storage = storageOrNull();
  const targetDigests = await digestsOf(target.config, storage);
  const incoming = fileDigests(file);
  const slugsKept = target.event.publishedAt !== null;
  const wanted: EventConfig = slugsKept
    ? {
        ...file.event,
        translations: {
          ro: { ...file.event.translations.ro, slug: target.config.translations.ro.slug },
          en: { ...file.event.translations.en, slug: target.config.translations.en.slug },
        },
      }
    : file.event;
  const changes = diffConfigs(
    comparable(wanted, (url) => incoming.get(url) ?? null),
    comparable(target.config, (url) => targetDigests.get(url) ?? null),
  );
  return { changes, target, targetDigests, storage, slugsKept };
}

/** A well-formed stored-picture address, for the one check that reads words and never loads a picture. */
const STAND_IN_PICTURE = "/api/media/stand-in/00000000-0000-4000-8000-000000000000/web.webp";

/**
 * Whether the published event this would change stays publishable (§28): both languages with a title, a
 * page address and a summary, and a place in both — the rules `transitionEvent` asks to publish, asked
 * of the result. `null` when it stays so, or the event is not published; otherwise the reason, in the
 * plain words of the check. Computed from the file as the editor would store it, before anything is written.
 */
export function publicationRefusal(target: EditableEvent, incoming: EventConfig, slugs: Record<Locale, string>): string | null {
  if (target.editorialStatus !== "PUBLISHED") return null;
  // The pictures' addresses are the other environment's until they are copied, and the editor's schema
  // refuses any address that is not this site's own; the check asks about words, so every one is a stand-in.
  const config = mapMediaUrls(incoming, () => STAND_IN_PICTURE);
  const rows: Array<Pick<EditableTranslation, "locale" | "locationName">> = [];
  const missing: string[] = [];
  for (const locale of routing.locales) {
    const parsed = translationFieldsSchema.safeParse(translationFieldsFromConfig(config.translations[locale], slugs[locale]));
    // A text the editor would refuse is refused by the save, with its own words.
    if (!parsed.success) return null;
    const columns = translationColumnsFrom(parsed.data, config.type, false);
    const gaps = missingPublicFields({ title: columns.title, slug: columns.slug, excerpt: columns.excerpt ?? null });
    if (gaps.length > 0) missing.push(`${locale}: ${gaps.join(", ")}`);
    rows.push({ locale, locationName: config.place.name[locale] });
  }
  const place = missingPublicEventFields({ locationName: config.place.name.ro, locationToBeAnnounced: config.place.toBeAnnounced }, rows);
  if (place.length > 0) missing.push(`place: ${place.join(", ")}`);
  return missing.length === 0 ? null : `the event is published, and the file would leave it incomplete — ${missing.join("; ")}`;
}

/** The slugs the target's rows will carry: its own on a published event (a public address), the file's otherwise. */
function slugsOver(target: EditableEvent, rows: readonly EditableTranslation[], config: EventConfig): Record<Locale, string> {
  const slugs = {} as Record<Locale, string>;
  for (const locale of routing.locales) {
    const row = rows.find((candidate) => candidate.locale === locale);
    slugs[locale] = target.publishedAt !== null && row ? row.slug : config.translations[locale].slug;
  }
  return slugs;
}

/** A slug the file brings that another event already has — refused naming the box, never suffixed over an existing event. */
async function assertSlugsFree<T extends Record<string, unknown>>(db: Database<T>, eventId: string, slugs: Record<Locale, string>): Promise<void> {
  for (const locale of routing.locales) {
    const [clash] = await db
      .select({ id: eventTranslations.id })
      .from(eventTranslations)
      .where(and(eq(eventTranslations.locale, locale), eq(eventTranslations.slug, slugs[locale]), ne(eventTranslations.eventId, eventId)))
      .limit(1);
    if (clash) throw new DomainError("VALIDATION_ERROR", `translations.${locale}.slug: another event already has this page address`, [`translations.${locale}.slug`]);
  }
}

export type DiffEventImportResult = {
  changes: ConfigChange[];
  /** What the file names, and whether each medium is already on the event (same bytes) or would be copied. */
  media: Array<{ role: string; roleKey: MediaRoleKey; state: "same" | "copy" | "unverifiable" }>;
  target: {
    id: string;
    version: number;
    translationVersions: Record<Locale, number>;
    titles: Record<Locale, string>;
    published: boolean;
    registrations: number;
  };
  /** Why the import would be refused (a published event it would leave incomplete), or null. */
  refusal: string | null;
  /** The file's series rule, said so it is not mistaken for one that will be applied. */
  seriesNotApplied: boolean;
  /** The file carries volunteer categories or roles, which an import over an existing event never writes (§774): said, so it is not mistaken for one that will be. */
  volunteersNotApplied: boolean;
  /** The event has been public, so its page addresses stay as they are even where the file's differ. */
  slugsKept: boolean;
};

/**
 * The diff of the file against one event, for the page that asks for the confirmation: every field
 * that would change with both sides, the media named, and the event's version and its translations' —
 * which the confirmation hands back to the save, so what is applied is what was shown or it is a CONFLICT.
 * Reads only; writes nothing, copies nothing.
 */
export async function diffEventImport<T extends Record<string, unknown>>(db: Database<T>, input: { actor: Actor; file: EventFile; eventId: string }): Promise<DiffEventImportResult> {
  if (!canTransferEvents(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not import an event`);
  }
  const { changes, target, targetDigests, slugsKept } = await compare(db, input.file, input.eventId);
  const sameHashes = new Set(targetDigests.values());
  const media = input.file.media.map((entry) => ({
    role: entry.role,
    roleKey: mediaRoleKey(entry.role),
    state: entry.sha256 === null ? ("unverifiable" as const) : sameHashes.has(entry.sha256) ? ("same" as const) : ("copy" as const),
  }));
  const slugs = slugsOver(target.event, target.translations, input.file.event);
  const version = (locale: Locale) => target.translations.find((row) => row.locale === locale)?.version ?? 0;
  const title = (locale: Locale) => target.translations.find((row) => row.locale === locale)?.title ?? "";
  return {
    changes,
    media,
    target: {
      id: target.event.id,
      version: target.event.version,
      translationVersions: { ro: version("ro"), en: version("en") },
      titles: { ro: title("ro"), en: title("en") },
      published: target.event.editorialStatus === "PUBLISHED",
      registrations: await countRegistrationsForEvent(db, target.event.id),
    },
    refusal: publicationRefusal(target.event, input.file.event, slugs),
    seriesNotApplied: input.file.series.partOfASeries || input.file.series.rule !== null,
    volunteersNotApplied: hasVolunteers(input.file),
    slugsKept: slugsKept && routing.locales.some((locale) => input.file.event.translations[locale].slug !== target.config.translations[locale].slug),
  };
}

export type ImportOverInput = {
  actor: Actor;
  file: EventFile;
  eventId: string;
  /** The versions the diff was shown for. */
  expectedVersion: number;
  translationVersions: Record<Locale, number>;
  /** The second confirmation, required where `environment` is production: the event's title typed, and the registrations it was shown with. */
  confirmation?: { typedTitle: string; registrations: number };
  /** Only for tests: which environment this is, where it is not `env.APP_ENV`. */
  environment?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export type ImportOverResult = { changed: string[]; media: MediaOutcome; offered: number };

/**
 * «Peste un eveniment existent»: the file written over the event — and only after the diff was shown and
 * confirmed. Through `saveEventAndTranslations`, the editor's own save: the version guards of the event
 * and of each language (a colleague's save since the diff is a CONFLICT), the capacity under the event's
 * lock refused below the places taken, the offers a raised capacity makes, the holds the window moves,
 * the covers' and the lists' own audit rows. Never touched: the registrations, the invitations, the race
 * numbers given, the publication state, the status, the featured mark, the series' rule.
 *
 * - **A published event stays published only if the result is publishable** (§28) — refused with the
 *   reason otherwise, before anything is copied or written. Its page addresses stay (a public address
 *   is never changed by a save, §11.5).
 * - **Production asks twice** — the event's title typed, and the number of registrations it carries as
 *   the diff showed it: a count that moved since is refused.
 * - **Media are all or nothing here**: a picture or file that cannot be had from the file's address is a
 *   refusal naming it, so no cover, no GPX and no picture of a text is emptied because another site was
 *   unreachable.
 */
export async function importEventOver<T extends Record<string, unknown>>(db: Database<T>, input: ImportOverInput): Promise<ImportOverResult> {
  if (!canTransferEvents(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not import an event`);
  }
  const now = input.now ?? new Date();
  const { file } = input;
  const { changes, target, targetDigests, storage } = await compare(db, file, input.eventId);

  const registrations = await countRegistrationsForEvent(db, input.eventId);
  if ((input.environment ?? env.APP_ENV) === "production") {
    const titles = target.translations.map((row) => row.title.trim()).filter((title) => title !== "");
    const accepted = titles.length > 0 ? titles : [input.eventId];
    if (!accepted.includes((input.confirmation?.typedTitle ?? "").trim())) {
      throw new DomainError("VALIDATION_ERROR", "typedTitle: the typed title does not match this event's title", ["typedTitle"]);
    }
    if (input.confirmation?.registrations !== registrations) {
      throw new DomainError("VALIDATION_ERROR", `registrations: the event has ${registrations} registrations now, not the number the confirmation was shown with; look at the diff again`, ["registrations"]);
    }
  }

  if (changes.length === 0) return { changed: [], media: { copied: 0, reused: 0, problems: [] }, offered: 0 };

  const slugs = slugsOver(target.event, target.translations, file.event);
  const refusal = publicationRefusal(target.event, file.event, slugs);
  if (refusal) throw new DomainError("VALIDATION_ERROR", refusal, ["editorialStatus"]);
  await assertSlugsFree(db, input.eventId, slugs);
  // The checkpoints, where the diff showed them changed (§757): held to the card's rules before anything is copied or written.
  const checkpointsChanged = changes.some((change) => change.key === "route.checkpoints");
  const checkpoints = checkpointsChanged ? importedCheckpoints(file.event) : [];

  const resolved = await resolveMedia(db, { actor: input.actor, file, reuse: await reusableOf(storage, target.event, target.config, targetDigests), fetchImpl: input.fetchImpl, now });
  if (resolved.outcome.problems.length > 0) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `a picture or file could not be copied from the file's address, so nothing was changed: ${resolved.outcome.problems.map((problem) => `${problem.role} (${problem.reason})`).join(", ")}`,
      ["media"],
    );
  }

  const sameDeclaration = file.event.registration.declaration?.key === target.config.registration.declaration?.key;
  const declarationDocumentId = sameDeclaration ? target.event.declarationDocumentId : await declarationIdFor(db, file.event.registration.declaration?.key ?? null, now);
  const designChanged = changes.some((change) => change.key.startsWith("bib.design"));
  const badgeDesignChanged = changes.some((change) => change.key.startsWith("badges.design"));
  const coverChanged = changes.some((change) => change.key.startsWith("cover"));
  const gpxChanged = changes.some((change) => change.key.startsWith("route.gpx"));

  const fields = eventFieldsFromConfig({
    config: resolved.config,
    // A picture or file the diff says is the same is left as the event holds it, never written again.
    coverAssetId: coverChanged ? resolved.coverAssetId : undefined,
    routeGpx: gpxChanged ? resolved.routeGpx : undefined,
    declarationDocumentId,
    featured: target.event.featured,
    includeBibDesign: designChanged,
    includeBadgeDesign: badgeDesignChanged,
    participantListNames: file.event.publicList.names,
    eventStatus: target.event.eventStatus,
  });
  const translations = routing.locales.map((locale) => {
    const row = target.translations.find((candidate) => candidate.locale === locale);
    if (!row) throw new DomainError("NOT_FOUND", "no such event translation");
    return {
      translationId: row.id,
      expectedVersion: input.translationVersions[locale],
      fields: translationFieldsFromConfig(resolved.config.translations[locale], slugs[locale]),
    };
  });

  const saved = await saveEventAndTranslations(db, {
    actor: input.actor,
    eventId: input.eventId,
    fields,
    expectedVersion: input.expectedVersion,
    translations,
    // The confirmation of the diff is the acknowledgement a live edit asks for (BR-REQ-051-01 criterion 4).
    acknowledgeLiveEdit: true,
    scope: "this",
    // The names are the file's, exactly: an older event's English must not follow its Romanian (§362).
    placeNamesAsTyped: true,
    // The file's list replaces the saved one below, held to the rules already; else the saved list is held to them against the file's event (§757).
    checkpointsReplaced: checkpointsChanged,
    now,
    fetchImpl: input.fetchImpl,
  });

  // The whole list as the file has it — none for a file that has none, as the diff said.
  if (checkpointsChanged) await replaceCheckpoints(db, input.actor, input.eventId, checkpoints, now);

  const changed = changes.map((change) => change.key);
  await recordAuditEvent(db, {
    actorStaffUserId: input.actor.id,
    action: "event.imported_over",
    entityType: "event",
    entityId: input.eventId,
    metadata: {
      from: file.exportedFrom,
      exportedAt: file.exportedAt,
      changed,
      registrations,
      copied: resolved.outcome.copied,
      offered: saved.offered,
    },
    now,
  });
  return { changed, media: resolved.outcome, offered: saved.offered };
}
