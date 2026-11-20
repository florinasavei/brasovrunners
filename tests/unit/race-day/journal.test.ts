import { describe, expect, it } from "vitest";
import {
  JOURNAL_LINES_MAX,
  type JournalLine,
  journalAccountOf,
  journalAccountValue,
  journalKindOf,
  journalReads,
  journalSummary,
  journalWhoValue,
  knownAccount,
  mergeJournalLines,
  runnerKindOf,
} from "@/modules/race-day/domain/journal";
import { checkedInByOf, checkedInWords } from "@/modules/registrations/domain/checked-in-by";

/**
 * §996 — «Ziua cursei» → «Jurnal», the pure half (`race-day/domain/journal.ts`): the address's two filters, which reads a filter
 * asks, the reads merged under one cap with how many more, the counts per account (a test registration's never counted, its
 * account still offered) and an unknown account read as everybody; and who marked a runner present, in the desk chip's words.
 * The desk's «Scanat înainte» is its own module's (`tests/unit/registrations/code-scans.test.ts`).
 */
const ACCOUNT = "0b6c1e7e-6f6a-4c55-9a43-2f6f3c5b8a10";
const OTHER = "1c7d2f8f-7a7b-4d66-8b54-3a7a4d6c9b21";

describe("§996 the address's filters", () => {
  it("reads `account` as everybody, one account by id, the participants or the deleted accounts — and writes it back", () => {
    expect(journalAccountOf(undefined)).toEqual({ kind: "all" });
    expect(journalAccountOf("")).toEqual({ kind: "all" });
    expect(journalAccountOf("junk")).toEqual({ kind: "all" });
    expect(journalAccountOf(["participant"])).toEqual({ kind: "all" });
    expect(journalAccountOf(ACCOUNT)).toEqual({ kind: "staff", id: ACCOUNT });
    expect(journalAccountOf("participant")).toEqual({ kind: "participant" });
    expect(journalAccountOf("removed")).toEqual({ kind: "removed" });
    for (const value of ["", ACCOUNT, "participant", "removed"]) expect(journalAccountValue(journalAccountOf(value))).toBe(value);
    expect(journalWhoValue({ kind: "staff", id: ACCOUNT, name: "QR1" })).toBe(ACCOUNT);
    expect(journalWhoValue({ kind: "participant" })).toBe("participant");
    expect(journalWhoValue({ kind: "removed" })).toBe("removed");
  });

  it("reads `kind` as one of the eight, or every kind", () => {
    // §1028: «raffleConfirmed», a volunteer confirmed for the raffle alone, beside the raffle's two kinds of §1020.
    for (const kind of ["scanned", "checkedIn", "undone", "raffleOut", "raffleIn", "raffleConfirmed", "volunteerPresent", "volunteerAbsent"]) expect(journalKindOf(kind)).toBe(kind);
    for (const junk of [undefined, "", "SCANNED", "all", ["scanned"], "raffle"]) expect(journalKindOf(junk)).toBeNull();
    expect(runnerKindOf("registration.code_scanned")).toBe("scanned");
    expect(runnerKindOf("registration.checked_in")).toBe("checkedIn");
    expect(runnerKindOf("registration.checkin_undone")).toBe("undone");
    // §1020: a runner taken off the raffle and put back — whichever door wrote the mark, the desk's or the organizers' tick.
    expect(runnerKindOf("registration.raffle_excluded")).toBe("raffleOut");
    expect(runnerKindOf("registration.raffle_included")).toBe("raffleIn");
    expect(runnerKindOf("volunteer.edited")).toBeNull();
  });

  it("asks each read only what the filter can show", () => {
    const everyRunnerKind = ["scanned", "checkedIn", "undone", "raffleOut", "raffleIn"];
    expect(journalReads(null, { kind: "all" })).toEqual({ runnerKinds: everyRunnerKind, volunteerTicks: [true, false], raffleConfirmations: true, selfCheckIns: true });
    expect(journalReads("scanned", { kind: "all" })).toEqual({ runnerKinds: ["scanned"], volunteerTicks: [], raffleConfirmations: false, selfCheckIns: false });
    expect(journalReads("checkedIn", { kind: "all" })).toEqual({ runnerKinds: ["checkedIn"], volunteerTicks: [], raffleConfirmations: false, selfCheckIns: true });
    expect(journalReads("volunteerAbsent", { kind: "all" })).toEqual({ runnerKinds: [], volunteerTicks: [false], raffleConfirmations: false, selfCheckIns: false });
    // §1020: the raffle's two kinds are the runners' audit rows alone — never a volunteer's tick, never the person's own «Am ajuns».
    expect(journalReads("raffleOut", { kind: "all" })).toEqual({ runnerKinds: ["raffleOut"], volunteerTicks: [], raffleConfirmations: false, selfCheckIns: false });
    expect(journalReads("raffleIn", { kind: "staff", id: ACCOUNT })).toEqual({ runnerKinds: ["raffleIn"], volunteerTicks: [], raffleConfirmations: false, selfCheckIns: false });
    expect(journalReads("raffleOut", { kind: "participant" })).toEqual({ runnerKinds: [], volunteerTicks: [], raffleConfirmations: false, selfCheckIns: false });
    // One account, or the deleted ones: never the participants' own «Am ajuns», which has no account.
    expect(journalReads(null, { kind: "staff", id: ACCOUNT })).toEqual({ runnerKinds: everyRunnerKind, volunteerTicks: [true, false], raffleConfirmations: true, selfCheckIns: false });
    expect(journalReads("checkedIn", { kind: "removed" })).toEqual({ runnerKinds: ["checkedIn"], volunteerTicks: [], raffleConfirmations: false, selfCheckIns: false });
    // The participants: their own check-ins alone.
    expect(journalReads(null, { kind: "participant" })).toEqual({ runnerKinds: [], volunteerTicks: [], raffleConfirmations: false, selfCheckIns: true });
    expect(journalReads("scanned", { kind: "participant" })).toEqual({ runnerKinds: [], volunteerTicks: [], raffleConfirmations: false, selfCheckIns: false });
    // §1028: a volunteer confirmed for the raffle alone is the volunteers' read's, a staff row — never the participants' own.
    expect(journalReads("raffleConfirmed", { kind: "all" })).toEqual({ runnerKinds: [], volunteerTicks: [], raffleConfirmations: true, selfCheckIns: false });
    expect(journalReads("raffleConfirmed", { kind: "staff", id: ACCOUNT })).toEqual({ runnerKinds: [], volunteerTicks: [], raffleConfirmations: true, selfCheckIns: false });
    expect(journalReads("raffleConfirmed", { kind: "participant" })).toEqual({ runnerKinds: [], volunteerTicks: [], raffleConfirmations: false, selfCheckIns: false });
  });
});

