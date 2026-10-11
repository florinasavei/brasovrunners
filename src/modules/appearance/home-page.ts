import { eq, sql } from "drizzle-orm";
import { mediaAssets } from "@/db/schema/gallery";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { readTeamPhotoCrop } from "@/modules/content/team/photo-crop";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { pages } from "@/db/schema/pages";
import { MAX_STRIP_PICTURES, moveStripPicture } from "@/modules/home/domain/photo-strip";
import {
  DEFAULT_HOME_PAGE_SETTING,
  describeHomePage,
  HOME_PAGE_SETTING_KEY,
  HOME_BUTTON_MAX,
  HOME_HEADLINE_MAX,
  HOME_SECTION_KEYS,
  HOME_SUBLINE_MAX,
  type HomeSectionKey,
  type HomeHeroPicture,
  type HomePageSetting,
  parseHomePage,
  postedPair,
} from "./domain/home-page";
import { type PostedField, postedNumbers, postedSteps, postedStripTitle, postedWhy, type SectionRead, STEPS_PAGE_FIELD } from "./domain/home-sections-form";

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
  /** «Cum funcționează»'s club page, by its id; empty: no third button. */
  buttonHowPageId?: unknown;
  /** Which sections are drawn, by key; `undefined`: kept as they were. A key left out keeps its value. */
  sections?: Partial<Record<HomeSectionKey, boolean>>;
  /**
   * The four lower sections' boxes, each a reader of the posted form by name (`home-sections-form.ts`),
   * or `undefined` when the form did not carry that section's fold — which keeps it as it was.
   */
  steps?: PostedField;
  why?: PostedField;
  strip?: PostedField;
  numbers?: PostedField;
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
  [input.buttonJoinRo, input.buttonJoinEn, input.buttonCalendarRo, input.buttonCalendarEn, input.buttonHowRo, input.buttonHowEn, input.buttonHowPageId].some(
    (value) => value !== undefined,
  );

/**
 * A club page («Pagini personalizate») chosen by its id, as posted: none for an empty choice, else a
 * page that exists — published or not yet, since the page draws its button only once it is published,
 * in each language at that language's own address. Anything else is refused naming the choice.
 */
async function postedPageId<T extends Record<string, unknown>>(db: Database<T>, value: unknown, field: string): Promise<string | null> {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) return null;
  const refuse = () => new DomainError("VALIDATION_ERROR", `${field}: not a page of the club`, [field]);
  if (!UUID.test(id)) throw refuse();
  const [page] = await db.select({ id: pages.id }).from(pages).where(eq(pages.id, id)).limit(1);
  if (!page) throw refuse();
  return page.id;
}

/**
 * The three buttons as posted: two labels both languages or neither (§352), and «Cum funcționează» a
 * club page with, optionally, its own pair of words — a button with no page to go to is never saved,
 * so words with no page are refused naming the choice; no words, the platform's «Cum funcționează».
 */
async function postedButtons<T extends Record<string, unknown>>(db: Database<T>, input: HomePageInput, before: HomePageSetting["buttons"]): Promise<HomePageSetting["buttons"]> {
  if (!carriesButtons(input)) return before;
  const join = pairOf(input, "buttonJoin", HOME_BUTTON_MAX);
  const calendar = pairOf(input, "buttonCalendar", HOME_BUTTON_MAX);
  const label = pairOf(input, "buttonHow", HOME_BUTTON_MAX);
  const pageId = await postedPageId(db, input.buttonHowPageId, "buttonHowPageId");
  if (!pageId && label) throw new DomainError("VALIDATION_ERROR", "buttonHowPageId: a button needs a page to go to", ["buttonHowPageId"]);
  return { join, calendar, how: pageId ? { label, pageId } : null };
}

/** One lower section as posted, or as it was when the form did not carry its fold; a refusal names the box. */
function section<V>(read: PostedField | undefined, before: V, post: (read: PostedField) => SectionRead<V>): V {
  if (!read) return before;
  const result = post(read);
  if (!result.ok) throw new DomainError("VALIDATION_ERROR", `${result.field}: not saved as written (both languages or neither, within its length)`, [result.field]);
  return result.value;
}

