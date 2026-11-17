import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type EmailOutboxStatus, emailOutboxStatus } from "@/db/schema/email-outbox";
import { EMAIL_OUTCOMES, emailOutcomeOf, isWaitingStatus } from "@/modules/notifications/domain/email-outcome";

/**
 * §NNN — what became of an email is ONE judgement (`domain/email-outcome.ts#emailOutcomeOf`): the person's «Emailuri»
 * fold draws its chips and its closed line from it (§915), and the «Emailuri» column of the «Voluntari» and
 * registrations lists says it in a word. Held here two ways: the function over every state a row can be in, and the
 * sources — the column's reader and its cell name no state of their own, and the fold's chip, waiting mark and closed
 * line ask the function — so a second judgement cannot be written beside the first. That the three say the same words
 * of the same row is `email-outcome-words.test.ts`.
 */

const SENT_AT = new Date("2026-10-01T07:15:00.000Z");

/** Every state a row can be in, by what the judgement reads: the status, how many it reached, whether it was taken. */
const ROWS: Array<{ status: EmailOutboxStatus; recipientCount: number | null; deliveredAt: Date | null }> = emailOutboxStatus.enumValues.flatMap((status) =>
  [null, 0, 1, 3].flatMap((recipientCount) => [null, SENT_AT].map((deliveredAt) => ({ status, recipientCount, deliveredAt }))),
);

describe("§NNN what became of an email: one judgement", () => {
  it("is a closed set of six, and says each from the state and the provider's facts", () => {
    expect([...EMAIL_OUTCOMES]).toEqual(["waiting", "sent", "delivered", "rejected", "failed", "captured"]);
    const of = (status: EmailOutboxStatus, recipientCount: number | null = 1, deliveredAt: Date | null = null) => emailOutcomeOf({ status, recipientCount, deliveredAt });
    // It has not left: queued, or a worker holds it — whatever else the row says.
    expect(of("PENDING", null)).toBe("waiting");
    expect(of("PROCESSING", null)).toBe("waiting");
    expect(of("PENDING", 0, SENT_AT)).toBe("waiting");
    // It spent its tries; the recipient's server refused it, or the person called it spam.
    expect(of("FAILED", null)).toBe("failed");
    expect(of("BOUNCED")).toBe("rejected");
    expect(of("COMPLAINED")).toBe("rejected");
    // A refusal is a refusal even of a row the environment captured or that was taken first.
    expect(of("BOUNCED", 0, SENT_AT)).toBe("rejected");
    // The environment kept it: «sent», to nobody — before anything is said of a delivery.
    expect(of("SENT", 0)).toBe("captured");
    expect(of("SENT", 0, SENT_AT)).toBe("captured");
    // It left: taken by the recipient's server, or nothing more known — a row sent before the count existed too.
    expect(of("SENT", 1, SENT_AT)).toBe("delivered");
    expect(of("SENT", null, SENT_AT)).toBe("delivered");
    expect(of("SENT", 1)).toBe("sent");
    expect(of("SENT", null)).toBe("sent");
    // A reader that does not carry the delivery fact («Emailuri azi») reads «sent» of a row that left.
    expect(emailOutcomeOf({ status: "SENT", recipientCount: 2 })).toBe("sent");
  });

  it("answers for every state a row can be in, and waits exactly on the two states that have not left", () => {
    for (const row of ROWS) expect(EMAIL_OUTCOMES, JSON.stringify(row)).toContain(emailOutcomeOf(row));
    expect(new Set(ROWS.map(emailOutcomeOf))).toEqual(new Set(EMAIL_OUTCOMES));
    for (const status of emailOutboxStatus.enumValues) {
      expect(isWaitingStatus(status), status).toBe(status === "PENDING" || status === "PROCESSING");
      expect(emailOutcomeOf({ status, recipientCount: 1 }) === "waiting", status).toBe(isWaitingStatus(status));
    }
  });
});

describe("§NNN no second judgement beside the first", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
  /** Code alone: a comment may tell the story of a state, the code may not decide by one. */
  const codeOf = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const STATES = emailOutboxStatus.enumValues.map((status) => `"${status}"`);

  it("the column's reader and its cell name no state and no recipient count of their own: they ask the one function", () => {
    for (const file of ["src/modules/notifications/email-summaries.ts", "src/modules/notifications/ui/EmailSummary.tsx"]) {
      const code = codeOf(file);
      for (const state of STATES) expect(code, `${file} ${state}`).not.toContain(state);
      expect(code, file).not.toMatch(/recipientCount\s*[!=]==/);
      expect(code, file).not.toMatch(/deliveredAt\s*[?&|]/);
    }
    expect(codeOf("src/modules/notifications/email-summaries.ts")).toContain("emailOutcomeOf(");
    // The cell draws the outcome it is handed, by name: each of the six has its word and its ink.
    const cell = codeOf("src/modules/notifications/ui/EmailSummary.tsx");
    for (const outcome of EMAIL_OUTCOMES) {
      expect(cell, outcome).toMatch(new RegExp(`case "${outcome}":`));
      expect(cell, outcome).toMatch(new RegExp(`\\b${outcome}: "`));
    }
  });

  it("the fold's chip, its waiting mark and its closed line ask the one function", () => {
    const journal = codeOf("src/modules/notifications/ui/EmailJournal.tsx");
    const chip = journal.slice(journal.indexOf("export function DepartedChip"), journal.indexOf("export function ClubFold"));
    expect(chip).toContain("emailOutcomeOf(line)");
    for (const state of STATES) expect(chip, state).not.toContain(state);
    expect(chip).not.toMatch(/recipientCount\s*[!=]==/);

    const fold = codeOf("src/modules/notifications/ui/EmailHistory.tsx");
    const closedLine = fold.slice(fold.indexOf("function latestState"), fold.indexOf("function causeWords"));
    expect(closedLine).toContain("emailOutcomeOf(row)");
    for (const state of STATES) expect(closedLine, state).not.toContain(state);
    expect(fold).toMatch(/const isWaiting = [^\n]*emailOutcomeOf\(row\) === "waiting"/);
    expect(fold).not.toMatch(/recipientCount\s*[!=]==/);
  });

  it("the judgement reads the row's state and the provider's facts — never the payload, an address or the last answer", () => {
    const domain = codeOf("src/modules/notifications/domain/email-outcome.ts");
    for (const state of STATES.filter((state) => state !== '"SENT"')) expect(domain, state).toContain(state);
    for (const never of ["payload", "recipientEmail", "lastError", "providerDetail"]) expect(domain, never).not.toContain(never);
  });
});
