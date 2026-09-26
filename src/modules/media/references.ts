import { and, desc, eq, lt, not, type SQL, sql } from "drizzle-orm";
import { eventTranslations, events } from "@/db/schema/events";
import { galleryAlbumTranslations, galleryAlbums, galleryItems, mediaAssets } from "@/db/schema/gallery";
import { pageTranslations } from "@/db/schema/pages";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { canEditEventFields, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { bodyImageSrc, deleteAssetObjects, getStorage, objectKey } from "./storage";

/**
 * Where a stored picture is used, and what happens to one that is used nowhere
 * (AGENTS.md §17 "reference check before delete"; `DECISIONS.md` §73).
 *
 * A `media_assets` row is referenced by a gallery item, an album cover, or a body — a page's
 * `body_json`, an event translation's `body_json`, `excerpt_json`, `rules_json`, `schedule_json` or
 * `route_description` (§387: the map is a picture in that text) — where the image node
 * carries the variant's address and that address contains the asset's opaque `key_prefix`. Drafts count: a picture in a draft is
 * a picture somebody is about to publish, and the sweep must never take it. The check is one
 * SQL predicate, used by the sweep, the media list and the delete, so the three cannot
 * disagree about what "in use" means.
 *
 * The body check is a text search for the prefix inside the JSON rather than a JSON path
 * query, deliberately: the prefix is a UUID, which cannot occur in a body by accident, and a
 * `LIKE` over a few hundred rows every fifteen minutes is nothing — while a JSON path would
 * have to know the node shape, which is the schema module's business and nobody else's.
 */

/** How long a picture may go unreferenced before the sweep takes it. */
export const ORPHAN_ASSET_DAYS = 7;

/** The sweep advances `last_referenced_at` at most this often, so it is not rewriting every referenced row every run. */
const TOUCH_INTERVAL_HOURS = 1;

/**
 * `key_prefix` as a `LIKE` needle, with `_` escaped so it is never read as a single-character
 * wildcard (found by re-review, `DECISIONS.md` §403). Every prefix used to be a UUID, which
 * cannot contain one — a poster's is `yt-<videoId>` (`modules/media/video-poster.ts`), and a
 * YouTube video id may carry an underscore, which without escaping matches any character there
 * and over-retains an orphan poster the sweep should have taken.
 */
const keyPrefixNeedle = sql`'%' || REPLACE(${mediaAssets.keyPrefix}, '_', '\\_') || '%'`;

/**
 * The address a picture had before the older pictures' button moved it (§430), as a needle: for
 * a version-8 prefix the same UUID with its version digit back at 4 (`formerKeyPrefixOf`), and
 * for any other prefix NULL, which matches nothing. A text saved with the old address after the
 * move — a new page's or a new event's form open since before the press, which has no version to
 * be refused on — still names the picture, whose old files are kept for exactly that; without
 * this the sweep or a delete would take the picture, and those files with it. A UUID cannot occur
 * in a body by accident, and for a picture uploaded with its ladder the former address was never
 * written anywhere.
 */
const formerKeyPrefixNeedle = sql`CASE WHEN ${mediaAssets.keyPrefix} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-8' THEN '%' || overlay(${mediaAssets.keyPrefix} placing '4' from 15 for 1) || '%' END`;

/** Whether a text names the asset, at its address or at its former one (§430). */
const names = (text: SQL): SQL =>
  sql`(${text} LIKE ${keyPrefixNeedle} ESCAPE '\\' OR ${text} LIKE ${formerKeyPrefixNeedle})`;

/**
 * Whether one event translation carries the asset in any of its rich texts. Every text the editor
 * lets a picture into is here — the summary, the description, the rules, the programme's notes and
 * the route description (§387) — because a text left out is a picture the sweep deletes from a
 * page that shows it. The rules and the programme's notes were missing until §387.
 */
const inEventTranslation = sql`(${names(sql`${eventTranslations.bodyJson}::text`)}
    OR ${names(sql`${eventTranslations.excerptJson}::text`)}
    OR ${names(sql`${eventTranslations.rulesJson}::text`)}
    OR ${names(sql`${eventTranslations.scheduleJson}::text`)}
    OR ${names(sql`${eventTranslations.routeDescriptionJson}::text`)})`;

const referencedSomewhere = sql`(
  EXISTS (SELECT 1 FROM ${galleryItems} WHERE ${galleryItems.mediaAssetId} = ${mediaAssets.id})
  OR EXISTS (SELECT 1 FROM ${galleryAlbums} WHERE ${galleryAlbums.coverMediaAssetId} = ${mediaAssets.id})
  OR EXISTS (SELECT 1 FROM ${pageTranslations} WHERE ${names(sql`${pageTranslations.bodyJson}::text`)})
  OR EXISTS (SELECT 1 FROM ${eventTranslations} WHERE ${inEventTranslation})
  -- An event's own film poster (DECISIONS.md §403): the address is stored on the event row
  -- itself, not a translation, and carries the poster's key prefix as an ordinary path segment —
  -- the same substring check every other body uses.
  OR EXISTS (SELECT 1 FROM ${events} WHERE ${names(sql`${events.videoPosterUrl}`)})
)`;

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);

