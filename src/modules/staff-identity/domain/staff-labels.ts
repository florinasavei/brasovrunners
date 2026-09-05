import type { RegistrationStatus } from "@/db/schema/registrations";
import type { EditorialStatus, StaffRole } from "./roles";

/**
 * The backoffice's enum labels, in Romanian, once.
 *
 * These used to be message keys in both catalogues: `Admin.status.PUBLISHED` in `ro.json` and
 * again in `en.json`, and the same for four other enums. That is two copies of the same seven
 * words, kept in step by a parity test, for a screen three people in one club use — and the
 * owner's judgement, recorded in `DECISIONS.md` §35, is that a bilingual backoffice is confusing
 * rather than helpful.
 *
 * **The public site is unaffected and stays fully bilingual.** An event's kind, its registration
 * state, every word a visitor reads: those are still message keys in both catalogues, because a
 * visitor chose their language. `Event.kind.*` is the boundary — it is read by a public page and
 * by the backoffice, so it stays where the public need puts it.
 *
 * `Record<Enum, string>` rather than a lookup with a fallback: adding a value to any of these
 * enums is a TypeScript error here, which is what a missing label should be. There is no runtime
 * path that can render a raw enum token to an organizer.
 */

export const EDITORIAL_STATUS_LABEL: Record<EditorialStatus, string> = {
  DRAFT: "Ciornă",
  IN_REVIEW: "În verificare",
  PUBLISHED: "Publicat",
  ARCHIVED: "Arhivat",
};

/** The button that moves an event *to* that state, which is a different word from the state. */
export const EDITORIAL_TRANSITION_LABEL: Record<EditorialStatus, string> = {
  DRAFT: "Mută în ciornă",
  IN_REVIEW: "Trimite spre verificare",
  PUBLISHED: "Publică",
  ARCHIVED: "Arhivează",
};

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  CONTRIBUTOR: "Colaborator",
  MODERATOR: "Moderator",
  DEV: "Tehnic",
  ADMIN: "Administrator",
  SUPERADMIN: "Administrator principal",
};

export const EVENT_STATUS_LABEL: Record<"SCHEDULED" | "CANCELLED" | "COMPLETED", string> = {
  SCHEDULED: "Programat",
  CANCELLED: "Anulat",
  COMPLETED: "Încheiat",
};

export const REGISTRATION_MODE_LABEL: Record<"NONE" | "INTERNAL" | "EXTERNAL", string> = {
  NONE: "Fără înscriere",
  INTERNAL: "Înscriere aici",
  EXTERNAL: "Înscriere în altă parte",
};

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  PENDING_EMAIL_CONFIRMATION: "Așteaptă confirmarea emailului",
  PENDING_DECLARATION: "Așteaptă semnarea declarației",
  WAITLISTED: "Pe lista de așteptare",
  WAITLIST_OFFERED: "Ofertă activă",
  CONFIRMED: "Confirmată",
  CANCELLED: "Anulată",
  EXPIRED: "Expirată",
};
