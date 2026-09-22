import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { turnstileSiteKey } from "./turnstile";

/**
 * Whether the anti-bot challenge runs, as a switch the club can reach (`DECISIONS.md` §254; the
 * owner: "I wanna be able to enable/disable the captcha from the backoffice").
 *
 * Turnstile has been behind two environment keys since §97, which means turning it off needed a
 * Vercel setting and a deployment — and the day it needs turning off is the day it is refusing
 * real people (it refused Dani twice on 2026-09-21, §216). A switch in the backoffice is the
 * difference between a five-minute fix by whoever is awake and a developer.
 *
 * ## What the switch does and does not do
 *
 * Off, the widget is not rendered and no token is verified: the registration form and the
 * contact form behave exactly as they do on a deployment with no keys at all. **The honeypot,
 * the timing check and the per-address throttle are untouched** — they are the checks that cost
 * a visitor nothing and they stand whatever this says (`AGENTS.md` §19.4).
 *
 * On (the default) nothing changes from §97: with both keys set the widget shows and a token
 * Cloudflare rejects refuses the submission; without the keys there is nothing to switch on,
 * and the panel says so rather than pretending.
 *
 * ## Read on the request path, so it is memoized
 *
 * Two public pages and two actions ask, on every submission. A primary-key lookup is cheap but
 * not free, and the answer changes a few times a year: half a minute of staleness, dropped the
 * moment somebody saves, is the same bargain the editable wording took (§247).
 */

export const BOT_CHECK_SETTING_KEY = "botCheck";
/** One fixed id per setting for the audit row; `…e001`–`…e004` are taken (§100, §164, §244, §247). */
export const BOT_CHECK_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e005";

export type BotCheckState = { enabled: boolean; updatedAt: Date | null };

/** On unless the club has switched it off: a defence is not removed by a missing row. */
export const DEFAULT_BOT_CHECK: BotCheckState = { enabled: true, updatedAt: null };

function readEnabled(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { enabled?: unknown }).enabled === "boolean"
    ? (value as { enabled: boolean }).enabled
    : DEFAULT_BOT_CHECK.enabled;
}

export async function readBotCheck<T extends Record<string, unknown>>(db: Database<T>): Promise<BotCheckState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, BOT_CHECK_SETTING_KEY))
    .limit(1);
  return row ? { enabled: readEnabled(row.value), updatedAt: row.updatedAt } : DEFAULT_BOT_CHECK;
}

const CACHE_MS = 30_000;
let cached: { at: number; enabled: boolean } | null = null;

/**
 * The same read for the request path, memoized for half a minute.
 *
 * It answers **on** when the database cannot be reached: a registration form that refuses to
 * render because a settings table is unavailable would fail the one thing this site exists to
 * do, and a challenge is the safe side of that failure — the form still works, the visitor
 * ticks a box.
 */
export async function botCheckIsOn<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<boolean> {
  if (cached && now.getTime() - cached.at < CACHE_MS) return cached.enabled;
  try {
    const { enabled } = await readBotCheck(db);
    cached = { at: now.getTime(), enabled };
    return enabled;
  } catch {
    return DEFAULT_BOT_CHECK.enabled;
  }
}

/** Dropped whenever the switch moves, so a save is visible on the next submission. */
export function forgetCachedBotCheck(): void {
  cached = null;
}

/**
 * The site key the form should render, or nothing: both keys set *and* the switch on (§254).
 *
 * One function, so the two forms cannot disagree — and so "off" is one condition rather than
 * an `&&` copied into two pages.
 */
export async function activeBotCheckSiteKey<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<string | undefined> {
  return (await botCheckIsOn(db, now)) ? turnstileSiteKey() : undefined;
}

export async function updateBotCheck<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  enabled: boolean,
  now: Date,
): Promise<BotCheckState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not switch the anti-bot check`);
  }
  const before = await readBotCheck(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: BOT_CHECK_SETTING_KEY, value: { enabled }, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: { enabled }, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "bot_check.changed",
      entityType: "platform_setting",
      entityId: BOT_CHECK_SETTING_ENTITY_ID,
      // Turning a defence off is exactly the kind of decision a trail has to carry.
      metadata: { from: before.enabled, to: enabled },
      now,
    });
  });
  forgetCachedBotCheck();
  return { enabled, updatedAt: now };
}
