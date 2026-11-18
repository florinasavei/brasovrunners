import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The pictures and links of «Planul voluntarilor» (§952, §978 «Poze și hărți», BR-REQ-060-01) — the organizers' own drawing of
 * the plan and their maps stay with the plan. Their two tables (`event_volunteer_plan_pictures`, `event_volunteer_plan_links`)
 * are read and written by the plan alone and counted by the pictures' reference check, and by nothing else; the retired column
 * of §952 (`events.volunteer_plan_media_asset_id`) is written by nobody now and named only by its schema, the reference check
 * and the events' blank row, until the contract that drops it. Never a public query or the public cache, never a series' scope,
 * a copy or the event's file. They leave by one road, at an organizer's press: «Trimite fiecăruia punctul lui» (§956) carries
 * them in the email each placed volunteer gets about their own point — read through the plan's own function
 * (`readVolunteerPlanMaps`), so even that message's files never name a table. The structural half of that promise, as
 * `plan-never-leaves.test.ts` beside it holds the point's: no file outside the lists below so much as names a table or the
 * column, so a later join or a helpful new column cannot quietly start carrying them. (What the plan reads, who may write it
 * and what the sweep does is `tests/integration/volunteers/plan-picture.test.ts` and `plan-links.test.ts`.) A new reader is a
 * reviewed edit of these lists.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** The retired column, by its name in the code and in the database. */
const NAMES_THE_COLUMN = /volunteerPlanMediaAssetId|volunteer_plan_media_asset_id/;
/** The two tables of «Poze și hărți», by their names in the code and in the database. */
const NAMES_THE_MAPS = /eventVolunteerPlanPictures|eventVolunteerPlanLinks|event_volunteer_plan_pictures|event_volunteer_plan_links/;
/** The trail's actions: the release before's `set`, and the pictures' and links' own. */
const NAMES_THE_TRAIL = /event\.volunteer_plan_(picture_(set|added|removed)|link_(added|removed))/;

const EVENT_SERVICE = "src/modules/content/events/service.ts";

const COLUMN_READERS = new Set(
  [
    // The column itself.
    "src/db/schema/events.ts",
    // The one predicate that says a stored picture is in use: the sweep, the pictures page and its delete — until the contract.
    "src/modules/media/references.ts",
    // The row a create page's preview starts from, which is every column of the event (`blankEventRow`) — and nothing else there.
    EVENT_SERVICE,
  ].map((file) => path.join(ROOT, file)),
);

