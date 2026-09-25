import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { forgetCachedAddressCap, memoizedAddressCap, rememberAddressCap } from "./address-cap-memo";
import { type AddressCap, addressCapSettingSchema, DEFAULT_ADDRESS_CAP, readAddressCapValue } from "./domain/address-cap";

/**
 * Where the club's registrations-per-address limit is kept and read (§389): one `platform_settings`
 * row in the shape of the club's deadlines (§377) — a strict schema, the Administrator's role
 * asserted here and not only by the hidden form, an audit row naming who changed it from what to
 * what, and a save that changes nothing writes nothing.
 *
 * Two ways to read it:
 * - `readAddressCap` — straight through, for the panel that sets it and the guide that states it;
 * - `currentAddressCap` — memoized for a minute per server instance (`address-cap-memo.ts`), for the
 *   submission paths, which must not pay a round trip for a number that changes a few times a year.
 *   Read before the submission's transaction, never under the event's lock (§377's rule).
 *
 * No public page states the number, so there is no data-cache read of it: the email says it (from
 * the payload the submission wrote), and the form behind the emailed link reads it with the token.
 */

export const ADDRESS_CAP_SETTING_KEY = "registrations-per-address";
/** One fixed id per setting for the audit row; `…e001`–`…e008` are taken (§100 … §377). */
export const ADDRESS_CAP_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e009";

export type AddressCapState = { cap: AddressCap; updatedAt: Date | null };

export async function readAddressCap<T extends Record<string, unknown>>(db: Database<T>): Promise<AddressCapState> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, ADDRESS_CAP_SETTING_KEY)).limit(1);
  if (!row) return { cap: { ...DEFAULT_ADDRESS_CAP }, updatedAt: null };
  return { cap: readAddressCapValue(row.value), updatedAt: row.updatedAt };
}

/** The limit in force, from this instance's memo when it is fresh, else read and kept. */
export async function currentAddressCap<T extends Record<string, unknown>>(db: Database<T>): Promise<AddressCap> {
  const kept = memoizedAddressCap();
  if (kept) return kept;
  const { cap } = await readAddressCap(db);
  rememberAddressCap(cap);
  return cap;
}

export async function updateAddressCap<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  rawInput: unknown,
  now: Date,
): Promise<AddressCapState> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the registrations-per-address limit`);
  }
  const parsed = addressCapSettingSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
    );
  }
  const next: AddressCap = parsed.data;
  const before = await readAddressCap(db);
  // A save that moves nothing writes nothing: no row, no audit entry (§377's rule).
  if (before.cap.registrationsPerAddress === next.registrationsPerAddress) return before;

  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: ADDRESS_CAP_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id },
      });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "registrationsPerAddress.changed",
      entityType: "platform_setting",
      entityId: ADDRESS_CAP_SETTING_ENTITY_ID,
      metadata: { from: before.cap.registrationsPerAddress, to: next.registrationsPerAddress },
      now,
    });
  });

  forgetCachedAddressCap();
  return { cap: next, updatedAt: now };
}
