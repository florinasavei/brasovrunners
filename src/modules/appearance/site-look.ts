import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { judgeAccent } from "./domain/accent-shades";
import {
  CUSTOM_LOOK_ACCENT,
  DEFAULT_SITE_LOOK_SETTING,
  describeLookAccent,
  describeSiteLook,
  LOOK_ACCENT_CHOICES,
  lookAccentOf,
  type LookAccentSetting,
  parseSiteLook,
  type SiteLookSetting,
  siteLookSchema,
} from "./domain/site-look";

/**
 * «Aspectul nou» (§708, its accent colour since §723): one `platform_settings` row, written by an
 * Administrator under «Setări» → «Aspect», audited, read by the locale layout and the header through
 * the public cache (§333). No migration: the settings table takes any key (§100).
 */

export const SITE_LOOK_SETTING_KEY = "siteLook";
/**
 * The audit row's fixed entity id for this key — one per key, never reused (`…e011` is the tint,
 * `…e012` the text size). `…e01a` rather than the next in line, so a sibling branch that takes the
 * next one for a setting of its own cannot land on the same id.
 */
export const SITE_LOOK_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e01a";

/**
 * The marker a refused typed accent carries beside its box's name, so the action can say the rule in
 * words rather than "check what you entered" (§488's tint does the same). A marker, not a box: the
 * action drops it from the field list.
 */
export const LOOK_ACCENT_REFUSAL = { tooGrey: "accentTooGrey" } as const;

export type SiteLookState = { setting: SiteLookSetting; updatedAt: Date | null };

/** The look in force: off with no row (`updatedAt: null`), or with a value this code cannot read. */
export async function readSiteLook<T extends Record<string, unknown>>(db: Database<T>): Promise<SiteLookState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, SITE_LOOK_SETTING_KEY)).limit(1);
  if (!row) return { setting: DEFAULT_SITE_LOOK_SETTING, updatedAt: null };
  return { setting: parseSiteLook(row.value), updatedAt: row.updatedAt };
}

/** What the form sends: the radio's value, `on` or `off`. Anything else is refused. */
const CHOICES: Record<string, boolean> = { on: true, off: false };

/**
 * The accent the form sent, checked: a preset, or «Personalizat» with a colour — spaces around it and
 * a missing "#" forgiven, nothing else — that is `#rrggbb` and not a grey (`accent-shades.ts`). A form
 * that sent no accent (an older page) keeps the one in force.
 */
function accentFrom(raw: { accent?: unknown; hex?: unknown }, before: SiteLookSetting): LookAccentSetting {
  if (raw.accent === undefined || raw.accent === null) return lookAccentOf(before);
  if (typeof raw.accent !== "string" || !(LOOK_ACCENT_CHOICES as readonly string[]).includes(raw.accent)) {
    throw new DomainError("VALIDATION_ERROR", `accent: not one of the choices (${String(raw.accent)})`, ["accent"]);
  }
  if (raw.accent !== CUSTOM_LOOK_ACCENT) return { accent: raw.accent as Exclude<LookAccentSetting["accent"], typeof CUSTOM_LOOK_ACCENT> };
  const typed = typeof raw.hex === "string" ? raw.hex.trim() : "";
  const hex = (typed.startsWith("#") ? typed : `#${typed}`).toLowerCase();
  const verdict = judgeAccent(hex);
  if (verdict === "notAColour") throw new DomainError("VALIDATION_ERROR", "hex: not a #rrggbb colour", ["hex"]);
  if (verdict !== null) throw new DomainError("VALIDATION_ERROR", `hex: ${verdict} as an accent`, ["hex", LOOK_ACCENT_REFUSAL[verdict]]);
  return { accent: CUSTOM_LOOK_ACCENT, hex };
}

/**
 * Switches the look on or off and sets its accent colour. A club setting (§450): the Administrator's,
 * asserted here as well as at the action. Expires the public cache's settings — every static public
 * page is made again at its next visit, in the look and the accent now in force (§549).
 */
export async function updateSiteLook<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<SiteLookState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the site's look`);
  }
  const raw = rawInput && typeof rawInput === "object" ? (rawInput as { look?: unknown; accent?: unknown; hex?: unknown }) : {};
  if (typeof raw.look !== "string" || !Object.hasOwn(CHOICES, raw.look)) {
    throw new DomainError("VALIDATION_ERROR", `look: not one of the choices (${String(raw.look)})`, ["look"]);
  }
  const before = await readSiteLook(db);
  const accent = accentFrom(raw, before.setting);
  // A setting that never named an accent stays without one while the pink is kept: the row reads as it did.
  const keepsBareDefault = before.setting.accent === undefined && raw.accent === undefined;
  const parsed = siteLookSchema.safeParse(keepsBareDefault ? { on: CHOICES[raw.look] } : { on: CHOICES[raw.look], ...accent });
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", "look: not a setting this code can store", ["look"]);
  }
  const next: SiteLookSetting = parsed.data;

  const accentBefore = describeLookAccent(before.setting);
  const accentAfter = describeLookAccent(next);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: SITE_LOOK_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "site_look.changed",
      entityType: "platform_setting",
      entityId: SITE_LOOK_SETTING_ENTITY_ID,
      // The accent is named only when it changed, so a flip of the switch reads as it always did.
      metadata: {
        from: describeSiteLook(before.setting),
        to: describeSiteLook(next),
        ...(accentBefore === accentAfter ? {} : { accentFrom: accentBefore, accentTo: accentAfter }),
      },
      now,
    });
  });
  // Every public page reads the look from the public cache (§333); the static ones are made again.
  revalidatePublicContent("settings");
  return { setting: next, updatedAt: now };
}
