import { describe, expect, it } from "vitest";
import { buildCalendar, googleCalendarUrl, icalFold, icalText, icalUtc, webcalUrl, type CalendarEvent } from "@/modules/events/ical";

/** BR-REQ-020-01 criterion 7 (`DECISIONS.md` §107) — events as a calendar file and a feed. */
const event: CalendarEvent = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Crosul aniversar; ediția a 3-a, Brașov",
  startsAt: new Date("2026-10-11T06:00:00.000Z"),
  endsAt: new Date("2026-10-11T09:00:00.000Z"),
  locationName: "Parcul Tractorul, intrarea principală",
  excerpt: "Cursa clubului.\nVino devreme.",
  scheduleJson: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "07:00 ridicarea numerelor, 09:00 start" }] }],
  },
  url: "https://example.test/ro/evenimente/crosul-aniversar",
  updatedAt: new Date("2026-09-19T10:00:00.000Z"),
};

describe("the calendar file", () => {
  it("writes UTC instants, escapes text and folds long lines", () => {
    expect(icalUtc(event.startsAt)).toBe("20261011T060000Z");
    expect(icalText("a, b; c\\ d\nnew")).toBe("a\\, b\\; c\\\\ d\\nnew");
    const folded = icalFold("X".repeat(150));
    for (const line of folded.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n")).toEqual([`X`.repeat(75), ` ${"X".repeat(74)}`, ` X`]);
  });

  it("folds by octets and never splits a character — emoji in a title (§129)", () => {
    // 73 ASCII octets, then a four-octet runner: the runner goes whole to the next line.
    const folded = icalFold(`${"a".repeat(73)}🏃 și`);
    const lines = folded.split("\r\n");
    expect(lines).toEqual([`${"a".repeat(73)}`, " 🏃 și"]);
    for (const line of lines) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`${"a".repeat(73)}🏃 și`);
    // No lone surrogate anywhere, whatever the boundary.
    for (let n = 60; n < 80; n += 1) {
      expect(icalFold(`${"a".repeat(n)}🏃🏃🏃`)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });

  it("makes the map link the place and keeps the meeting point's name in the description (§129)", () => {
    const mapUrl = "https://maps.app.goo.gl/abc123";
    const ics = buildCalendar({ events: [{ ...event, mapUrl }], baseUrl: "https://example.test", name: "🏃 BVR", labels: { programme: "Program" } });
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("X-WR-CALNAME:🏃 BVR");
    expect(unfolded).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(unfolded).toContain(`LOCATION:${mapUrl}`);
    expect(unfolded).not.toContain("LOCATION:Parcul");
    expect(unfolded).toContain("DESCRIPTION:📍 Parcul Tractorul\\, intrarea principală\\n\\nCursa clubului.");
    const url = new URL(googleCalendarUrl({ ...event, mapUrl }));
    expect(url.searchParams.get("location")).toBe(mapUrl);
    expect(url.searchParams.get("details")).toContain("📍 Parcul Tractorul, intrarea principală");
  });

  it("is a VCALENDAR with one VEVENT per event, the programme in the description and the page as URL", () => {
    const ics = buildCalendar({ events: [event], baseUrl: "https://example.test", name: "Brașov Runners", labels: { programme: "Program" } });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:11111111-1111-1111-1111-111111111111@example.test");
    expect(ics).toContain("DTSTART:20261011T060000Z");
    expect(ics).toContain("DTEND:20261011T090000Z");
    expect(ics).toContain("DTSTAMP:20260919T100000Z");
    // Escaped: the semicolon and the comma in the title, the comma in the place.
    expect(ics).toContain("SUMMARY:Crosul aniversar\\; ediția a 3-a\\, Brașov");
    expect(ics).toContain("LOCATION:Parcul Tractorul\\, intrarea principală");
    // The description, unfolded, carries the excerpt, the programme and the page.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(
      "DESCRIPTION:Cursa clubului.\\nVino devreme.\\n\\nProgram:\\n07:00 ridicarea numerelor\\, 09:00 start\\n\\nhttps://example.test/ro/evenimente/crosul-aniversar",
    );
    expect(unfolded).toContain("URL:https://example.test/ro/evenimente/crosul-aniversar");
    // Every line short of the RFC's 75 octets.
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8"), line).toBeLessThanOrEqual(75);
  });

  it("uses the start as the end when the event has none, and skips a missing place", () => {
    const ics = buildCalendar({ events: [{ ...event, endsAt: null, locationName: null }], baseUrl: "https://example.test", name: "x", labels: { programme: "Program" } });
    expect(ics).toContain("DTEND:20261011T060000Z");
    expect(ics).not.toContain("LOCATION:");
  });

  it("adds one VEVENT per programme row, at the row's time and place, under the event's UID (§117)", () => {
    const programme = [
      { startsAt: new Date("2026-10-10T13:00:00.000Z"), endsAt: new Date("2026-10-10T16:00:00.000Z"), label: "Kit pickup", place: "Start tent" },
      { startsAt: new Date("2026-10-11T05:30:00.000Z"), endsAt: null, label: "Briefing", place: null },
    ];
    const ics = buildCalendar({
      events: [{ ...event, programme, timezone: "Europe/Bucharest" }],
      baseUrl: "https://example.test",
      name: "x",
      labels: { programme: "Programme", locale: "en" },
    });
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(unfolded).toContain("UID:11111111-1111-1111-1111-111111111111-1@example.test");
    expect(unfolded).toContain("DTSTART:20261010T130000Z\r\nDTEND:20261010T160000Z\r\nSUMMARY:Crosul aniversar\\; ediția a 3-a\\, Brașov — Kit pickup");
    expect(unfolded).toContain("LOCATION:Start tent");
    // The briefing has no place of its own, so it is at the event's.
    expect(unfolded).toContain("SUMMARY:Crosul aniversar\\; ediția a 3-a\\, Brașov — Briefing\r\nDESCRIPTION:https://example.test/ro/evenimente/crosul-aniversar\r\nURL:https://example.test/ro/evenimente/crosul-aniversar\r\nLOCATION:Parcul Tractorul\\, intrarea principală");
    // The event's own description lists the rows before the text, with the day since they span two.
    expect(unfolded).toContain("Programme:\\nSat 10 Oct 16:00–19:00 — Kit pickup (Start tent)\\nSun 11 Oct 08:30 — Briefing\\n07:00 ridicarea numerelor\\, 09:00 start");
  });

  it("says when registration opens, in the event's zone, only while the caller says it is ahead (§146)", () => {
    const opensAt = new Date("2026-10-01T15:00:00.000Z");
    const labels = { programme: "Program", locale: "ro" as const, registrationOpens: (date: string) => `Înscrieri din ${date}` };
    const ahead = buildCalendar({ events: [{ ...event, timezone: "Europe/Bucharest", registrationOpensAt: opensAt }], baseUrl: "https://example.test", name: "BVR", labels }).replace(/\r\n /g, "");
    expect(ahead).toContain("Cursa clubului.\\nVino devreme.\\n\\nÎnscrieri din 1 octombrie 2026 la 18:00\\n\\nProgram:");
    // Not set — the window already open, or no window at all — and the line is not there.
    const open = buildCalendar({ events: [{ ...event, registrationOpensAt: null }], baseUrl: "https://example.test", name: "BVR", labels });
    expect(open).not.toContain("Înscrieri din");
  });

  it("builds Google's add-event address and the webcal scheme", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("dates")).toBe("20261011T060000Z/20261011T090000Z");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("location")).toBe(event.locationName);
    expect(webcalUrl("https://example.test/ro/events/calendar.ics")).toBe("webcal://example.test/ro/events/calendar.ics");
  });
});
