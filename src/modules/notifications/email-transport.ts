import { and, count, eq, gte, max } from "drizzle-orm";
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
  DEFAULT_EMAIL_TRANSPORT,
  type EmailTransportSetting,
  emailTransportSettingSchema,
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
  if (!row) return { ...DEFAULT_EMAIL_TRANSPORT, updatedAt: null };
  // A value this code can no longer read falls back to the default rather than stopping the
  // outbox: this is read before every batch the platform sends.
  const parsed = emailTransportSettingSchema.safeParse(row.value);
  return parsed.success
    ? { ...parsed.data, updatedAt: row.updatedAt }
    : { ...DEFAULT_EMAIL_TRANSPORT, updatedAt: row.updatedAt };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What Gmail carried in the last 24 hours and when it last sent — from the outbox's own
 * `transport` column, so the cap holds across batches, requests and instances.
 *
 * Rolling, not since midnight: Google counts a rolling day. The contact form's messages are not
 * in the outbox and are not counted here; the cap's default leaves room for them.
 */
export async function readGmailUsage<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  configured: boolean = gmailIsConfigured(),
): Promise<GmailUsage> {
  const [usage] = await db
    .select({ sent: count(), last: max(emailOutbox.sentAt) })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.transport, "gmail"), gte(emailOutbox.sentAt, new Date(now.getTime() - DAY_MS))));
  return { configured, sentLastDay: usage?.sent ?? 0, lastSentAt: usage?.last ?? null };
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
