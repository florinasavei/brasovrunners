import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { DEFAULT_RSVP_ASK_AUDIENCE, readRsvpAskAudience, type RsvpAskAudience, rsvpAskAudienceSchema } from "./domain/ask-audience";

/**
 * «Cui îi trimitem întrebarea „Vii?"» (§823): the shape every club setting on «Emailuri» has (§100, §164, §672) — one `platform_settings`
 * row, written by an Administrator, audited with what it was and what it became. Read straight through: the queue reads it once, and
 * only when an event's window is open (`rsvp/ask.ts`), and the page that sets it reads it as it is.
 */

export const RSVP_ASK_AUDIENCE_SETTING_KEY = "rsvpAskAudience";
/** The audit row's fixed entity id for this key (§483): its own, never another setting's. */
export const RSVP_ASK_AUDIENCE_ENTITY_ID = "00000000-0000-4000-8000-00000000e0a9";

export type RsvpAskAudienceState = { audience: RsvpAskAudience; updatedAt: Date | null };

/** The setting as stored, or the default — subscribers only. A value this code can no longer read is the default, never a wider audience. */
export async function readRsvpAskAudienceSetting<T extends Record<string, unknown>>(db: Database<T>): Promise<RsvpAskAudienceState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, RSVP_ASK_AUDIENCE_SETTING_KEY)).limit(1);
  if (!row) return { audience: DEFAULT_RSVP_ASK_AUDIENCE, updatedAt: null };
  return { audience: readRsvpAskAudience(row.value), updatedAt: row.updatedAt };
}

export async function updateRsvpAskAudience<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<RsvpAskAudienceState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change who the «Vii?» question is asked of`);
  }
  const parsed = rsvpAskAudienceSchema.safeParse(rawInput);
  if (!parsed.success) {
    // The one choice: `audience` on the form.
    throw new DomainError("VALIDATION_ERROR", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), ["audience"]);
  }
  const next = parsed.data;
  const before = await readRsvpAskAudienceSetting(db);
  // A save that moves nothing writes nothing: no row, no audit.
  if (before.updatedAt !== null && before.audience === next.audience) return before;
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: RSVP_ASK_AUDIENCE_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "rsvp_ask_audience.changed",
      entityType: "platform_setting",
      entityId: RSVP_ASK_AUDIENCE_ENTITY_ID,
      // Who it was asked of, and who now: a widening to the answerers is the one change that uses an address for a new purpose.
      metadata: { from: before.audience, to: next.audience },
      now,
    });
  });
  return { audience: next.audience, updatedAt: now };
}