/**
 * The orphan sweep: rides on the registration-maintenance job, last and in its own try/catch.
 *
 * Two statements and a loop. First, every referenced asset is marked as seen (throttled to
 * once an hour, so a quiet site writes nothing). Then every asset nothing has referenced for
 * `ORPHAN_ASSET_DAYS` — and that is at least that old, so a picture uploaded into an editor
 * and not yet saved keeps its grace — is deleted: the row first, in a statement that re-checks
 * the reference so a body saved a moment ago wins, then the two objects, best effort, exactly
 * as the gallery deletes a photo. A failed object delete is a stray object in the bucket and
 * not a reason to keep a row that says the picture exists.
 */
export async function sweepOrphanAssets<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<number> {
  await db
    .update(mediaAssets)
    .set({ lastReferencedAt: now })
    .where(
      and(
        referencedSomewhere,
        lt(mediaAssets.lastReferencedAt, new Date(now.getTime() - TOUCH_INTERVAL_HOURS * 60 * 60_000)),
      ),
    );

  const cutoff = daysBefore(now, ORPHAN_ASSET_DAYS);
  const candidates = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(not(referencedSomewhere), lt(mediaAssets.lastReferencedAt, cutoff), lt(mediaAssets.createdAt, cutoff)));
  if (candidates.length === 0) return 0;

  const storage = getStorage();
  let deleted = 0;
  for (const candidate of candidates) {
    const [row] = await db
      .delete(mediaAssets)
      .where(and(eq(mediaAssets.id, candidate.id), not(referencedSomewhere)))
      .returning({ keyPrefix: mediaAssets.keyPrefix });
    if (!row) continue;
    await deleteAssetObjects(storage, row.keyPrefix);
    deleted += 1;
  }
  return deleted;
}

/** The figures `/devs` shows: how many pictures, how many used nowhere, how many the next sweep takes. */
export async function countMediaAssets<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<{ total: number; unreferenced: number; sweepable: number }> {
  const cutoff = daysBefore(now, ORPHAN_ASSET_DAYS);
  const [row] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      unreferenced: sql<number>`count(*) FILTER (WHERE NOT ${referencedSomewhere})`.mapWith(Number),
      sweepable: sql<number>`count(*) FILTER (WHERE NOT ${referencedSomewhere} AND ${mediaAssets.lastReferencedAt} < ${cutoff} AND ${mediaAssets.createdAt} < ${cutoff})`.mapWith(Number),
    })
    .from(mediaAssets);
  return row ?? { total: 0, unreferenced: 0, sweepable: 0 };
}

export type MediaReference = { kind: "album" | "page" | "event"; id: string; title: string | null };

export type MediaAssetRow = {
  id: string;
  keyPrefix: string;
  originalFilename: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: Date;
  uploadedByName: string | null;
  /** The variant addresses, for the list and the picker — `webUrl` in the shape a body carries. */
  webUrl: string;
  thumbUrl: string;
  /**
   * The same picture's *absolute* address, which `webUrl` is not: a body stores a path when
   * the bucket is this app (local and test storage), because a body outlives a hostname
   * (§8, BR-REQ-101-02). Somebody pasting a picture into a newsletter or a Facebook post needs
   * the whole address, so the list carries both rather than making the page rebuild one.
   */
  publicWebUrl: string;
  references: MediaReference[];
};

/**
 * What the bucket holds, in bytes: summed from the rows the list already read rather than
 * asked of the database again, so the figure at the top of the page and the rows under it
 * cannot disagree. `byte_size` is the web variant — the thumbnail beside it is a few
 * kilobytes, and the page says so instead of pretending this is the object count.
 */
export function totalMediaBytes(rows: readonly Pick<MediaAssetRow, "byteSize">[]): number {
  return rows.reduce((sum, row) => sum + row.byteSize, 0);
}

