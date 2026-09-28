import {
  canCreateEvent,
  canDeleteEvent,
  canEditEventFields,
  canEditTexts,
  canHardDeleteEvent,
  canReadRegistrations,
  canTransitionEvent,
  type StaffRole,
} from "@/modules/staff-identity/domain/roles";

/**
 * Which verbs the backoffice's events list offers a role (BR-REQ-060-01, §542) — the pattern of
 * `pageListVerbs`: each verb asks the gate its service asserts, so the list offers only what the
 * server would accept, and the server still asserts it on every press.
 *
 * - `create`: «Eveniment nou» (`canCreateEvent`, asserted by `createEvent`).
 * - `edit`: the row's pencil «Editează» for a role that writes something of the event — its
 *   settings (`canEditEventFields`) or its words (`canEditTexts`); every other reader gets
 *   «Deschide», the eye, to the same editor in its read-only view (§542).
 * - `select`: the row's tick and the bulk bar — publish, archive, delete ticked events.
 * - `duplicate`: «Duplică» in the ⋮ (`duplicateEvent` asserts `canCreateEvent`).
 * - `remove` / `hardDelete`: «Șterge» and the erase screen, as `deleteEvent` and
 *   `hardDeleteEvent` assert them.
 * - `publish`: «Publică» on a series' draft line (`publishEvent`, `canTransitionEvent`).
 * - `switchSeries`: «Publică automat de acum» (`setRepeatPublish`: `canCreateEvent`, and publishing
 *   when switching it on).
 * - `readRegistrations`: the ⋮'s «Înscrieri» and «Fișă de urgență» links — reads, the Organizer's
 *   since §289.
 *
 * The Organizer, since §542: `readRegistrations` and nothing else — the list, the preview, the
 * registrations and the emergency sheet, and no verb that changes an event.
 */
export type EventListVerbs = {
  create: boolean;
  edit: boolean;
  select: boolean;
  duplicate: boolean;
  remove: boolean;
  hardDelete: boolean;
  publish: boolean;
  switchSeries: boolean;
  readRegistrations: boolean;
};

export function eventListVerbs(role: StaffRole): EventListVerbs {
  const create = canCreateEvent(role);
  const publish = canTransitionEvent(role, "IN_REVIEW", "PUBLISHED", false);
  return {
    create,
    edit: canEditEventFields(role) || canEditTexts(role),
    select: create,
    duplicate: create,
    remove: canDeleteEvent(role),
    hardDelete: canHardDeleteEvent(role),
    publish,
    switchSeries: create && publish,
    readRegistrations: canReadRegistrations(role),
  };
}
