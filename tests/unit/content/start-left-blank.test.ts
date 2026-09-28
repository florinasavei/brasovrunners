import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import StartToBeAnnounced from "@/modules/content/events/ui/StartToBeAnnounced";
import { bibEventDate } from "@/modules/registrations/bibs";
import { resolveStart, startBoxesRequired } from "@/modules/content/events/start";
import {
  blankStartParts,
  provisionalStartWallTime,
  readStartBoxes,
  startBoxValues,
  typedStartOrNull,
  typedStartShape,
  UNDATED_DAY,
} from "@/modules/events/domain/provisional-start";
import { eventFormFieldName } from "@/modules/content/events/form-names";
import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * `DECISIONS.md` §NNN (amending §533) — which of the start's boxes may be left empty, per switch
 * state, and the provisional start the platform stores in place of an empty part: read back as an
 * empty box, never as a date or an hour somebody typed.
 */
const ZONE = "Europe/Bucharest";
const off = { dateToBeAnnounced: false, timeToBeAnnounced: false };
const dateLater = { dateToBeAnnounced: true, timeToBeAnnounced: false };
const timeLater = { dateToBeAnnounced: false, timeToBeAnnounced: true };
const both = { dateToBeAnnounced: true, timeToBeAnnounced: true };

describe("§NNN the start's boxes, per switch state", () => {
  it("requires both with neither switch, nothing with the date's, the date alone with the time's", () => {
    expect(startBoxesRequired(off)).toEqual({ date: true, time: true });
    expect(startBoxesRequired(dateLater)).toEqual({ date: false, time: false });
    expect(startBoxesRequired(both)).toEqual({ date: false, time: false });
    expect(startBoxesRequired(timeLater)).toEqual({ date: true, time: false });
  });

  it("refuses an empty box the switches do not excuse, naming it", () => {
    const refusal = (posted: string, switches: typeof off) => {
      try {
        resolveStart(posted, switches, ZONE);
        return null;
      } catch (error) {
        return (error as { fields: string[] }).fields;
      }
    };
    expect(refusal("", off)).toEqual(["startsAt"]);
    expect(refusal("T10:00", off)).toEqual(["startsAt"]);
    expect(refusal("2027-03-14", off)).toEqual(["startsAtTime"]);
    expect(refusal("", timeLater)).toEqual(["startsAt"]);
    expect(refusal("2027-03-14", timeLater)).toBeNull();
    expect(refusal("", dateLater)).toBeNull();
    expect(refusal("T10:00", dateLater)).toBeNull();
    expect(refusal("2027-03-14T10:00", off)).toBeNull();
    expect(refusal("14.03.2027", dateLater)).toEqual(["startsAt"]);
    expect(refusal(`${UNDATED_DAY}T10:00`, dateLater)).toEqual(["startsAt"]);
    // Both refusals point at a box «Începutul evenimentului» labels (`field-labels.ts`).
    expect(eventFormFieldName("startsAt")).toBe("event.startsAtDate");
    expect(eventFormFieldName("startsAtTime")).toBe("event.startsAtTime");
  });

  it("stores a typed start as typed, and says which parts were left blank", () => {
    expect(resolveStart("2027-03-14T10:00", off, ZONE)).toEqual({ startsAt: new Date("2027-03-14T08:00:00.000Z"), blank: { date: false, time: false } });
    expect(resolveStart("", dateLater, ZONE).blank).toEqual({ date: true, time: true });
    expect(resolveStart("2027-03-14", timeLater, ZONE).blank).toEqual({ date: false, time: true });
  });
});