/** «Prima dată» as posted, its «Cum funcționează» a club page that exists (the same rule as the hero's). */
async function postedStepsSection<T extends Record<string, unknown>>(db: Database<T>, read: PostedField | undefined, before: HomePageSetting["steps"]): Promise<HomePageSetting["steps"]> {
  const steps = section(read, before, postedSteps);
  if (!read) return steps;
  return { ...steps, targetPageId: await postedPageId(db, steps.targetPageId, STEPS_PAGE_FIELD) };
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
 * both languages or neither, «Cum funcționează»'s page, which sections the page draws, and the words
 * and figures of the four lower sections (each kept as it was when the form did not carry its fold).
 * A club setting (§450): the Administrator's, asserted here as well as at the action. Expires the
 * public cache's settings, so the root and every header are made again at their next visit (§549):
 * the root becomes the page or the redirect, the logo leads to it or to the listing.
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
  const on = CHOICES[input.page];
  // Read, merged and written under one lock: a strip change that overlaps this save waits its turn
  // instead of being written over (or writing over this one) from a stale read.
  const state = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${HOME_PAGE_LOCK_KEY})`);
    const before = await readHomePage(tx);
    const hero = await postedHero(tx, input, before.setting.hero);
    const buttons = await postedButtons(tx, input, before.setting.buttons);
    const sections = postedSections(input, before.setting.sections);
    const steps = await postedStepsSection(tx, input.steps, before.setting.steps);
    const why = section(input.why, before.setting.why, postedWhy);
    const strip = section(input.strip, before.setting.strip, (read) => postedStripTitle(read, before.setting.strip));
    const numbers = section(input.numbers, before.setting.numbers, postedNumbers);
    // The previous row first: a field a later release wrote is carried, never dropped by this save.
    const next: HomePageSetting = { ...before.setting, on, hero, headline, subline, buttons, sections, steps, why, strip, numbers };
    const changed = (pick: (setting: HomePageSetting) => unknown) => JSON.stringify(pick(before.setting)) !== JSON.stringify(pick(next));

    await writeHomePage(tx, actor, next, now, {
      // By id and by switch, never the words, a figure or a file name: what changed, not a copy of it.
      from: describeHomePage(before.setting),
      to: describeHomePage(next),
      heroFrom: before.setting.hero?.assetId ?? null,
      heroTo: next.hero?.assetId ?? null,
      heroCropped: next.hero?.crop !== null && next.hero !== null,
      wordsChanged: changed((setting) => [setting.headline, setting.subline, setting.buttons]),
      sectionsChanged: changed((setting) => setting.sections),
      contentChanged: changed((setting) => [setting.steps, setting.why, setting.strip.title, setting.numbers]),
    });
    return { setting: next, updatedAt: now };
  });
  revalidatePublicContent("settings");
  return state;
}

/** One lock for every read-merge-write of the row: the page's save and the strip's three forms (§NNN). */
const HOME_PAGE_LOCK_KEY = 7_203_300_101;

/**
 * Writes the row over what was there and its audit row, inside the caller's transaction (and its
 * lock). The caller expires the public cache's settings once the transaction has committed: the root
 * and every header read it from there (§333), and the static pages are made again at their next
 * visit (§549) — never before, or a rebuild could read the row as it was.
 */
async function writeHomePage<T extends Record<string, unknown>>(
  tx: Database<T>,
  actor: Pick<StaffUser, "id">,
  next: HomePageSetting,
  now: Date,
  metadata: Record<string, unknown>,
): Promise<void> {
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
    metadata,
    now,
  });
}

/** What the strip's three small forms post: the picture, and for a move its direction. */
export type StripPictureInput = { assetId?: unknown; direction?: unknown };

/**
 * One picture added to the strip, moved a place, or taken out of it (§NNN): the strip's own small
 * forms under «Pagina principală», each a save of its own like a product's pictures (§697), so a slow
 * upload never holds the page's boxes hostage. The Administrator's (§450), audited as the page's
 * change, by the picture's id. Adding reads the picture's key prefix and size from the store and keeps
 * them beside its id, as the hero does, so the public read asks the store nothing and the pictures
 * page sees the picture used; a picture not in the store, a film's poster (§485), one already in the
 * strip, or a thirteenth, is refused naming the box.
 */
export async function changeStripPicture<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  change: "add" | "move" | "remove",
  input: StripPictureInput,
  now: Date,
): Promise<HomePageState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the home page`);
  }
  const refuse = (why: string) => new DomainError("VALIDATION_ERROR", `stripAssetId: ${why}`, ["stripAssetId"]);
  if (typeof input.assetId !== "string" || !UUID.test(input.assetId)) throw refuse("choose a picture");
  const assetId = input.assetId;
  let wrote = false;
  const state = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${HOME_PAGE_LOCK_KEY})`);
    const before = await readHomePage(tx);
    const pictures = before.setting.strip.pictures;
    let next: HomePageSetting["strip"]["pictures"];
    if (change === "add") {
      if (pictures.some((picture) => picture.assetId === assetId)) throw refuse("already in the strip");
      if (pictures.length >= MAX_STRIP_PICTURES) throw refuse(`at most ${MAX_STRIP_PICTURES} pictures`);
      const [asset] = await tx
        .select({ id: mediaAssets.id, keyPrefix: mediaAssets.keyPrefix, width: mediaAssets.width, height: mediaAssets.height })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, assetId))
        .limit(1);
      if (!asset || asset.keyPrefix.startsWith("yt-") || !asset.width || !asset.height) throw refuse("no such picture in the store");
      next = [...pictures, { assetId: asset.id, keyPrefix: asset.keyPrefix, width: asset.width, height: asset.height }];
    } else if (change === "move") {
      if (input.direction !== "up" && input.direction !== "down") throw refuse("not a direction");
      next = moveStripPicture(pictures, assetId, input.direction);
    } else {
      next = pictures.filter((picture) => picture.assetId !== assetId);
    }
    // Nothing to do — the picture was taken out or moved already (a second press, a stale page): no write, no audit row.
    if (JSON.stringify(next) === JSON.stringify(pictures)) return before;
    const setting: HomePageSetting = { ...before.setting, strip: { ...before.setting.strip, pictures: next } };
    await writeHomePage(tx, actor, setting, now, {
      from: describeHomePage(before.setting),
      to: describeHomePage(setting),
      strip: change,
      stripPicture: assetId,
      stripCount: next.length,
    });
    wrote = true;
    return { setting, updatedAt: now };
  });
  if (wrote) revalidatePublicContent("settings");
  return state;
}
