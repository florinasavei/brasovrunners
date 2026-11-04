import type { EmailMessageType } from "@/db/schema/email-outbox";
import { isBulkMessage } from "./bulk";
import { type DepartureContext, type DepartureRow, departureOf } from "./departure";
import { isClubSide } from "./email-audience";
import { mainTypesOf, type PressCause } from "./press-causes";

/**
 * What one press queued, told after it (the design «telling the owner about every email a staff press sends»,
 * 2026-11-03, slice 2, its section 3: the owner asked to know, after every press, what left, to how many and when).
 *
 * The press's rows — every one its scope stamped with its `press_id`, read back once its transaction committed, so a
 * row withdrawn inside the same press (the waiting-list email an offer replaced) is not among them — are sorted four
 * ways:
 *
 * - **the person's own email** — a type the cause names as its main email (`press-causes.ts`) to a person: what the
 *   press is about («„Înscriere anulată” către 1 persoană»);
 * - **the club's** — a copy, the declaration's archive, «somebody has confirmed», a notice to the club's people
 *   (`email-audience.ts#isClubSide`, Critic correction 4): counted, never named;
 * - **others** — what reached somebody else: the offer to the next in line, a lapsed hold;
 * - **test** — a test registration's row (AGENTS.md §12.6): counted apart, never among the people.
 *
 * When each leaves is the queue's own judgement (`departure.ts#departureOf`, the one the queue panel and «Emailuri
 * azi» ask): now, at an estimated hour — the volunteer roles' two-minute hold included —, after Mailgun resumes, or
 * over the next days for the part of a newsletter today's room cannot hold (`bulk.ts`). A send split between two
 * moments says both: the first, and how many leave later.
 *
 * Pure: the server reads the rows and the context once (`../press-receipt.ts`), and the flash carries only the result's
 * tokens, counts and instants (`receiptValues`) — never a name, never an address.
 */

/** One row of the press, as the receipt reads it: what the departure judgement needs, the club-copy flag and the test mark. */
export type ReceiptRow = DepartureRow & { clubCopy: boolean; test: boolean };

/** When a part of the press leaves: now, at an estimated hour, after Mailgun resumes, or over the next days. */
export type ReceiptWhen = { kind: "now" } | { kind: "at"; at: Date } | { kind: "reset"; at: Date } | { kind: "days" };

/** Whom the line's email went to: the person the press acts on, a test address, or — when the person got none — others. */
export type ReceiptAudience = "people" | "test" | "others";

export type ReceiptLine = {
  to: ReceiptAudience;
  /** The one or two types the line names, the most sent first; none when other people got several kinds. */
  types: EmailMessageType[];
  /** How many leave at `when`: people for one kind of email, emails for several. */
  count: number;
  when: ReceiptWhen;
  /** The rest of a split send: how many, and when the last of them leaves. */
  later: { count: number; when: ReceiptWhen } | null;
  /** A volunteer's roles email held for the next press (`ROLE_EMAIL_SETTLE_MINUTES`). */
  rolesHeld: boolean;
};

export type Receipt = {
  /** Null when the press queued nothing for anybody: the toast then says nothing about email. */
  line: ReceiptLine | null;
  club: number;
  /** What reached other people, beside the person's own email; null when nothing did or the line is theirs. */
  others: { count: number; type: EmailMessageType | null } | null;
  /** Test rows outside the line. */
  test: number;
};

/** The order two moments are told in: now first, then by the hour, the next days last. */
function rank(when: ReceiptWhen): [number, number] {
  if (when.kind === "now") return [0, 0];
  if (when.kind === "days") return [2, 0];
  return [1, when.at.getTime()];
}

/** One slot per moment: the same minute is the same moment. */
function slotKey(when: ReceiptWhen): string {
  if (when.kind === "now" || when.kind === "days") return when.kind;
  return `${when.kind}:${Math.floor(when.at.getTime() / 60_000)}`;
}

/** The queue's judgement, as the receipt words it: a row the worker already holds leaves now; a failed one has no time to tell. */
function whenOf(row: ReceiptRow, ctx: DepartureContext): ReceiptWhen | null {
  const departure = departureOf(row, ctx);
  switch (departure.kind) {
    case "now":
    case "sending":
      return { kind: "now" };
    case "never":
      return null;
    case "reset":
      return { kind: "reset", at: departure.at };
    case "at":
      return { kind: "at", at: departure.at };
  }
}

/** How many a set of rows reaches: one person per row of one kind; with several kinds, the most of any one kind — each person gets one of each. */
function peopleOf(rows: readonly ReceiptRow[], mixed: boolean): number {
  if (mixed) return rows.length;
  const byType = new Map<EmailMessageType, number>();
  for (const row of rows) byType.set(row.messageType, (byType.get(row.messageType) ?? 0) + 1);
  return Math.max(0, ...byType.values());
}

