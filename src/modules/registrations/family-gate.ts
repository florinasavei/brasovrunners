import { sql } from "drizzle-orm";
import type { Database } from "@/db/types";

/**
 * Whether a second runner may be registered on an address that already holds a registration at an
 * event (§NNN) — which is a question about the schema, not a setting.
 *
 * The rule that made one address one registration is a unique constraint,
 * `registrations_event_participant_unique`. Its replacement — one registration per address, per
 * event, per runner's name (`registrations_event_participant_name_unique`) — is added beside it in
 * migration `0071`; the old one is dropped by a contract migration of its own in a **later**
 * release (AGENTS.md §7.6: a drop ships after the code stopped relying on what it drops, and the
 * code that served before this release still reads "one row per address" into
 * `findRegistrationByEventAndParticipant`). Until that release, a second row would be refused by
 * the database — so the flow must not offer a link it cannot honour.
 *
 * So the flow switches itself on when the old constraint is gone, the way the minor's second
 * signature switches on with the declaration's text (§330): no flag, no deploy. While it stands,
 * the public form behaves exactly as it did — a second name on a registered address is the
 * same-person re-send (§199) — and the emailed link is never offered.
 *
 * Asked only on the paths that need it — a different name on an address that holds an active
 * registration, and the page and submission behind the emailed link — which are rare, and the
 * question is one indexed catalogue read. Never memoized: the answer changes once, when the
 * contract migration runs, and a stale "no" would only keep today's behaviour a little longer, but a
 * stale "yes" on a test database recreated with the constraint would offer a link that fails.
 */
export const LEGACY_ONE_PER_ADDRESS_CONSTRAINT = "registrations_event_participant_unique";

export async function familyRegistrationOpen<T extends Record<string, unknown>>(db: Database<T>): Promise<boolean> {
  const result = await db.execute<{ present: number }>(
    sql`SELECT 1 AS present FROM pg_constraint WHERE conname = ${LEGACY_ONE_PER_ADDRESS_CONSTRAINT} AND conrelid = 'registrations'::regclass LIMIT 1`,
  );
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
  return rows.length === 0;
}
