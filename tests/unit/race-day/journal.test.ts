import { describe, expect, it } from "vitest";
import {
  type CodeScan,
  earlierScans,
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
 * §NNN — «Ziua cursei» → «Jurnal» and «Scanat înainte», the pure half (`race-day/domain/journal.ts`): the address's two filters,
 * which reads a filter asks, the reads merged under one cap with how many more, the counts per account (a test registration's
 * never counted, its account still offered), an unknown account read as everybody, and the visit's own scan left out of the
 * earlier ones; and who marked a runner present, in the desk chip's words.
 */
const ACCOUNT = "0b6c1e7e-6f6a-4c55-9a43-2f6f3c5b8a10";
const OTHER = "1c7d2f8f-7a7b-4d66-8b54-3a7a4d6c9b21";

describe("§NNN the address's filters", () => {
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

  it("reads `kind` as one of the five, or every kind", () => {
    for (const kind of ["scanned", "checkedIn", "undone", "volunteerPresent", "volunteerAbsent"]) expect(journalKindOf(kind)).toBe(kind);
    for (const junk of [undefined, "", "SCANNED", "all", ["scanned"]]) expect(journalKindOf(junk)).toBeNull();
    expect(runnerKindOf("registration.code_scanned")).toBe("scanned");
    expect(runnerKindOf("registration.checked_in")).toBe("checkedIn");
    expect(runnerKindOf("registration.checkin_undone")).toBe("undone");
    expect(runnerKindOf("volunteer.edited")).toBeNull();
  });

  it("asks each read only what the filter can show", () => {
    expect(journalReads(null, { kind: "all" })).toEqual({ runnerKinds: ["scanned", "checkedIn", "undone"], volunteerTicks: [true, false], selfCheckIns: true });
    expect(journalReads("scanned", { kind: "all" })).toEqual({ runnerKinds: ["scanned"], volunteerTicks: [], selfCheckIns: false });
    expect(journalReads("checkedIn", { kind: "all" })).toEqual({ runnerKinds: ["checkedIn"], volunteerTicks: [], selfCheckIns: true });
    expect(journalReads("volunteerAbsent", { kind: "all" })).toEqual({ runnerKinds: [], volunteerTicks: [false], selfCheckIns: false });
    // One account, or the deleted ones: never the participants' own «Am ajuns», which has no account.
    expect(journalReads(null, { kind: "staff", id: ACCOUNT })).toEqual({ runnerKinds: ["scanned", "checkedIn", "undone"], volunteerTicks: [true, false], selfCheckIns: false });
    expect(journalReads("checkedIn", { kind: "removed" })).toEqual({ runnerKinds: ["checkedIn"], volunteerTicks: [], selfCheckIns: false });
    // The participants: their own check-ins alone.
    expect(journalReads(null, { kind: "participant" })).toEqual({ runnerKinds: [], volunteerTicks: [], selfCheckIns: true });
    expect(journalReads("scanned", { kind: "participant" })).toEqual({ runnerKinds: [], volunteerTicks: [], selfCheckIns: false });
  });
});

const line = (id: string, iso: string): JournalLine => ({ id, at: new Date(iso), kind: "scanned", who: { kind: "removed" }, whom: { kind: "volunteer", id: "v", name: "x" } });

describe("§NNN the reads merged", () => {
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

describe("§NNN the counts per account", () => {
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
      { who: { kind: "staff", id: ACCOUNT, name: "QR1" }, counts: { scanned: 3, checkedIn: 0, undone: 0, volunteerTicks: 1 } },
      { who: { kind: "staff", id: OTHER, name: "QR2" }, counts: { scanned: 0, checkedIn: 2, undone: 0, volunteerTicks: 0 } },
      { who: { kind: "removed" }, counts: { scanned: 0, checkedIn: 0, undone: 1, volunteerTicks: 0 } },
      { who: { kind: "participant" }, counts: { scanned: 0, checkedIn: 4, undone: 0, volunteerTicks: 0 } },
    ]);
    expect(accounts.map((who) => (who.kind === "staff" ? who.name : who.kind))).toEqual(["QR1", "QR2", "removed", "participant"]);
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

describe("§NNN «Scanat înainte»", () => {
  const scan = (id: string, minute: number, actorId: string | null): CodeScan => ({ id, at: new Date(Date.UTC(2099, 10, 21, 6, minute)), actorId, actorName: actorId });
  // The code's newest scans, newest first, as `listCodeScans` reads them.
  const scans = [scan("d", 12, "qr2"), scan("c", 9, "admin"), scan("b", 7, "qr3"), scan("a", 5, "qr1")];

  it("names the newest three but the visit's own, oldest first", () => {
    expect(earlierScans(scans, { ownScanId: "d", backFromVerb: false, viewerId: "qr2" }).map((one) => one.id)).toEqual(["a", "b", "c"]);
    // A visit that recorded nothing (a prefetch is never drawn; the registration's own link): the newest three.
    expect(earlierScans(scans, { ownScanId: null, backFromVerb: false, viewerId: "admin" }).map((one) => one.id)).toEqual(["b", "c", "d"]);
  });

  it("back from a verb, leaves out the viewer's newest scan — the visit's own, a press later — and only that one", () => {
    expect(earlierScans(scans, { ownScanId: null, backFromVerb: true, viewerId: "qr2" }).map((one) => one.id)).toEqual(["a", "b", "c"]);
    expect(earlierScans([scan("e", 20, "qr1"), ...scans], { ownScanId: null, backFromVerb: true, viewerId: "qr1" }).map((one) => one.id)).toEqual(["b", "c", "d"]);
    // A viewer who never scanned it: nothing to leave out.
    expect(earlierScans(scans, { ownScanId: null, backFromVerb: true, viewerId: "nobody" }).map((one) => one.id)).toEqual(["b", "c", "d"]);
  });

  it("is empty with no earlier scan", () => {
    expect(earlierScans([scan("d", 12, "qr2")], { ownScanId: "d", backFromVerb: false, viewerId: "qr2" })).toEqual([]);
    expect(earlierScans([], { ownScanId: null, backFromVerb: true, viewerId: "qr2" })).toEqual([]);
  });
});

describe("§NNN who marked a runner present", () => {
  const words = { self: "prin „Am ajuns”", removed: "cont șters" };
  it("is the account's name, the person's own press, or an account gone since", () => {
    expect(checkedInWords(checkedInByOf({ checkedInByName: "QR2", checkedInBySelf: false }), words)).toBe("QR2");
    expect(checkedInWords(checkedInByOf({ checkedInByName: null, checkedInBySelf: true }), words)).toBe("prin „Am ajuns”");
    expect(checkedInWords(checkedInByOf({ checkedInByName: null, checkedInBySelf: false }), words)).toBe("cont șters");
    // A name wins: an account that still exists is named whatever else is true.
    expect(checkedInByOf({ checkedInByName: "QR2", checkedInBySelf: true })).toEqual({ kind: "staff", name: "QR2" });
  });
});
