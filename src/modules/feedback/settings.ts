import { eq } from "drizzle-orm";
import { z } from "zod";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { DEFAULT_FEEDBACK_SETTINGS, FEEDBACK_BRANCHES, type FeedbackBranch, type FeedbackSettings } from "./domain/branches";

/**
 * «Spune-ne ceva» on «Pagini» → «Contact» (§676): per branch a switch and the address that receives
 * it, and the safety branch's first name — one `platform_settings` row (the table is a key-value
 * store, so no migration), the contact recipients' shape (§164). Read by everybody who reads the
 * club's content; written by an Administrator (`canManageClubSettings`), audited — which branch moved
 * and in which direction, and whether a recipient changed, never an address.
 */

export const FEEDBACK_SETTING_KEY = "feedbackForms";
/** The audit row's fixed entity id for this key — one per key, never reused (§483). */
export const FEEDBACK_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0fe";

/** The first name the safety page shows («Mesajul ajunge doar la {name}»): one or two words, never a full name in code. */
export const SAFETY_NAME_MAX = 40;

const address = z
  .string()
  .trim()
  .max(320)
  .transform((value) => (value === "" ? null : value))
  .pipe(z.email().nullable());

/** A stored branch: a value this code cannot read is off, or no address — never a crash. */
const branch = z.object({ on: z.boolean().catch(false), to: z.email().nullable().catch(null) });

/** What a stored row is read with: anything unreadable is that branch off, never a crash. */
const storedSchema = z
  .object({
    howItWent: branch.catch(DEFAULT_FEEDBACK_SETTINGS.howItWent),
    suggestion: branch.catch(DEFAULT_FEEDBACK_SETTINGS.suggestion),
    complaint: branch.catch(DEFAULT_FEEDBACK_SETTINGS.complaint),
    safety: branch
      .extend({ name: z.string().trim().min(1).max(SAFETY_NAME_MAX).nullable().catch(null) })
      .catch(DEFAULT_FEEDBACK_SETTINGS.safety),
  })
  .partial();

/**
 * What a save is checked against: each address `z.email()` or empty; a branch switched on needs its
 * recipient, and the safety branch its first name too — a door that leads to nobody is not a door.
 */
const saveSchema = z
  .object({
    howItWent: z.object({ on: z.boolean(), to: address }),
    suggestion: z.object({ on: z.boolean(), to: address }),
    complaint: z.object({ on: z.boolean(), to: address }),
    safety: z.object({
      on: z.boolean(),
      to: address,
      name: z
        .string()
        .trim()
        .max(SAFETY_NAME_MAX)
        .refine((value) => !/[\r\n<>{}]/.test(value), { message: "one line, no markup" })
        .transform((value) => (value === "" ? null : value)),
    }),
  })
  .superRefine((value, context) => {
    for (const name of FEEDBACK_BRANCHES) {
      if (value[name].on && !value[name].to) context.addIssue({ code: "custom", path: [name, "to"], message: "a branch switched on needs a recipient" });
    }
    if (value.safety.on && !value.safety.name) context.addIssue({ code: "custom", path: ["safety", "name"], message: "the safety branch needs the first name it shows" });
  });

export type FeedbackSettingsState = FeedbackSettings & { updatedAt: Date | null };

function readStored(value: unknown): FeedbackSettings {
  const parsed = storedSchema.safeParse(value ?? {});
  const stored = parsed.success ? parsed.data : {};
  return {
    howItWent: stored.howItWent ?? DEFAULT_FEEDBACK_SETTINGS.howItWent,
    suggestion: stored.suggestion ?? DEFAULT_FEEDBACK_SETTINGS.suggestion,
    complaint: stored.complaint ?? DEFAULT_FEEDBACK_SETTINGS.complaint,
    safety: stored.safety ?? DEFAULT_FEEDBACK_SETTINGS.safety,
  };
}

export async function readFeedbackSettings<T extends Record<string, unknown>>(db: Database<T>): Promise<FeedbackSettingsState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, FEEDBACK_SETTING_KEY)).limit(1);
  if (!row) return { ...DEFAULT_FEEDBACK_SETTINGS, updatedAt: null };
  return { ...readStored(row.value), updatedAt: row.updatedAt };
}

/** Half a minute: the outbox renders a batch of thank-yous, the action sends a message — one read for all of them. */
const MEMO_MS = 30_000;
const memo = new WeakMap<object, { at: number; state: FeedbackSettingsState }>();

/** The same read, memoized per database for half a minute; a save on this instance forgets it. */
export async function readFeedbackSettingsMemo<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<FeedbackSettingsState> {
  const held = memo.get(db);
  if (held && now.getTime() - held.at >= 0 && now.getTime() - held.at < MEMO_MS) return held.state;
  const state = await readFeedbackSettings(db);
  memo.set(db, { at: now.getTime(), state });
  return state;
}

/** Saves the four branches. Administrator only, asserted here as well as in the action. */
export async function updateFeedbackSettings<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<FeedbackSettingsState> {
  if (!canManageClubSettings(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the feedback forms`);
  }
  const parsed = saveSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      // The box's own name, `howItWentTo` or `safetyName`, as the panel's form posts it.
      [...new Set(parsed.error.issues.map((issue) => boxName(issue.path)))],
    );
  }
  const next: FeedbackSettings = parsed.data;

  const before = await readFeedbackSettings(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: FEEDBACK_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "feedback_forms.changed",
      entityType: "platform_setting",
      entityId: FEEDBACK_SETTING_ENTITY_ID,
      // Which branch moved and which way, and which recipient changed — never an address or a name:
      // an audit row is read by more people than the setting (§483).
      metadata: auditOf(before, next),
      now,
    });
  });
  memo.delete(db);
  // The contact page's door and the feedback page read the switches through the public cache (§333).
  revalidatePublicContent("settings");
  return { ...next, updatedAt: now };
}

function boxName(path: readonly PropertyKey[]): string {
  const [branchName, field] = path.map(String);
  return field ? `${branchName}${field.charAt(0).toUpperCase()}${field.slice(1)}` : branchName;
}

export function auditOf(before: FeedbackSettings, next: FeedbackSettings): {
  switched: Array<{ branch: FeedbackBranch; on: boolean }>;
  recipientChanged: FeedbackBranch[];
  safetyNameChanged: boolean;
} {
  return {
    switched: FEEDBACK_BRANCHES.filter((name) => before[name].on !== next[name].on).map((name) => ({ branch: name, on: next[name].on })),
    recipientChanged: FEEDBACK_BRANCHES.filter((name) => (before[name].to ?? "").toLowerCase() !== (next[name].to ?? "").toLowerCase()),
    safetyNameChanged: (before.safety.name ?? "") !== (next.safety.name ?? ""),
  };
}
