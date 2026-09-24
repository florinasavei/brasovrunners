import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  changedDeadlines,
  DEFAULT_DEADLINES,
  type Deadlines,
  deadlinesSettingSchema,
  readDeadlinesValue,
} from "./domain/deadlines";
import { forgetCachedDeadlines, memoizedDeadlines, rememberDeadlines } from "./memo";

/**
 * Where the club's deadlines are kept and read (§NNN): one `platform_settings` row, the shape the
 * Mailgun plan (§100), the contact recipients (§164) and the declaration copies (§244) proved — a
 * strict schema, the Administrator's role asserted here and not only by the hidden form, and an
 * audit row naming who changed what from what to what.
 *
 * Three ways to read it, for three kinds of caller:
 * - `readDeadlines` — straight through, for the panel that sets it and the page it lands on;
 * - `currentDeadlines` — memoized for a minute per server instance, for the hot paths: every
 *   allocation and every confirmation needs two of these numbers, and a registration must not
 *   cost a second round trip for figures that change a few times a year;
 * - `readDeadlinesForRun` — fresh, once at the start of a maintenance run, and handed to the
 *   memo, so everything that run and its plan (`jobs/next-work.ts`) compute agrees on one value.
 * The public pages read it through the data cache instead (`public-cache/reads.ts`), because a
 * visitor must not wake the database (§333).
 */

export const DEADLINES_SETTING_KEY = "deadlines";
/** One fixed id per setting for the audit row; `…e001`–`…e007` are taken (§100, §164, §244, §247, §254, §280, §334). */
export const DEADLINES_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e008";

export type DeadlinesState = { deadlines: Deadlines; updatedAt: Date | null };

export async function readDeadlines<T extends Record<string, unknown>>(db: Database<T>): Promise<DeadlinesState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, DEADLINES_SETTING_KEY)).limit(1);
  if (!row) return { deadlines: { ...DEFAULT_DEADLINES }, updatedAt: null };
  return { deadlines: readDeadlinesValue(row.value), updatedAt: row.updatedAt };
}

/** The deadlines in force, from this instance's memo when it is fresh (`memo.ts`), else read and kept. */
export async function currentDeadlines<T extends Record<string, unknown>>(db: Database<T>): Promise<Deadlines> {
  const kept = memoizedDeadlines();
  if (kept) return kept;
  const { deadlines } = await readDeadlines(db);
  rememberDeadlines(deadlines);
  return deadlines;
}

/** A fresh read, left in the memo: the maintenance job reads the setting once per run. */
export async function readDeadlinesForRun<T extends Record<string, unknown>>(db: Database<T>): Promise<Deadlines> {
  const { deadlines } = await readDeadlines(db);
  rememberDeadlines(deadlines);
  return deadlines;
}

export async function updateDeadlines<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<DeadlinesState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the club's deadlines`);
  }
  const parsed = deadlinesSettingSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next: Deadlines = parsed.data;
  const before = await readDeadlines(db);
  const changed = changedDeadlines(before.deadlines, next);

  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: DEADLINES_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "deadlines.changed",
      entityType: "platform_setting",
      entityId: DEADLINES_SETTING_ENTITY_ID,
      // Only what moved, from and to: seven numbers every time would hide which one changed.
      metadata: {
        changed,
        from: Object.fromEntries(changed.map((key) => [key, before.deadlines[key]])),
        to: Object.fromEntries(changed.map((key) => [key, next[key]])),
      },
      now,
    });
  });

  forgetCachedDeadlines();
  // The form's five steps, the countdown and the legal texts on the public pages say these numbers.
  revalidatePublicContent("settings");
  // A longer reminder lead or series horizon can make the job's work due sooner than it planned (§334).
  wakeJobs("registration-maintenance");
  return { deadlines: next, updatedAt: now };
}