function lineOf(to: ReceiptAudience, rows: readonly ReceiptRow[], ctx: DepartureContext, bulkRoom: number | null): ReceiptLine | null {
  const byType = new Map<EmailMessageType, number>();
  for (const row of rows) byType.set(row.messageType, (byType.get(row.messageType) ?? 0) + 1);
  const kinds = [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type]) => type);
  // The person's own email names its two kinds at most (a member's order placed and paid); a test or another person's, one or none.
  const types = to === "people" ? kinds.slice(0, 2) : kinds.length === 1 ? kinds : [];
  const mixed = types.length === 0;

  const slots = new Map<string, { when: ReceiptWhen; rows: ReceiptRow[] }>();
  // A newsletter's rows on Mailgun's road fill only today's room (`bulk.ts`); the rest wait for the next days' allowance.
  let room = bulkRoom;
  for (const row of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    let when = whenOf(row, ctx);
    if (when === null) continue;
    if (room !== null && isBulkMessage(row.messageType) && row.onMailgunRoad && (when.kind === "now" || when.kind === "at")) {
      if (room > 0) room -= 1;
      else when = { kind: "days" };
    }
    const key = slotKey(when);
    const slot = slots.get(key) ?? { when, rows: [] };
    slot.rows.push(row);
    slots.set(key, slot);
  }
  const ordered = [...slots.values()].sort((a, b) => {
    const [ra, ta] = rank(a.when);
    const [rb, tb] = rank(b.when);
    return ra - rb || ta - tb;
  });
  const [first, ...rest] = ordered;
  if (!first) return null;
  const laterRows = rest.reduce((sum, slot) => sum + slot.rows.length, 0);
  return {
    to,
    types,
    count: peopleOf(first.rows, mixed),
    when: first.when,
    later: laterRows > 0 ? { count: laterRows, when: rest[rest.length - 1].when } : null,
    rolesHeld: rows.some((row) => row.messageType === "VOLUNTEER_ROLE_ASSIGNED" && row.nextAttemptAt !== null && row.nextAttemptAt.getTime() > ctx.now.getTime()),
  };
}

/**
 * The press's rows told as one receipt. `bulkRoom` is how many newsletter rows today's allowance still holds after
 * what already waits (null: no ceiling binds).
 */
export function summarizeReceipt(cause: PressCause, rows: readonly ReceiptRow[], ctx: DepartureContext, bulkRoom: number | null = null): Receipt {
  const main = new Set<EmailMessageType>(mainTypesOf(cause));
  let club = 0;
  const own: ReceiptRow[] = [];
  const others: ReceiptRow[] = [];
  const testOwn: ReceiptRow[] = [];
  const testOther: ReceiptRow[] = [];
  for (const row of rows) {
    if (isClubSide(row.messageType, row.clubCopy)) club += 1;
    else if (row.test) (main.has(row.messageType) ? testOwn : testOther).push(row);
    else (main.has(row.messageType) ? own : others).push(row);
  }

  // The person's own email first; a test registration's when that is all the press touched; others when the person got none.
  const [to, lineRows, besides, test]: [ReceiptAudience, ReceiptRow[], ReceiptRow[], number] =
    own.length > 0
      ? ["people", own, others, testOwn.length + testOther.length]
      : testOwn.length > 0
        ? ["test", testOwn, others, testOther.length]
        : others.length > 0
          ? ["others", others, [], testOther.length]
          : ["test", testOther, [], 0];
  const line = lineRows.length > 0 ? lineOf(to, lineRows, ctx, bulkRoom) : null;
  const otherKinds = new Set(besides.map((row) => row.messageType));
  return {
    line,
    club,
    others: besides.length > 0 ? { count: besides.length, type: otherKinds.size === 1 ? besides[0].messageType : null } : null,
    test,
  };
}

/**
 * The receipt as the flash carries it (`shared/feedback/flash.ts`, read back by `shared/feedback/mail-line.ts`): tokens,
 * counts and instants, every name prefixed `mail` — never a person's name or address (§384's cookie rule). Empty when
 * the press queued nothing: the toast then says nothing about email.
 *
 * `road` is the road the press's dialog promised (§841), told inside the line; `zitadel`, that Zitadel sent its own
 * password link beside the club's invitation (the email the club's queue never sees).
 */
export function receiptValues(receipt: Receipt, pressedAt: Date, extras: { road?: "mailgun" | "gmail" | null; zitadel?: boolean } = {}): Record<string, string> {
  const { line } = receipt;
  if (!line) return {};
  const values: Record<string, string> = { mail: line.when.kind, mailTo: line.to, mailPeople: String(line.count), mailPressedAt: pressedAt.toISOString() };
  if (line.when.kind === "at" || line.when.kind === "reset") values.mailAt = line.when.at.toISOString();
  if (line.types[0]) values.mailType = line.types[0];
  if (line.types[1]) values.mailType2 = line.types[1];
  if (line.later) {
    values.mailLater = String(line.later.count);
    if (line.later.when.kind === "days") values.mailLaterDays = "1";
    else if (line.later.when.kind === "at" || line.later.when.kind === "reset") values.mailLaterAt = line.later.when.at.toISOString();
  }
  if (receipt.club > 0) values.mailClub = String(receipt.club);
  if (receipt.test > 0) values.mailTest = String(receipt.test);
  if (receipt.others) {
    values.mailOthers = String(receipt.others.count);
    if (receipt.others.type) values.mailOtherType = receipt.others.type;
  }
  if (line.rolesHeld) values.mailRoles = "1";
  if (extras.road) values.mailRoad = extras.road;
  if (extras.zitadel) values.mailZitadel = "1";
  return values;
}
