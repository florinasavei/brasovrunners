/**
 * Who answers «Vin!» (§811, «Vin!» part 1): an **identity with a source and a verified flag**, never a bare address —
 * so the same service takes an answer from the event page, from a remembered browser, from a signed-in member of the
 * members' zone (lane 59) and from a personal link in an email (lane 58) without any of them being able to claim more
 * than it proved.
 *
 *   page        the typed form on the event page. An address anybody can type: **never verified**. The answer waits for
 *               the emailed link («Da, vin»).
 *   remembered  a browser that used a «Da, vin» link and carries the cookie (`person-session/`). The address was proved
 *               by that email: verified, counted at once.
 *   account     a member signed in to the members' zone (§524). The account's address is the staff provider's
 *               verified one: verified, counted at once. (Lane 59 builds the caller.)
 *   link        a personal link in an email the platform sent to that address («Vii?», lane 58): the link is the
 *               proof. Verified, counted at once.
 *
 * `verified` is derived from the source by `identityOf`, so a caller cannot build an unverified `account` or a
 * verified `page` by mistake; `isConsistent` is what the service asserts again.
 */
export const RSVP_SOURCES = ["page", "remembered", "account", "link"] as const;
export type RsvpSource = (typeof RSVP_SOURCES)[number];

export type RsvpIdentity = {
  email: string;
  /** The name to show, when the person gave one and ticked `showName`; at most 80 characters after trimming. */
  displayName?: string | null;
  /** «Vreau să apar cu numele»: the person's own tick. */
  showName: boolean;
  locale: "ro" | "en";
  source: RsvpSource;
  verified: boolean;
};

/** Only the typed form proves nothing. */
export function isVerifiedSource(source: RsvpSource): boolean {
  return source !== "page";
}

/** An identity of a source, with `verified` as that source proves it. */
export function identityOf(source: RsvpSource, parts: Omit<RsvpIdentity, "source" | "verified">): RsvpIdentity {
  return { ...parts, source, verified: isVerifiedSource(source) };
}

/** Whether `verified` says what the source proves: the service refuses an identity that claims otherwise. */
export function isConsistent(identity: RsvpIdentity): boolean {
  return identity.verified === isVerifiedSource(identity.source);
}

/** The longest name shown (the table's CHECK says the same). */
export const RSVP_NAME_MAX = 80;

/** A typed name as it is kept: trimmed, whitespace collapsed, at most 80 characters; null when empty. */
export function cleanDisplayName(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim().slice(0, RSVP_NAME_MAX).trim();
  return cleaned === "" ? null : cleaned;
}
