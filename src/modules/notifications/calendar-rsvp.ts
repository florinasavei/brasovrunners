import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  type CalendarRsvpTo,
  calendarRsvpToSchema,
  DEFAULT_CALENDAR_RSVP_TO,
  forgetCachedCalendarRsvpTo,
  memoizedCalendarRsvpTo,
  rememberCalendarRsvpTo,
} from "./domain/calendar-rsvp";

/**
 * «Răspunsurile din calendar merg la» (§672): the shape every club setting on «Emailuri» has (§100,
 * §164, §244) — one `platform_settings` row, written by an Administrator, audited with what it was
 * and what it became, read straight through by the page and through a half-minute memo by the send.
 * An address of the club's own, never a credential and never a participant's.
 */

export const CALENDAR_RSVP_SETTING_KEY = "calendarRsvpTo";
/** The audit row's fixed entity id for this key (§483): its own, never another setting's. */
export const CALENDAR_RSVP_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0ca";

export type CalendarRsvpState = CalendarRsvpTo & { updatedAt: Date | null };

/** The setting as stored, or off. A value this code can no longer read is off: the file as before, never a failed send. */
export async function readCalendarRsvpTo<T extends Record<string, unknown>>(db: Database<T>): Promise<CalendarRsvpState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, CALENDAR_RSVP_SETTING_KEY)).limit(1);
  if (!row) return { ...DEFAULT_CALENDAR_RSVP_TO, updatedAt: null };
  const parsed = calendarRsvpToSchema.safeParse(row.value);
  return parsed.success ? { ...parsed.data, updatedAt: row.updatedAt } : { ...DEFAULT_CALENDAR_RSVP_TO, updatedAt: row.updatedAt };
}

/**
 * The address the renderer writes as the invitation's organizer, or null for today's file (§672).
 * From the instance's memo (`domain/calendar-rsvp.ts`); a database that cannot answer is off — a
 * message never fails over a calendar part.
 */
export async function calendarRsvpToForSending<T extends Record<string, unknown>>(db: Database<T>): Promise<string | null> {
  const memoized = memoizedCalendarRsvpTo();
  if (memoized) return memoized.to;
  let to: string | null;
  try {
    to = (await readCalendarRsvpTo(db)).to || null;
  } catch {
    return null;
  }
  rememberCalendarRsvpTo(to);
  return to;
}

export async function updateCalendarRsvpTo<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<CalendarRsvpState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change where the calendar answers go`);
  }
  const parsed = calendarRsvpToSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      // The one box: `calendarRsvpTo` on the form.
      ["calendarRsvpTo"],
    );
  }
  const next = parsed.data;
  const before = await readCalendarRsvpTo(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: CALENDAR_RSVP_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "calendar_rsvp_to.changed",
      entityType: "platform_setting",
      entityId: CALENDAR_RSVP_SETTING_ENTITY_ID,
      // The club's own mailbox, before and after; empty is off.
      metadata: { from: before.to, to: next.to },
      now,
    });
  });
  // The next message this instance renders carries the new answer at once.
  forgetCachedCalendarRsvpTo();
  return { ...next, updatedAt: now };
}
