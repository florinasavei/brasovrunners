/**
 * The public form's address on the event page (§754): the id its action's redirect lands on, and what
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
export const VOLUNTEER_BOXES = ["roleIds", "name", "email", "phone", "age", "sex", "city", "shirtSize", "message", "consent", "agreement", "adult"] as const;
export type VolunteerBox = (typeof VOLUNTEER_BOXES)[number];

/** The boxes `?vfields=` names — names only, never a value (§14.5); a query string is typed by anybody. */
export function parseVolunteerBoxes(value: string | undefined): VolunteerBox[] {
  if (!value) return [];
  const asked = new Set(value.split(","));
  return VOLUNTEER_BOXES.filter((box) => asked.has(box));
}

/**
 * What was typed before a refusal, from the sealed draft (§142): never the consent tick, the agreement's or the
 * age's (§758) — each is the person's own act each time. The person's answers about themselves come back (§765): the
 * age, the sex, the city, the size, and the two optional ticks as "on" or nothing — they are claims, not consents.
 */
export type VolunteerTyped = {
  name?: string;
  email?: string;
  phoneCountry?: string;
  phone?: string;
  /** The roles ticked (§761), their ids joined by commas: the sealed draft keeps one string a name. */
  roleIds?: string;
  message?: string;
  age?: string;
  sex?: string;
  city?: string;
  shirtSize?: string;
  volunteeredBefore?: string;
  clubMember?: string;
};
