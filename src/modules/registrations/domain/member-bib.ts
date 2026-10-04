/**
 * The members' race number (§NNN; the owner, 2026-10-04: «I want BVR members to have an optional
 * special BiBs, with a special design»): who asked for it, and who will wear it.
 *
 * Three facts meet here, and the bib needs all three:
 *
 * - the **event** offers it — its bib design's members' switch is on (`bib-design.ts#bibMemberSchema`);
 * - the **person** asked — «Vreau numărul de membru», under the member tick (`registrations.member_bib_wanted`);
 * - the **club** knows the address as a member's — the verified rule of §662: the participant's
 *   canonical address is a live account on «Echipa» (`member-ticks.ts#memberCanonicalEmails`).
 *
 * The tick alone never prints it (§645's rule: the club's own list verifies). The number itself is
 * untouched: the same band, the same order of confirmation (§173) — only the bib's look differs.
 */

/**
 * What is stored for «Vreau numărul de membru»: true only when the event offers the members' bib and
 * the person ticked both «Sunt membru» and the wish. A stale form — rendered before the switch went
 * off, or posted with the member tick off — stores false, never refused.
 */
export function memberBibKept(input: { offered: boolean; declared: boolean; wanted: boolean }): boolean {
  return input.offered && input.declared && input.wanted;
}

/**
 * Which bib a registration prints, as the backoffice says it:
 * - `printed`: it asked and its address is a member account's — the sheet draws the members' bib;
 * - `asked`: it asked, and no member account has its address — the ordinary bib, and the bibs page
 *   says so, so an Administrator adds the person on «Echipa» first if they are a member;
 * - `null`: it did not ask, or the event no longer offers the members' bib (its switch went off
 *   after the person asked: the wish is kept, and nothing prints from it while the switch is off).
 */
export type MemberBib = "printed" | "asked";

export function memberBibOf(input: { offered: boolean; wanted: boolean; verified: boolean }): MemberBib | null {
  if (!input.offered || !input.wanted) return null;
  return input.verified ? "printed" : "asked";
}

/** The export's «Member bib» cell (CSV and spreadsheet alike), in the export's own English words. */
export const MEMBER_BIB_EXPORT_WORDS: Record<MemberBib, string> = {
  printed: "yes",
  asked: "asked",
};

/** The cell itself: `yes`, `asked` or empty. */
export function memberBibCell(row: { memberBibOffered: boolean; memberBibWanted: boolean; memberVerified: boolean }): string {
  const kind = memberBibOf({ offered: row.memberBibOffered, wanted: row.memberBibWanted, verified: row.memberVerified });
  return kind ? MEMBER_BIB_EXPORT_WORDS[kind] : "";
}

/**
 * Whether «Vreau numărul de membru» starts ticked on a form (§NNN). Ticked, unless the draft is a
 * refused press that brought the member tick back without the wish — then the person had unticked
 * it, and the box shows what they chose. Every other draft is a prefill, never an answer to this
 * question: a family sitting's shared boxes (§519) hold no member tick, and an invitation's prefill
 * for a member (`invitationDraft`) carries the wish as well as the tick.
 */
export function memberBibTickedAtFirst(draft: Readonly<Record<string, string>> | null): boolean {
  if (draft?.clubMemberDeclared !== "on") return true;
  return draft.memberBibWanted === "on";
}
