import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The picture of «Planul voluntarilor» (§952, BR-REQ-060-01) — the organizers' own drawing of the plan stays with the plan: the
 * column that holds it (`events.volunteer_plan_media_asset_id`) is read by the plan and counted by the pictures' reference check,
 * and by nothing else. Never a public query or the public cache, never a series' scope, a copy or the event's file. It leaves
 * by one road, at an organizer's press: «Trimite fiecăruia punctul lui» (§956) shows it in the email each placed volunteer
 * gets about their own point — read through the plan's own function (`readVolunteerPlanPicture`), so even that message's
 * files never name the column. The structural half of that promise, as `plan-never-leaves.test.ts` beside it holds the
 * point's: no file outside the list below so much as names the column, so a later join or a helpful new column cannot quietly
 * start carrying it. (What the plan reads, who may write it and what the sweep does is
 * `tests/integration/volunteers/plan-picture.test.ts`.) A new reader is a reviewed edit of this list.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** The column, by its name in the code and in the database. */
const NAMES_THE_PICTURE = /volunteerPlanMediaAssetId|volunteer_plan_media_asset_id/;
/** The trail's two actions. */
const NAMES_THE_TRAIL = /event\.volunteer_plan_picture_(set|removed)/;

const EVENT_SERVICE = "src/modules/content/events/service.ts";

const READERS = new Set(
  [
    // The column itself.
    "src/db/schema/events.ts",
    // The plan: the one read (`readVolunteerPlan`) and the one writer (`setVolunteerPlanPicture`).
    "src/modules/volunteers/plan.ts",
    // The one predicate that says a stored picture is in use: the sweep, the pictures page and its delete.
    "src/modules/media/references.ts",
    // The row a create page's preview starts from, which is every column of the event (`blankEventRow`) — and nothing else there.
    EVENT_SERVICE,
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

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

describe("§952 the plan's picture stays with the plan", () => {
  const all = sourceFiles(SRC);
  const naming = all.filter((file) => NAMES_THE_PICTURE.test(readFileSync(file, "utf8")));

  it("is named only by the files reviewed to read it", () => {
    const strangers = naming.filter((file) => !READERS.has(file)).map(relative);
    expect(strangers).toEqual([]);
  });

  it("keeps the list honest: every reader still names it", () => {
    const silent = [...READERS].filter((file) => !naming.includes(file)).map(relative);
    expect(silent).toEqual([]);
  });

  it("is classified once by the events' own service — the blank row — and carried by no save, series, repeat or copy", () => {
    const service = read(EVENT_SERVICE);
    const lines = service.split("\n").filter((line) => NAMES_THE_PICTURE.test(line));
    // The one line: an event that does not exist yet has no plan. Not in `SERIES_COLUMNS`, not in `copiedEventValues`, in no save.
    expect(lines.map((line) => line.trim())).toEqual(["volunteerPlanMediaAssetId: null,"]);
    const blankRow = service.slice(service.indexOf("function blankEventRow("), service.indexOf("function blankTranslationRow("));
    expect(blankRow).toContain("volunteerPlanMediaAssetId: null,");
  });

  it("is named by no public query, no public cache, no file of the emails, no file of the event and no file of the volunteers", () => {
    for (const file of [
      "src/modules/events/repository.ts",
      "src/modules/public-cache/cache.ts",
      "src/modules/public-cache/reads.ts",
      "src/modules/notifications/render.ts",
      "src/modules/notifications/templates.ts",
      "src/modules/content/events/fields.ts",
      "src/modules/content/events/repository.ts",
      "src/modules/volunteers/public-list.ts",
      "src/modules/volunteers/csv.ts",
      "src/modules/volunteers/export.ts",
      "src/modules/volunteers/workbook.ts",
      "src/modules/volunteers/badges/badges.ts",
      "src/modules/registrations/person-data.ts",
    ]) {
      expect(NAMES_THE_PICTURE.test(read(file)), file).toBe(false);
    }
    // The event as a JSON file (§751): none of its modules names the column — a file read on another environment would
    // name another bucket's object.
    const transfer = all.filter((file) => relative(file).startsWith("src/modules/content/events/transfer/"));
    expect(transfer.length).toBeGreaterThan(5);
    for (const file of transfer) expect(NAMES_THE_PICTURE.test(readFileSync(file, "utf8")), relative(file)).toBe(false);
    // Nor any page a visitor opens: nothing under the public routes, only the backoffice's plan reads it through the plan.
    const publicRoutes = all.filter((file) => relative(file).startsWith("src/app/") && !relative(file).startsWith("src/app/[locale]/admin/"));
    for (const file of publicRoutes) expect(NAMES_THE_PICTURE.test(readFileSync(file, "utf8")), relative(file)).toBe(false);
  });

  it("leaves by one road: the plan's own read of the picture alone is called by the point's email, and by nothing else", () => {
    // «Trimite fiecăruia punctul lui» (§956): the message reads the picture as it leaves, through the plan — the one
    // function that hands the picture to anything but the plan's page, with one caller.
    const callers = all.filter((file) => /\breadVolunteerPlanPicture\b/.test(readFileSync(file, "utf8"))).map(relative);
    expect(callers.sort()).toEqual(["src/modules/volunteers/plan.ts", "src/modules/volunteers/point-mail.ts"]);
    // …and no file of that email reads the plan whole (`readVolunteerPlan`: every person's name and telephone number).
    for (const file of ["src/modules/notifications/render.ts", "src/modules/notifications/templates.ts", "src/modules/volunteers/point-mail.ts"]) {
      expect(read(file), file).not.toMatch(/\breadVolunteerPlan\(/);
    }
  });

  it("has one writer of its trail: the plan, beside the list of the trail's actions", () => {
    const writers = all.filter((file) => NAMES_THE_TRAIL.test(readFileSync(file, "utf8"))).map(relative);
    expect(writers.sort()).toEqual(["src/modules/audit/repository.ts", "src/modules/volunteers/plan.ts"]);
  });

  it("is uploaded by an island that names neither the column nor the plan's module: strings in, a form sent", () => {
    const island = read("src/modules/volunteers/ui/PlanPictureUpload.tsx");
    expect(NAMES_THE_PICTURE.test(island)).toBe(false);
    expect(island).not.toMatch(/modules\/volunteers\/plan|@\/db\//);
    // The one upload of the backoffice, and the form's own send.
    expect(island).toContain('from "@/modules/media/ui/upload-picture"');
    expect(island).toContain("requestSubmit()");
  });
});
