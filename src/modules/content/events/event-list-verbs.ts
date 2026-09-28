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
 * Which verbs the backoffice events list offers a role (BR-REQ-060-01, §542). Each verb asks the
 * gate its service asserts, so the list offers only what the server would accept; the server
 * still asserts it on every press. `edit` is the pencil for a role that writes the settings or
 * the words; everyone else gets «Deschide», the read-only editor. The Organizer gets
 * `readRegistrations` only (§289, §542).
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
