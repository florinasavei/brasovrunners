import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importsModule } from "../../helpers/module-imports";

/**
 * «Planul voluntarilor» (§949, BR-REQ-060-01) — the point of the route a volunteer stands at is the organizers' own planning: it
 * reaches the plan's page, the «Voluntari» list's column and «Toate datele unei persoane» (art. 15) — and, since «Trimite
 * fiecăruia punctul lui» (§956), the one email an organizer's press sends each placed volunteer about their own point
 * (`VOLUNTEER_POINT`). Nothing else: never the public volunteers' list, never another email, never a badge, never the
 * volunteers' files. The structural half of that promise, as `volunteer-notes-never-leave.test.ts` holds the notes': no file
 * outside the list below so much as names the column, the plan's module or its words — nor the two names the point's email
 * carries it under, its reader's module and the template's field — so a later join or a helpful new column cannot quietly start
 * carrying it. (What the plan reads and who may read it is `tests/integration/volunteers/plan.test.ts`; who the email is
 * written to and what it says, `tests/integration/volunteers/plan-mail.test.ts`.) A new reader is a reviewed edit of this list.
 *
 * A reader is found by what it names — the column, the plan's words — or by what it imports (§953): the plan's module, the
 * module that reads the point for its email, or — since the plan has points of its own (§NNN) — the module that lists the
 * plan's points, by any spelling, the `@/` alias or a relative path. The words alone missed `./plan`, the import a file
 * beside the module would write. Who may read the plan's own points, and that none of them is public, is
 * `plan-points-never-leave.test.ts`.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/**
 * The column, the person's-data field, the plan's module as the alias writes it and the plan's catalogue words; and what the
 * point's one email names it by: the module that reads it for the message, and the field the template takes it in.
 */
const NAMES_THE_POINT = /checkpointId|checkpoint_id|checkpointName|modules\/volunteers\/plan|volunteers\.plan\.|modules\/volunteers\/point-mail|volunteerPoint/;
/** The plan's module and the point's email's, wherever they are imported from and however the import spells them. */
const PLAN_MODULE = path.join(SRC, "modules", "volunteers", "plan");
const POINT_MAIL_MODULE = path.join(SRC, "modules", "volunteers", "point-mail");
/** The plan's points (§NNN): the one list of them, which the plan, the list's column and the email all read. */
const PLAN_POINTS_MODULE = path.join(SRC, "modules", "volunteers", "plan-points");

const RENDERER = "src/modules/notifications/render.ts";
const TEMPLATES = "src/modules/notifications/templates.ts";

/** Whether the file at `file`, whose text is `source`, reads the plan: it names the point, or imports one of the three modules. */
const namesThePoint = (file: string, source: string): boolean =>
  NAMES_THE_POINT.test(source) ||
  importsModule(file, source, PLAN_MODULE, SRC) ||
  importsModule(file, source, POINT_MAIL_MODULE, SRC) ||
  importsModule(file, source, PLAN_POINTS_MODULE, SRC);

