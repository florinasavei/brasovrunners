/**
 * The volunteers' public list (§NNN, amending §754 and §143/§396; the owner, 2026-10-19: «private vs public lists of
 * volunteers») — pure rules, so they are tested without a database. **A public name is a disclosure** (CLAUDE.md's unbreakable row):
 * the list the team keeps (the editor's card, the CSV, the badges) stays the team's alone unless the club ticks «Lista voluntarilor e
 * publică pe pagina evenimentului», and even then a name reaches the event's page only for a volunteer who said so themselves.
 *
 * **Three questions, asked in this order.**
 *
 * 1. `volunteersListState` — does the page draw the card at all? Only for a **published, public** event that still takes volunteers
 *    (`events.accepts_volunteers`), whose club ticked the list public, while the privacy notice in force describes it
 *    (`{{volunteersList}}`, in every language) and the volunteers' rows still exist (thirty days after the event's start, §754).
 *    Anything else draws nothing — not a count, not a sentence.
 * 2. `publicVolunteerName` — which person is named? A **confirmed** adult volunteer (a person nobody has accepted, or who withdrew, is not
 *    "the team"; a minor is counted and never named, §768 — the guardian's acceptance covers the agreement, not a disclosure) who ticked «Vreau să apar pe lista publică a voluntarilor» under a privacy notice that described the list — the
 *    first such notice or a later one (`findFirstVolunteersListNoticeVersion`, §421's line), because a tick given under a notice that
 *    said nothing about it agreed to nothing this shows. Everyone else is only counted.
 * 3. `volunteersListView` — the names in the club's order (the oldest sign-up first, so the list does not reshuffle when somebody
 *    joins), each with the role the organizers **gave** (null while none is given: the person's own wish list is not shown), and how
 *    many are only counted («și încă N»).
 *
 * What is never here: an address, a telephone number, a city, a date of birth, the sex, a T-shirt size, a message, a note, the
 * roles a person ticked — the read selects none of them (`readPublicVolunteersList`); the age and the guardian's name it selects only to keep a minor off the page.
 */
import { RETENTION_PERIODS } from "@/modules/jobs/domain/retention-periods";
import { isVolunteerMinor, type VolunteerState } from "./volunteer";

/** The most names the card lists; the rest are «și încă N». */
export const VOLUNTEERS_LIST_NAMES_SHOWN = 100;

/**
 * Whether the card is drawn, and in which shape. `forming` is the one sentence «Echipa de voluntari se formează.» — only while the
 * club's tick is on and the volunteers' offer is open, so a page that asks for volunteers does not look empty; `list` is a card with at
 * least one name; `hidden` is nothing at all.
 */
export type VolunteersListState = "hidden" | "forming" | "list";

export type VolunteersListGate = {
  /** `events.volunteers_list_public`. */
  listPublic: boolean;
  /** `events.accepts_volunteers`: «Primește voluntari» is the master switch — off, nothing about volunteers is public. */
  acceptsVolunteers: boolean;
  /** The privacy notice in force describes the list (`describesVolunteersList`, every language): `cachedVolunteersListDescribed`. */
  noticeDescribes: boolean;
  /** The event is a published, public one (the members' events never reach the public read, a draft neither). */
  published: boolean;
  membersOnly: boolean;
  /** The volunteers' offer is open right now (`readVolunteerOffer` is not null): the page asks for people. */
  offerOpen: boolean;
  /** How many people the list names — `volunteersListView(...).named.length`. */
  named: number;
  /** The event's start, or null while it is to be announced. */
  startsAt: Date | null;
  now: Date;
};

/** Whether the event is past the retention of the volunteers' rows (`RETENTION_PERIODS.volunteerDaysAfterEvent`, §754): the page stops drawing the card on the day the sweep may take the rows. */
export function volunteersListExpired(startsAt: Date | null, now: Date, retentionDays: number = RETENTION_PERIODS.volunteerDaysAfterEvent): boolean {
  return startsAt !== null && now.getTime() >= startsAt.getTime() + retentionDays * 86_400_000;
}

