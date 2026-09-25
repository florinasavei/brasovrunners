import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §377 — the owner's standing rule, "no hardcoded values in documents and emails": the deadlines
 * that became the club's setting are nowhere a constant any more, and nowhere written as words a
 * setting cannot change. A guard, grep-shaped on purpose, so the next sentence that types
 * "48 de ore" is refused by the suite rather than found by the owner.
 */
const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

function flatten(messages: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flatten(value as Record<string, unknown>, full));
    else out[full] = String(value);
  }
  return out;
}

describe("§377 the former constants are gone", () => {
  it("no source file names one of the seven constants the setting replaced", () => {
    const names = /\b(EMAIL_CONFIRMATION_HOLD_HOURS|DECLARATION_HOLD_MINUTES|WAITLIST_OFFER_HOLD_HOURS|REMINDER_HOURS_BEFORE|SELF_CHECKIN_OPENS_HOURS|RACE_WEEK_DAYS|HORIZON_DAYS)\b/;
    const offenders = sourceFiles(path.join(ROOT, "src")).filter((file) => names.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it("the job's plan has no reminder lead of its own — the literal it duplicated is gone", () => {
    expect(read("src/modules/jobs/schedule.ts")).not.toMatch(/48 \* 60/);
    expect(read("src/modules/jobs/next-work.ts")).not.toMatch(/\b48\b/);
  });

  it("the backoffice's race week reads the setting, not seven days of its own", () => {
    for (const file of ["src/modules/content/events/ui/boxes/RegistrationBox.tsx", "src/app/[locale]/admin/events/[id]/page.tsx"]) {
      expect(read(file), file).not.toMatch(/7 \* 86_400_000/);
    }
  });
});

describe("§377 no sentence states a deadline the setting cannot change", () => {
  /*
    What the catalogues said before, word for word. A key may still carry one of these phrases
    for a reason that is not a deadline — "Ora pe 24 de ore" is the 24-hour clock, the monitor's
    "not every 30 minutes" is the pinger's cadence, and the placeholder help quotes "48 de ore" as
    an example of what the setting fills in — and those keys are named here, each with its reason.
  */
  const PHRASES = [
    "48 de ore",
    "30 de minute",
    "24 de ore",
    "două zile",
    "opt săptămâni",
    "ziua dinaintea startului",
    "48 hours",
    "30 minutes",
    "24 hours",
    "two days",
    "Two days",
    "eight weeks",
    "48-hour",
    "30-minute",
    " 24 h ",
    "the day before the start",
  ];
  const NOT_A_DEADLINE = new Set([
    // The time picker: the 24-hour clock.
    "Admin.pickers.timeTyped",
    // The pinger's cadence on cron-job.org, a cost of the platform's, not a participant's deadline.
    "Admin.tasks.items.scheduler.how.5",
    // Quotes "48 de ore" as what the four deadline placeholders fill in.
    "Admin.emails.copy.placeholders",
    "Admin.emails.copy.placeholdersUsed",
  ]);

  it("in either catalogue", () => {
    for (const [name, messages] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const flat = flatten(messages as Record<string, unknown>);
      const offenders = Object.entries(flat)
        .filter(([key]) => !NOT_A_DEADLINE.has(key))
        .filter(([, value]) => PHRASES.some((phrase) => value.includes(phrase)))
        .map(([key]) => key);
      expect(offenders, `${name}.json`).toEqual([]);
    }
  });

  it("in the email templates, which word the numbers they are handed", () => {
    const templates = read("src/modules/notifications/templates.ts");
    for (const phrase of ["peste două zile", "two days away", "cu o săptămână înainte de start", "a week before the start", "valabil 14 zile", "valid for 14 days"]) {
      expect(templates, phrase).not.toContain(phrase);
    }
  });

  it("in the platform's legal templates, whose deadlines are merge fields now", () => {
    for (const file of ["src/modules/legal-documents/templates/terms.ts", "src/modules/legal-documents/templates/privacy-notice.ts"]) {
      const text = read(file);
      for (const phrase of ["48 de ore", "30 de minute", "24 de ore", "48 hours", "30 minutes", "24 hours"]) {
        expect(text, `${file}: ${phrase}`).not.toContain(phrase);
      }
    }
    expect(read("src/modules/legal-documents/templates/terms.ts")).toContain("{{confirmationHours}}");
    expect(read("src/modules/legal-documents/templates/privacy-notice.ts")).toContain("{{reminderClause}}");
  });
});
