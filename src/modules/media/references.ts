import { and, desc, eq, inArray, isNotNull, lt, not, type SQL, sql } from "drizzle-orm";
import { eventTranslations } from "@/db/schema/events";
import { galleryAlbumTranslations, galleryAlbums, galleryItems, mediaAssets } from "@/db/schema/gallery";
import { pageTranslations } from "@/db/schema/pages";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers } from "@/db/schema/staff-users";
import { faqQuestions } from "@/db/schema/faq";
import { teamMembers } from "@/db/schema/team";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { FAQ_PAGE_SETTING_KEY } from "@/modules/content/faq/page-settings";
import { MEMBERS_PAGE_SETTING_KEY } from "@/modules/content/members/page-settings";
import { TEAM_PAGE_SETTING_KEY } from "@/modules/content/team/page-settings";
import { isEditorial, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { bodyImageSrc, deleteAssetObjects, getStorage, objectKey } from "./storage";

/**
 * Where a stored picture is used, and what happens to one used nowhere (AGENTS.md §17; §73).
 *
 * One SQL predicate decides "in use" for the sweep, the media list and the delete, so they
 * cannot disagree. Drafts count. A body is searched as text for the key prefix, not by JSON
 * path: a UUID cannot occur by accident, and the node shape stays the schema module's business.
 */

/** How long a picture may go unreferenced before the sweep takes it. */
export const ORPHAN_ASSET_DAYS = 7;

/** How often at most the sweep rewrites `last_referenced_at` on a referenced row. */
const TOUCH_INTERVAL_HOURS = 1;

/**
 * `key_prefix` as a `LIKE` needle, `_` escaped: a poster's `yt-<videoId>` may contain one, which
 * would otherwise match any character and keep an orphan poster (§403).
 */
const keyPrefixNeedle = sql`'%' || REPLACE(${mediaAssets.keyPrefix}, '_', '\\_') || '%'`;

/**
 * The pre-§430 address as a needle (version digit back at 4; NULL, matching nothing, for any
 * other prefix): a form open since before the conversion may still save the old address, whose
 * files are kept for exactly that.
 */
const formerKeyPrefixNeedle = sql`CASE WHEN ${mediaAssets.keyPrefix} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-8' THEN '%' || overlay(${mediaAssets.keyPrefix} placing '4' from 15 for 1) || '%' END`;

/** Whether a text names the asset, at its address or at its former one (§430). */
const names = (text: SQL): SQL =>
  sql`(${text} LIKE ${keyPrefixNeedle} ESCAPE '\\' OR ${text} LIKE ${formerKeyPrefixNeedle})`;

/**
 * Whether one event translation carries the asset in any rich text. Every text that takes a
 * picture must be here, or the sweep deletes a picture a page shows (§387).
 */
const inEventTranslation = sql`(${names(sql`${eventTranslations.bodyJson}::text`)}
    OR ${names(sql`${eventTranslations.excerptJson}::text`)}
    OR ${names(sql`${eventTranslations.rulesJson}::text`)}
    OR ${names(sql`${eventTranslations.scheduleJson}::text`)}
    OR ${names(sql`${eventTranslations.routeDescriptionJson}::text`)})`;

/** A team card's bio, either language (§474). */
const inTeamBio = sql`(${names(sql`${teamMembers.bioRoJson}::text`)} OR ${names(sql`${teamMembers.bioEnJson}::text`)})`;

/** The team page's introduction, both languages in one `platform_settings` row (§474). */
const inTeamIntro = sql`(${platformSettings.key} = ${TEAM_PAGE_SETTING_KEY} AND ${names(sql`${platformSettings.value}::text`)})`;

/** An FAQ answer, either language (§525). */
const inFaqAnswer = sql`(${names(sql`${faqQuestions.answerRoJson}::text`)} OR ${names(sql`${faqQuestions.answerEnJson}::text`)})`;

/** The FAQ page's introduction (§525). */
const inFaqIntro = sql`(${platformSettings.key} = ${FAQ_PAGE_SETTING_KEY} AND ${names(sql`${platformSettings.value}::text`)})`;

/** The members' pages, both in one `platform_settings` row (§524). */
const inMembersPage = sql`(${platformSettings.key} = ${MEMBERS_PAGE_SETTING_KEY} AND ${names(sql`${platformSettings.value}::text`)})`;

const referencedSomewhere = sql`(
  EXISTS (SELECT 1 FROM ${galleryItems} WHERE ${galleryItems.mediaAssetId} = ${mediaAssets.id})
  OR EXISTS (SELECT 1 FROM ${galleryAlbums} WHERE ${galleryAlbums.coverMediaAssetId} = ${mediaAssets.id})
  OR EXISTS (SELECT 1 FROM ${pageTranslations} WHERE ${names(sql`${pageTranslations.bodyJson}::text`)})
  OR EXISTS (SELECT 1 FROM ${eventTranslations} WHERE ${inEventTranslation})
  -- No events.video_poster_url any more (§485): a film is a figure in the description, whose
  -- poster the event translation's own body names above (migration 0092 carried every stored
  -- poster there). The column is unread and leaves the database in BR-V2.11 (§491).
  -- A card of «Echipa» (§459): its photo, by id, hidden cards included — a card being prepared
  -- is a card somebody is about to show.
  OR EXISTS (SELECT 1 FROM ${teamMembers} WHERE ${teamMembers.photoMediaAssetId} = ${mediaAssets.id})
  -- A picture in the words about a person (§474), by address, as every other text is read.
  OR EXISTS (SELECT 1 FROM ${teamMembers} WHERE ${inTeamBio})
  -- A picture in the team page's introduction (§474), kept in its platform setting.
  OR EXISTS (SELECT 1 FROM ${platformSettings} WHERE ${inTeamIntro})
  -- A picture in an answer of «Întrebări frecvente» (§525), hidden questions included, and in
  -- the page's introduction.
  OR EXISTS (SELECT 1 FROM ${faqQuestions} WHERE ${inFaqAnswer})
  OR EXISTS (SELECT 1 FROM ${platformSettings} WHERE ${inFaqIntro})
  -- A picture in the members' pages (§524), kept in their platform setting.
  OR EXISTS (SELECT 1 FROM ${platformSettings} WHERE ${inMembersPage})
)`;

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);

