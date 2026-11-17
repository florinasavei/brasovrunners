import { type SQL, sql } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";

/**
 * Whether the event offers the members' race number (§664): its bib design's `member.enabled`, read as
 * `bib-design.ts#readBibDesign` reads it — on only for a JSON true, off for anything else or nothing. One third of the
 * rule below, and read nowhere else in SQL (§972: no form asks anything from it any more). Over `events` as the query
 * names it: inside `PRINTS_MEMBER_BIB` that is the `EXISTS`'s own row.
 */
export const OFFERS_MEMBER_BIB = sql<boolean>`coalesce((${events.bibDesign} #> '{member,enabled}') = 'true'::jsonb, false)`.mapWith(Boolean);

/*
  The two halves of the rule, each its own nested piece: Drizzle prints a selection's own top-level columns bare in a
  one-table select (`listBibs` selects from `registrations` alone), and a bare `"id"` inside the `EXISTS` would be the
  event's. A column inside a nested piece always prints qualified, so the condition reads the same in any query.
*/
const DECLARED_AND_NOT_ELITE = sql`(${registrations.clubMemberDeclared} and not ${registrations.elite})`;
/**
 * The registration's event offers it, through its own `EXISTS` over `events` — never through the caller's joins, so a
 * query that joins no `events` (the sheet's) and one that joins it (the list's) ask the same thing.
 */
const EVENT_OFFERS_IT = sql`exists (select 1 from ${events} where ${events.id} = ${registrations.eventId} and ${OFFERS_MEMBER_BIB})`;

/**
 * Whether a registration prints with the members' race number (§664, §972) — the one rule, as SQL over a registration
 * row: the event's bib design offers it, the person ticked «Sunt membru al grupului {club}», and the registration is
 * not marked «Elită» (§897). No account on «Echipa», no «Vreau numărul de membru», no `kind`, no state.
 *
 * `domain/member-bib.ts#printsMemberBib` is the same rule in TypeScript, for a caller holding the three facts already;
 * `tests/integration/registrations/member-bib-declared.test.ts` runs both over every combination, and
 * `tests/unit/registrations/member-bib-callers.test.ts` reads every caller.
 *
 * Built from this module's own pieces and the schema alone — no other module's export is read while it is defined — so
 * a test that stands in for a repository module never finds it half-made.
 */
export const PRINTS_MEMBER_BIB: SQL<boolean> = sql<boolean>`(${DECLARED_AND_NOT_ELITE} and ${EVENT_OFFERS_IT})`.mapWith(Boolean);
