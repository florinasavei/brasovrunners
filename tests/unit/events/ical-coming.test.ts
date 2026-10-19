import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  buildCalendar,
  calendarDescription,
  calendarDescriptionHtml,
  googleCalendarDetails,
  type CalendarEvent,
  type CalendarLabels,
} from "@/modules/events/ical";
import { RSVP_BOX_ID } from "@/modules/rsvp/rsvp-box";

/**
 * §815 (BR-REQ-020-01 criterion 7; amends §107 and §159) — what the calendar's description says about «Vin!»: one line
 * that links the page's «Vii?» card and one that counts who comes. The gate is not decided here (`readComing` does, tested beside it);
 * this file holds that an event given `coming` says both lines, in the page's words in either language, from the event's own address,
 * and that an event without it reads exactly as it did.
 */
const event: CalendarEvent = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Alergarea de joi",
  startsAt: new Date("2026-10-22T15:00:00.000Z"),
  endsAt: null,
  locationName: "Parcul Tractorul",
  excerpt: "Alergare ușoară, în grup.",
  scheduleJson: null,
  url: "https://example.test/ro/evenimente/alergarea-de-joi",
  updatedAt: new Date("2026-10-18T10:00:00.000Z"),
};

function translator(catalogue: { Event: Record<string, unknown> }): CalendarLabels["t"] {
  return (key, values) => {
    const message = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue.Event);
    if (typeof message !== "string") throw new Error(`missing Event.${key}`);
    return Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), message);
  };
}
const labelsRo: CalendarLabels = { locale: "ro", t: translator(ro) };
const labelsEn: CalendarLabels = { locale: "en", t: translator(en) };

const withComing = (count: number): CalendarEvent => ({ ...event, coming: { count } });

describe("§815 the calendar's «Vin!» lines", () => {
  it("says the link to the page's #vin and how many come, in Romanian, from the event's own address", () => {
    const text = calendarDescription(withComing(5), labelsRo);
    expect(text).toContain(`Vin! → ${event.url}#${RSVP_BOX_ID}`);
    expect(text).toContain("5 vin până acum");
    // The two lines are one paragraph, the link first: a reader of the entry meets the action, then the number.
    expect(text).toContain(`Vin! → ${event.url}#vin\n5 vin până acum`);
  });

  it("says the same in English, with its own words", () => {
    const text = calendarDescription({ ...withComing(5), url: "https://example.test/en/events/thursday-run" }, labelsEn);
    expect(text).toContain("I'm coming! → https://example.test/en/events/thursday-run#vin");
    expect(text).toContain("5 people coming so far");
    expect(text).not.toContain("vin până acum");
  });

  it("takes the house's plural rule: «1 vine», «5 vin», «21 vin» in Romanian, «1 person» in English", () => {
    expect(calendarDescription(withComing(1), labelsRo)).toContain("1 vine până acum");
    expect(calendarDescription(withComing(2), labelsRo)).toContain("2 vin până acum");
    expect(calendarDescription(withComing(21), labelsRo)).toContain("21 vin până acum");
    expect(calendarDescription(withComing(1), labelsEn)).toContain("1 person coming so far");
    expect(calendarDescription(withComing(2), labelsEn)).toContain("2 people coming so far");
  });

  it("says «Fii primul care spune că vine.» when nobody has yet — never «0 vin»", () => {
    const text = calendarDescription(withComing(0), labelsRo);
    expect(text).toContain("Fii primul care spune că vine.");
    expect(text).not.toContain("0 vin");
    expect(calendarDescription(withComing(0), labelsEn)).toContain("Be the first to say you're coming.");
  });

  it("says nothing of «Vin!» for an event given no `coming`: the description is what it was", () => {
    for (const absent of [event, { ...event, coming: null }]) {
      const text = calendarDescription(absent, labelsRo);
      expect(text).not.toContain("Vin!");
      expect(text).not.toContain("#vin");
      expect(text).not.toContain("vin până acum");
    }
    expect(calendarDescription({ ...event, coming: null }, labelsRo)).toBe(calendarDescription(event, labelsRo));
  });

  it("makes the words the link in the HTML twin Outlook renders, and keeps the count a plain line", () => {
    const html = calendarDescriptionHtml(withComing(3), labelsRo);
    expect(html).toContain(`<a href="${event.url}#vin">Vin!</a><br>3 vin până acum`);
  });

  it("is in the file as DESCRIPTION and X-ALT-DESC, the link unfolded in the text a calendar app reads", () => {
    const ics = buildCalendar({ events: [withComing(2)], baseUrl: "https://example.test", name: "Brașov Runners", labels: labelsRo });
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toMatch(/DESCRIPTION:[^\r]*Vin! → https:\/\/example\.test\/ro\/evenimente\/alergarea-de-joi#vin\\n2 vin până acum/);
    expect(unfolded).toMatch(/X-ALT-DESC;FMTTYPE=text\/html:[^\r]*<a href="https:\/\/example\.test\/ro\/evenimente\/alergarea-de-joi#vin">Vin!<\/a>/);
  });

  it("is in Google's add-event details too when an event is given the count, and absent when it is not", () => {
    expect(googleCalendarDetails(withComing(2), labelsRo)).toContain(`<a href="${event.url}#vin">Vin!</a>`);
    expect(googleCalendarDetails(event, labelsRo)).not.toContain("#vin");
  });

  it("writes the link from the event's address, never a host of its own: another address, another link", () => {
    const text = calendarDescription({ ...withComing(2), url: "https://elsewhere.test/ro/evenimente/x" }, labelsRo);
    expect(text).toContain("Vin! → https://elsewhere.test/ro/evenimente/x#vin");
    expect(text).not.toContain("example.test");
  });
});
