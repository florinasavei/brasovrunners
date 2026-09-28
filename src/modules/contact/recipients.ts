import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  type ContactRecipients,
  contactRecipientsSchema,
  DEFAULT_CONTACT_RECIPIENTS,
} from "./domain/recipients";

/**
 * Who receives the contact form's messages (§164): one audited `platform_settings` row, the
 * shape of the Mailgun plan's (§100). Addresses only; the Gmail password stays in the environment.
 */

export const CONTACT_RECIPIENTS_SETTING_KEY = "contactRecipients";
/** `audit_logs.entity_id` is a UUID, so each setting key has a fixed id, never reused. */
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
  // Unreadable reads as "nobody", which falls back to `CONTACT_FORM_TO` instead of crashing.
  const parsed = contactRecipientsSchema.safeParse(row.value);
  return parsed.success
    ? { ...parsed.data, updatedAt: row.updatedAt }
    : { ...DEFAULT_CONTACT_RECIPIENTS, updatedAt: row.updatedAt };
}

/**
 * For `/contact` and the header, which must render with a suspended or absent database (§68, a
 * build): `null` falls back to `CONTACT_FORM_TO`. The `try` also covers `getDb()`, which throws
 * synchronously.
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
  if (!canManageClubSettings(actor.role)) {
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
        from: { to: before.to, cc: before.cc, bcc: before.bcc },
        to: { to: next.to, cc: next.cc, bcc: next.bcc },
      },
      now,
    });
  });
  // The header and contact page read this through the public cache (§333).
  revalidatePublicContent("settings");
  return { ...next, updatedAt: now };
}
