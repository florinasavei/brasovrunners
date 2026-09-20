import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  type ContactRecipients,
  contactRecipientsSchema,
  DEFAULT_CONTACT_RECIPIENTS,
} from "./domain/recipients";

/**
 * Who receives the contact form's messages, as the club sets it (`DECISIONS.md` §164).
 *
 * The Mailgun plan's own shape (§100, `notifications/email-plan.ts`): one `platform_settings`
 * row, read by everything that needs it, written by an Administrator on `/admin/emails`, with
 * an audit row naming who changed it and from what. Addresses, never a password — the Gmail
 * account and its app password stay `CONTACT_SMTP_USER` / `CONTACT_SMTP_PASSWORD`.
 */

export const CONTACT_RECIPIENTS_SETTING_KEY = "contactRecipients";
/**
 * `audit_logs.entity_id` is a UUID and a setting has a key, so the audit row names the setting
 * by a fixed id of its own — one per key, never reused (`…e001` is the email plan's).
 */
export const CONTACT_RECIPIENTS_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e002";

export type ContactRecipientsState = ContactRecipients & { updatedAt: Date | null };

export async function readContactRecipients<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<ContactRecipientsState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, CONTACT_RECIPIENTS_SETTING_KEY))
    .limit(1);
  if (!row) return { ...DEFAULT_CONTACT_RECIPIENTS, updatedAt: null };
  // A stored value this code can no longer read falls back to "nobody", which sends the
  // resolution on to `CONTACT_FORM_TO` rather than crashing every page that asks: the safe
  // answer is the deployment's own list, the same reasoning as the plan's smallest ceiling.
  const parsed = contactRecipientsSchema.safeParse(row.value);
  return parsed.success
    ? { ...parsed.data, updatedAt: row.updatedAt }
    : { ...DEFAULT_CONTACT_RECIPIENTS, updatedAt: row.updatedAt };
}

/**
 * The same read for a page that must render whatever the database is doing.
 *
 * `/contact` and the header are the two places that ask, and both of them are the *fallback*
 * — the page whose job is to say "write to us at …" when something is broken, and the menu
 * that is a site's only way out of a page. Neon's compute suspends once the club's free
 * 100 CU-hours are spent (`DECISIONS.md` §68), and a build renders the layout with no
 * database at all (`db/client.ts`), so a throw here would turn the remedy into a 500.
 *
 * `null` is the honest answer and also the safe one: `resolveContactRecipients` reads it as
 * "the club has named nobody" and hands the question to `CONTACT_FORM_TO`, which is exactly
 * how the deployment behaved before §164. The `try` covers `getDb()` as well as the await,
 * because `getDb()` throws synchronously, as an argument — `SiteHeader.tsx` documents the
 * same trap and the same shape.
 */
export async function readContactRecipientsOrNull(): Promise<ContactRecipientsState | null> {
  try {
    return await readContactRecipients(getDb());
  } catch {
    return null;
  }
}

export async function updateContactRecipients<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<ContactRecipientsState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the contact recipients`);
  }
  const parsed = contactRecipientsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = parsed.data;

  const before = await readContactRecipients(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: CONTACT_RECIPIENTS_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "contact_recipients.changed",
      entityType: "platform_setting",
      entityId: CONTACT_RECIPIENTS_SETTING_ENTITY_ID,
      metadata: {
        from: { to: before.to, cc: before.cc },
        to: { to: next.to, cc: next.cc },
      },
      now,
    });
  });
  return { ...next, updatedAt: now };
}
