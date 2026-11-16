import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «Planul voluntarilor» (§NNN, BR-REQ-060-01) — the point of the route a volunteer stands at is the organizers' own planning: it
 * reaches the plan's page, the «Voluntari» list's column and «Toate datele unei persoane» (art. 15), and nothing else. Never the
 * public volunteers' list, never an email, never a badge, never the volunteers' files. The structural half of that promise, as
 * `volunteer-notes-never-leave.test.ts` holds the notes': no file outside the list below so much as names the column, the plan's
 * module or its words, so a later join or a helpful new column cannot quietly start carrying it. (What the plan reads and who may
 * read it is `tests/integration/volunteers/plan.test.ts`.) A new reader is a reviewed edit of this list.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** The column, the person's-data field, the plan's module and the plan's catalogue words. */
const NAMES_THE_POINT = /checkpointId|checkpoint_id|checkpointName|modules\/volunteers\/plan|volunteers\.plan\./;

const READERS = new Set(
  [
    // The column itself.
    "src/db/schema/event-volunteers.ts",
    // The one writer («Pune aici» / «Scoate», `setCheckpoint`) and the row's item, which the staff screens read.
    "src/modules/volunteers/volunteers.ts",
    // The plan as read: the points with their people.
    "src/modules/volunteers/plan.ts",
    // The plan's page and its two presses.
    "src/app/[locale]/admin/events/[id]/plan-voluntari/page.tsx",
    "src/app/[locale]/admin/events/[id]/plan-voluntari/actions.ts",
    // The «Voluntari» list: the button to the plan and the column «Punct».
    "src/app/[locale]/admin/volunteers/(list)/page.tsx",
    // «Toate datele unei persoane» (art. 15): the point's name, and the line that draws it.
    "src/modules/registrations/person-data.ts",
    "src/modules/volunteers/ui/VolunteerAnswers.tsx",
  ].map((file) => path.join(ROOT, file)),
);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("§NNN a volunteer's point stays with the organizers", () => {
  const naming = sourceFiles(SRC).filter((file) => NAMES_THE_POINT.test(readFileSync(file, "utf8")));

  it("is named only by the files reviewed to read it", () => {
    const strangers = naming.filter((file) => !READERS.has(file)).map((file) => path.relative(ROOT, file));
    expect(strangers).toEqual([]);
  });

  it("keeps the list honest: every reader still names it", () => {
    const silent = [...READERS].filter((file) => !naming.includes(file)).map((file) => path.relative(ROOT, file));
    expect(silent).toEqual([]);
  });

  it("is in no public list, email, badge or file of the volunteers", () => {
    for (const file of [
      "src/modules/volunteers/public-list.ts",
      "src/modules/volunteers/csv.ts",
      "src/modules/volunteers/export.ts",
      "src/modules/volunteers/workbook.ts",
      "src/modules/volunteers/raffle-list.ts",
      "src/modules/volunteers/badges/badges.ts",
      "src/modules/notifications/render.ts",
      "src/modules/notifications/templates.ts",
    ]) {
      expect(NAMES_THE_POINT.test(readFileSync(path.join(ROOT, file), "utf8")), file).toBe(false);
    }
  });
});
