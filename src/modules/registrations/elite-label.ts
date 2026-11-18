import { eq } from "drizzle-orm";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { eliteDefaultLabel, eliteLineDefaultLabel, parseEliteBibLabel } from "./bib-elite";

/**
 * «Eticheta pe BIB» (§NNN, amending §948; the owner, 2026-11-18, of the elite list: «în dreptul fiecăruia vreau un „BIB Label” și
 * să fie prenumele by default»): what an elite bib prints where the number goes, typed per line — on a registration marked «Elită»
 * (`registrations.elite_bib_label`) and on a line of the race's elite list (`event_elite_entries.bib_label`). Null is the default,
 * the rule from before: the first name, the line's first word; the label in force is decided once in `bib-elite.ts`.
 *
 * **Who** — the Administrator alone (`canManageRegistrations`, the elite mark's own gate, §897), asserted here as at every action's
 * door (BR-REQ-060-01): the Organizer reads the label on the card, every desk role reads it on the row, nobody else writes it.
 *
 * **The value** — trimmed, inner spaces collapsed; empty or equal to the default stores null, back to the default; longer than
 * `ELITE_NAME_MAX` refused naming the box (`ELITE_LABEL_TOO_LONG`). A press that finds the label already as asked (a stale page, a
 * colleague first) writes nothing and no row. Otherwise one statement under the row's lock — the lock the elite list's ticks take —
 * and one audit row naming the registration, or the event and the line's id: never the label, which is a person's name.
 *
 * **What it moves** — nothing but the printed name: no state, place, number, count, email or public page. A registration's label
 * stays while its mark is off (inert, as the §910 ticks are) and prints again when it is marked; it is the person's data, deleted
 * with the registration's erasure and named in «Toate datele unei persoane», never read by a public query.
 */
type Actor = Pick<StaffUser, "id" | "role">;

function assertMayWrite(actor: Pick<StaffUser, "role">): void {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change an elite bib's label`);
  }
}

/** «Eticheta pe BIB» on a registration (§NNN): the Administrator's; see the module's note. */
export async function setRegistrationEliteBibLabel<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  registrationId: string,
  raw: unknown,
  now: Date,
): Promise<{ changed: boolean; eventId: string }> {
  assertMayWrite(actor);
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: registrations.id, eventId: registrations.eventId, firstName: registrations.firstName, registeredName: registrations.registeredName, label: registrations.eliteBibLabel })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
      .for("update");
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    const label = parseEliteBibLabel(raw, eliteDefaultLabel(current));
    if (label === current.label) return { changed: false, eventId: current.eventId };
    await tx.update(registrations).set({ eliteBibLabel: label, updatedAt: now }).where(eq(registrations.id, current.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "registration.elite_bib_label_set", entityType: "registration", entityId: current.id, now });
    return { changed: true, eventId: current.eventId };
  });
}

/** «Eticheta pe BIB» on a line of the race's elite list (§NNN): the Administrator's; the club's typed text, as the line's name is. */
export async function setEliteEntryBibLabel<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  entryId: string,
  raw: unknown,
  now: Date,
): Promise<{ changed: boolean; eventId: string }> {
  assertMayWrite(actor);
  if (!isUuid(entryId)) throw new DomainError("NOT_FOUND", "the line is not there");
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: eventEliteEntries.id, eventId: eventEliteEntries.eventId, name: eventEliteEntries.name, label: eventEliteEntries.bibLabel })
      .from(eventEliteEntries)
      .where(eq(eventEliteEntries.id, entryId))
      .for("update");
    if (!current) throw new DomainError("NOT_FOUND", "the line is not there");
    const label = parseEliteBibLabel(raw, eliteLineDefaultLabel(current.name));
    if (label === current.label) return { changed: false, eventId: current.eventId };
    await tx.update(eventEliteEntries).set({ bibLabel: label }).where(eq(eventEliteEntries.id, current.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event.elite_entry_bib_label_set", entityType: "event", entityId: current.eventId, metadata: { entryId: current.id }, now });
    return { changed: true, eventId: current.eventId };
  });
}
