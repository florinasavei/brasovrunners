import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importsModule } from "../../helpers/module-imports";

/**
 * «Punctele planului» (§961, BR-REQ-011-01, BR-REQ-050-02) — a point the organizers added by hand to the volunteers' plan,
 * and where any point is, are the organizers' own: they reach the plan's page, the «Voluntari» list's «Punct» column and the
 * one email that tells a volunteer their own point. Never the event's page, the route's chart, a race number, the event's
 * file or a copy of the event — though they live in the very table those read (`event_checkpoints`).
 *
 * The structural half of that promise, in the manner of `plan-never-leaves.test.ts` (what each reader returns is
 * `tests/integration/events/plan-points-stay-private.test.ts`):
 *
 * 1. **the plan's reader** (`modules/volunteers/plan-points.ts`: `listPlanPoints`, `changePlanPoint`) is imported only by
 *    the files listed — by any spelling, the `@/` alias or a relative path (`tests/helpers/module-imports.ts`);
 * 2. **the plan's side of a point** — whether it is the plan's own, whether it is at the start–finish, its coordinates — is
 *    named only by those files, the schema, the two public-side files that name it to leave it out, and the email's template;
 * 3. **the table itself** is read only by the files listed, each held to how it reads: the public side through the one
 *    filter, the others a point by its id;
 * 4. **«Notă pentru voluntari»** (§1009) — what the people standing at a point have to know — is named only by the files listed,
 *    and by nothing on the public side: not the one filter, its `Checkpoint`, the event's file or the race number's stamp.
 *
 * A new reader is a reviewed edit of these lists.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const at = (file: string) => path.join(ROOT, file);
const read = (file: string) => readFileSync(at(file), "utf8");

const READER = "src/modules/volunteers/plan-points.ts";
const READER_MODULE = path.join(SRC, "modules", "volunteers", "plan-points");
const PLAN = "src/modules/volunteers/plan.ts";
const POINT_MAIL = "src/modules/volunteers/point-mail.ts";
const PLAN_PAGE = "src/app/[locale]/admin/events/[id]/plan-voluntari/page.tsx";
const PLAN_ACTIONS = "src/app/[locale]/admin/events/[id]/plan-voluntari/actions.ts";
const VOLUNTEERS_LIST = "src/app/[locale]/admin/volunteers/(list)/page.tsx";
const SCHEMA = "src/db/schema/event-checkpoints.ts";
const PUBLIC_READER = "src/modules/event-checkpoints/checkpoints.ts";
const STAMP = "src/modules/events/repository.ts";
const TEMPLATES = "src/modules/notifications/templates.ts";

/** Who may import the plan's reader: the plan's own files. */
const IMPORTERS = [
  // The plan as read: its points with their people, in the reader's order and with its numbers.
  PLAN,
  // «Trimite fiecăruia punctul lui»: who stands at a point of the plan, and what the message says of the point as it leaves.
  POINT_MAIL,
  // The plan's page — the two groups, a point's coordinates, the boxes of «Modifică punctul» — and its three presses.
  PLAN_PAGE,
  PLAN_ACTIONS,
  // The «Voluntari» list's «Punct» column: the same point, the same number.
  VOLUNTEERS_LIST,
];

/** Whether a point is the plan's own, and whether it is at the start–finish: by the column or by the field. */
const NAMES_THE_KIND = /planOnly|plan_only|startFinish|start_finish/;
/** A point's coordinates read from the table: the column of the Drizzle table, or of the stamp's own SQL alias. */
const NAMES_A_POINTS_PLACE = /eventCheckpoints\s*\.\s*(?:latitude|longitude)|\bc\.(?:latitude|longitude)\b/;
/**
 * «Notă pentru voluntari» (§1009): a point's note for the people standing at it, by the column or by the field — and, since §1011, the
 * moment it last changed (`volunteer_note_changed_at`), which only the plan's reader, its verb and the press read.
 */
const NAMES_THE_VOLUNTEER_NOTE = /volunteerNote(?:Ro|En|ChangedAt)|volunteer_note_(?:ro|en|changed_at)/;

/**
 * Who may name «Notă pentru voluntari» (§1009) — and why. The plan's side of a point too: the organizers' words to the people at a
 * point, on the plan and in the one email, never on the event's page, the chart, a race number, the event's file or a copy.
 */
