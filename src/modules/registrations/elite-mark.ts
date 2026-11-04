import { and, asc, eq, ne } from "drizzle-orm";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { rerankEventResults } from "@/modules/results/results";
import { canManageRegistrations, canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Marchează ca elită» / «Nu mai e elită» (§897; the owner, 2026-11-03: «ar trebui să pot marca pe cineva ca elită
 * oricând», and asked what happens to the registration, «Rămâne înscris»): a registration whose bib prints as an elite
 * bib — the name where the number goes, laid out and drawn by the elite list's own code (§895: `bib-elite.ts`,
 * `bib-geometry.ts#bibEliteLayout`, `bibs-pdf.ts`, `bib-image.tsx`), its own race number under the name only with
 * «Număr pe BIB-urile de elită» ticked and the sponsors' row only with «Banda de sponsori pe BIB-urile de elită».
 *
 * **A mark on how the bib prints, and nothing else.** No state, no place, no race number (it stays the registration's,
 * never freed or drawn again), no count, no queue and no email: this touches one boolean column and the trail, never
 * the allocator (`AGENTS.md` §10.6) nor the outbox. So it takes no event lock, and asks no date or state: the club
 * marks a runner the day it learns who the elite are, and unmarks them as freely — in any state, a cancelled row too
 * (its bib does not print; the mark waits for a restart, which keeps it, like the number).
 *
 * **Who** — the Administrator (`canManageRegistrations`), asserted here as at the action's door (BR-REQ-060-01);
 * the Organizer reads the chip and the elite card, Tehnic nothing. **The trail** — `registration.elite_marked` or
 * `registration.elite_unmarked` on the registration, its metadata the new value alone. A press that finds the mark
 * already as asked (a stale list, a colleague first) writes nothing and no row.
 *
 * **The elite's two ticks (§910; the owner, 2026-11-04).** On a marked registration the Administrator may untick
 * «Apare în clasament» — its result runs hors concours: out of the public results and of everybody's positions — and
 * «Apare pe site» — the public «Cine vine» reads it as one that did not tick «Vreau să apar». **A staff tick only ever
 * hides**: ticked is no override at all, and the person's own ticks decide (`registrations.elite_hidden_from_*`), so
 * nobody is shown whom their own consent does not show. The ticks have effect only while the mark is on — the mark
 * taken off leaves them inert, the mark put back finds them as they were — which is why a mark put on or taken off
 * ranks the results again and tells the public pages when either is set.
 */
type Actor = Pick<StaffUser, "id" | "role">;

/**
 * Where a mark put on from the start came from (§917): the staff entry's «Elită» tick, or the invitation's, carried onto
 * the registration it became. Absent for «Marchează ca elită» itself, whose trail keeps the new value alone.
 */
export type EliteMarkVia = "entry" | "invitation";

/** What one write of the mark did: whether it changed, and whether the public pages must be told after the commit. */
export type EliteMarkWritten = { changed: boolean; public: boolean };

/**
 * The mark written inside the caller's transaction — the one body of «Marchează ca elită» (`setRegistrationElite`), of the
 * staff entry's «Elită» tick (`admin-service.ts#createRegistrationByStaff`) and of an invitation sent with it
 * (`service.ts#seatInvitedRegistration`, `markInvitationAdopted`), so the three can never mark differently (§917).
 *
 * One statement: the mark changes only where it says otherwise, so a second press is a no-op and writes no row. Then the
 * trail — `registration.elite_marked` / `registration.elite_unmarked` on the registration, `{ elite }` and, from the
 * entry or an invitation, `via` — and, when «Apare în clasament» was unticked (§910), the results ranked again in the same
 * transaction. `public` says the caller must tell the public pages after its commit (`revalidatePublicContent`).
 * Who may is the caller's to assert: `actorStaffUserId` is whoever the trail names (an invitation's sender may be gone).
 */
export async function writeRegistrationEliteMark<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  actorStaffUserId: string | null,
  registrationId: string,
  elite: boolean,
  now: Date,
  via?: EliteMarkVia,
): Promise<EliteMarkWritten> {
  const [changed] = await tx
    .update(registrations)
    .set({ elite, updatedAt: now })
    .where(and(eq(registrations.id, registrationId), ne(registrations.elite, elite)))
    .returning({ id: registrations.id, eventId: registrations.eventId, hiddenFromResults: registrations.eliteHiddenFromResults, hiddenFromSite: registrations.eliteHiddenFromSite });
  if (!changed) {
    const [exists] = await tx.select({ id: registrations.id }).from(registrations).where(eq(registrations.id, registrationId)).limit(1);
    if (!exists) throw new DomainError("NOT_FOUND", "no such registration");
    return { changed: false, public: false };
  }
  await recordAuditEvent(tx, {
    actorStaffUserId,
    action: elite ? "registration.elite_marked" : "registration.elite_unmarked",
    entityType: "registration",
    entityId: changed.id,
    metadata: via ? { elite, via } : { elite },
    now,
  });
  // The two ticks (§910) count only under the mark: a hidden result returns to the ranking, or leaves it again.
  if (changed.hiddenFromResults) await rerankEventResults(tx, changed.eventId);
  return { changed: true, public: changed.hiddenFromResults || changed.hiddenFromSite };
}