describe("§NNN the provisional start", () => {
  it("reads back as empty boxes, and a typed start never does", () => {
    for (const boxes of [
      { date: "", time: "" },
      { date: "", time: "09:30" },
      { date: "2027-03-14", time: "" },
      { date: "2027-10-25", time: "" },
      { date: "2027-03-14", time: "23:45" },
    ]) {
      // What the save stores for these boxes, with the switch that excuses them.
      const stored = resolveStart(boxes.date && boxes.time ? `${boxes.date}T${boxes.time}` : boxes.date || (boxes.time ? `T${boxes.time}` : ""), dateLater, ZONE).startsAt;
      expect(stored).toEqual(fromWallTimeInput(provisionalStartWallTime(boxes), ZONE));
      expect(startBoxValues(stored, ZONE)).toEqual(boxes);
    }
    // Every hour of a day, typed, is an hour — noon included.
    for (let hour = 0; hour < 24; hour += 1) {
      const time = `${String(hour).padStart(2, "0")}:00`;
      const typed = resolveStart(`2027-03-28T${time}`, off, ZONE).startsAt;
      expect(blankStartParts(typed, ZONE)).toEqual({ date: false, time: false });
    }
  });

  it("keeps the day on the event's own calendar when the hour is blank, across a clock change", () => {
    // 28 March 2027 is the spring change in Romania: the provisional noon is still that day.
    const stored = resolveStart("2027-03-28", timeLater, ZONE).startsAt;
    expect(startBoxValues(stored, ZONE).date).toBe("2027-03-28");
  });

  it("gives staff surfaces no date for a date left blank", () => {
    const blank = resolveStart("", dateLater, ZONE).startsAt;
    expect(typedStartOrNull({ startsAt: blank, timezone: ZONE })).toBeNull();
    const typed = new Date("2027-03-14T08:00:00.000Z");
    expect(typedStartOrNull({ startsAt: typed, timezone: ZONE })).toBe(typed);
    expect(startBoxValues(null, ZONE)).toEqual({ date: "", time: "" });
  });

  it("reads what the form posts: the whole value, the date alone, an hour alone, nothing", () => {
    expect(readStartBoxes("2027-03-14T10:00")).toEqual({ date: "2027-03-14", time: "10:00" });
    // A caller's seconds are dropped, so no typed start can carry the blank hour's second.
    expect(readStartBoxes("2027-03-14T12:00:01")).toEqual({ date: "2027-03-14", time: "12:00" });
    expect(readStartBoxes("2027-03-14")).toEqual({ date: "2027-03-14", time: "" });
    expect(readStartBoxes("T10:00")).toEqual({ date: "", time: "10:00" });
    expect(readStartBoxes("  ")).toEqual({ date: "", time: "" });
    expect(readStartBoxes("tomorrow")).toBeNull();
  });
});

describe("§NNN the staff surfaces that print the start in words", () => {
  const blankDate = { startsAt: resolveStart("T19:00", dateLater, ZONE).startsAt, timezone: ZONE };
  const blankHour = { startsAt: resolveStart("2027-03-14", timeLater, ZONE).startsAt, timezone: ZONE };
  const typed = { startsAt: resolveStart("2027-03-14T19:00", off, ZONE).startsAt, timezone: ZONE };

  it("gives the day alone for an hour left blank, nothing for a date left blank", () => {
    expect(typedStartShape(blankDate)).toBeNull();
    expect(typedStartShape(blankHour)).toEqual({ at: blankHour.startsAt, hour: false });
    expect(typedStartShape(typed)).toEqual({ at: typed.startsAt, hour: true });
  });

  it("prints no 9999 on the bib preview, the sheet or the emergency sheet of a race without a date", () => {
    for (const locale of ["ro", "en"]) {
      expect(bibEventDate(blankDate, locale)).toBe("");
      expect(bibEventDate(blankDate, locale)).not.toContain("9999");
      expect(bibEventDate(typed, locale)).toContain("2027");
      // A bib prints the day, never an hour: the blank hour's noon never shows either.
      expect(bibEventDate(blankHour, locale)).toContain("2027");
      expect(bibEventDate(blankHour, locale)).not.toContain("12:00");
    }
  });
});

describe("§NNN the start's boxes without JavaScript", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const messages = JSON.parse(readFileSync(path.join(ROOT, "messages/ro.json"), "utf8")) as { Admin: { pickers: Record<string, string> } };
  const render = (defaults: typeof off) =>
    renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale: "ro", messages: { Admin: { pickers: messages.Admin.pickers } } } as unknown as ComponentProps<typeof NextIntlClientProvider>,
        createElement(StartToBeAnnounced, {
          labels: { date: "Începutul evenimentului", time: "Ora", help: "", dateSwitch: "Data", dateSwitchHelp: "", timeSwitch: "Ora", timeSwitchHelp: "" },
          values: { date: "", time: "" },
          defaults,
          required: true,
        }),
      ),
    );

  it("carries no required attribute a switch ticked before the press could not lift; the server's rule refuses instead", () => {
    // The create page's switches start off; ticked with JavaScript off, the save must still go through.
    for (const defaults of [off, dateLater, timeLater]) {
      const html = render(defaults);
      expect(html).toContain('name="event.startsAtDate"');
      expect(html).not.toMatch(/<input[^>]*name="event\.startsAt(Date|Time)"[^>]*required/);
      expect(html).not.toMatch(/<input[^>]*required[^>]*name="event\.startsAt(Date|Time)"/);
    }
  });
});
