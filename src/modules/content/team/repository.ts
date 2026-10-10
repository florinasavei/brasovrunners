import { asc, eq } from "drizzle-orm";
import { mediaAssets } from "@/db/schema/gallery";
import { teamMembers, teamPageBoxes } from "@/db/schema/team";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import type { ImageCrop, RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { getStorage, objectKey } from "@/modules/media/storage";
import { responsibilityLines, storedTeamDoc, TEAM_PLACEMENTS, type TeamPlacement } from "./fields";
import { storedTeamPhotoCrop } from "./photo-crop";
import { readTeamLinks, type TeamLink, type TeamLinkKind, teamLinkLabel } from "./links";
import { readTeamPageSettings, teamIntroFor } from "./page-settings";

/**
 * Reads for «Echipa» (§459, §474), public and backoffice. The public read names its columns
 * (BR-REQ-070-01), returns shown cards only, and a half-written pair reads as none on both pages
 * (§352). Rows from before §474 read their plain `bio_*` and single `link` (`storedTeamDoc`,
 * `readTeamLinks`).
 */

export type TeamPhoto = {
  /** The master, `web.webp`, which is also what `srcset` is built from (§414). */
  webUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  /** §541: four fractions of the stored picture; null draws the whole photo, a square face-top. */
  crop: ImageCrop | null;
};

/** One of a person's links as the page draws it: the club's label in this language, or null for the kind's word. */
export type PublicTeamLink = { kind: TeamLinkKind; url: string; label: string | null };

export type PublicTeamMember = {
  id: string;
  name: string;
  role: string | null;
  /** The sub-role line under the role (§691), or null unless both languages are written. */
  subtitle: string | null;
  /** «Responsabilități» (§691), one per line, empty unless both languages are written. */
  responsibilities: string[];
  bio: RichTextDoc | null;
  /** In the club's order, up to twelve. */
  links: PublicTeamLink[];
  photo: TeamPhoto | null;
  /** The chart (§691): whom the card answers to, as stored — `buildOrgChart` decides what it means among the shown cards. */
  reportsToId: string | null;
  placement: TeamPlacement;
};

/** One box under the chart (§691) in this language: a heading and the rich text. */
export type PublicTeamBox = { id: string; title: string; body: RichTextDoc };

export type PublicTeamPage = {
  published: boolean;
  /** The club's introduction in this language as a document, or null for the platform's sentence. */
  intro: RichTextDoc | null;
  /** The introduction's words, for the page's meta description. */
  introText: string | null;
  members: PublicTeamMember[];
  /** The shown boxes under the chart, in the club's order (§691). */
  boxes: PublicTeamBox[];
};

export type AdminTeamMember = {
  id: string;
  name: string;
  roleRo: string | null;
  roleEn: string | null;
  subtitleRo: string | null;
  subtitleEn: string | null;
  /** As stored: one responsibility per line. */
  responsibilitiesRo: string | null;
  responsibilitiesEn: string | null;
  reportsToId: string | null;
  placement: TeamPlacement;
  /** The stored document, or the plain words as paragraphs. */
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

export type AdminTeamBox = {
  id: string;
  titleRo: string;
  titleEn: string;
  /** The stored document, or the plain words as paragraphs. */
  bodyRo: RichTextDoc | null;
  bodyEn: RichTextDoc | null;
  position: number;
  visible: boolean;
  version: number;
  updatedAt: Date;
};

/** A stored placement, leniently: anything but a known word reads as `below`. */
function placementOf(value: string): TeamPlacement {
  return (TEAM_PLACEMENTS as readonly string[]).includes(value) ? (value as TeamPlacement) : "below";
}

const COLUMNS = {
  id: teamMembers.id,
  name: teamMembers.name,
  roleRo: teamMembers.roleRo,
  roleEn: teamMembers.roleEn,
  subtitleRo: teamMembers.subtitleRo,
  subtitleEn: teamMembers.subtitleEn,
  responsibilitiesRo: teamMembers.responsibilitiesRo,
  responsibilitiesEn: teamMembers.responsibilitiesEn,
  reportsToId: teamMembers.reportsToId,
  placement: teamMembers.placement,
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
  photoCrop: teamMembers.photoCrop,
  position: teamMembers.position,
  visible: teamMembers.visible,
  version: teamMembers.version,
  updatedAt: teamMembers.updatedAt,
};

function photoOf(row: {
  photoKeyPrefix: string | null;
  photoWidth: number | null;
  photoHeight: number | null;
  photoCrop: unknown;
}): TeamPhoto | null {
  if (!row.photoKeyPrefix || !row.photoWidth || !row.photoHeight) return null;
  const storage = getStorage();
  return {
    webUrl: storage.publicUrl(objectKey(row.photoKeyPrefix, "web")),
    thumbUrl: storage.publicUrl(objectKey(row.photoKeyPrefix, "thumb")),
    width: row.photoWidth,
    height: row.photoHeight,
    crop: storedTeamPhotoCrop(row.photoCrop),
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
    subtitle: pairFor(locale, row.subtitleRo, row.subtitleEn),
    responsibilities: responsibilityLines(pairFor(locale, row.responsibilitiesRo, row.responsibilitiesEn)),
    bio: docPairFor(locale, storedTeamDoc(row.bioRoJson, row.bioRo), storedTeamDoc(row.bioEnJson, row.bioEn)),
    links: readTeamLinks(row.links, row.link).map((link) => ({ kind: link.kind, url: link.url, label: teamLinkLabel(link, locale) })),
    photo: photoOf(row),
    reportsToId: row.reportsToId,
    placement: placementOf(row.placement),
  }));
}

