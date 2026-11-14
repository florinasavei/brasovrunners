import { and, asc, eq, ne } from "drizzle-orm";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { rerankEventResults } from "@/modules/results/results";
import { canManageRegistrations, canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Marchează ca ambasador» / «Nu mai e ambasador» (§NNN; the owner, 2026-11-14: «pe lângă Elite, adaugă și categoria de
 * „Ambasadori" ca să putem decide pe cine premiem și pe cine nu», and asked what the mark should do, «Ca Elită, fără BIB
 * special»): the club's second category of invited runner, beside «Elită» (§897).
 *
 * **A label, and the two ticks it brings.** The mark itself changes nothing a runner or a visitor can see: not the bib —
 * it prints as any other, the number where the number goes — nor a state, a place, a race number, a count, a queue or an
 * email; the allocator never reads it (`AGENTS.md` §10.6). The backoffice draws it — on the registrations list, on the
 * registration's page, in «Clasament» and at «Premii» — so the club knows whose result it is looking at when it hands out
 * the awards. And a marked registration has the elite's two ticks (§910, `elite-mark.ts#setRegistrationEliteTick`):
 * «Apare în clasament», unticked, runs the result hors concours — out of the public results, of everybody's positions and
 * so of «Premii» — and «Apare pe site», unticked, reads the row on the public «Cine vine» as one that did not tick «Vreau
 * să apar». The ticks are the registration's, one pair whichever of the two marks it wears, and a staff tick only ever
 * hides.
 *
 * So it takes no event lock and asks no date or state: the club marks a runner the day it learns who its ambassadors are,
 * and unmarks them as freely — in any state, a cancelled row too.
 *
 * **Who** — the Administrator (`canManageRegistrations`), asserted here as at the action's door (BR-REQ-060-01); the
 * Organizer reads the chip and the panel, Tehnic nothing. **The trail** — `registration.ambassador_marked` or
 * `registration.ambassador_unmarked` on the registration, its metadata the new value alone. A press that finds the mark
 * already as asked (a stale list, a colleague first) writes nothing and no row.
 *
 * **When the ticks start or stop counting.** They count while the registration is marked «Elită» or «Ambasador». So this
 * mark put on or taken off changes what they do only on a registration that is not an elite: there, when «Apare în
 * clasament» was unticked the stored results are ranked again in the same transaction, and when either was unticked the
 * public pages are told after the commit.
 */
type Actor = Pick<StaffUser, "id" | "role">;

export async function setRegistrationAmbassador<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  registrationId: string,
  ambassador: boolean,
  now: Date,
): Promise<{ changed: boolean }> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not mark a registration an ambassador`);
  }
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");

  const outcome = await db.transaction(async (tx) => {
    // One statement: the mark changes only where it says otherwise, so a second press is a no-op and writes no row.
    const [changed] = await tx
      .update(registrations)
      .set({ ambassador, updatedAt: now })
      .where(and(eq(registrations.id, registrationId), ne(registrations.ambassador, ambassador)))
      .returning({
        id: registrations.id,
        eventId: registrations.eventId,
        elite: registrations.elite,
        hiddenFromResults: registrations.eliteHiddenFromResults,
        hiddenFromSite: registrations.eliteHiddenFromSite,
      });
    if (!changed) {
      const [exists] = await tx.select({ id: registrations.id }).from(registrations).where(eq(registrations.id, registrationId)).limit(1);
      if (!exists) throw new DomainError("NOT_FOUND", "no such registration");
      return { changed: false, public: false };
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: ambassador ? "registration.ambassador_marked" : "registration.ambassador_unmarked",
      entityType: "registration",
      entityId: changed.id,
      metadata: { ambassador },
      now,
    });
    // An elite's ticks count already, whatever this mark does; on anybody else they start or stop counting here.
    const ticksMove = !changed.elite;
    if (ticksMove && changed.hiddenFromResults) await rerankEventResults(tx, changed.eventId);
    return { changed: true, public: ticksMove && (changed.hiddenFromResults || changed.hiddenFromSite) };
  });
  if (outcome.public) revalidatePublicContent("events", "places");
  return { changed: outcome.changed };
}

/** A registration marked «Ambasador», as the registrations page's «Ambasadori» panel lists it, with its two ticks as they stand. */
export type AmbassadorMarkedRow = {
  id: string;
  name: string;
  status: RegistrationStatus;
  bibNumber: number | null;
  /** Also marked «Elită»: its bib prints as an elite's. */
  elite: boolean;
  /** «Apare în clasament» and «Apare pe site» (§910): ticked unless the club hid it. */
  inResults: boolean;
  onSite: boolean;
};

/**
 * The registrations marked «Ambasador» at one event, for the registrations page's «Ambasadori» panel — read-only there,
 * beside «Elite». Every state, each said by its chip — the mark is kept on a cancelled row, which a restart keeps — by
 * name; a test row is left out, as from every figure the club is given (`AGENTS.md` §12.6). The Organizer and above
 * (`canReadRegistrations`, the list's own gate), asserted here as at the page (BR-REQ-060-01).
 */
export async function listAmbassadorMarkedRegistrations<T extends Record<string, unknown>>(db: Database<T>, actor: Pick<StaffUser, "role">, eventId: string): Promise<AmbassadorMarkedRow[]> {
  if (!canReadRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read an event's registrations`);
  }
  if (!isUuid(eventId)) return [];
  const rows = await db
    .select({
      id: registrations.id,
      name: registrations.registeredName,
      status: registrations.status,
      bibNumber: registrations.bibNumber,
      elite: registrations.elite,
      hiddenFromResults: registrations.eliteHiddenFromResults,
      hiddenFromSite: registrations.eliteHiddenFromSite,
    })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.ambassador, true), eq(registrations.kind, "REAL")))
    .orderBy(asc(registrations.registeredName), asc(registrations.id));
  return rows.map(({ hiddenFromResults, hiddenFromSite, ...row }) => ({ ...row, inResults: !hiddenFromResults, onSite: !hiddenFromSite }));
}
