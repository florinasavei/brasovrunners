import { eq } from "drizzle-orm";
import { mediaAssets } from "@/db/schema/gallery";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { readTeamPhotoCrop } from "@/modules/content/team/photo-crop";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_HOME_PAGE_SETTING,
  describeHomePage,
  HOME_PAGE_SETTING_KEY,
  HOME_HEADLINE_MAX,
  HOME_SUBLINE_MAX,
  type HomeHeroPicture,
  type HomePageSetting,
  parseHomePage,
  postedPair,
} from "./domain/home-page";

/**
 * «Pagina principală» (§NNN): one `platform_settings` row, written by an Administrator under «Setări» →
 * «Aspect», audited, read by the site's root and the header through the public cache (§333). No
 * migration: the settings table takes any key (§100). `domain/home-page.ts` says what it holds.
 */

/** The row's key, in the pure module so the pictures' reference check can name it without the service. */
export { HOME_PAGE_SETTING_KEY };
/**
 * The audit row's fixed entity id for this key — one per key, never reused (`…e01a` is «Aspectul
 * nou»). Out of the run of `…e01x`, so a sibling branch that takes the next one cannot land on it.
 */
export const HOME_PAGE_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0e1";

export type HomePageState = { setting: HomePageSetting; updatedAt: Date | null };

/** The setting in force: off with no row (`updatedAt: null`), or with a value this code cannot read. */
export async function readHomePage<T extends Record<string, unknown>>(db: Database<T>): Promise<HomePageState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, HOME_PAGE_SETTING_KEY)).limit(1);
  if (!row) return { setting: DEFAULT_HOME_PAGE_SETTING, updatedAt: null };
  return { setting: parseHomePage(row.value), updatedAt: row.updatedAt };
}

/** The radio's value, `on` or `off`. Anything else is refused. */
const CHOICES: Record<string, boolean> = { on: true, off: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the form posts, as the action reads it. A field the form did not carry is `undefined`. */
export type HomePageInput = {
  page?: unknown;
  heroAssetId?: unknown;
  heroCrop?: unknown;
  headlineRo?: unknown;
  headlineEn?: unknown;
  sublineRo?: unknown;
  sublineEn?: unknown;
};

/**
 * The hero's picture as posted: kept as it was when the form did not carry the box (the partners'
 * discipline, §169), none for an emptied box, else the stored picture with its facts and the crop.
 * A picture that is not in the store, or a film's poster (§485), is refused, naming the box.
 */
async function postedHero<T extends Record<string, unknown>>(db: Database<T>, input: HomePageInput, before: HomeHeroPicture | null): Promise<HomeHeroPicture | null> {
  if (input.heroAssetId === undefined || input.heroAssetId === null) return before;
  if (input.heroAssetId === "") return null;
  const refuse = (why: string) => new DomainError("VALIDATION_ERROR", `heroAssetId: ${why}`, ["heroAssetId"]);
  if (typeof input.heroAssetId !== "string" || !UUID.test(input.heroAssetId)) throw refuse("choose a picture");
  const crop = readTeamPhotoCrop(input.heroCrop);
  if (crop === "invalid") throw refuse("not a crop of the picture");
  // Asked only when the picture changes: the same picture with a new crop needs no second look.
  if (before && before.assetId === input.heroAssetId) return { ...before, crop };
  const [asset] = await db
    .select({ id: mediaAssets.id, keyPrefix: mediaAssets.keyPrefix, width: mediaAssets.width, height: mediaAssets.height })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, input.heroAssetId))
    .limit(1);
  if (!asset || asset.keyPrefix.startsWith("yt-") || !asset.width || !asset.height) throw refuse("no such picture in the store");
  return { assetId: asset.id, keyPrefix: asset.keyPrefix, width: asset.width, height: asset.height, crop };
}

/** One pair of boxes, both languages or neither (§352); a box over its length is refused by name. */
function pairOf(input: HomePageInput, stem: "headline" | "subline", max: number) {
  const pair = postedPair({ ro: input[`${stem}Ro`], en: input[`${stem}En`] });
  if (pair && "missing" in pair) {
    const field = `${stem}${pair.missing === "ro" ? "Ro" : "En"}`;
    throw new DomainError("VALIDATION_ERROR", `${field}: written in one language only`, [field]);
  }
  if (pair) {
    for (const [locale, text] of Object.entries(pair)) {
      const field = `${stem}${locale === "ro" ? "Ro" : "En"}`;
      if (text.length > max) throw new DomainError("VALIDATION_ERROR", `${field}: longer than ${max}`, [field]);
    }
  }
  return pair;
}

/**
 * Saves «Pagina principală»: on or off, the hero's picture and its crop, the two lines in both
 * languages or neither. A club setting (§450): the Administrator's, asserted here as well as at the
 * action. Expires the public cache's settings, so the root and every header are made again at their
 * next visit (§549): the root becomes the page or the redirect, the logo leads to it or to the listing.
 */
export async function updateHomePage<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: HomePageInput,
  now: Date,
): Promise<HomePageState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the home page`);
  }
  if (typeof input.page !== "string" || !Object.hasOwn(CHOICES, input.page)) {
    throw new DomainError("VALIDATION_ERROR", `page: not one of the choices (${String(input.page)})`, ["page"]);
  }
  const headline = pairOf(input, "headline", HOME_HEADLINE_MAX);
  const subline = pairOf(input, "subline", HOME_SUBLINE_MAX);
  const before = await readHomePage(db);
  const hero = await postedHero(db, input, before.setting.hero);
  const next: HomePageSetting = { on: CHOICES[input.page], hero, headline, subline };

  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: HOME_PAGE_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "home_page.changed",
      entityType: "platform_setting",
      entityId: HOME_PAGE_SETTING_ENTITY_ID,
      // By id and by switch, never the words or a file name: what changed, not a copy of it.
      metadata: {
        from: describeHomePage(before.setting),
        to: describeHomePage(next),
        heroFrom: before.setting.hero?.assetId ?? null,
        heroTo: next.hero?.assetId ?? null,
        heroCropped: next.hero?.crop !== null && next.hero !== null,
        wordsChanged:
          JSON.stringify([before.setting.headline, before.setting.subline]) !== JSON.stringify([next.headline, next.subline]),
      },
      now,
    });
  });
  // The root and the header read it from the public cache (§333); the static pages are made again.
  revalidatePublicContent("settings");
  return { setting: next, updatedAt: now };
}
