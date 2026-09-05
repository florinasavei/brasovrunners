import type { RegistrationSex, RegistrationTshirtSize } from "@/db/schema/registrations";

/**
 * The two names a registration carries, and the rule that keeps them apart (BR-REQ-031-04,
 * BR-REQ-039-02).
 *
 * A race needs the name on somebody's identity document — the declaration is signed with it, and
 * it is what the club would hand to an authority. A start list needs no such thing. Publishing
 * the first because the second was left blank is the disclosure `AGENTS.md` §10.10 exists to
 * prevent, so the derivation below never returns an empty string and never returns the legal
 * name unchanged when a surname is known.
 */

/** The details a race asks for beyond an address, all optional at this layer. */
export type RegistrationEntryDetails = {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  /** ISO `yyyy-mm-dd`. A date, never an age: an age is wrong by the next birthday. */
  birthDate?: string | null;
  sex?: RegistrationSex | null;
  /** ISO 3166-1 alpha-2, uppercase. */
  nationality?: string | null;
  city?: string | null;
  phone?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  clubName?: string | null;
  tshirtSize?: RegistrationTshirtSize | null;
  healthNotes?: string | null;
  healthConsentVersion?: number | null;
  healthConsentAt?: Date | null;
};

const collapse = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();

/**
 * The legal name of record, composed from its parts (BR-REQ-031-04 criterion 6).
 *
 * Falls back to whatever single string was supplied, because an organizer entering a
 * registration from a telephone call may have been given one name and no way to split it
 * (criterion 5) — and a registration with a name is worth more than a refusal.
 */
export function composeLegalName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback: string | null | undefined = "",
): string {
  const composed = [collapse(firstName), collapse(lastName)].filter(Boolean).join(" ");
  return composed || collapse(fallback);
}

/**
 * What a public start list shows.
 *
 * The default is the legal name exactly as it was given, because that is what most people
 * expect a start list to say and what the club prints on one. The field exists for the
 * person who would rather it did not: they shorten it to "Ana P.", or to the name everyone
 * at the club actually uses, and the list prints that instead.
 *
 * Somebody who wants to appear nowhere at all uses the opt-out (BR-REQ-039-01) — a
 * different question with a different answer, which is why it is a different field and not
 * an empty string here.
 *
 * Never empty: a blank row on a published list is either a mistake or the legal name about
 * to arrive through some later fallback.
 */
export function resolveDisplayName(input: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  legalName?: string | null;
}): string {
  const chosen = collapse(input.displayName);
  if (chosen) return chosen;

  return composeLegalName(input.firstName, input.lastName, input.legalName);
}

/**
 * The shortened form — a first name and a last initial.
 *
 * Offered as a suggestion when somebody opens the "what appears publicly" section, and never
 * reached for by `resolveDisplayName`: a default that quietly abbreviated everybody would
 * surprise the club on the morning it printed a start list.
 */
export function shortenedName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const first = collapse(firstName);
  const last = collapse(lastName);
  if (first && last) return `${first} ${[...last][0]}.`;
  return first || last;
}

/**
 * A country name in the reader's own language, from the platform (`AGENTS.md` §1.5: prefer the
 * platform over a library). `Intl.DisplayNames` ships with Node and every browser, so a
 * country-name table — 250 rows in two languages, stale the day a country renames itself — is
 * not needed. An unknown code returns itself rather than throwing.
 */
export function countryName(code: string, locale: "ro" | "en"): string {
  const normalized = collapse(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return normalized;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(normalized) ?? normalized;
  } catch {
    return normalized;
  }
}
