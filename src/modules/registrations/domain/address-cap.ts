import { z } from "zod";

/**
 * "Maxim de înscrieri pe o adresă (pe eveniment)" — how many registrations one email address may
 * carry at one event (§NNN; the owner, 2026-09-25: "sometimes people register as a family… there
 * must be a max number of people with the same email").
 *
 * One club setting (`platform_settings`, key `registrations-per-address`), in the shape of the
 * club's deadlines (§377): a strict schema, the Administrator's alone, audited, and unset means the
 * default. It counts the address's *active* registrations at the event — a cancelled or lapsed one
 * frees its slot — whatever their kind, because a test registration behaves exactly like a real one
 * in the queue (§30). It is enforced under the event's lock when another person's registration is
 * created from the emailed link (`service.ts`), and it decides whether that email offers the link
 * at all.
 *
 * Pure and client-safe, like `deadlines/domain/deadlines.ts`: the panel's box reads the bounds,
 * the service the schema, the lenient reader everything else.
 */

export const ADDRESS_CAP_RULE = {
  /** One is "a person per address": the family flow offers nothing, and says so. */
  min: 1,
  /** Ten: a club's whole family table, and still a number a person can check at the desk. */
  max: 10,
  /** Four: two parents, two children — the owner's "up to 4 QR codes". */
  default: 4,
} as const;

export type AddressCap = { registrationsPerAddress: number };

export const DEFAULT_ADDRESS_CAP: AddressCap = Object.freeze({ registrationsPerAddress: ADDRESS_CAP_RULE.default });

/**
 * What a save must be: one whole number inside the bounds, and nothing else. An empty box is refused
 * rather than read as zero — the same reason the deadlines give (§377).
 */
export const addressCapSettingSchema = z
  .object({
    registrationsPerAddress: z.preprocess(
      (value) => (typeof value === "string" ? (/^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN) : value),
      z.number().int().min(ADDRESS_CAP_RULE.min).max(ADDRESS_CAP_RULE.max),
    ),
  })
  .strict();

/**
 * The stored value, leniently: a whole number inside today's bounds, or the default. A row written
 * by another version of this code must never make a submission throw.
 */
export function readAddressCapValue(value: unknown): AddressCap {
  const raw = value !== null && typeof value === "object" ? (value as Record<string, unknown>).registrationsPerAddress : undefined;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= ADDRESS_CAP_RULE.min && raw <= ADDRESS_CAP_RULE.max) {
    return { registrationsPerAddress: raw };
  }
  return { ...DEFAULT_ADDRESS_CAP };
}

/**
 * Whether one more registration fits on an address that holds `active` at the event now. The one
 * comparison, for the email (link or no link) and for the creation under the lock alike, so the two
 * can never disagree about where the limit is.
 */
export function addressHasRoom(active: number, cap: AddressCap): boolean {
  return active < cap.registrationsPerAddress;
}