const MAPS_READERS = new Set(
  [
    // The two tables.
    "src/db/schema/volunteer-plan.ts",
    // The plan: the one read (`readVolunteerPlan`, `readVolunteerPlanMaps`) and the one writer (the four presses).
    "src/modules/volunteers/plan.ts",
    // The one predicate that says a stored picture is in use, and the pictures page's «Planul voluntarilor: …» line.
    "src/modules/media/references.ts",
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

describe("§952, §978 the plan's pictures and links stay with the plan", () => {
  const all = sourceFiles(SRC);
  const namingColumn = all.filter((file) => NAMES_THE_COLUMN.test(readFileSync(file, "utf8")));
  const namingMaps = all.filter((file) => NAMES_THE_MAPS.test(readFileSync(file, "utf8")));

  it("are named only by the files reviewed to read them", () => {
    expect(namingColumn.filter((file) => !COLUMN_READERS.has(file)).map(relative)).toEqual([]);
    expect(namingMaps.filter((file) => !MAPS_READERS.has(file)).map(relative)).toEqual([]);
  });

  it("keeps the lists honest: every reader still names them", () => {
    expect([...COLUMN_READERS].filter((file) => !namingColumn.includes(file)).map(relative)).toEqual([]);
    expect([...MAPS_READERS].filter((file) => !namingMaps.includes(file)).map(relative)).toEqual([]);
  });

  it("writes the retired column nowhere: the reference check counts it and the blank row names it, and that is all", () => {
    // The one line of the events' service: an event that does not exist yet has no plan. Not in `SERIES_COLUMNS`, not in
    // `copiedEventValues`, in no save.
    const service = read(EVENT_SERVICE);
    const lines = service.split("\n").filter((line) => NAMES_THE_COLUMN.test(line));
    expect(lines.map((line) => line.trim())).toEqual(["volunteerPlanMediaAssetId: null,"]);
    const blankRow = service.slice(service.indexOf("function blankEventRow("), service.indexOf("function blankTranslationRow("));
    expect(blankRow).toContain("volunteerPlanMediaAssetId: null,");
    // The reference check only ever compares it.
    const references = read("src/modules/media/references.ts");
    expect(references).not.toMatch(/\.set\(\{[^}]*volunteerPlanMediaAssetId/);
    for (const line of references.split("\n").filter((one) => NAMES_THE_COLUMN.test(one))) expect(line).toMatch(/volunteerPlanMediaAssetId, mediaAssets\.id|volunteerPlanMediaAssetId\} = \$\{mediaAssets\.id\}/);
  });

  it("are named by no public query, no public cache, no file of the emails, no file of the event and no file of the volunteers", () => {
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
      "src/modules/volunteers/point-mail.ts",
      "src/modules/volunteers/badges/badges.ts",
      "src/modules/registrations/person-data.ts",
      "src/modules/jobs/retention.ts",
    ]) {
      expect(NAMES_THE_COLUMN.test(read(file)), file).toBe(false);
      expect(NAMES_THE_MAPS.test(read(file)), file).toBe(false);
    }
    // The event as a JSON file (§751): none of its modules names them — a file read on another environment would name another
    // bucket's objects.
    const transfer = all.filter((file) => relative(file).startsWith("src/modules/content/events/transfer/"));
    expect(transfer.length).toBeGreaterThan(5);
    for (const file of transfer) {
      expect(NAMES_THE_COLUMN.test(readFileSync(file, "utf8")), relative(file)).toBe(false);
      expect(NAMES_THE_MAPS.test(readFileSync(file, "utf8")), relative(file)).toBe(false);
    }
    // Nor any page a visitor opens, nor the plan's own page and its presses: they go through the plan.
    const routes = all.filter((file) => relative(file).startsWith("src/app/"));
    for (const file of routes) {
      expect(NAMES_THE_COLUMN.test(readFileSync(file, "utf8")), relative(file)).toBe(false);
      expect(NAMES_THE_MAPS.test(readFileSync(file, "utf8")), relative(file)).toBe(false);
    }
  });

  it("leave by one road: the plan's own read of them alone is called by the point's email, and by nothing else", () => {
    // «Trimite fiecăruia punctul lui» (§956): the message reads them as it leaves, through the plan — the one function that
    // hands them to anything but the plan's page, with one caller.
    const callers = all.filter((file) => /\breadVolunteerPlanMaps\b/.test(readFileSync(file, "utf8"))).map(relative);
    expect(callers.sort()).toEqual(["src/modules/volunteers/plan.ts", "src/modules/volunteers/point-mail.ts"]);
    // The one picture's reader of the release before is gone with it.
    expect(all.filter((file) => /\breadVolunteerPlanPicture\b|\bsetVolunteerPlanPicture\b/.test(readFileSync(file, "utf8"))).map(relative)).toEqual([]);
    // …and no file of that email reads the plan whole (`readVolunteerPlan`: every person's name and telephone number).
    for (const file of ["src/modules/notifications/render.ts", "src/modules/notifications/templates.ts", "src/modules/volunteers/point-mail.ts"]) {
      expect(read(file), file).not.toMatch(/\breadVolunteerPlan\(/);
    }
  });

  it("has one writer of its trail: the plan, beside the list of the trail's actions", () => {
    const writers = all.filter((file) => NAMES_THE_TRAIL.test(readFileSync(file, "utf8"))).map(relative);
    expect(writers.sort()).toEqual(["src/modules/audit/repository.ts", "src/modules/volunteers/plan.ts"]);
    // No row of it carries an address or a label: ids alone.
    const plan = read("src/modules/volunteers/plan.ts");
    expect([...plan.matchAll(/metadata: \{([^}]*)\}/g)].map((match) => match[1].trim()).sort()).toEqual(["assetId", "assetId: gone.assetId", "linkId: added.id", "linkId: gone.id"]);
  });

  it("is uploaded by an island that names neither a table nor the plan's module: strings in, a form sent", () => {
    const island = read("src/modules/volunteers/ui/PlanPictureUpload.tsx");
    expect(NAMES_THE_COLUMN.test(island)).toBe(false);
    expect(NAMES_THE_MAPS.test(island)).toBe(false);
    expect(island).not.toMatch(/modules\/volunteers\/plan|@\/db\//);
    // The one upload of the backoffice, and the form's own send.
    expect(island).toContain('from "@/modules/media/ui/upload-picture"');
    expect(island).toContain("requestSubmit()");
  });
});
