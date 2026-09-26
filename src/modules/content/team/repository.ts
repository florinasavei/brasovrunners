import { asc, eq } from "drizzle-orm";
import { mediaAssets } from "@/db/schema/gallery";
import { teamMembers } from "@/db/schema/team";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { getStorage, objectKey } from "@/modules/media/storage";
import { readTeamPageSettings, teamIntroFor } from "./page-settings";

/**
 * Reads for «Echipa» (§459), public and backoffice.
 *
 * The public read names its columns (BR-REQ-070-01), reads only the cards shown on the site, and
 * gives each card the words of the page's own language alone: what the person does and the words
 * about them are a pair written in both languages or in neither (§352), and a stored half pair —
 * only a hand-made row can hold one — reads as none on both pages, never the other language's text.
 */

export type TeamPhoto = {
  /** The master, `web.webp`, which is also what `srcset` is built from (§414). */
  webUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
};

export type PublicTeamMember = {
  id: string;
  name: string;
  role: string | null;
  bio: string | null;
  /** The one `https://` link the person shares, or null. */
  link: string | null;
  photo: TeamPhoto | null;
};

/** What the public page, the header and the sitemap need: the page's state, its words, its cards. */
export type PublicTeamPage = {
  published: boolean;
  /** The club's introduction in this language, or null for the platform's sentence. */
  intro: string | null;
  members: PublicTeamMember[];
};

export type AdminTeamMember = {
  id: string;
  name: string;
  roleRo: string | null;
  roleEn: string | null;
  bioRo: string | null;
  bioEn: string | null;
  link: string | null;
  photoAssetId: string | null;
  photo: TeamPhoto | null;
  position: number;
  visible: boolean;
  version: number;
  updatedAt: Date;
};

const COLUMNS = {
  id: teamMembers.id,
  name: teamMembers.name,
  roleRo: teamMembers.roleRo,
  roleEn: teamMembers.roleEn,
  bioRo: teamMembers.bioRo,
  bioEn: teamMembers.bioEn,
  link: teamMembers.link,
  photoAssetId: teamMembers.photoMediaAssetId,
  photoKeyPrefix: mediaAssets.keyPrefix,
  photoWidth: mediaAssets.width,
  photoHeight: mediaAssets.height,
  position: teamMembers.position,
  visible: teamMembers.visible,
  version: teamMembers.version,
  updatedAt: teamMembers.updatedAt,
};

function photoOf(row: { photoKeyPrefix: string | null; photoWidth: number | null; photoHeight: number | null }): TeamPhoto | null {
  if (!row.photoKeyPrefix || !row.photoWidth || !row.photoHeight) return null;
  const storage = getStorage();
  return {
    webUrl: storage.publicUrl(objectKey(row.photoKeyPrefix, "web")),
    thumbUrl: storage.publicUrl(objectKey(row.photoKeyPrefix, "thumb")),
    width: row.photoWidth,
    height: row.photoHeight,
  };
}

/** A pair's side for this page, or null unless both sides are written (§352, §354). */
export function pairFor(locale: Locale, ro: string | null, en: string | null): string | null {
  const written = (value: string | null) => (value ?? "").trim() !== "";
  if (!written(ro) || !written(en)) return null;
  return locale === "ro" ? ro : en;
}

/** Every card on the site, in the club's order, in this language. */
export async function listVisibleTeamMembers<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
): Promise<PublicTeamMember[]> {
  const rows = await db
    .select(COLUMNS)
    .from(teamMembers)
    .leftJoin(mediaAssets, eq(mediaAssets.id, teamMembers.photoMediaAssetId))
    .where(eq(teamMembers.visible, true))
    .orderBy(asc(teamMembers.position), asc(teamMembers.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: pairFor(locale, row.roleRo, row.roleEn),
    bio: pairFor(locale, row.bioRo, row.bioEn),
    link: row.link,
    photo: photoOf(row),
  }));
}

/**
 * The page as a visitor may see it: a DRAFT page shows nobody, whatever the cards say — the page's
 * switch is the first gate, each card's own the second (`page-settings.ts`).
 */
export async function readPublicTeamPage<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<PublicTeamPage> {
  const settings = await readTeamPageSettings(db);
  if (settings.status !== "PUBLISHED") return { published: false, intro: null, members: [] };
  return { published: true, intro: teamIntroFor(locale, settings), members: await listVisibleTeamMembers(db, locale) };
}

/** Whether the page is on the site with somebody on it — the header's entry and the sitemap's. */
export function teamPageOnSite(page: PublicTeamPage): boolean {
  return page.published && page.members.length > 0;
}

/** Every card, shown or not, in the club's order — the backoffice screen. */
export async function listTeamMembersForAdmin<T extends Record<string, unknown>>(db: Database<T>): Promise<AdminTeamMember[]> {
  const rows = await db
    .select(COLUMNS)
    .from(teamMembers)
    .leftJoin(mediaAssets, eq(mediaAssets.id, teamMembers.photoMediaAssetId))
    .orderBy(asc(teamMembers.position), asc(teamMembers.createdAt));

  return rows.map(({ photoKeyPrefix, photoWidth, photoHeight, ...row }) => ({
    ...row,
    photo: photoOf({ photoKeyPrefix, photoWidth, photoHeight }),
  }));
}

/** Whether a picture id names a stored picture — the save refuses one that does not. */
export async function mediaAssetExists<T extends Record<string, unknown>>(db: Database<T>, assetId: string): Promise<boolean> {
  const [row] = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
  return Boolean(row);
}