const line = (id: string, iso: string): JournalLine => ({ id, at: new Date(iso), kind: "scanned", who: { kind: "removed" }, whom: { kind: "volunteer", id: "v", name: "x" } });

describe("§996 the reads merged", () => {
  it("puts the newest first, a tie by the id so a reload never reorders two lines of one second", () => {
    const merged = mergeJournalLines([
      { lines: [line("a", "2099-11-21T06:00:01Z"), line("c", "2099-11-21T06:00:00Z")], total: 2 },
      { lines: [line("b", "2099-11-21T06:00:01Z")], total: 1 },
      { lines: [], total: 0 },
    ]);
    expect(merged.lines.map((entry) => entry.id)).toEqual(["b", "a", "c"]);
    expect(merged.more).toBe(0);
  });

  it("keeps at most the cap and counts the rest by the reads' own totals", () => {
    expect(JOURNAL_LINES_MAX).toBe(300);
    const many = Array.from({ length: 300 }, (_, index) => line(`r${String(index).padStart(3, "0")}`, new Date(Date.UTC(2099, 10, 21, 6, 0, index)).toISOString()));
    const merged = mergeJournalLines([
      { lines: many, total: 410 },
      { lines: [line("v", "2099-11-21T07:00:00Z")], total: 1 },
    ]);
    expect(merged.lines).toHaveLength(300);
    expect(merged.lines[0].id).toBe("v");
    expect(merged.more).toBe(111);
    expect(mergeJournalLines([{ lines: many.slice(0, 2), total: 2 }], 1)).toMatchObject({ more: 1 });
  });
});