const NOTE_NAMERS = [
  // The columns themselves.
  SCHEMA,
  // The reader and the verb that writes it, both or neither.
  READER,
  // «Salvează punctul»: the two boxes handed to the verb.
  PLAN_ACTIONS,
  // The plan's page: the note under the point's name, in the fold and in the table, and the two boxes of «Modifică punctul».
  PLAN_PAGE,
  // What the message says of the point as it leaves…
  POINT_MAIL,
  // …and its paragraph under the band.
  TEMPLATES,
  // The preview's made-up point on «Emailuri», with its note.
  "src/modules/notifications/email-copy-fields.ts",
];

/** Who may name the plan's side of a point — and why. */
const NAMERS = [
  // The columns themselves.
  SCHEMA,
  // The reader and the verbs.
  READER,
  // What the message says of the point: its kind and its coordinates, read through the reader.
  POINT_MAIL,
  // The plan's page: the group a point is drawn in, «doar pe plan», the coordinates' line and box.
  PLAN_PAGE,
  // The list's cell: «start–finish» beside the name of a point that has no number.
  VOLUNTEERS_LIST,
  // The words of «Punctul tău»: the band of a person at the start–finish, and «Unde e punctul».
  TEMPLATES,
  // The public side, which names the column to leave the plan's own rows OUT: the one filter every public reader goes through…
  PUBLIC_READER,
  // …and the race number's stamp in SQL, which leaves the same rows out.
  STAMP,
];

/** Who reads the table at all, by the Drizzle table or by SQL — and how each is held to read it (below). */
const TABLE_READERS = [
  SCHEMA,
  // The reference a volunteer's row holds to a point.
  "src/db/schema/event-volunteers.ts",
  PUBLIC_READER,
  STAMP,
  READER,
  // «Pune aici»: that the point is one of the event's, by its id.
  "src/modules/volunteers/volunteers.ts",
  // «Toate datele unei persoane» (art. 15): the name of the point the person stands at, by the person's own reference.
  "src/modules/registrations/person-data.ts",
];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}
const SOURCES = sourceFiles(SRC).map((file) => ({ file, text: readFileSync(file, "utf8") }));
const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const importsTheReader = (file: string, source: string) => importsModule(file, source, READER_MODULE, SRC);
const readsTheTable = (source: string) => /\beventCheckpoints\b/.test(source) || /\b(?:FROM|JOIN|UPDATE|INTO)\s+"?event_checkpoints\b/i.test(source);

