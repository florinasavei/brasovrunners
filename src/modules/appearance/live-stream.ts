import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_LIVE_STREAM_SETTING,
  describeLiveStream,
  type LiveStreamSetting,
  liveStreamSchema,
  parseLiveStream,
  youtubeAddress,
} from "./domain/live-stream";

/**
 * «În direct pe YouTube» (§NNN): one `platform_settings` row, written by an Administrator under
 * «Setări» → «Aspect», audited, read by the site header through the public cache (§333). No
 * migration: the settings table takes any key (§100). `domain/live-stream.ts` says what it holds.
 */

export const LIVE_STREAM_SETTING_KEY = "liveStream";
/** The audit row's fixed entity id for this key — one per key, never reused (`…e0e1` is «Pagina principală»). */
export const LIVE_STREAM_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0e2";

export type LiveStreamState = { setting: LiveStreamSetting; updatedAt: Date | null };

/** The setting in force: off with no row (`updatedAt: null`), or with a value this code cannot read. */
export async function readLiveStream<T extends Record<string, unknown>>(db: Database<T>): Promise<LiveStreamState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, LIVE_STREAM_SETTING_KEY)).limit(1);
  if (!row) return { setting: DEFAULT_LIVE_STREAM_SETTING, updatedAt: null };
  return { setting: parseLiveStream(row.value), updatedAt: row.updatedAt };
}

/** What the form posts, as the action reads it: the tick box (`on` when ticked) and the address box. */
export type LiveStreamInput = { on?: unknown; url?: unknown };

/**
 * Saves the notice. A club setting (§450): the Administrator's, asserted here as well as at the
 * action. An address is kept even while the notice is off, so the next broadcast is one tick;
 * switching on with no address, or with one that is not YouTube's, is refused naming the box.
 * Expires the public cache's settings, so the next page view draws, or drops, the bar.
 */
export async function updateLiveStream<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<LiveStreamState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the live notice`);
  }
  const raw = rawInput && typeof rawInput === "object" ? (rawInput as LiveStreamInput) : {};
  const on = raw.on === true || raw.on === "on";
  const typed = typeof raw.url === "string" ? raw.url.trim() : "";
  const url = typed ? youtubeAddress(typed) : null;
  if (typed && url === null) {
    throw new DomainError("VALIDATION_ERROR", "url: not an https address on YouTube", ["url"]);
  }
  if (on && url === null) {
    throw new DomainError("VALIDATION_ERROR", "url: the notice needs the broadcast's address", ["url"]);
  }
  const parsed = liveStreamSchema.safeParse({ on, url });
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", "liveStream: not a setting this code can store", ["url"]);
  }
  const next: LiveStreamSetting = parsed.data;

  const before = await readLiveStream(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: LIVE_STREAM_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "live_stream.changed",
      entityType: "platform_setting",
      entityId: LIVE_STREAM_SETTING_ENTITY_ID,
      metadata: { from: describeLiveStream(before.setting), to: describeLiveStream(next) },
      now,
    });
  });
  // Every public page's header reads the notice from the public cache (§333).
  revalidatePublicContent("settings");
  return { setting: next, updatedAt: now };
}
