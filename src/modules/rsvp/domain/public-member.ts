import { canOpenMembersZone, type StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * Who is a member on «Cine vine» (§NNN, amending §812 and §796; the owner, 2026-10-19: «Și aici, la „Cine vine", trebuie să pot trece dacă sunt
 * membru BVR»; then: «organizatorii și administratorii sunt peste membri»). Two kinds, kept as the row's `club_member`:
 *
 *   DECLARED  the person's own tick «Sunt membru al grupului …» on the page's form, in the remembered browser or on the link's page — a claim
 *             the club does not check (the registrations' «Membru (declarat)», §662).
 *   ACCOUNT   an answer given from the members' zone by an account whose role is at least a member (`canOpenMembersZone`'s rule, so every staff
 *             role counts: the club's colleagues are members first, §524). Set on the server from the role, **never from
 *             a posted box** (BR-REQ-060-01) — the registrations' «Membru (verificat)».
 *
 * Null is «not said», never «not a member» (§650). Pure, like `public-name.ts`.
 */
export const CLUB_MEMBER_KINDS = ["DECLARED", "ACCOUNT"] as const;
export type ClubMemberKind = (typeof CLUB_MEMBER_KINDS)[number];

/** The kind a column value is, or null for anything else (a stale row, a value this code does not know). */
export function parseClubMember(value: string | null | undefined): ClubMemberKind | null {
  return (CLUB_MEMBER_KINDS as readonly string[]).includes(value ?? "") ? (value as ClubMemberKind) : null;
}

/** An account's kind: `ACCOUNT` for a role at least a member — every role of the club's accounts — and nothing otherwise. */
export function accountClubMember(role: StaffRole): ClubMemberKind | null {
  // The members' zone's own door (`canOpenMembersZone`, §524): a role at least a member — no bare rank is asked here (§450).
  return canOpenMembersZone(role) ? "ACCOUNT" : null;
}

/**
 * The kind an answer is given with: an account's is read from its role and **wins over any tick** (a posted box never makes an account's answer
 * «declared», and never takes the mark away); every other door has the person's tick, `DECLARED`, or nothing.
 */
export function answerClubMember(input: { accountRole: StaffRole | null; tick: boolean }): ClubMemberKind | null {
  if (input.accountRole !== null) {
    const kind = accountClubMember(input.accountRole);
    if (kind !== null) return kind;
  }
  return input.tick ? "DECLARED" : null;
}

/**
 * The kind a row keeps when a verified press arrives for an answer already counted: the stronger of what it held and what comes (`ACCOUNT` is
 * never lowered to a tick — the same person pressing from a remembered browser is still a member by their account), and a press that says nothing
 * leaves what the person said before, as `showName` does (§812).
 */
export function mergeClubMember(held: ClubMemberKind | null, incoming: ClubMemberKind | null): ClubMemberKind | null {
  if (held === "ACCOUNT" || incoming === "ACCOUNT") return "ACCOUNT";
  return incoming ?? held;
}

export type RsvpMemberInput = {
  confirmed: boolean;
  clubMember: ClubMemberKind | null;
  /** The notice the row was last given under: when the answer was made, or when a tick last changed (`setRsvpClubMember`). */
  privacyNoticeVersion: number;
  /** `findFirstRsvpMemberNoticeVersion`: the first approved notice that described the mark, or null when none did. */
  firstMemberNoticeVersion: number | null;
};

/**
 * Whether a row counts as a member on the public page — **the whole rule, and the same version line as the name's** (§421, §811): the row is
 * confirmed, it says it is a member, and the notice it was given under is the first that described the mark, or a later one
 * (`firstMemberNoticeVersion`). An answer given — or a tick changed — under an older notice agreed to nothing that described a mark, so it is
 * not marked and not counted among the members. The mark beside a name is this AND a name that may be shown (`publicRsvpName`): a member
 * with no shown name only adds to the count «N vin · M membri», never a mark on «și încă N».
 */
export function publicRsvpMember(row: RsvpMemberInput): boolean {
  if (!row.confirmed || row.clubMember === null) return false;
  if (row.firstMemberNoticeVersion === null) return false;
  return row.privacyNoticeVersion >= row.firstMemberNoticeVersion;
}