describe("§996 the counts per account", () => {
  it("is one line per account — the staff by name, then the deleted accounts, then the participants — a test row never counted", () => {
    const { rows, accounts } = journalSummary(
      [
        { actorId: OTHER, actorName: "QR2", kind: "checkedIn", count: 2, test: false },
        { actorId: ACCOUNT, actorName: "QR1", kind: "scanned", count: 3, test: false },
        { actorId: ACCOUNT, actorName: "QR1", kind: "scanned", count: 5, test: true },
        { actorId: ACCOUNT, actorName: "QR1", kind: "volunteerTicks", count: 1, test: false },
        { actorId: null, actorName: null, kind: "undone", count: 1, test: false },
        { actorId: null, actorName: null, kind: "selfCheckIn", count: 4, test: false },
        { actorId: null, actorName: null, kind: "selfCheckIn", count: 2, test: true },
      ],
      "ro",
    );
    expect(rows).toEqual([
      { who: { kind: "staff", id: ACCOUNT, name: "QR1" }, counts: { scanned: 3, checkedIn: 0, undone: 0, raffleOut: 0, raffleIn: 0, raffleConfirmed: 0, volunteerTicks: 1 } },
      { who: { kind: "staff", id: OTHER, name: "QR2" }, counts: { scanned: 0, checkedIn: 2, undone: 0, raffleOut: 0, raffleIn: 0, raffleConfirmed: 0, volunteerTicks: 0 } },
      { who: { kind: "removed" }, counts: { scanned: 0, checkedIn: 0, undone: 1, raffleOut: 0, raffleIn: 0, raffleConfirmed: 0, volunteerTicks: 0 } },
      { who: { kind: "participant" }, counts: { scanned: 0, checkedIn: 4, undone: 0, raffleOut: 0, raffleIn: 0, raffleConfirmed: 0, volunteerTicks: 0 } },
    ]);
    expect(accounts.map((who) => (who.kind === "staff" ? who.name : who.kind))).toEqual(["QR1", "QR2", "removed", "participant"]);
  });

  it("counts the runners each account took off the raffle and put back (§1020) — a test registration's never", () => {
    const { rows, accounts } = journalSummary(
      [
        { actorId: ACCOUNT, actorName: "QR1", kind: "raffleOut", count: 2, test: false },
        { actorId: ACCOUNT, actorName: "QR1", kind: "raffleIn", count: 1, test: false },
        { actorId: ACCOUNT, actorName: "QR1", kind: "raffleOut", count: 4, test: true },
        { actorId: OTHER, actorName: "Org1", kind: "raffleIn", count: 3, test: true },
      ],
      "ro",
    );
    expect(rows).toEqual([{ who: { kind: "staff", id: ACCOUNT, name: "QR1" }, counts: { scanned: 0, checkedIn: 0, undone: 0, raffleOut: 2, raffleIn: 1, raffleConfirmed: 0, volunteerTicks: 0 } }]);
    // The account that pressed on a test row alone is still offered to the filter, as for every other kind.
    expect(accounts.map((who) => (who.kind === "staff" ? who.name : who.kind))).toEqual(["Org1", "QR1"]);
  });

  it("counts the volunteers each account confirmed for the raffle alone (§1028)", () => {
    const { rows } = journalSummary(
      [
        { actorId: ACCOUNT, actorName: "Org1", kind: "raffleConfirmed", count: 2, test: false },
        { actorId: ACCOUNT, actorName: "Org1", kind: "volunteerTicks", count: 1, test: false },
      ],
      "ro",
    );
    expect(rows).toEqual([{ who: { kind: "staff", id: ACCOUNT, name: "Org1" }, counts: { scanned: 0, checkedIn: 0, undone: 0, raffleOut: 0, raffleIn: 0, raffleConfirmed: 2, volunteerTicks: 1 } }]);
  });

  it("offers an account that worked test rows alone, and counts it nowhere", () => {
    const { rows, accounts } = journalSummary([{ actorId: ACCOUNT, actorName: "QR1", kind: "scanned", count: 3, test: true }], "ro");
    expect(rows).toEqual([]);
    expect(accounts).toEqual([{ kind: "staff", id: ACCOUNT, name: "QR1" }]);
  });

  it("reads an account the log does not name as everybody", () => {
    const accounts = [{ kind: "staff" as const, id: ACCOUNT, name: "QR1" }, { kind: "participant" as const }];
    expect(knownAccount({ kind: "staff", id: ACCOUNT }, accounts)).toEqual({ kind: "staff", id: ACCOUNT });
    expect(knownAccount({ kind: "staff", id: OTHER }, accounts)).toEqual({ kind: "all" });
    expect(knownAccount({ kind: "participant" }, accounts)).toEqual({ kind: "participant" });
    expect(knownAccount({ kind: "removed" }, accounts)).toEqual({ kind: "all" });
    expect(knownAccount({ kind: "all" }, [])).toEqual({ kind: "all" });
  });
});

describe("§996 who marked a runner present", () => {
  const words = { self: "prin „Am ajuns”", removed: "cont șters" };
  it("is the account's name, the person's own press, or an account gone since", () => {
    expect(checkedInWords(checkedInByOf({ checkedInByName: "QR2", checkedInBySelf: false }), words)).toBe("QR2");
    expect(checkedInWords(checkedInByOf({ checkedInByName: null, checkedInBySelf: true }), words)).toBe("prin „Am ajuns”");
    expect(checkedInWords(checkedInByOf({ checkedInByName: null, checkedInBySelf: false }), words)).toBe("cont șters");
    // A name wins: an account that still exists is named whatever else is true.
    expect(checkedInByOf({ checkedInByName: "QR2", checkedInBySelf: true })).toEqual({ kind: "staff", name: "QR2" });
  });
});