export async function setRegistrationElite<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  registrationId: string,
  elite: boolean,
  now: Date,
): Promise<{ changed: boolean }> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not mark a registration elite`);
  }
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");

  const outcome = await db.transaction((tx) => writeRegistrationEliteMark(tx, actor.id, registrationId, elite, now));
  if (outcome.public) revalidatePublicContent("events", "places");
  return { changed: outcome.changed };
}

/** The two ticks of a marked registration (§910), by the names the forms post. */
export const REGISTRATION_ELITE_TICKS = ["inResults", "onSite"] as const;
export type RegistrationEliteTick = (typeof REGISTRATION_ELITE_TICKS)[number];

export function isRegistrationEliteTick(value: unknown): value is RegistrationEliteTick {
  return typeof value === "string" && (REGISTRATION_ELITE_TICKS as readonly string[]).includes(value);
}

/** The trail's word for a tick and the state it now stands in. */
function tickAction(tick: RegistrationEliteTick, shown: boolean): AuditAction {
  if (tick === "inResults") return shown ? "registration.elite_in_results" : "registration.elite_out_of_results";
  return shown ? "registration.elite_on_site" : "registration.elite_off_site";
}

/**
 * «Apare în clasament» / «Apare pe site» on a registration marked «Elită» (§910): `shown` is the tick as it should now stand —
 * false hides (out of the ranking; off the public «Cine vine» by name), true takes the club's hide away and leaves the person's own
 * ticks to decide, exactly as before the mark. Nothing here can show a runner their own ticks do not show.
 *
 * The Administrator's (FORBIDDEN otherwise). A registration that is not there is NOT_FOUND; one that is not marked «Elită» is refused
 * (`ELITE_NOT_MARKED`: the ticks are an elite's — a stale menu, a colleague who took the mark off). A press that finds the tick as asked
 * writes nothing and no row. Otherwise one statement, one audit row on the registration with the new value alone (`{ inResults }` or
 * `{ onSite }`), the stored results ranked again in the same transaction for «Apare în clasament», and the public pages told after it.
 * No state, place, number, count or email moves.
 */
export async function setRegistrationEliteTick<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  registrationId: string,
  tick: RegistrationEliteTick,
  shown: boolean,
  now: Date,
): Promise<{ changed: boolean; eventId: string }> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change an elite's ticks`);
  }
  if (!isRegistrationEliteTick(tick)) throw new DomainError("VALIDATION_ERROR", "no such tick on an elite", ["tick"]);
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");

  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: registrations.id, eventId: registrations.eventId, elite: registrations.elite, hiddenFromResults: registrations.eliteHiddenFromResults, hiddenFromSite: registrations.eliteHiddenFromSite })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
      .for("update");
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    if (!current.elite) throw new DomainError("ELITE_NOT_MARKED", "the registration is not marked elite");
    const hidden = tick === "inResults" ? current.hiddenFromResults : current.hiddenFromSite;
    if (hidden === !shown) return { changed: false, eventId: current.eventId };
    await tx
      .update(registrations)
      .set(tick === "inResults" ? { eliteHiddenFromResults: !shown, updatedAt: now } : { eliteHiddenFromSite: !shown, updatedAt: now })
      .where(eq(registrations.id, current.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: tickAction(tick, shown), entityType: "registration", entityId: current.id, metadata: { [tick]: shown }, now });
    if (tick === "inResults") await rerankEventResults(tx, current.eventId);
    return { changed: true, eventId: current.eventId };
  });
  if (outcome.changed) revalidatePublicContent("events", "places");
  return outcome;
}

/** A marked registration's two ticks as the card and the menu draw them: ticked unless the club hid it (§910). */
export type EliteTicks = { inResults: boolean; onSite: boolean };

/**
 * The two ticks of every registration of an event marked «Elită» (§910), by registration — for the elite card's lines, which read
 * the sheet's rows (`listBibs`) and need nothing else of them. Whoever reads the registrations (`canReadRegistrations`): the Organizer
 * sees them, the Administrator ticks them. Test rows are never marked on a sheet, and are left out like everywhere a count is read.
 */
export async function listEliteTicks<T extends Record<string, unknown>>(db: Database<T>, actor: Pick<StaffUser, "role">, eventId: string): Promise<Map<string, EliteTicks>> {
  if (!canReadRegistrations(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read an event's elites`);
  if (!isUuid(eventId)) return new Map();
  const rows = await db
    .select({ id: registrations.id, hiddenFromResults: registrations.eliteHiddenFromResults, hiddenFromSite: registrations.eliteHiddenFromSite })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.elite, true), eq(registrations.kind, "REAL")));
  return new Map(rows.map((row) => [row.id, { inResults: !row.hiddenFromResults, onSite: !row.hiddenFromSite }]));
}

/** A registration marked «Elită», as the registrations page's «Elite» panel lists it. */
export type EliteMarkedRow = { id: string; name: string; status: RegistrationStatus; bibNumber: number | null };

/**
 * The registrations marked «Elită» at one event, for the registrations page's «Elite» panel — read-only, beside the race's
 * separate elite list (the owner, 2026-11-04, who looked for an elite on the registrations page and did not find her). Every
 * state, each said by its chip there — the mark is kept on a cancelled row, which a restart keeps — by name; a test row is
 * left out, as from every figure the club is given (`AGENTS.md` §12.6). The Organizer and above (`canReadRegistrations`, the
 * list's own gate), asserted here as at the page (BR-REQ-060-01).
 */
export async function listEliteMarkedRegistrations<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string): Promise<EliteMarkedRow[]> {
  if (!canReadRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read an event's registrations`);
  }
  if (!isUuid(eventId)) return [];
  return db
    .select({ id: registrations.id, name: registrations.registeredName, status: registrations.status, bibNumber: registrations.bibNumber })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.elite, true), eq(registrations.kind, "REAL")))
    .orderBy(asc(registrations.registeredName), asc(registrations.id));
}