/**
 * The shown boxes under the chart (§691), in the club's order, in this language. A box whose text
 * is written in one language only (a row from before the rule, or a hand-written one) is left out
 * on both pages, as every half pair is (§352); a title is always both.
 */
export async function listVisibleTeamBoxes<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<PublicTeamBox[]> {
  const rows = await db
    .select({
      id: teamPageBoxes.id,
      titleRo: teamPageBoxes.titleRo,
      titleEn: teamPageBoxes.titleEn,
      bodyRo: teamPageBoxes.bodyRo,
      bodyEn: teamPageBoxes.bodyEn,
      bodyRoJson: teamPageBoxes.bodyRoJson,
      bodyEnJson: teamPageBoxes.bodyEnJson,
    })
    .from(teamPageBoxes)
    .where(eq(teamPageBoxes.visible, true))
    .orderBy(asc(teamPageBoxes.position), asc(teamPageBoxes.createdAt));
  const boxes: PublicTeamBox[] = [];
  for (const row of rows) {
    const title = pairFor(locale, row.titleRo, row.titleEn);
    const body = docPairFor(locale, storedTeamDoc(row.bodyRoJson, row.bodyRo), storedTeamDoc(row.bodyEnJson, row.bodyEn));
    if (title && body) boxes.push({ id: row.id, title, body });
  }
  return boxes;
}

/** A DRAFT page shows nobody: the page's switch is the first gate, each card's the second. */
export async function readPublicTeamPage<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<PublicTeamPage> {
  const settings = await readTeamPageSettings(db);
  if (settings.status !== "PUBLISHED") return { published: false, intro: null, introText: null, members: [], boxes: [] };
  const intro = teamIntroFor(locale, settings);
  const [members, boxes] = await Promise.all([listVisibleTeamMembers(db, locale), listVisibleTeamBoxes(db, locale)]);
  return { published: true, intro: intro.doc, introText: intro.text, members, boxes };
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

  return rows.map(({ photoKeyPrefix, photoWidth, photoHeight, photoCrop, bioRo, bioEn, bioRoJson, bioEnJson, link, links, placement, ...row }) => ({
    ...row,
    placement: placementOf(placement),
    bioRo: storedTeamDoc(bioRoJson, bioRo),
    bioEn: storedTeamDoc(bioEnJson, bioEn),
    links: readTeamLinks(links, link),
    photo: photoOf({ photoKeyPrefix, photoWidth, photoHeight, photoCrop }),
  }));
}

/** Every box, shown or not, in the club's order — the backoffice's «Casetele paginii» (§691). */
export async function listTeamBoxesForAdmin<T extends Record<string, unknown>>(db: Database<T>): Promise<AdminTeamBox[]> {
  const rows = await db.select().from(teamPageBoxes).orderBy(asc(teamPageBoxes.position), asc(teamPageBoxes.createdAt));
  return rows.map((row) => ({
    id: row.id,
    titleRo: row.titleRo,
    titleEn: row.titleEn,
    bodyRo: storedTeamDoc(row.bodyRoJson, row.bodyRo),
    bodyEn: storedTeamDoc(row.bodyEnJson, row.bodyEn),
    position: row.position,
    visible: row.visible,
    version: row.version,
    updatedAt: row.updatedAt,
  }));
}

/** A stored picture's key prefix, or `null` when the id names none (the save refuses `yt-` posters, §485). */
export async function mediaAssetKeyPrefix<T extends Record<string, unknown>>(db: Database<T>, assetId: string): Promise<string | null> {
  const [row] = await db.select({ keyPrefix: mediaAssets.keyPrefix }).from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
  return row?.keyPrefix ?? null;
}
