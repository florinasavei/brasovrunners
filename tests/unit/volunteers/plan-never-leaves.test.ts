import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «Planul voluntarilor» (§NNN, BR-REQ-060-01) — the point of the route a volunteer stands at is the organizers' own planning: it
 * reaches the plan's page, the «Voluntari» list's column and «Toate datele unei persoane» (art. 15) — and, since «Trimite
 * fiecăruia punctul lui» (§NNN), the one email an organizer's press sends each placed volunteer about their own point
 * (`VOLUNTEER_POINT`). Nothing else: never the public volunteers' list, never another email, never a badge, never the
 * volunteers' files. The structural half of that promise, as `volunteer-notes-never-leave.test.ts` holds the notes': no file
 * outside the list below so much as names the column, the plan's module or its words — nor the two names the point's email
 * carries it under, its reader's module and the template's field — so a later join or a helpful new column cannot quietly start
 * carrying it. (What the plan reads and who may read it is `tests/integration/volunteers/plan.test.ts`; who the email is
 * written to and what it says, `tests/integration/volunteers/plan-mail.test.ts`.) A new reader is a reviewed edit of this list.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/**
 * The column, the person's-data field, the plan's module and the plan's catalogue words; and what the point's one email
 * names it by: the module that reads it for the message, and the field the template takes it in.
 */
const NAMES_THE_POINT = /checkpointId|checkpoint_id|checkpointName|modules\/volunteers\/plan|volunteers\.plan\.|modules\/volunteers\/point-mail|volunteerPoint/;

const RENDERER = "src/modules/notifications/render.ts";
const TEMPLATES = "src/modules/notifications/templates.ts";

const READERS = new Set(
  [
    // The column itself.
    "src/db/schema/event-volunteers.ts",
    // The one writer («Pune aici» / «Scoate», `setCheckpoint`) and the row's item, which the staff screens read.
    "src/modules/volunteers/volunteers.ts",
    // The plan as read: the points with their people.
    "src/modules/volunteers/plan.ts",
    // The plan's page and its presses: placing, the picture, and «Trimite fiecăruia punctul lui» with the numbers of its question.
    "src/app/[locale]/admin/events/[id]/plan-voluntari/page.tsx",
    "src/app/[locale]/admin/events/[id]/plan-voluntari/actions.ts",
    // The «Voluntari» list: the button to the plan and the column «Punct».
    "src/app/[locale]/admin/volunteers/(list)/page.tsx",
    // «Toate datele unei persoane» (art. 15): the point's name, and the line that draws it.
    "src/modules/registrations/person-data.ts",
    "src/modules/volunteers/ui/VolunteerAnswers.tsx",
    // «Trimite fiecăruia punctul lui» (§NNN): who stands where and who was already told it, counted and queued at the press;
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

describe("§NNN a volunteer's point stays with the organizers — and leaves by one email alone", () => {
  const naming = sourceFiles(SRC).filter((file) => NAMES_THE_POINT.test(readFileSync(file, "utf8")));

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
      expect(NAMES_THE_POINT.test(read(file)), file).toBe(false);
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
});