/**
 * The orphan sweep, run last in the registration-maintenance job. Marks referenced assets seen
 * (hourly at most), then deletes each asset unreferenced and uncreated for `ORPHAN_ASSET_DAYS`
 * (an unsaved upload keeps its grace): the row first, re-checking the reference so a body saved
 * a moment ago wins, then its objects best effort — a stray object beats a row that lies.
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

/**
 * Deletes the rows among `assetIds` that nothing references any more, in the caller's
 * transaction, and answers their key prefixes for the caller to remove after commit. For a
 * removal of one use (an album photo), since a picture may be used in several places (§485).
 */
export async function deleteAssetsNoLongerReferenced<T extends Record<string, unknown>>(
  db: Database<T>,
  assetIds: readonly string[],
): Promise<string[]> {
  if (assetIds.length === 0) return [];
  const rows = await db
    .delete(mediaAssets)
    .where(and(inArray(mediaAssets.id, [...assetIds]), not(referencedSomewhere)))
    .returning({ keyPrefix: mediaAssets.keyPrefix });
  return rows.map((row) => row.keyPrefix);
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

export type MediaReference = { kind: "album" | "page" | "event" | "team" | "teamIntro" | "faq" | "membersPage"; id: string; title: string | null };

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
  /** The absolute address, for pasting elsewhere; `webUrl` may be a path (§8, BR-REQ-101-02). */
  publicWebUrl: string;
  references: MediaReference[];
};

