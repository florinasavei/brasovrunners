import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DURATION_HOURS_CONSTRAINTS,
  DURATION_MAX_MINUTES,
  DURATION_MINUTES_CONSTRAINTS,
  joinDuration,
  savedDurationMinutes,
  splitDuration,
} from "@/modules/content/events/duration";
import { durationShort } from "@/i18n/dates";
import { eventInputConstraints } from "@/modules/content/events/constraints";
import { eventFieldsSchema } from "@/modules/content/events/fields";
import { eventFormFieldName } from "@/modules/content/events/form-names";

/**
 * «Durata» as hours and minutes (§433, amending §71's single minutes box): the editor asks two
 * numbers, the action joins them into the minutes `fields.ts` has always read, the closed box
 * line says "3 h 30 min", and a refusal of the total points at the hours box.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

/** The duration field alone, through the event schema's own rule. */
const durationRule = eventFieldsSchema.shape.durationMinutes;

describe("§433 the duration's two boxes, joined into minutes", () => {
  it("joins hours and minutes into the total, either box alone included", () => {
    expect(joinDuration("3", "30")).toBe("210");
    expect(joinDuration("1", "30")).toBe("90");
    expect(joinDuration("2", "")).toBe("120");
    expect(joinDuration("", "45")).toBe("45");
    expect(joinDuration(" 1 ", " 5 ")).toBe("65");
    expect(joinDuration("0", "45")).toBe("45");
  });

  it("two empty boxes are no duration", () => {
    expect(joinDuration("", "")).toBe("");
    expect(joinDuration("  ", " ")).toBe("");
    expect(durationRule.parse(joinDuration("", ""))).toBeNull();
  });

  it("the schema refuses what the boxes refuse: not a whole number, sixty minutes or more, nothing at all, more than a week", () => {
    for (const [hours, minutes] of [
      ["1.5", ""],
      ["-1", ""],
      ["", "60"],
      ["1", "75"],
      ["x", "10"],
      ["0", "0"],
      [String(DURATION_MAX_MINUTES / 60), "1"],
    ] as const) {
      expect(durationRule.safeParse(joinDuration(hours, minutes)).success, `${hours} h ${minutes} min`).toBe(false);
    }
    expect(durationRule.parse(joinDuration(String(DURATION_MAX_MINUTES / 60), "0"))).toBe(DURATION_MAX_MINUTES);
    expect(durationRule.parse(joinDuration("1", "59"))).toBe(119);
  });

  it("the boxes' HTML limits are the join's and stay inside the schema's week", () => {
    expect(DURATION_HOURS_CONSTRAINTS).toMatchObject({ type: "number", min: 0, step: 1 });
    expect(DURATION_MINUTES_CONSTRAINTS).toMatchObject({ type: "number", min: 0, max: 59, step: 1 });
    expect((DURATION_HOURS_CONSTRAINTS.max ?? 0) * 60).toBe(eventInputConstraints("durationMinutes").max);
  });

  it("splits a saved duration back into the two boxes", () => {
    expect(splitDuration(210)).toEqual({ hours: "3", minutes: "30" });
    expect(splitDuration(120)).toEqual({ hours: "2", minutes: "0" });
    expect(splitDuration(45)).toEqual({ hours: "0", minutes: "45" });
    expect(splitDuration(null)).toEqual({ hours: "", minutes: "" });
    expect(splitDuration(0)).toEqual({ hours: "", minutes: "" });
    for (const total of [1, 45, 60, 90, 210, DURATION_MAX_MINUTES]) {
      const { hours, minutes } = splitDuration(total);
      expect(joinDuration(hours, minutes)).toBe(String(total));
    }
  });

  it("reads the saved duration off the start and the end", () => {
    const start = new Date("2026-11-21T07:00:00Z");
    expect(savedDurationMinutes(start, new Date("2026-11-21T08:30:00Z"))).toBe(90);
    expect(savedDurationMinutes(start, null)).toBeNull();
    expect(savedDurationMinutes(start, start)).toBeNull();
  });

  it("writes the closed box line in hours and minutes", () => {
    expect(durationShort(210)).toBe("3 h 30 min");
    expect(durationShort(120)).toBe("2 h");
    expect(durationShort(45)).toBe("45 min");
  });

  it("a refusal of the duration names the hours box", () => {
    expect(eventFormFieldName("durationMinutes")).toBe("event.durationHours");
  });
});

describe("§433 the editor asks two boxes and the action joins them", () => {
  it("the Data și ora box posts the hours and the minutes, never the old single box", () => {
    const box = read("src/modules/content/events/ui/boxes/WhenBox.tsx");
    expect(box).toContain('name="event.durationHours"');
    expect(box).toContain('name="event.durationMinutesPart"');
    expect(box).not.toContain('name="event.durationMinutes"');
  });

  it("the action joins them into the one minutes field", () => {
    const actions = read("src/app/[locale]/admin/actions.ts");
    expect(actions).toContain('durationMinutes: joinDuration(value("durationHours"), value("durationMinutesPart"))');
  });

  it("the night line reads the same two boxes the save reads", () => {
    const night = read("src/modules/content/events/ui/NightEventField.tsx");
    expect(night).toContain('joinDuration(text("event.durationHours"), text("event.durationMinutesPart"))');
  });

  it("both catalogues name the two boxes", () => {
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      const editor = JSON.parse(read(file)).Admin.editor;
      for (const key of ["duration", "durationHours", "durationMinutesPart", "durationHelp"]) {
        expect(typeof editor[key], `${file} ${key}`).toBe("string");
      }
      expect(editor.durationMinutes, file).toBeUndefined();
    }
  });
});
