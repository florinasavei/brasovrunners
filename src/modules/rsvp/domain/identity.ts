import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { answerClubMember, type ClubMemberKind } from "./public-member";

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
  /**
   * «Sunt membru al grupului …» (§831): the person's own tick, **declared** — taken from the page, the remembered browser and the link, and
   * only while the notice in force describes the mark (the service asks). An `account` identity never carries it: its kind comes from `role`.
   */
  clubMember?: boolean;
  /** The signed-in account's role, read on the server from the session (§831, BR-REQ-060-01): only for `source: "account"`. A role at least a member makes the answer `ACCOUNT`. */
  role?: StaffRole;
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
  if (identity.verified !== isVerifiedSource(identity.source)) return false;
  // A role belongs to a signed-in account and to nothing else; a tick belongs to everything but an account (§831).
  if (identity.role !== undefined && identity.source !== "account") return false;
  if (identity.clubMember === true && identity.source === "account") return false;
  return true;
}

/**
 * The kind of member an identity answers as (`public-member.ts`): an account's from its role, on the server; any other door's from the person's
 * own tick, declared. Never read from anything the form could post beside the tick.
 */
export function identityClubMember(identity: RsvpIdentity): ClubMemberKind | null {
  return answerClubMember({ accountRole: identity.source === "account" ? (identity.role ?? null) : null, tick: identity.source !== "account" && identity.clubMember === true });
}

/** The longest name shown (the table's CHECK says the same). */
export const RSVP_NAME_MAX = 80;

/** A typed name as it is kept: trimmed, whitespace collapsed, at most 80 characters; null when empty. */
export function cleanDisplayName(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim().slice(0, RSVP_NAME_MAX).trim();
  return cleaned === "" ? null : cleaned;
}