/**
 * Bytes stored, summed from the rows already read so the total and the rows agree. A lower
 * bound: `byte_size` is the web variant only.
 */
export function totalMediaBytes(rows: readonly Pick<MediaAssetRow, "byteSize">[]): number {
  return rows.reduce((sum, row) => sum + row.byteSize, 0);
}

/** The same sum as one aggregate, for Costuri's R2 line (§479); likewise a lower bound. */
export async function storedMediaBytes<T extends Record<string, unknown>>(db: Database<T>): Promise<number> {
  const [row] = await db.select({ total: sql<string | null>`coalesce(sum(${mediaAssets.byteSize}), 0)` }).from(mediaAssets);
  return Number(row?.total ?? 0);
}

/** Every stored picture, newest first, with everywhere it is used, titled in the reader's locale. */
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
    // Same predicate as the delete (§430), so the list and the refusal agree.
    .innerJoin(pageTranslations, names(sql`${pageTranslations.bodyJson}::text`));

  const inEvents = await db
    .select({ assetId: mediaAssets.id, id: eventTranslations.eventId, title: eventTranslations.title, locale: eventTranslations.locale })
    .from(mediaAssets)
    .innerJoin(eventTranslations, inEventTranslation);

  const inTeam = await db
    .select({ assetId: teamMembers.photoMediaAssetId, id: teamMembers.id, title: teamMembers.name })
    .from(teamMembers)
    .where(isNotNull(teamMembers.photoMediaAssetId));

  // §474.
  const inTeamBios = await db
    .select({ assetId: mediaAssets.id, id: teamMembers.id, title: teamMembers.name })
    .from(mediaAssets)
    .innerJoin(teamMembers, inTeamBio);
  const inTeamIntros = await db
    .select({ assetId: mediaAssets.id })
    .from(mediaAssets)
    .innerJoin(platformSettings, inTeamIntro);
  // Any FAQ answer or the introduction is one reference, the page (§525).
  const inFaq = await db
    .select({ assetId: mediaAssets.id })
    .from(mediaAssets)
    .where(sql`EXISTS (SELECT 1 FROM ${faqQuestions} WHERE ${inFaqAnswer}) OR EXISTS (SELECT 1 FROM ${platformSettings} WHERE ${inFaqIntro})`);
  const inMembersPages = await db
    .select({ assetId: mediaAssets.id })
    .from(mediaAssets)
    .innerJoin(platformSettings, inMembersPage);

  const references = new Map<string, MediaReference[]>();
  const add = (assetId: string, reference: MediaReference) => {
    const list = references.get(assetId) ?? [];
    // Both languages of one page are one reference, titled in the reader's locale when possible.
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
  for (const row of inTeam) if (row.assetId) add(row.assetId, { kind: "team", id: row.id, title: row.title });
  for (const row of inTeamBios) add(row.assetId, { kind: "team", id: row.id, title: row.title });
  for (const row of inTeamIntros) add(row.assetId, { kind: "teamIntro", id: TEAM_PAGE_SETTING_KEY, title: null });
  for (const row of inFaq) add(row.assetId, { kind: "faq", id: FAQ_PAGE_SETTING_KEY, title: null });
  for (const row of inMembersPages) add(row.assetId, { kind: "membersPage", id: MEMBERS_PAGE_SETTING_KEY, title: null });

  return assets.map((asset) => ({
    ...asset,
    webUrl: bodyImageSrc(objectKey(asset.keyPrefix, "web")),
    publicWebUrl: storage.publicUrl(objectKey(asset.keyPrefix, "web")),
    thumbUrl: storage.publicUrl(objectKey(asset.keyPrefix, "thumb")),
    references: references.get(asset.id) ?? [],
  }));
}

/** Delete a picture by hand (editorial roles), only when it is used nowhere. */
export async function deleteMediaAsset<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: { id: string; role: StaffRole }; assetId: string },
): Promise<void> {
  if (!isEditorial(input.actor.role)) {
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
