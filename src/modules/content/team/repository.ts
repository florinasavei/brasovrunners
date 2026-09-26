import { asc, eq } from "drizzle-orm";
import { mediaAssets } from "@/db/schema/gallery";
import { teamMembers } from "@/db/schema/team";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { getStorage, objectKey } from "@/modules/media/storage";
import { storedTeamDoc } from "./fields";
import { readTeamLinks, type TeamLink, type TeamLinkKind, teamLinkLabel } from "./links";
import { readTeamPageSettings, teamIntroFor } from "./page-settings";

/**
 * Reads for «Echipa» (§459, grown by §NNN), public and backoffice.
 *
 * The public read names its columns (BR-REQ-070-01), reads only the cards shown on the site, and
 * gives each card the words of the page's own language alone: what the person does and the words
 * about them are a pair written in both languages or in neither (§352), and a stored half pair —
 * only a hand-made row can hold one — reads as none on both pages, never the other language's text.
 *
 * The words about a person are a rich-text document since §NNN (`bio_*_json`); a row from before
 * reads its plain `bio_*` as paragraphs (`storedTeamDoc`). The links are a list since §NNN
 * (`links`); a row from before reads its one `link` as a row of its guessed kind (`readTeamLinks`).
 */

export type TeamPhoto = {
  /** The master, `web.webp`, which is also what `srcset` is built from (§414). */
  webUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
};

/** One of a person's links as the page draws it: the club's label in this language, or null for the kind's word. */
export type PublicTeamLink = { kind: TeamLinkKind; url: string; label: string | null };

export type PublicTeamMember = {
  id: string;
  name: string;
  role: string | null;
  /** The words about them in this language, as a document, or null. */
  bio: RichTextDoc | null;
  /** The person's links, in the club's order — none, one or up to six. */
  links: PublicTeamLink[];
  photo: TeamPhoto | null;
};

/** What the public page, the header and the sitemap need: the page's state, its words, its cards. */
export type PublicTeamPage = {
  published: boolean;
  /** The club's introduction in this language as a document, or null for the platform's sentence. */
  intro: RichTextDoc | null;
  /** The same introduction's words, for the page's description to search engines; null with it. */
  introText: string | null;
  members: PublicTeamMember[];
};

export type AdminTeamMember = {
  id: string;
  name: string;
  roleRo: string | null;
  roleEn: string | null;
  /** The words about them as the editor opens them: the stored document, or the plain words as paragraphs. */
  bioRo: RichTextDoc | null;
  bioEn: RichTextDoc | null;
  links: TeamLink[];
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
  bioRoJson: teamMembers.bioRoJson,
  bioEnJson: teamMembers.bioEnJson,
  link: teamMembers.link,
  links: teamMembers.links,
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

/** A rich pair's side for this page, or null unless both sides hold something (§352). */
export function docPairFor(locale: Locale, ro: RichTextDoc | null, en: RichTextDoc | null): RichTextDoc | null {
  if (!ro || !en) return null;
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
    bio: docPairFor(locale, storedTeamDoc(row.bioRoJson, row.bioRo), storedTeamDoc(row.bioEnJson, row.bioEn)),
    links: readTeamLinks(row.links, row.link).map((link) => ({ kind: link.kind, url: link.url, label: teamLinkLabel(link, locale) })),
    photo: photoOf(row),
  }));
}

/**
 * The page as a visitor may see it: a DRAFT page shows nobody, whatever the cards say — the page's
 * switch is the first gate, each card's own the second (`page-settings.ts`).
 */
export async function readPublicTeamPage<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<PublicTeamPage> {
  const settings = await readTeamPageSettings(db);
  if (settings.status !== "PUBLISHED") return { published: false, intro: null, introText: null, members: [] };
  const intro = teamIntroFor(locale, settings);
  return { published: true, intro: intro.doc, introText: intro.text, members: await listVisibleTeamMembers(db, locale) };
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

  return rows.map(({ photoKeyPrefix, photoWidth, photoHeight, bioRo, bioEn, bioRoJson, bioEnJson, link, links, ...row }) => ({
    ...row,
    bioRo: storedTeamDoc(bioRoJson, bioRo),
    bioEn: storedTeamDoc(bioEnJson, bioEn),
    links: readTeamLinks(links, link),
    photo: photoOf({ photoKeyPrefix, photoWidth, photoHeight }),
  }));
}

/** Whether a picture id names a stored picture — the save refuses one that does not. */
export async function mediaAssetExists<T extends Record<string, unknown>>(db: Database<T>, assetId: string): Promise<boolean> {
  const [row] = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
  return Boolean(row);
}
