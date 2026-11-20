import { isUuid } from "@/shared/ids";

/**
 * «Ziua cursei» → «Jurnal» (§996; the owner, 2026-11-19: «vreau si tracing pentru voluntarim [voluntari] gen cine a scanat, cine a
 * marcat prezent»), the pure half: what a line is, the page's two filters as the address carries them, which of the three reads a
 * filter asks, the reads' newest lines merged under one cap, and the counts per account. No database, no request, no words:
 * `journal.ts` reads, the page says it. The organizers' alone (`canReadRaceDayJournal`): the desk's «Scanat înainte» is its own
 * (`registrations/domain/code-scans.ts`).
 *
 * Seven kinds of line, each from what the platform already keeps: a desk code opened at the desk (`registration.code_scanned`), a
 * runner marked present at the desk or by their own «Am ajuns», a check-in taken back (`registration.checked_in`,
 * `registration.checkin_undone`), a runner taken off the event's raffle or put back on it (`registration.raffle_excluded`,
 * `registration.raffle_included` — at the desk, asked first, or by the organizers' tick; §1020: who decided that X does not take
 * part), and a volunteer's «Prezent» ticked or unticked (`volunteer.edited` with `fields: ["present"]`).
 */
export const JOURNAL_KINDS = ["scanned", "checkedIn", "undone", "raffleOut", "raffleIn", "volunteerPresent", "volunteerAbsent"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/** The runners' kinds, by the audit action each is read from. */
export const RUNNER_JOURNAL_ACTIONS = {
  scanned: "registration.code_scanned",
  checkedIn: "registration.checked_in",
  undone: "registration.checkin_undone",
  // §1020: «a scos de la tombolă» / «a pus înapoi la tombolă», whichever door wrote the mark.
  raffleOut: "registration.raffle_excluded",
  raffleIn: "registration.raffle_included",
} as const;
export type RunnerJournalKind = keyof typeof RUNNER_JOURNAL_ACTIONS;

/** The action's kind, or null for an action the log does not say. */
export function runnerKindOf(action: string): RunnerJournalKind | null {
  for (const [kind, known] of Object.entries(RUNNER_JOURNAL_ACTIONS) as [RunnerJournalKind, string][]) if (known === action) return kind;
  return null;
}

/** At most this many lines on the page, the newest; the rest are counted («și încă N»). */
export const JOURNAL_LINES_MAX = 300;

/** Who did it: a staff account, the person themselves by «Am ajuns», or an account deleted since (its rows keep no name). */
export type JournalWho = { kind: "staff"; id: string; name: string } | { kind: "participant" } | { kind: "removed" };

/** Whom it was done to: a registration of the event (its number once it wears one; a test one marked) or one of its volunteers. */
export type JournalWhom =
  | { kind: "registration"; id: string; name: string; number: string | null; test: boolean }
  | { kind: "volunteer"; id: string; name: string };

export type JournalLine = { id: string; at: Date; kind: JournalKind; who: JournalWho; whom: JournalWhom };

/** The account filter (`?account=`): everybody, one staff account by id, the participants' own «Am ajuns», or the deleted accounts. */
export type JournalAccount = { kind: "all" } | { kind: "staff"; id: string } | { kind: "participant" } | { kind: "removed" };

/** The address's values of the two non-staff choices. */
export const PARTICIPANT_ACCOUNT = "participant";
export const REMOVED_ACCOUNT = "removed";

/** `?account=` as the address carries it; anything that is not one of the four is everybody. */
export function journalAccountOf(value: unknown): JournalAccount {
  if (value === PARTICIPANT_ACCOUNT) return { kind: "participant" };
  if (value === REMOVED_ACCOUNT) return { kind: "removed" };
  return typeof value === "string" && isUuid(value) ? { kind: "staff", id: value } : { kind: "all" };
}

/** The filter's value in the address and the select: the reverse of `journalAccountOf`. */
export function journalAccountValue(account: JournalAccount): string {
  if (account.kind === "staff") return account.id;
  if (account.kind === "participant") return PARTICIPANT_ACCOUNT;
  if (account.kind === "removed") return REMOVED_ACCOUNT;
  return "";
}

/** The filter's value that shows one who's lines: the account's id, or the participants' or the deleted accounts' word. */
export function journalWhoValue(who: JournalWho): string {
  return who.kind === "staff" ? who.id : who.kind === "participant" ? PARTICIPANT_ACCOUNT : REMOVED_ACCOUNT;
}

/** `?kind=` as the address carries it: one of the seven, or null for every kind. */
export function journalKindOf(value: unknown): JournalKind | null {
  return (JOURNAL_KINDS as readonly unknown[]).includes(value) ? (value as JournalKind) : null;
}

/**
 * What the three reads are asked for a filter: the runners' audit rows of these kinds, the volunteers' ticks of these values
 * (`true` ticked, `false` unticked), and the participants' own «Am ajuns» — each empty or `false` when the filter leaves it out,
 * so nothing is read for it. The participants' own check-ins have no staff account: one account's filter or the deleted
 * accounts' leaves them out, and only they answer «participanții».
 */
export function journalReads(kind: JournalKind | null, account: JournalAccount): { runnerKinds: RunnerJournalKind[]; volunteerTicks: boolean[]; selfCheckIns: boolean } {
  const staffRows = account.kind !== "participant";
  const runnerKinds = staffRows ? (Object.keys(RUNNER_JOURNAL_ACTIONS) as RunnerJournalKind[]).filter((one) => kind === null || kind === one) : [];
  const volunteerTicks = staffRows ? [true, false].filter((ticked) => kind === null || kind === (ticked ? "volunteerPresent" : "volunteerAbsent")) : [];
  const selfCheckIns = (account.kind === "all" || account.kind === "participant") && (kind === null || kind === "checkedIn");
  return { runnerKinds, volunteerTicks, selfCheckIns };
}

/**
 * The three reads' lines as one list: newest first — a tie by the line's id, so a reload never reorders two lines of one second —,
 * at most `max`, and how many more the filter holds (each read says its own total before its limit).
 */
export function mergeJournalLines(reads: readonly { lines: readonly JournalLine[]; total: number }[], max = JOURNAL_LINES_MAX): { lines: JournalLine[]; more: number } {
  const all = reads.flatMap((read) => read.lines);
  all.sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const lines = all.slice(0, max);
  const total = reads.reduce((sum, read) => sum + read.total, 0);
  return { lines, more: Math.max(0, total - lines.length) };
}

export type JournalCounts = { scanned: number; checkedIn: number; undone: number; raffleOut: number; raffleIn: number; volunteerTicks: number };
export type JournalSummaryRow = { who: JournalWho; counts: JournalCounts };

/** One grouped count of a read: who (a staff account's id and name, or none), what, and how many — a test registration's apart. */
export type JournalTally = { actorId: string | null; actorName: string | null; kind: RunnerJournalKind | "volunteerTicks" | "selfCheckIn"; count: number; test: boolean };

const NO_COUNTS: JournalCounts = { scanned: 0, checkedIn: 0, undone: 0, raffleOut: 0, raffleIn: 0, volunteerTicks: 0 };

/**
 * One line per account that acted at the event (§996): how many scans, check-ins, undos, runners taken off the raffle and put
 * back (§1020) and volunteer ticks — the staff accounts
 * by name, then the deleted accounts as one, then the participants' own «Am ajuns» (their check-ins alone). A test registration's
 * row is omitted from every count the club is given (§30, AGENTS.md §12.6), but its account is still one the filter offers
 * (`accounts`), so a rehearsal on test rows can be read by account too.
 */
export function journalSummary(tallies: readonly JournalTally[], locale: string): { rows: JournalSummaryRow[]; accounts: JournalWho[] } {
  const byKey = new Map<string, { who: JournalWho; counts: JournalCounts; real: boolean }>();
  for (const tally of tallies) {
    const who: JournalWho =
      tally.kind === "selfCheckIn" ? { kind: "participant" } : tally.actorId !== null && tally.actorName !== null ? { kind: "staff", id: tally.actorId, name: tally.actorName } : { kind: "removed" };
    const key = who.kind === "staff" ? who.id : who.kind;
    const entry = byKey.get(key) ?? { who, counts: { ...NO_COUNTS }, real: false };
    if (!tally.test && tally.count > 0) {
      const field: keyof JournalCounts = tally.kind === "selfCheckIn" ? "checkedIn" : tally.kind;
      entry.counts[field] += tally.count;
      entry.real = true;
    }
    byKey.set(key, entry);
  }
  const rank = (who: JournalWho) => (who.kind === "staff" ? 0 : who.kind === "removed" ? 1 : 2);
  const ordered = [...byKey.values()].sort(
    (a, b) => rank(a.who) - rank(b.who) || (a.who.kind === "staff" && b.who.kind === "staff" ? a.who.name.localeCompare(b.who.name, locale) || (a.who.id < b.who.id ? -1 : 1) : 0),
  );
  return { rows: ordered.filter((entry) => entry.real).map(({ who, counts }) => ({ who, counts })), accounts: ordered.map((entry) => entry.who) };
}

/**
 * The account filter against the accounts the event's log names: a staff account it does not name — another event's, a guessed id —
 * reads as everybody, so the select and the lines never disagree about what is shown.
 */
export function knownAccount(account: JournalAccount, accounts: readonly JournalWho[]): JournalAccount {
  if (account.kind === "all") return account;
  const known = accounts.some((who) => (account.kind === "staff" ? who.kind === "staff" && who.id === account.id : who.kind === account.kind));
  return known ? account : { kind: "all" };
}
