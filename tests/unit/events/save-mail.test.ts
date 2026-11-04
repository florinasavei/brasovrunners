import { describe, expect, it } from "vitest";
import { raiseMailLines, windowMailLines } from "@/modules/content/events/save-mail";
import { type ConfirmSpec, type FormCondition, resolveAlso } from "@/shared/feedback/notice";
import { WINDOW_SEND_EMAIL_FIELD } from "@/shared/forms/send-email";

/**
 * What else the editor's save emails, said as the quieter lines of a question that asks already (the design «telling the
 * owner about every email a staff press sends», slices 3 and 4): the window's re-sent «Semnează declarația» counted as the
 * window's own question counts it — the places held to another instant at every save, those held to the window's own
 * instant too once any of its four boxes moved — and the offers with their club count. Each line said only when the
 * form as posted makes it true.
 */

const BOXES = [
  { field: "event.confirmationOpensDaysBefore", stored: "15" },
  { field: "event.confirmationDeadlineDaysBefore", stored: "5" },
  { field: "event.startsAtDate", stored: "2026-11-21" },
  { field: "event.startsAtTime", stored: "10:00" },
];
const moved: FormCondition = { anyOf: BOXES.map(({ field, stored }) => ({ field, notEquals: stored })) };
const unmoved: FormCondition[] = BOXES.map(({ field, stored }) => ({ field, equals: stored }));
const line = (count: number) => `cel mult ${count}`;
const SKIPPED = "debifat";

/** The lines the question says for a form posted with `changes` over the stored boxes. */
function said(lines: ConfirmSpec["also"], changes: Record<string, string> = {}): string[] {
  const values: Record<string, string> = { ...Object.fromEntries(BOXES.map(({ field, stored }) => [field, stored])), [WINDOW_SEND_EMAIL_FIELD]: "on", ...changes };
  const spec: ConfirmSpec = { title: "t", body: "b", confirmLabel: "c", cancelLabel: "x", also: lines };
  return (resolveAlso(spec, (field) => values[field] ?? null).also ?? []).map((one) => one.text);
}

describe("the window's re-sent declarations, as another question's lines", () => {
  it("counts both kinds of held places once a box moved — moveNow 2, atWindow 3: «cel mult 5» — and the first kind alone while none did", () => {
    const lines = windowMailLines({ holds: { moveNow: 2, atWindow: 3 }, open: true, moved, unmoved, line });
    expect(said(lines, { "event.confirmationDeadlineDaysBefore": "3" })).toEqual(["cel mult 5"]);
    expect(said(lines, { "event.startsAtTime": "09:00" })).toEqual(["cel mult 5"]);
    expect(said(lines)).toEqual(["cel mult 2"]);
  });

  it("says the places held to the window's instant only when the window moves, and one line always when none are", () => {
    const atWindowOnly = windowMailLines({ holds: { moveNow: 0, atWindow: 3 }, open: true, moved, unmoved, line });
    expect(said(atWindowOnly)).toEqual([]);
    expect(said(atWindowOnly, { "event.confirmationOpensDaysBefore": "10" })).toEqual(["cel mult 3"]);
    const moveNowOnly = windowMailLines({ holds: { moveNow: 4, atWindow: 0 }, open: true, moved, unmoved, line });
    expect(said(moveNowOnly)).toEqual(["cel mult 4"]);
    expect(said(moveNowOnly, { "event.startsAtDate": "2026-11-22" })).toEqual(["cel mult 4"]);
  });

  it("says nothing before the window opens, on a cancelled event, or with nothing held", () => {
    expect(windowMailLines({ holds: { moveNow: 2, atWindow: 3 }, open: false, moved, unmoved, line })).toEqual([]);
    expect(windowMailLines({ holds: null, open: true, moved, unmoved, line })).toEqual([]);
    expect(windowMailLines({ holds: { moveNow: 0, atWindow: 0 }, open: true, moved, unmoved, line })).toEqual([]);
  });

  it("adds the unticked box's line after whichever count is said, and only while the box is unticked (slice 4)", () => {
    const lines = windowMailLines({ holds: { moveNow: 2, atWindow: 3 }, open: true, moved, unmoved, line, skipped: SKIPPED });
    expect(said(lines)).toEqual(["cel mult 2"]);
    expect(said(lines, { [WINDOW_SEND_EMAIL_FIELD]: "off" })).toEqual(["cel mult 2", SKIPPED]);
    expect(said(lines, { [WINDOW_SEND_EMAIL_FIELD]: "off", "event.confirmationDeadlineDaysBefore": "3" })).toEqual(["cel mult 5", SKIPPED]);
  });
});

describe("the offers a save makes, as another question's lines", () => {
  const raiseWhen: FormCondition[] = [{ field: "event.waitlistAutoOffer", equals: "true" }];

  it("says the offers' email line and then its club count, each only while the offers are", () => {
    const lines = raiseMailLines({ email: "Pleacă cel mult 3 emailuri „S-a eliberat un loc”.", also: [{ text: "Și cel mult 6 emailuri pentru căsuțele clubului.", withEmail: true }] }, raiseWhen);
    const spec: ConfirmSpec = { title: "t", body: "b", confirmLabel: "c", cancelLabel: "x", also: lines };
    const texts = (offers: string) => (resolveAlso(spec, (field) => (field === "event.waitlistAutoOffer" ? offers : null)).also ?? []).map((one) => one.text);
    expect(texts("true")).toEqual(["Pleacă cel mult 3 emailuri „S-a eliberat un loc”.", "Și cel mult 6 emailuri pentru căsuțele clubului."]);
    expect(texts("false")).toEqual([]);
  });

  it("says nothing without offers to make", () => {
    expect(raiseMailLines(null, raiseWhen)).toEqual([]);
    expect(raiseMailLines({ email: "x" }, null)).toEqual([]);
    expect(raiseMailLines({}, raiseWhen)).toEqual([]);
  });
});