const READERS = new Set(
  [
    // The column itself.
    "src/db/schema/event-volunteers.ts",
    // The one writer («Pune aici» / «Scoate», `setCheckpoint`) and the row's item, which the staff screens read.
    "src/modules/volunteers/volunteers.ts",
    // The plan as read: the points with their people.
    "src/modules/volunteers/plan.ts",
    // The plan's points (§NNN): the one list of them — the editor's and the plan's own, in the plan's order, each with its
    // number — and «Șterge punctul», which counts the people it frees by the point they stand at.
    "src/modules/volunteers/plan-points.ts",
    // The plan's page and its presses: placing, the picture, and «Trimite fiecăruia punctul lui» with the numbers of its question.
    "src/app/[locale]/admin/events/[id]/plan-voluntari/page.tsx",
    "src/app/[locale]/admin/events/[id]/plan-voluntari/actions.ts",
    // The «Voluntari» list: the button to the plan and the column «Punct».
    "src/app/[locale]/admin/volunteers/(list)/page.tsx",
    // «Toate datele unei persoane» (art. 15): the point's name, and the line that draws it.
    "src/modules/registrations/person-data.ts",
    "src/modules/volunteers/ui/VolunteerAnswers.tsx",
    // «Trimite fiecăruia punctul lui» (§956): who stands where and who was already told it, counted and queued at the press;
    // and the point as it stands when the message leaves, or the message withdrawn.
    "src/modules/volunteers/point-mail.ts",
    // The renderer: hands that point to the template for the one message type, and withdraws the message on a corrected address.
    RENDERER,
    // The words of «Punctul tău de voluntar»: the band that names the point, its note, and the plan's picture.
    TEMPLATES,
    // «Emailuri»: the preview's made-up point, so the club reads the message before anybody is placed. Never a volunteer's.
    "src/modules/notifications/email-copy-fields.ts",
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

describe("§949 a volunteer's point stays with the organizers — and leaves by one email alone (§956)", () => {
  const naming = sourceFiles(SRC).filter((file) => namesThePoint(file, readFileSync(file, "utf8")));

  it("is named only by the files reviewed to read it", () => {
    const strangers = naming.filter((file) => !READERS.has(file)).map((file) => path.relative(ROOT, file));
    expect(strangers).toEqual([]);
  });

  it("keeps the list honest: every reader still names it", () => {
    const silent = [...READERS].filter((file) => !naming.includes(file)).map((file) => path.relative(ROOT, file));
    expect(silent).toEqual([]);
  });

  it("is in no public list, badge or file of the volunteers", () => {
    for (const file of [
      "src/modules/volunteers/public-list.ts",
      "src/modules/volunteers/csv.ts",
      "src/modules/volunteers/export.ts",
      "src/modules/volunteers/workbook.ts",
      "src/modules/volunteers/raffle-list.ts",
      "src/modules/volunteers/badges/badges.ts",
    ]) {
      expect(namesThePoint(path.join(ROOT, file), read(file)), file).toBe(false);
    }
  });

  it("is handed to one email alone: the renderer reads it under `VOLUNTEER_POINT` and nowhere else, never from the row", () => {
    const renderer = read(RENDERER);
    // One place sets the template's point, and it is the branch of the one message type.
    expect([...renderer.matchAll(/\bvolunteerPoint\s*=/g)]).toHaveLength(1);
    expect(renderer).toMatch(/if \(row\.messageType === "VOLUNTEER_POINT"\) \{\s*if \(!addressCurrent\) throw new OutboxMessageWithdrawn\([^)]*\);\s*data\.volunteerPoint = await volunteerPointAtSend\(db, row\);\s*\}/);
    // The renderer never reads the column itself: the point comes from the module that queued the message.
    expect(renderer).not.toMatch(/checkpointId|checkpoint_id|checkpointName/);
    expect([...renderer.matchAll(/\bvolunteerPointAtSend\(/g)]).toHaveLength(1);
  });

  it("is drawn by one template alone: the point's lines and the plan's picture stand behind the message type, the band in its own entry", () => {
    const templates = read(TEMPLATES);
    // The two parts the platform adds around the words: each called once, each only for «Punctul tău».
    for (const part of ["volunteerPointLines", "volunteerPointPicture"]) {
      const calls = templates.split("\n").filter((line) => new RegExp(`\\b${part}\\(locale, data\\)`).test(line));
      expect(calls, part).toHaveLength(1);
      expect(calls[0], part).toContain(`messageType === "VOLUNTEER_POINT" ? ${part}(locale, data) : []`);
    }
    // The band: asked for by the message's own two entries (Romanian, English), by no other message.
    expect([...templates.matchAll(/\bvolunteerPointLine\("(ro|en)", d\)/g)].map((match) => match[1])).toEqual(["ro", "en"]);
    // …and the message type has one template.
    expect(templates).toContain('VOLUNTEER_POINT: "volunteerPoint",');
  });

  it("is queued by one press alone: the plan's service, never by placing, moving or taking a person off", () => {
    const queueing = sourceFiles(SRC)
      .filter((file) => /messageType: "VOLUNTEER_POINT"/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
    expect(queueing).toEqual(["src/modules/volunteers/point-mail.ts"]);
    // The writer of the column («Pune aici» / «Scoate») names neither the message nor its module.
    const writer = read("src/modules/volunteers/volunteers.ts");
    expect(writer).not.toMatch(/VOLUNTEER_POINT|point-mail|sendVolunteerPoints/);
  });

  it("catches a reader that imports the plan's module by a relative path, which the words alone would miss (§953)", () => {
    const at = (...parts: string[]) => path.join(SRC, ...parts);
    // A file beside the plan — say the volunteers' CSV — that starts reading it: no column, no alias path, none of the plan's words.
    const beside = `import { readVolunteerPlan } from "./plan";\n\nexport const everybodyOnTheRoute = readVolunteerPlan;\n`;
    expect(NAMES_THE_POINT.test(beside)).toBe(false);
    expect(namesThePoint(at("modules", "volunteers", "csv.ts"), beside)).toBe(true);
    // One folder down, from another module, loaded lazily, re-exported, and with the extension or single quotes written.
    expect(namesThePoint(at("modules", "volunteers", "ui", "VolunteerPerson.tsx"), `import type { VolunteerPlan } from "../plan";`)).toBe(true);
    expect(namesThePoint(at("modules", "notifications", "render.ts"), `const { readVolunteerPlan } = await import("../volunteers/plan");`)).toBe(true);
    expect(namesThePoint(at("modules", "volunteers", "export.ts"), `export * from './plan.ts';`)).toBe(true);
    expect(namesThePoint(at("app", "[locale]", "volunteers", "page.tsx"), `import {\n  readVolunteerPlan,\n} from "../../../modules/volunteers/plan";`)).toBe(true);
    // The alias, as before.
    expect(namesThePoint(at("modules", "events", "repository.ts"), `import { readVolunteerPlan } from "@/modules/volunteers/plan";`)).toBe(true);
    // The plan's points (§NNN), read from beside their module: no column, no alias path, none of the plan's words.
    const points = `import { listPlanPoints } from "./plan-points";\n\nexport const everyPoint = listPlanPoints;\n`;
    expect(NAMES_THE_POINT.test(points)).toBe(false);
    expect(namesThePoint(at("modules", "volunteers", "export.ts"), points)).toBe(true);
    expect(namesThePoint(at("modules", "deadlines", "wake.ts"), points)).toBe(false);
    // The same spelling from a folder where it is another file is not the plan, nor is a neighbour with a longer name: no false alarm.
    expect(namesThePoint(at("modules", "deadlines", "wake.ts"), beside)).toBe(false);
    expect(namesThePoint(at("modules", "volunteers", "csv.ts"), `import { plansOf } from "./plans";`)).toBe(false);
    expect(namesThePoint(at("modules", "volunteers", "csv.ts"), `import { plan } from "plan";`)).toBe(false);
  });
});
