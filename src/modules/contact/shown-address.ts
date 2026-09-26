import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import {
  DEFAULT_SHOWN_CONTACT_ADDRESS,
  resolveShownContactAddresses,
  replyToHeader,
  type ShownContactAddress,
  shownContactAddressSchema,
} from "./domain/shown-address";

/**
 * «Adresa de contact afișată» (§NNN): the contact-recipients setting's shape (§164) — one
 * `platform_settings` row, written by an Administrator on `/admin/emails`, audited, read by
 * everything that shows the club's address or sets an email's Reply-To.
 */

export const SHOWN_CONTACT_ADDRESS_SETTING_KEY = "shownContactAddress";
/** The audit row's fixed entity id for this key — one per key, never reused (`…e002` is the contact recipients'). */
export const SHOWN_CONTACT_ADDRESS_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e00a";

export type ShownContactAddressState = ShownContactAddress & { updatedAt: Date | null };

export async function readShownContactAddress<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<ShownContactAddressState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, SHOWN_CONTACT_ADDRESS_SETTING_KEY))
    .limit(1);
  if (!row) return { ...DEFAULT_SHOWN_CONTACT_ADDRESS, updatedAt: null };
  // A value this code can no longer read is the default — the environment's mailbox, as before.
  const parsed = shownContactAddressSchema.safeParse(row.value);
  return parsed.success
    ? { ...parsed.data, updatedAt: row.updatedAt }
    : { ...DEFAULT_SHOWN_CONTACT_ADDRESS, updatedAt: row.updatedAt };
}

/**
 * The addresses in force, straight from the database, for a caller that already holds one — the
 * outbox's senders, the legal prefill. A database that cannot answer gives the environment's
 * mailbox: the Reply-To every email carried before §NNN.
 */
export async function shownContactAddresses<T extends Record<string, unknown>>(db: Database<T>): Promise<string[]> {
  try {
    return resolveShownContactAddresses(await readShownContactAddress(db), env.EMAIL_REPLY_TO);
  } catch {
    return resolveShownContactAddresses(null, env.EMAIL_REPLY_TO);
  }
}

/** The same list as one Reply-To header value, or nothing. */
export async function replyToInForce<T extends Record<string, unknown>>(db: Database<T>): Promise<string | undefined> {
  return replyToHeader(await shownContactAddresses(db));
}

/** For a page with no database handle of its own; `getDb()` throws synchronously, hence the `try`. */
export async function shownContactAddressesOrDefault(): Promise<string[]> {
  try {
    return await shownContactAddresses(getDb());
  } catch {
    return resolveShownContactAddresses(null, env.EMAIL_REPLY_TO);
  }
}

export async function updateShownContactAddress<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<ShownContactAddressState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the shown contact address`);
  }
  const parsed = shownContactAddressSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next = parsed.data;

  const before = await readShownContactAddress(db);
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: SHOWN_CONTACT_ADDRESS_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "shown_contact_address.changed",
      entityType: "platform_setting",
      entityId: SHOWN_CONTACT_ADDRESS_SETTING_ENTITY_ID,
      metadata: { from: { mode: before.mode, gmail: before.gmail }, to: { mode: next.mode, gmail: next.gmail } },
      now,
    });
  });
  // The footer and the contact page read the address from the public cache (§333).
  revalidatePublicContent("settings");
  return { ...next, updatedAt: now };
}