describe("§961 the plan's own points and every coordinate stay with the organizers", () => {
  it("lets only the plan's files import the plan's reader", () => {
    const importing = SOURCES.filter(({ file, text }) => importsTheReader(file, text)).map(({ file }) => relative(file));
    expect(importing.sort()).toEqual([...IMPORTERS].sort());
  });

  it("lets only the reviewed files name the plan's side of a point: its kind, and its coordinates as the table holds them", () => {
    const naming = SOURCES.filter(({ text }) => NAMES_THE_KIND.test(text) || NAMES_A_POINTS_PLACE.test(text)).map(({ file }) => relative(file));
    expect(naming.filter((file) => !NAMERS.includes(file))).toEqual([]);
    // The list is honest: every file on it still names it.
    expect(NAMERS.filter((file) => !naming.includes(file))).toEqual([]);
    // The coordinates' columns are read by one file alone: the reader.
    expect(SOURCES.filter(({ text }) => NAMES_A_POINTS_PLACE.test(text)).map(({ file }) => relative(file))).toEqual([READER]);
  });

  it("lets only the reviewed files name «Notă pentru voluntari» (§1009) — and the public side none of them", () => {
    const naming = SOURCES.filter(({ text }) => NAMES_THE_VOLUNTEER_NOTE.test(text)).map(({ file }) => relative(file));
    expect(naming.sort()).toEqual([...NOTE_NAMERS].sort());
    // The one filter every public reader goes through hands no note on: its mapper names each field, and not this one.
    expect(read(PUBLIC_READER)).not.toMatch(NAMES_THE_VOLUNTEER_NOTE);
    expect(read(STAMP)).not.toMatch(NAMES_THE_VOLUNTEER_NOTE);
  });

  it("lets only the reviewed files read the table at all", () => {
    const reading = SOURCES.filter(({ text }) => readsTheTable(text)).map(({ file }) => relative(file));
    expect(reading.sort()).toEqual([...TABLE_READERS].sort());
  });

  it("holds the public side to the one filter: every read, update and delete of `checkpoints.ts` leaves the plan's own rows out", () => {
    const source = read(PUBLIC_READER);
    // One filter, defined once…
    expect(source).toContain("const NOT_PLAN_ONLY = eq(eventCheckpoints.planOnly, false);");
    // …in the file's one read of the table, which everything else in it starts from…
    const reads = source.split("\n").filter((line) => /\.from\(eventCheckpoints\)/.test(line));
    expect(reads).toHaveLength(1);
    expect(source).toMatch(/\.from\(eventCheckpoints\)\s*\.innerJoin\(events, eq\(events\.id, eventCheckpoints\.eventId\)\)\s*\.where\(and\(eq\(eventCheckpoints\.eventId, eventId\), NOT_PLAN_ONLY\)\)/);
    // …and in every row it updates or deletes: by id, of the event, and the editor's own.
    expect(source).toContain("const editorsRow = (eventId: string, id: string) => and(eq(eventCheckpoints.id, id), eq(eventCheckpoints.eventId, eventId), NOT_PLAN_ONLY);");
    const writes = source.split("\n").filter((line) => /\.(?:update|delete)\(eventCheckpoints\)/.test(line));
    expect(writes).toHaveLength(4);
    for (const line of writes) expect(line).toMatch(/\.where\(editorsRow\(event\.id, (?:row|existing)\.id\)\)/);
    // What it hands on has no field for the kind or the coordinates: `toCheckpoint` names each field, and none of these.
    const mapper = /const toCheckpoint = [\s\S]*?\n\}\);/.exec(source)?.[0] ?? "";
    expect(mapper).toContain("onProfile: row.onProfile");
    expect(mapper).not.toMatch(/planOnly|startFinish|latitude|longitude|volunteerNote/);
    // Its inserts name no such column either: a row it writes is the editor's, with no coordinates and no note for the volunteers.
    expect(source).not.toMatch(/planOnly:|startFinish:|latitude:|longitude:|volunteerNote(?:Ro|En):/);
  });

  it("gives `Checkpoint` — the type every public reader takes — no field for the kind, the coordinates or the volunteers' note", () => {
    const domain = read("src/modules/event-checkpoints/domain/checkpoint.ts");
    expect(domain).not.toMatch(/planOnly|plan_only|startFinish|start_finish|latitude|longitude|volunteerNote|volunteer_note/);
    // …and the event's file has none to carry: its schema of a point names seven things, these not among them, and is
    // strict — a file that named one would be refused whole, never read into the editor's list.
    const fileFormat = read("src/modules/content/events/transfer/file-format.ts");
    const pointSchema = /const checkpointSchema = z\s*\.object\(\{[\s\S]*?\}\)\s*\.strict\(\);/.exec(fileFormat)?.[0] ?? "";
    expect([...pointSchema.matchAll(/^ {4}(\w+): z\./gm)].map((match) => match[1])).toEqual(["km", "name", "kinds", "cutoffMinutes", "cutoff", "note", "onProfile"]);
    expect(pointSchema).not.toMatch(/planOnly|startFinish|latitude|longitude|coordinates|volunteerNote/);
  });

  it("leaves the plan's own rows out of the race number's stamp in SQL, and reads no coordinate there", () => {
    const stamp = /const CHECKPOINTS_STAMP = sql`[^`]*`;/.exec(read(STAMP))?.[0] ?? "";
    expect(stamp).toContain("FROM event_checkpoints c WHERE c.event_id = ${events.id} AND NOT c.plan_only)");
    expect(stamp).not.toMatch(/latitude|longitude|start_finish/);
    // The one place the file names the kind is that filter.
    expect(read(STAMP).split("\n").filter((line) => NAMES_THE_KIND.test(line) && !line.trimStart().startsWith("*"))).toHaveLength(1);
  });

  it("holds the two files that read a point by its id to that: the id, the event and the name — never the kind or the coordinates", () => {
    const columnsOf = (file: string) => [...new Set([...read(file).matchAll(/\beventCheckpoints\.(\w+)/g)].map((match) => match[1]))].sort();
    expect(columnsOf("src/modules/volunteers/volunteers.ts")).toEqual(["eventId", "id"]);
    expect(columnsOf("src/modules/registrations/person-data.ts")).toEqual(["id", "nameRo"]);
    expect(columnsOf("src/db/schema/event-volunteers.ts")).toEqual(["id"]);
  });

  it("is in no public page, list, badge or file", () => {
    const publicSide = SOURCES.filter(({ file }) => {
      const name = relative(file);
      return (
        /^src\/app\/\[locale\]\/(?!admin\/|devs\/)/.test(name) ||
        /^src\/app\/api\//.test(name) ||
        /^src\/modules\/(?:events|public-cache|content\/events\/transfer|registrations\/bib|event-checkpoints\/ui)/.test(name) ||
        ["src/modules/volunteers/public-list.ts", "src/modules/volunteers/csv.ts", "src/modules/volunteers/export.ts", "src/modules/volunteers/workbook.ts", "src/modules/volunteers/badges/badges.ts"].includes(name)
      );
    });
    expect(publicSide.length).toBeGreaterThan(100);
    const strangers = publicSide
      .filter(({ file, text }) => relative(file) !== STAMP && (importsTheReader(file, text) || NAMES_THE_KIND.test(text) || NAMES_A_POINTS_PLACE.test(text) || NAMES_THE_VOLUNTEER_NOTE.test(text)))
      .map(({ file }) => relative(file));
    expect(strangers).toEqual([]);
  });

  it("catches a reader that imports the plan's reader by a relative path, which the words alone would miss", () => {
    const inSrc = (...parts: string[]) => path.join(SRC, ...parts);
    // A file beside the reader — say the volunteers' CSV — that starts reading it: no column, no field, no alias path.
    const beside = `import { listPlanPoints } from "./plan-points";\n\nexport const everyPoint = listPlanPoints;\n`;
    expect(NAMES_THE_KIND.test(beside) || NAMES_A_POINTS_PLACE.test(beside)).toBe(false);
    expect(importsTheReader(inSrc("modules", "volunteers", "csv.ts"), beside)).toBe(true);
    // One folder down, from another module, loaded lazily, re-exported, as a type alone, and with the extension written.
    expect(importsTheReader(inSrc("modules", "volunteers", "ui", "VolunteerPerson.tsx"), `import type { PlanPoint } from "../plan-points";`)).toBe(true);
    expect(importsTheReader(inSrc("modules", "events", "repository.ts"), `const { listPlanPoints } = await import("../volunteers/plan-points");`)).toBe(true);
    expect(importsTheReader(inSrc("modules", "volunteers", "export.ts"), `export * from './plan-points.ts';`)).toBe(true);
    expect(importsTheReader(inSrc("app", "[locale]", "events", "[slug]", "page.tsx"), `import {\n  listPlanPoints,\n} from "../../../../modules/volunteers/plan-points";`)).toBe(true);
    // The alias.
    expect(importsTheReader(inSrc("modules", "public-cache", "reads.ts"), `import { listPlanPoints } from "@/modules/volunteers/plan-points";`)).toBe(true);
    // The same spelling from a folder where it is another file is not the reader, nor is a neighbour with a longer name, nor the plan itself.
    expect(importsTheReader(inSrc("modules", "deadlines", "wake.ts"), beside)).toBe(false);
    expect(importsTheReader(inSrc("modules", "volunteers", "csv.ts"), `import { more } from "./plan-points-more";`)).toBe(false);
    expect(importsTheReader(inSrc("modules", "volunteers", "csv.ts"), `import { readVolunteerPlan } from "./plan";`)).toBe(false);
    // A table read that names no column is seen too: a whole row carries every column.
    expect(readsTheTable(`const rows = await db.select().from(eventCheckpoints).where(eq(eventCheckpoints.eventId, id));`)).toBe(true);
    expect(readsTheTable("const rows = await db.execute(sql`SELECT * FROM event_checkpoints WHERE event_id = ${id}`);")).toBe(true);
    expect(readsTheTable(`import * as eventCheckpointsSchema from "./schema/event-checkpoints";`)).toBe(false);
    expect(readsTheTable(`action: "event_checkpoints.changed" satisfies AuditAction,`)).toBe(false);
  });
});
