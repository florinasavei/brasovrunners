import { and, eq, gt, gte, max, min, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import {
  defaultEmailTransportFor,
  type EmailTransportSetting,
  GMAIL_WINDOW_MS,
  emailTransportSettingSchema,
  gmailAdmission,
  type GmailLedger,
  type GmailUsage,
} from "./domain/email-transport";

/**
 * Which road each group of emails takes, and Gmail's cap and pace (§NNN) — read by the outbox
 * worker once per batch, written by an Administrator on `/admin/emails`.
 *
 * The same shape as the Mailgun plan beside it (§100): one `platform_settings` row, a strict
 * schema, an audit row naming who changed it and from what, and the Administrator's gate —
 * both spend the club's allowance, one by saying how big it is, this by saying what uses it.
 */

export const EMAIL_TRANSPORT_SETTING_KEY = "emailTransport";
/** One fixed id per setting key, never reused, as `email-plan.ts` does. */
export const EMAIL_TRANSPORT_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0a8";

export type EmailTransportState = EmailTransportSetting & { updatedAt: Date | null };

/**
 * Whether this deployment has the club's Gmail at all: the account and its app password — the
 * same two variables the contact form sends with (§149). Local and test have neither, so every
 * message there takes Mailgun's road, into the capture, exactly as before this setting existed.
 */
export function gmailIsConfigured(config: Pick<typeof env, "CONTACT_SMTP_USER" | "CONTACT_SMTP_PASSWORD"> = env): boolean {
  return Boolean(config.CONTACT_SMTP_USER && config.CONTACT_SMTP_PASSWORD);
}

export async function readEmailTransport<T extends Record<string, unknown>>(db: Database<T>): Promise<EmailTransportState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, EMAIL_TRANSPORT_SETTING_KEY))
    .limit(1);
  // Production's default, or a smaller Gmail share where the account is production's too (§NNN).
  const fallback = defaultEmailTransportFor(env.APP_ENV);
  if (!row) return { ...fallback, updatedAt: null };
  // A value this code can no longer read falls back to the default rather than stopping the
  // outbox: this is read before every batch the platform sends.
  const parsed = emailTransportSettingSchema.safeParse(row.value);
  return parsed.success
    ? { ...parsed.data, updatedAt: row.updatedAt }
    : { ...fallback, updatedAt: row.updatedAt };
}

/**
 * How many recipients Gmail reached in the last 24 hours, when it last sent and when the oldest of
 * those sends was — from the outbox's own `transport` and `recipient_count` columns, so the cap
 * holds across batches, requests and instances.
 *
 * Rolling, not since midnight, and in recipients, not messages: Google counts both that way
 * (`domain/email-transport.ts#GMAIL_DAILY_CAP_MAX`). A captured row reached nobody
 * (`recipient_count` 0) and is not counted. The contact form's messages, the people writing by
 * hand and the other environment on the same account are not in this outbox; the cap's default
 * leaves room for them.
 */
export async function readGmailUsage<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  configured: boolean = gmailIsConfigured(),
): Promise<GmailUsage> {
  const [usage] = await db
    .select({
      sent: sql<string | null>`sum(${emailOutbox.recipientCount})`,
      last: max(emailOutbox.sentAt),
      oldest: min(emailOutbox.sentAt),
    })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.transport, "gmail"),
        gt(emailOutbox.recipientCount, 0),
        gte(emailOutbox.sentAt, new Date(now.getTime() - GMAIL_WINDOW_MS)),
      ),
    );
  return {
    configured,
    sentLastDay: Number(usage?.sent ?? 0),
    lastSentAt: usage?.last ? new Date(usage.last) : null,
    oldestInWindowAt: usage?.oldest ? new Date(usage.oldest) : null,
  };
}

/** The latest Gmail slot any sender holds (§NNN review): one row every sender takes in turn. */
export const GMAIL_SLOT_KEY = "gmailSlot";

/**
 * Gmail's ledger in the database (§NNN review), shared by every sender in every instance.
 *
 * Before each Gmail message the sender asks it, and it answers from the outbox itself — the rolling
 * day's recipients and the last `sent_at`, which is the moment Gmail took the message, not the
 * batch's start — plus the latest slot another sender holds. The read and the hold are one short
 * transaction behind a row lock on the slot row (`FOR UPDATE`), never around the SMTP call: two
 * senders asking at once are answered one after the other, and the second paces from the first's
 * slot. What the lock cannot see is a message another sender is sending this very second against
 * the cap — at most one per sender in flight, under a cap set well below Google's 500.
 */