/**
 * Every stored picture, newest first, with everywhere it is used — so an organizer can see
 * what a picture is and where before deciding anything about it. Four queries and a merge:
 * the assets, then each kind of reference joined to its title in the reader's locale.
 */
export async function listMediaAssetsForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
): Promise<MediaAssetRow[]> {
  const storage = getStorage();

  const assets = await db
    .select({
      id: mediaAssets.id,
      keyPrefix: mediaAssets.keyPrefix,
      originalFilename: mediaAssets.originalFilename,
      width: mediaAssets.width,
      height: mediaAssets.height,
      byteSize: mediaAssets.byteSize,
      createdAt: mediaAssets.createdAt,
      uploadedByName: staffUsers.displayName,
    })
    .from(mediaAssets)
    .leftJoin(staffUsers, eq(staffUsers.id, mediaAssets.createdByStaffUserId))
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id));

  const inAlbums = await db
    .select({ assetId: galleryItems.mediaAssetId, id: galleryItems.albumId, title: galleryAlbumTranslations.title })
    .from(galleryItems)
    .leftJoin(
      galleryAlbumTranslations,
      and(eq(galleryAlbumTranslations.albumId, galleryItems.albumId), eq(galleryAlbumTranslations.locale, locale)),
    );

  const inPages = await db
    .select({ assetId: mediaAssets.id, id: pageTranslations.pageId, title: pageTranslations.title, locale: pageTranslations.locale })
    .from(mediaAssets)
    // At the address or the former one (§430), as the check that refuses a delete reads it: a
    // picture the list shows as used nowhere must not be one the delete then refuses.
    .innerJoin(pageTranslations, names(sql`${pageTranslations.bodyJson}::text`));

  const inEvents = await db
    .select({ assetId: mediaAssets.id, id: eventTranslations.eventId, title: eventTranslations.title, locale: eventTranslations.locale })
    .from(mediaAssets)
    .innerJoin(eventTranslations, inEventTranslation);

  const references = new Map<string, MediaReference[]>();
  const add = (assetId: string, reference: MediaReference) => {
    const list = references.get(assetId) ?? [];
    // A picture in both languages of one page is one reference, named in the reader's locale
    // when that translation carries it and in the other otherwise.
    const existing = list.find((r) => r.kind === reference.kind && r.id === reference.id);
    if (existing) {
      if (reference.title && !existing.title) existing.title = reference.title;
      return;
    }
    list.push(reference);
    references.set(assetId, list);
  };
  for (const row of inAlbums) add(row.assetId, { kind: "album", id: row.id, title: row.title });
  for (const row of [...inPages].sort((a) => (a.locale === locale ? -1 : 1))) {
    add(row.assetId, { kind: "page", id: row.id, title: row.title });
  }
  for (const row of [...inEvents].sort((a) => (a.locale === locale ? -1 : 1))) {
    add(row.assetId, { kind: "event", id: row.id, title: row.title });
  }

  return assets.map((asset) => ({
    ...asset,
    webUrl: bodyImageSrc(objectKey(asset.keyPrefix, "web")),
    publicWebUrl: storage.publicUrl(objectKey(asset.keyPrefix, "web")),
    thumbUrl: storage.publicUrl(objectKey(asset.keyPrefix, "thumb")),
    references: references.get(asset.id) ?? [],
  }));
}

/**
 * Delete a picture by hand — the same roles that remove a gallery photo — and only when it
 * is used nowhere: a picture in a body is that page's, and taking it away would leave a broken
 * image on a published page. The list says where it is used; remove it there first.
 */
export async function deleteMediaAsset<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: { id: string; role: StaffRole }; assetId: string },
): Promise<void> {
  if (!canEditEventFields(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not delete a picture`);
  }
  const [asset] = await db
    .select({ id: mediaAssets.id, referenced: sql<boolean>`${referencedSomewhere}` })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, input.assetId))
    .limit(1);
  if (!asset) throw new DomainError("NOT_FOUND", "no such picture");
  if (asset.referenced) throw new DomainError("VALIDATION_ERROR", "the picture is used on a page, an event or in an album");

  const [row] = await db
    .delete(mediaAssets)
    .where(and(eq(mediaAssets.id, input.assetId), not(referencedSomewhere)))
    .returning({ keyPrefix: mediaAssets.keyPrefix });
  if (!row) throw new DomainError("VALIDATION_ERROR", "the picture is used on a page, an event or in an album");

  const storage = getStorage();
  await deleteAssetObjects(storage, row.keyPrefix);
}
