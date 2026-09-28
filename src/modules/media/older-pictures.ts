import { and, asc, eq, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { eventTranslations } from "@/db/schema/events";
import { mediaAssets } from "@/db/schema/gallery";
import { pageTranslations } from "@/db/schema/pages";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import { faqQuestions } from "@/db/schema/faq";
import { teamMembers } from "@/db/schema/team";
import { FAQ_PAGE_SETTING_KEY } from "@/modules/content/faq/page-settings";
import { MEMBERS_PAGE_SETTING_KEY } from "@/modules/content/members/page-settings";
import { TEAM_PAGE_SETTING_KEY } from "@/modules/content/team/page-settings";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { ladderFromStoredMaster } from "./images";
import { FORMER_KEY_PREFIX_PATTERN, LADDER_WIDTHS, ladderKeyPrefixOf } from "./ladder";
import { getStorage, isStorageConfigured, objectKey, type Storage } from "./storage";

/**
 * Pictures stored before §414, given their ladder by an Administrator button, a batch per press
 * (§430). The ladder is read from the address (`ladder.ts`), so a picture must move:
 *
 * 1. Files under `ladderKeyPrefixOf(old)` — deterministic, so a repeated press rewrites the same
 *    keys; the master byte for byte, the thumbnail and rungs made from it.
 * 2. One transaction moves the row and rewrites the prefix in every text `references.ts` reads,
 *    bumping each row's `version` so an open editor is refused rather than writing the old
 *    address back (AGENTS.md §11.5).
 * 3. The old two files stay, so a copied address keeps working; `assetObjectKeys` removes them
 *    with the picture.
 *
 * Never touches a `yt-<id>` poster (§403) or a laddered picture; a missing or unreadable master
 * is counted as failed and left as is.
 */

/**
 * Per-press limits, measured (§430): about 7 s per picture on a one-vCPU function, so no new
 * picture after 12 s keeps a press well inside the page's 60-second function.
 */
export const OLDER_PICTURES_PER_PRESS = 8;

/** See `OLDER_PICTURES_PER_PRESS`: no new picture after this many milliseconds. */
export const OLDER_PICTURES_BUDGET_MS = 12_000;

/** A picture stored before §414: its prefix is a version-4 UUID (`ladder.ts`). */
const isOlderPicture = sql`${mediaAssets.keyPrefix} ~ ${FORMER_KEY_PREFIX_PATTERN}`;

/** How many pictures still have no ladder (the task board's card hides at zero). */
export async function countOlderPictures<T extends Record<string, unknown>>(db: Database<T>): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(mediaAssets)
    .where(isOlderPicture);
  return row?.count ?? 0;
}

export type OlderPicturesPress = {
  /** Given their ladder by this press. */
  converted: number;
  /** Tried and not converted: the master missing or unreadable, or the store refused a file. */
  failed: number;
  /** Still without a ladder after the press, the failed ones included. */
  left: number;
};

type Outcome = "converted" | "failed" | "skipped";

/** `old` → `next` inside a text column, as text; a null stays null. */
const swapped = (column: AnyPgColumn, old: string, next: string): SQL => sql`replace(${column}::text, ${old}, ${next})`;
const holds = (column: AnyPgColumn, old: string): SQL => sql`position(${old} in ${column}::text) > 0`;

