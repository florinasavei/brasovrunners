import { createTranslator } from "next-intl";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type EmailOutboxStatus, emailOutboxStatus } from "@/db/schema/email-outbox";
import { catalogueOf } from "@/i18n/catalogue";
import { type EmailOutcome, emailOutcomeOf } from "@/modules/notifications/domain/email-outcome";
import { type EmailHistoryRowRead, foldEmailHistory } from "@/modules/notifications/email-history";
import { emailHistorySummary } from "@/modules/notifications/ui/EmailHistory";
import { DepartedChip, type T } from "@/modules/notifications/ui/EmailJournal";
import EmailSummaryCell from "@/modules/notifications/ui/EmailSummary";

/**
 * §NNN — the fold and the column say one thing of every row. For every state an outbox row can be in, the chip of the
 * person's «Emailuri» fold (§915), the fold's closed line and the «Emailuri» column's word are drawn and read: each
 * says the outcome the one judgement gives (`domain/email-outcome.ts`), in the fold's own words — the column's two
 * bare ones, «a plecat» and «livrat», being the fold's words without the hour the column says beside them.
 */

// 12:00 in Brașov on 1 October 2026 (UTC+3); the email left at 10:15 that day.
const NOW = new Date("2026-10-01T09:00:00.000Z");
const SENT_AT = new Date("2026-10-01T07:15:00.000Z");
const translatorOf = (locale: "ro" | "en") => createTranslator({ locale, messages: catalogueOf(locale), namespace: "Admin" }) as unknown as T;

/** Every state a row can be in, by what the judgement reads: the status, how many it reached, whether it was taken. */
const ROWS: Array<{ status: EmailOutboxStatus; recipientCount: number | null; deliveredAt: Date | null }> = emailOutboxStatus.enumValues.flatMap((status) =>
  [null, 0, 1, 3].flatMap((recipientCount) => [null, new Date("2026-10-01T07:16:00.000Z")].map((deliveredAt) => ({ status, recipientCount, deliveredAt }))),
);

/** What the fold's chip says for each outcome of a row that is no longer waiting, in Romanian. */
const CHIP_WORDS: Record<Exclude<EmailOutcome, "waiting">, string> = {
  sent: "A plecat la 10:15",
  delivered: "A plecat la 10:15",
  rejected: "Refuzat",
  failed: "Eșuat",
  captured: "Nu a ajuns la nimeni (QA)",
};

/** What the fold's closed line says of its latest email, and what the column says of each: the same words, the column's without the hour. */
const WORDS: Record<"ro" | "en", Record<EmailOutcome, { line: string; column: string }>> = {
  ro: {
    waiting: { line: "așteaptă", column: "așteaptă" },
    sent: { line: "a plecat la 10:15", column: "a plecat" },
    delivered: { line: "a plecat la 10:15", column: "livrat" },
    rejected: { line: "refuzat", column: "refuzat" },
    failed: { line: "eșuat", column: "eșuat" },
    captured: { line: "n-a ajuns la nimeni (QA)", column: "n-a ajuns la nimeni (QA)" },
  },
  en: {
    waiting: { line: "waiting", column: "waiting" },
    sent: { line: "left at 10:15", column: "left" },
    delivered: { line: "left at 10:15", column: "delivered" },
    rejected: { line: "refused", column: "refused" },
    failed: { line: "failed", column: "failed" },
    captured: { line: "reached nobody (QA)", column: "reached nobody (QA)" },
  },
};

const said = (element: ReactElement | null) => (element ? renderToStaticMarkup(element).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "") : "");

describe("§NNN the fold and the column say one thing of every row", () => {
  it("the fold's chip is the outcome's chip, for every row that is no longer waiting", () => {
    const t = translatorOf("ro");
    for (const row of ROWS) {
      const outcome = emailOutcomeOf(row);
      if (outcome === "waiting") continue;
      const chip = said(DepartedChip({ line: { ...row, sentAt: SENT_AT, createdAt: SENT_AT }, t, locale: "ro", now: NOW }));
      expect(chip, JSON.stringify(row)).toBe(CHIP_WORDS[outcome]);
    }
  });

  it("the fold's closed line and the column's line say the same outcome of the same row, in Romanian and in English", () => {
    for (const locale of ["ro", "en"] as const) {
      const t = translatorOf(locale);
      for (const row of ROWS) {
        const outcome = emailOutcomeOf(row);
        const left = outcome !== "waiting" && outcome !== "failed";
        const read: EmailHistoryRowRead = {
          id: "00000000-0000-4000-8000-000000000001",
          messageType: "REGISTRATION_CONFIRMED",
          status: row.status,
          recipientEmail: "ana@example.org",
          createdAt: SENT_AT,
          sentAt: left ? SENT_AT : null,
          recipientCount: row.recipientCount,
          attemptCount: 1,
          nextAttemptAt: null,
          deliveredAt: row.deliveredAt,
          rejectedAt: null,
          rejectionCause: null,
          lastError: null,
          cause: null,
          pressId: null,
          by: null,
          manualResend: false,
          clubCopy: false,
          familyHeld: false,
          sentNow: false,
          road: null,
          idempotencyKey: "k:one",
        };
        // The fold's closed line: «1 email · ultimul: „…” — <state>».
        const line = emailHistorySummary(foldEmailHistory([read], { ownTotal: 1, total: 1 }), t, locale, NOW);
        expect(line.split(" — ").at(-1), `${locale} ${JSON.stringify(row)}`).toBe(WORDS[locale][outcome].line);
        // The column's line: «<name> · <when> · <outcome>».
        const cell = said(
          EmailSummaryCell({
            summary: { total: 1, lines: [{ id: read.id, messageType: read.messageType, at: SENT_AT, outcome }] },
            href: "/ro/admin/registrations/x#emailuri",
            personName: "Ana Pop",
            locale,
            t,
          }),
        );
        expect(cell.split(" · ").at(-1), `${locale} ${JSON.stringify(row)}`).toBe(WORDS[locale][outcome].column);
      }
    }
  });

  it("the column's two bare words are the fold's own, without the hour the column says beside them", () => {
    for (const locale of ["ro", "en"] as const) {
      const admin = (catalogueOf(locale) as unknown as { Admin: { emails: { history: { last: Record<string, string> } }; registrations: { emails: { state: { delivered: string } } } } }).Admin;
      const last = admin.emails.history.last;
      // «a plecat» is «a plecat {at}» without its moment: the same word, never a second one («trimis», «expediat»).
      expect(last.sentOn).toBe(`${last.sent} {at}`);
      // «livrat» is the word of the registration's own «Emailuri» («Livrat {date}»), in the closed line's lower case.
      expect(admin.registrations.emails.state.delivered.toLowerCase()).toBe(`${last.delivered} {date}`);
    }
  });
});
