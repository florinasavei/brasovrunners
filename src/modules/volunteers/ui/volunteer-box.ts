/**
 * The public form's address on the event page (§NNN): the id its action's redirect lands on, and what
 * the page says after the action, read from `?volunteer=`. Kept out of the action's module because a
 * "use server" file may export only async functions.
 */
export const VOLUNTEER_BOX_ID = "volunteers";

/** What the page says after the action; anything else in the address is nothing. */
export type VolunteerOutcome = "done" | "invalid" | "captcha" | "limited" | "full";

export function parseVolunteerOutcome(value: string | undefined): VolunteerOutcome | null {
  if (value === "1") return "done";
  if (value === "invalid" || value === "captcha" || value === "limited" || value === "full") return value;
  return null;
}

/** The boxes a refusal can name, in the order the form draws them (the service's own field names). */
export const VOLUNTEER_BOXES = ["roleId", "name", "email", "phone", "message", "consent"] as const;
export type VolunteerBox = (typeof VOLUNTEER_BOXES)[number];

/** The boxes `?vfields=` names — names only, never a value (§14.5); a query string is typed by anybody. */
export function parseVolunteerBoxes(value: string | undefined): VolunteerBox[] {
  if (!value) return [];
  const asked = new Set(value.split(","));
  return VOLUNTEER_BOXES.filter((box) => asked.has(box));
}

/** What was typed before a refusal, from the sealed draft (§142): never the consent tick, which is the person's own act each time. */
export type VolunteerTyped = {
  name?: string;
  email?: string;
  phoneCountry?: string;
  phone?: string;
  roleId?: string;
  message?: string;
};