export function createGmailLedger<T extends Record<string, unknown>>(db: Database<T>): GmailLedger {
  return {
    async admit(request) {
      return db.transaction(async (tx) => {
        await tx
          .insert(platformSettings)
          .values({ key: GMAIL_SLOT_KEY, value: { at: null }, updatedAt: request.clock(), updatedByStaffUserId: null })
          .onConflictDoNothing({ target: platformSettings.key });
        const [slot] = await tx
          .select({ value: platformSettings.value })
          .from(platformSettings)
          .where(eq(platformSettings.key, GMAIL_SLOT_KEY))
          .for("update");
        // The clock once this sender has its turn: a slot taken before the wait for the lock would be stale.
        const now = request.clock();
        const usage = await readGmailUsage(tx, now, true);
        const heldValue = (slot?.value as { at?: unknown } | undefined)?.at;
        const held = typeof heldValue === "string" ? new Date(heldValue) : null;
        const lastSentAt =
          held && !Number.isNaN(held.getTime()) && (!usage.lastSentAt || held > usage.lastSentAt) ? held : usage.lastSentAt;
        const admission = gmailAdmission(
          { ...usage, lastSentAt },
          { gmailDailyCap: request.dailyCap, gmailPaceSeconds: request.paceSeconds },
          now,
          request.recipients,
          request.jitterMs,
        );
        if (admission.admitted && admission.waitMs <= request.maxWaitMs) {
          const slotAt = new Date(now.getTime() + admission.waitMs);
          await tx
            .update(platformSettings)
            .set({ value: { at: slotAt.toISOString() }, updatedAt: now })
            .where(eq(platformSettings.key, GMAIL_SLOT_KEY));
          return { ...admission, slotAt };
        }
        return admission;
      });
    },
    // Nothing to note: the outbox writes the row's `sent_at` with the moment Gmail took it.
    async accepted() {},
  };
}

/** The last time Gmail refused or broke (§NNN), kept beside the setting; never a body, an address or a secret. */
export const GMAIL_LAST_FAILURE_KEY = "gmailLastFailure";

export type GmailFailure = { at: Date; error: string };

/**
 * Record a Gmail failure the sender met — a revoked app password, a refused login, a connection
 * that broke. Without this, every Gmail message quietly fell back to Mailgun and spent its allowance
 * with nobody told; now `/admin/emails` and `/api/health` say when and why. The error is the
 * adapter's already-sanitized code (`smtp EAUTH`), never the server's reply (§14.5).
 */
export async function recordGmailFailure<T extends Record<string, unknown>>(db: Database<T>, error: string, at: Date): Promise<void> {
  const value = { at: at.toISOString(), error: error.slice(0, 200) };
  await db
    .insert(platformSettings)
    .values({ key: GMAIL_LAST_FAILURE_KEY, value, updatedAt: at, updatedByStaffUserId: null })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: at, updatedByStaffUserId: null } });
}

export async function readGmailLastFailure<T extends Record<string, unknown>>(db: Database<T>): Promise<GmailFailure | null> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, GMAIL_LAST_FAILURE_KEY))
    .limit(1);
  const value = row?.value as { at?: unknown; error?: unknown } | undefined;
  if (!value || typeof value.at !== "string" || typeof value.error !== "string") return null;
  const at = new Date(value.at);
  return Number.isNaN(at.getTime()) ? null : { at, error: value.error };
}

/**
 * Gmail's part of "can the club still send email?" (§98, §NNN): what it carried against its cap and
 * its last failure. Reported, never a status of its own — a Gmail failure falls back to Mailgun or
 * is retried by the outbox, and the outbox's own counts already turn a real stall into the 503.
 */
export type GmailHealth = {
  configured: boolean;
  sentLastDay: number;
  cap: number;
  lastFailureAt: string | null;
  lastFailure: string | null;
};

export async function checkGmailHealth<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<GmailHealth> {
  const configured = gmailIsConfigured();
  const [setting, failure, usage] = await Promise.all([
    readEmailTransport(db),
    readGmailLastFailure(db),
    configured ? readGmailUsage(db, now, true) : Promise.resolve(null),
  ]);
  return {
    configured,
    sentLastDay: usage?.sentLastDay ?? 0,
    cap: setting.gmailDailyCap,
    lastFailureAt: failure ? failure.at.toISOString() : null,
    lastFailure: failure?.error ?? null,
  };
}

export async function updateEmailTransport<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<EmailTransportState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change how email is sent`);
  }
  const parsed = emailTransportSettingSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      // The form's box names: `groups.club` is posted as `club`.
      parsed.error.issues.map((issue) => String(issue.path.at(-1) ?? "")),
    );
  }
  const next = parsed.data;
  const before = await readEmailTransport(db);

  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: EMAIL_TRANSPORT_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "email_transport.changed",
      entityType: "platform_setting",
      entityId: EMAIL_TRANSPORT_SETTING_ENTITY_ID,
      metadata: {
        from: {
          groups: before.groups,
          gmailDailyCap: before.gmailDailyCap,
          gmailPaceSeconds: before.gmailPaceSeconds,
          atGmailCap: before.atGmailCap,
          overflowToGmail: before.overflowToGmail,
        },
        to: next,
      },
      now,
    });
  });
  // A row deferred to Mailgun's reset may now go through Gmail: the outbox job looks again.
  wakeJobs("email-outbox");
  return { ...next, updatedAt: now };
}