export function volunteersListState(gate: VolunteersListGate): VolunteersListState {
  if (!gate.listPublic || !gate.acceptsVolunteers || !gate.noticeDescribes || !gate.published || gate.membersOnly) return "hidden";
  if (volunteersListExpired(gate.startsAt, gate.now)) return "hidden";
  if (gate.named > 0) return "list";
  return gate.offerOpen ? "forming" : "hidden";
}

/** What `publicVolunteerName` reads of a volunteer's row — nothing that could identify them beyond the name they typed. */
export type VolunteerNameInput = {
  state: VolunteerState;
  /** The name as the person typed it. */
  name: string;
  /** `event_volunteers.list_opt_in`. */
  listOptIn: boolean;
  /** The privacy notice version the tick was given under (`event_volunteers.list_opt_in_notice_version`: the sign-up's, or the notice in force at the organizers' record); null for a row that recorded none. */
  listNoticeVersion: number | null;
  /** The age on the event's day, null when none is known. A person under eighteen is counted and never named (§NNN, until the owner and counsel decide otherwise). */
  age: number | null;
  /** The parent or guardian's name when the person is a minor (§768): its presence is the same fact as the age, read twice so that a row with only one of them still holds. */
  guardianName: string | null;
  /** `findFirstVolunteersListNoticeVersion`: the first approved notice that described the list, or null when none did. */
  firstListNoticeVersion: number | null;
};

/**
 * The name to show for one volunteer, or null (counted only). Confirmed, ticked, under a notice that described the list or a later
 * one, and with a name that is not blank. A null version never qualifies: a tick with no notice behind it agreed to nothing.
 */
export function publicVolunteerName(row: VolunteerNameInput): string | null {
  if (row.state !== "CONFIRMED" || !row.listOptIn) return null;
  // A minor is never named on a public page on their own tick: the guardian's acceptance covers the agreement alone (§768), and a tick for a list is
  // another disclosure (§323 keeps a minor off every public list). Counted, not named, until the owner and counsel decide how a guardian consents to it.
  if (isVolunteerMinor(row.age) || row.guardianName !== null) return null;
  if (row.firstListNoticeVersion === null || row.listNoticeVersion === null || row.listNoticeVersion < row.firstListNoticeVersion) return null;
  const name = row.name.trim().replace(/\s+/g, " ");
  return name === "" ? null : name;
}

/** One row of the list as the read selects it: the person's name and tick, the role given — in both languages — and nothing else. */
export type VolunteerListRow = Omit<VolunteerNameInput, "firstListNoticeVersion"> & {
  roleNameRo: string | null;
  roleNameEn: string | null;
};

export type PublicVolunteersList = {
  /** Everyone the card counts: the confirmed volunteers, named or not. */
  count: number;
  /** Those who may be named, in the order given, with the role given in each language (null while none is given). */
  named: { name: string; roleNameRo: string | null; roleNameEn: string | null }[];
  /** `count` less the names shown: «și încă N voluntari». */
  others: number;
};

/** The count and the names. Rows in the order they should appear; a cancelled or unconfirmed person is nobody here. */
export function volunteersListView(rows: readonly VolunteerListRow[], firstListNoticeVersion: number | null): PublicVolunteersList {
  const confirmed = rows.filter((row) => row.state === "CONFIRMED");
  const named: PublicVolunteersList["named"] = [];
  for (const row of confirmed) {
    const name = publicVolunteerName({ ...row, firstListNoticeVersion });
    if (name !== null && named.length < VOLUNTEERS_LIST_NAMES_SHOWN) named.push({ name, roleNameRo: row.roleNameRo, roleNameEn: row.roleNameEn });
  }
  return { count: confirmed.length, named, others: confirmed.length - named.length };
}
