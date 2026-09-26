import { and, asc, eq, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { eventTranslations, events } from "@/db/schema/events";
import { mediaAssets } from "@/db/schema/gallery";
import { pageTranslations } from "@/db/schema/pages";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { ladderFromStoredMaster } from "./images";
import { FORMER_KEY_PREFIX_PATTERN, LADDER_WIDTHS, ladderKeyPrefixOf } from "./ladder";
import { getStorage, isStorageConfigured, objectKey, type Storage } from "./storage";

/**
 * The pictures stored before §414, given their ladder by one Administrator button, a batch per
 * press (§NNN).
 *
 * ## Why a button, and why it moves the picture
 *
 * §414 left every older picture drawing the one file it always drew — "until it is uploaded
 * again" — because the page decides whether a picture has smaller siblings from its address
 * alone: a version-8 prefix has a ladder, a version-4 one does not (`ladder.ts`). A body is JSON
 * and the renderer does not ask the database about each picture in it, so writing the rungs
 * beside an old master would change nothing anybody sees. Asking the club to upload every old
 * picture again, into every body it sits in, is an afternoon; this is a press.
 *
 * So a picture is converted in three steps:
 *
 * 1. **Its files, under its new prefix.** `ladderKeyPrefixOf(old)` — the same UUID with its
 *    version digit at 8 — so the new address is a pure function of the old one, the same bytes
 *    land on the same keys if a press is cut off halfway and repeated, and the old address can
 *    always be derived back (`formerKeyPrefixOf`). The master is stored **byte for byte**, not
 *    re-encoded: the file a wide screen loads is exactly the one it loaded before. The thumbnail
 *    and the rungs are made from it (`ladderFromStoredMaster`).
 * 2. **One transaction** moves the row to the new prefix and rewrites the old prefix to the new one
 *    in every text the reference check reads (`references.ts`: a page's body, an event
 *    translation's five rich texts, the event's film poster), and bumps the `version` of every
 *    row it rewrote — an editor open on one of them is then refused at save as for any other
 *    change made meanwhile (AGENTS.md §11.5), instead of writing the old address back.
 * 3. **The old two files stay** at the old address. The pictures page offers a picture's address
 *    to paste into a newsletter or a post, and a browser offers any picture's; an address copied
 *    out of the site must not turn into a broken image because the club pressed a button. They
 *    are not strays: `assetObjectKeys` names them under the new prefix, so they go when the
 *    picture goes — removed from a page, deleted by hand, or taken by the orphan sweep.
 *
 * A gallery photo and an album cover reference the row by id, so moving the row is the whole of
 * their change. The public reads are expired once per press (§333).
 *
 * ## Why in batches
 *
 * An old master is at most 2400 pixels; its seven new files take one to three seconds here and
 * up to about seven on a deployed function, and a Server Action has a minute. A press takes at most `OLDER_PICTURES_PER_PRESS` pictures and starts none after
 * `OLDER_PICTURES_BUDGET_MS`, then says how many are left; the button stays until none are.
 *
 * ## What it never does
 *
 * It never touches a film poster fetched from YouTube (`yt-<id>`, §403: YouTube's own thumbnail
 * is at most 480 pixels and keeps its one file on purpose), nor a picture uploaded with a
 * ladder. A picture whose master is missing from the store, or is not a picture, is counted as
 * not converted and left exactly as it is — it was already a broken image, and the pictures page
 * is where it is removed.
 */

/**
 * The most pictures one press converts, and the time after which it starts no new one — sized
 * from a measurement, not a guess (§NNN). `ladderFromStoredMaster` on a 2400 × 1349 «Normală»
 * master (six rungs and the thumbnail) took 0.9–1.5 s on the development machine with every
 * core, and 2.5–2.6 s with `sharp` and libuv held to one thread — the honest figure for a
 * Vercel function, whose one vCPU runs the `Promise.all` of encodes one after another. Counting
 * that twice again for a slower CPU, eight R2 writes (about 0.8 MB) and the move's transaction,
 * one picture is at most about 7 s there. So a press starts none after 12 s and finishes within
 * about 20 s even when the last picture it starts is a slow one; on a fast machine it stops at
 * eight. The action runs inside the page's 60-second function (`admin/tasks/page.tsx`), so a
 * picture three times slower still ends in time.
 */
export const OLDER_PICTURES_PER_PRESS = 8;

/** See `OLDER_PICTURES_PER_PRESS`: no new picture after this many milliseconds. */
export const OLDER_PICTURES_BUDGET_MS = 12_000;

/** A picture stored before §414: its prefix is a version-4 UUID (`ladder.ts`). */
const isOlderPicture = sql`${mediaAssets.keyPrefix} ~ ${FORMER_KEY_PREFIX_PATTERN}`;

/** How many pictures still have no ladder — what the task board's card says, and hides itself at zero. */
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

/**
 * One press of the button: up to `perPress` of the oldest pictures without a ladder, oldest
 * first, until the time budget is spent. Administrator only, asserted here as well as at the
 * action (BR-REQ-060-01), and one audit row per press.
 */
export async function giveOlderPicturesTheirLadder<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  options: { now?: Date; perPress?: number; budgetMs?: number; clock?: () => number } = {},
): Promise<OlderPicturesPress> {
  if (!canManageRegistrations(actor.role)) {
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
  /*
    A cursor, not "the first twenty again": a picture that fails stays a candidate, and with more
    failures than one page holds, re-reading the first page would convert nothing ever again. The
    failures are retried on the next press — a missing file is one quick read.

    The cursor's time is PostgreSQL's own text of the column, never a JavaScript `Date`: a `Date`
    holds milliseconds and `created_at` holds microseconds, so a cursor made from one sits just
    before the row it came from, and that row — a failed one, still a candidate — would be read
    again and again until the time budget ran out (§NNN).
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
      /*
        One picture's surprise is that picture's failure, never the press's: an exception here
        (a transient database error inside the move, a store that throws) would otherwise skip
        the audit row and the cache expiry for the pictures already moved, and — the press going
        oldest first — end every later press on this same picture (§NNN).
      */
      let outcome: Outcome;
      try {
        outcome = await convertOne(db, storage, asset);
      } catch (error) {
        console.error("[media] could not give the ladder to", asset.id, error);
        outcome = "failed";
      }
      if (outcome === "converted") converted += 1;
      if (outcome === "failed") failed += 1;
    }
  }

  const left = await countOlderPictures(db);
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "media.ladder_given",
    entityType: "media_asset",
    entityId: null,
    metadata: { converted, failed, left },
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
  if (!master) return "failed";
  let ladder: Awaited<ReturnType<typeof ladderFromStoredMaster>>;
  try {
    ladder = await ladderFromStoredMaster(master);
  } catch (error) {
    if (isDomainError(error)) return "failed";
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
    await tx
      .update(events)
      .set({ videoPosterUrl: swapped(events.videoPosterUrl, old, next), version: sql`${events.version} + 1` })
      .where(holds(events.videoPosterUrl, old));
    return true;
  });
  if (moved) return "converted";

  // Not moved by this press: another press moved it first (its files are these very keys), or it
  // was deleted meanwhile (these files are then nobody's).
  await removeUnlessMoved(db, storage, next);
  return "skipped";
}

/**
 * The new files go again only when no row holds the new prefix — never another press's result.
 *
 * Only the new prefix's own files, and so not `deleteAssetObjects`: for a laddered prefix that
 * also names the former address's two files, which are the old picture's — still needed by a
 * picture waiting for its ladder, and already removed with a picture deleted meanwhile.
 */
async function removeUnlessMoved<T extends Record<string, unknown>>(db: Database<T>, storage: Storage, next: string): Promise<void> {
  const [row] = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.keyPrefix, next)).limit(1);
  if (row) return;
  const keys = [objectKey(next, "web"), objectKey(next, "thumb"), ...LADDER_WIDTHS.map((width) => objectKey(next, width))];
  for (const key of keys) await storage.delete(key).catch(() => undefined);
}
