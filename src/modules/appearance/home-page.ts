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
  HOME_BUTTON_MAX,
  HOME_HEADLINE_MAX,
  HOME_PAGE_SLUG,
  HOME_SECTION_KEYS,
  HOME_SLUG_MAX,
  HOME_SUBLINE_MAX,
  type HomeSectionKey,
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
  /** The hero's buttons: a label in each language, and «Cum funcționează»'s club page. All `undefined`: kept as they were. */
  buttonJoinRo?: unknown;
  buttonJoinEn?: unknown;
  buttonCalendarRo?: unknown;
  buttonCalendarEn?: unknown;
  buttonHowRo?: unknown;
  buttonHowEn?: unknown;
  buttonHowSlug?: unknown;
  /** Which sections are drawn, by key; `undefined`: kept as they were. A key left out keeps its value. */
  sections?: Partial<Record<HomeSectionKey, boolean>>;
};

type PairStem = "headline" | "subline" | "buttonJoin" | "buttonCalendar" | "buttonHow";

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
function pairOf(input: HomePageInput, stem: PairStem, max: number) {
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

/** Whether the form carried any of the hero buttons' boxes: a save that did not (an older form) keeps them. */
const carriesButtons = (input: HomePageInput) =>
  [input.buttonJoinRo, input.buttonJoinEn, input.buttonCalendarRo, input.buttonCalendarEn, input.buttonHowRo, input.buttonHowEn, input.buttonHowSlug].some(
    (value) => value !== undefined,
  );

/**
 * The three buttons as posted: two labels both languages or neither (§352), and «Cum funcționează» a
 * pair of labels **and** the address of a club page, or none of them — a button with no place to go
 * is never saved, and a place with no words is refused naming the box.
 */
function postedButtons(input: HomePageInput, before: HomePageSetting["buttons"]): HomePageSetting["buttons"] {
  if (!carriesButtons(input)) return before;
  const join = pairOf(input, "buttonJoin", HOME_BUTTON_MAX);
  const calendar = pairOf(input, "buttonCalendar", HOME_BUTTON_MAX);
  const label = pairOf(input, "buttonHow", HOME_BUTTON_MAX);
  const slug = typeof input.buttonHowSlug === "string" ? input.buttonHowSlug.trim().toLowerCase() : "";
  const refuse = (field: string, why: string) => new DomainError("VALIDATION_ERROR", `${field}: ${why}`, [field]);
  if (slug && (slug.length > HOME_SLUG_MAX || !HOME_PAGE_SLUG.test(slug))) throw refuse("buttonHowSlug", "not the address of a page");
  if (slug && !label) throw refuse("buttonHowRo", "a button needs its words");
  if (!slug && label) throw refuse("buttonHowSlug", "a button needs a page to go to");
  return { join, calendar, how: slug && label ? { label, slug } : null };
}

/** The switches as posted, over what was there: only the keys the form named, and only booleans. */
function postedSections(input: HomePageInput, before: HomePageSetting["sections"]): HomePageSetting["sections"] {
  if (input.sections === undefined) return before;
  const next = { ...before };
  for (const key of HOME_SECTION_KEYS) {
    const value = input.sections[key];
    if (typeof value === "boolean") next[key] = value;
  }
  return next;
}

/**
 * Saves «Pagina principală»: on or off, the hero's picture and its crop, the lines and button labels in
 * both languages or neither, «Cum funcționează»'s page and which sections the page draws. A club
 * setting (§450): the Administrator's, asserted here as well as at the
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
  const buttons = postedButtons(input, before.setting.buttons);
  const sections = postedSections(input, before.setting.sections);
  // The previous row first: a field a later release wrote (part B) is carried, never dropped by this save.
  const next: HomePageSetting = { ...before.setting, on: CHOICES[input.page], hero, headline, subline, buttons, sections };

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
          JSON.stringify([before.setting.headline, before.setting.subline, before.setting.buttons]) !==
          JSON.stringify([next.headline, next.subline, next.buttons]),
        sectionsChanged: JSON.stringify(before.setting.sections) !== JSON.stringify(next.sections),
      },
      now,
    });
  });
  // The root and the header read it from the public cache (§333); the static pages are made again.
  revalidatePublicContent("settings");
  return { setting: next, updatedAt: now };
}