/** One press: up to `perPress` oldest pictures within the budget; one audit row (BR-REQ-060-01). */
export async function giveOlderPicturesTheirLadder<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  options: { now?: Date; perPress?: number; budgetMs?: number; clock?: () => number } = {},
): Promise<OlderPicturesPress> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not convert the stored pictures`);
  }
  if (!isStorageConfigured()) throw new DomainError("VALIDATION_ERROR", "photo storage is not configured for this environment");
  const storage = getStorage();
  const perPress = options.perPress ?? OLDER_PICTURES_PER_PRESS;
  const budgetMs = options.budgetMs ?? OLDER_PICTURES_BUDGET_MS;
  const clock = options.clock ?? Date.now;
  const started = clock();

  let converted = 0;
  let failed = 0;
  const failedIds: string[] = [];
  /*
    A cursor, so failures (still candidates) cannot fill every page. Its time is PostgreSQL's text
    of the column, not a `Date`: milliseconds would sit before the microsecond row and re-read it (§430).
  */
  let after = null as { createdAt: string; id: string } | null;
  pages: while (converted < perPress) {
    const cursor = after;
    const page = await db
      .select({ id: mediaAssets.id, keyPrefix: mediaAssets.keyPrefix, createdAt: sql<string>`${mediaAssets.createdAt}::text` })
      .from(mediaAssets)
      .where(
        cursor
          ? and(isOlderPicture, sql`(${mediaAssets.createdAt}, ${mediaAssets.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`)
          : isOlderPicture,
      )
      .orderBy(asc(mediaAssets.createdAt), asc(mediaAssets.id))
      .limit(perPress);
    if (page.length === 0) break;
    for (const asset of page) {
      if (converted >= perPress || clock() - started >= budgetMs) break pages;
      after = asset;
      /* One picture's exception is its own failure, never the press's (audit, cache expiry; §430). */
      let outcome: Outcome;
      try {
        outcome = await convertOne(db, storage, asset);
      } catch (error) {
        console.error("[media] could not give the ladder to", asset.id, error);
        outcome = "failed";
      }
      if (outcome === "converted") converted += 1;
      if (outcome === "failed") {
        failed += 1;
        if (failedIds.length < perPress) failedIds.push(asset.id);
      }
    }
  }

  const left = await countOlderPictures(db);
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "media.ladder_given",
    entityType: "media_asset",
    entityId: null,
    metadata: { converted, failed, left, ...(failedIds.length > 0 ? { failedIds } : {}) },
    now: options.now ?? new Date(),
  });
  // A body's address changed: every cached public read that carries one is stale (§333).
  if (converted > 0) revalidatePublicContent("events", "pages", "gallery");
  return { converted, failed, left };
}

async function convertOne<T extends Record<string, unknown>>(
  db: Database<T>,
  storage: Storage,
  asset: { id: string; keyPrefix: string },
): Promise<Outcome> {
  const old = asset.keyPrefix;
  const next = ladderKeyPrefixOf(old);

  const master = await storage.get(objectKey(old, "web"));
  if (!master) {
    console.warn("[media] no ladder for", asset.id, "its master is missing from storage");
    return "failed";
  }
  let ladder: Awaited<ReturnType<typeof ladderFromStoredMaster>>;
  try {
    ladder = await ladderFromStoredMaster(master);
  } catch (error) {
    if (isDomainError(error)) {
      console.warn("[media] no ladder for", asset.id, "its master could not be decoded", error);
      return "failed";
    }
    throw error;
  }

  try {
    await storage.put(objectKey(next, "web"), master, "image/webp");
    await storage.put(objectKey(next, "thumb"), ladder.thumb, "image/webp");
    for (const rung of ladder.rungs) await storage.put(objectKey(next, rung.width), rung.body, "image/webp");
  } catch (error) {
    console.error("[media] could not store the ladder of", asset.id, error);
    await removeUnlessMoved(db, storage, next);
    return "failed";
  }

  const moved = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(mediaAssets)
      .set({ keyPrefix: next, width: ladder.width, height: ladder.height, byteSize: master.byteLength })
      .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.keyPrefix, old)))
      .returning({ id: mediaAssets.id });
    if (!row) return false;

    // Every text `references.ts` reads, so the picture is found where it was found before.
    const texts = [
      eventTranslations.bodyJson,
      eventTranslations.excerptJson,
      eventTranslations.rulesJson,
      eventTranslations.scheduleJson,
      eventTranslations.routeDescriptionJson,
    ] as const;
    await tx
      .update(eventTranslations)
      .set({
        bodyJson: sql`${swapped(eventTranslations.bodyJson, old, next)}::jsonb`,
        excerptJson: sql`${swapped(eventTranslations.excerptJson, old, next)}::jsonb`,
        rulesJson: sql`${swapped(eventTranslations.rulesJson, old, next)}::jsonb`,
        scheduleJson: sql`${swapped(eventTranslations.scheduleJson, old, next)}::jsonb`,
        routeDescriptionJson: sql`${swapped(eventTranslations.routeDescriptionJson, old, next)}::jsonb`,
        version: sql`${eventTranslations.version} + 1`,
      })
      .where(or(...texts.map((column) => holds(column, old))));
    await tx
      .update(pageTranslations)
      .set({ bodyJson: sql`${swapped(pageTranslations.bodyJson, old, next)}::jsonb`, version: sql`${pageTranslations.version} + 1` })
      .where(holds(pageTranslations.bodyJson, old));
    // «Echipa»'s bios and introduction (§474, §483); a card's photo is by id and follows the row.
    await tx
      .update(teamMembers)
      .set({
        bioRoJson: sql`${swapped(teamMembers.bioRoJson, old, next)}::jsonb`,
        bioEnJson: sql`${swapped(teamMembers.bioEnJson, old, next)}::jsonb`,
        version: sql`${teamMembers.version} + 1`,
      })
      .where(or(holds(teamMembers.bioRoJson, old), holds(teamMembers.bioEnJson, old)));
    await tx
      .update(platformSettings)
      .set({ value: sql`${swapped(platformSettings.value, old, next)}::jsonb` })
      .where(and(eq(platformSettings.key, TEAM_PAGE_SETTING_KEY), holds(platformSettings.value, old)));
    // FAQ answers and introduction (§525).
    await tx
      .update(faqQuestions)
      .set({
        answerRoJson: sql`${swapped(faqQuestions.answerRoJson, old, next)}::jsonb`,
        answerEnJson: sql`${swapped(faqQuestions.answerEnJson, old, next)}::jsonb`,
        version: sql`${faqQuestions.version} + 1`,
      })
      .where(or(holds(faqQuestions.answerRoJson, old), holds(faqQuestions.answerEnJson, old)));
    await tx
      .update(platformSettings)
      .set({ value: sql`${swapped(platformSettings.value, old, next)}::jsonb` })
      .where(and(eq(platformSettings.key, FAQ_PAGE_SETTING_KEY), holds(platformSettings.value, old)));
    // The members' pages (§524).
    await tx
      .update(platformSettings)
      .set({ value: sql`${swapped(platformSettings.value, old, next)}::jsonb` })
      .where(and(eq(platformSettings.key, MEMBERS_PAGE_SETTING_KEY), holds(platformSettings.value, old)));
    return true;
  });
  if (moved) return "converted";

  // Another press moved it first (same keys), or it was deleted meanwhile.
  await removeUnlessMoved(db, storage, next);
  return "skipped";
}

/**
 * Removes the new prefix's files unless a row holds it. Not `deleteAssetObjects`, which would
 * also take the former address's files.
 */
async function removeUnlessMoved<T extends Record<string, unknown>>(db: Database<T>, storage: Storage, next: string): Promise<void> {
  const [row] = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.keyPrefix, next)).limit(1);
  if (row) return;
  const keys = [objectKey(next, "web"), objectKey(next, "thumb"), ...LADDER_WIDTHS.map((width) => objectKey(next, width))];
  for (const key of keys) await storage.delete(key).catch(() => undefined);
}
