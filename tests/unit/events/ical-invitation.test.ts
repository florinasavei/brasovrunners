import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import { buildCalendar, buildVEvent, type CalendarEvent, type CalendarLabels, type CalendarRsvp } from "@/modules/events/ical";

/**
 * BR-REQ-020-01 criterion 7 (`DECISIONS.md` §NNN, amending §107 and §174) — the calendar entry as
 * an invitation the runner's calendar answers: `METHOD:REQUEST` with the club as `ORGANIZER` and
 * the runner as the one `ATTENDEE`, `SEQUENCE` from the event, the public feed's `UID`, one entry
 * with the programme in its description, and `METHOD:CANCEL` for a cancelled event. Without the
 * option the file is what it was, byte for byte.
 */
function translator(catalogue: { Event: Record<string, unknown> }): CalendarLabels["t"] {
  return (key, values) => {
    const message = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue.Event);
    if (typeof message !== "string") throw new Error(`missing Event.${key}`);
    return Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), message);
  };
}
const labels: CalendarLabels = { locale: "ro", t: translator(ro) };

const event: CalendarEvent = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Crosul aniversar; ediția a 3-a, Brașov",
  startsAt: new Date("2026-10-11T06:00:00.000Z"),
  endsAt: new Date("2026-10-11T09:00:00.000Z"),
  locationName: "Parcul Tractorul, intrarea principală",
  excerpt: "Cursa clubului.\nVino devreme.",
  scheduleJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "07:00 ridicarea numerelor, 09:00 start" }] }] },
  url: "https://example.test/ro/evenimente/crosul-aniversar",
  updatedAt: new Date("2026-09-19T10:00:00.000Z"),
  programme: [{ startsAt: new Date("2026-10-11T05:00:00.000Z"), endsAt: null, label: "Ridicarea numerelor", place: "Cort" }],
};

const NOW = new Date("2026-10-08T12:34:56.000Z");
const request: CalendarRsvp = {
  method: "REQUEST",
  organizerEmail: "club+calendar@example.org",
  organizerName: "Brașov Runners",
  attendeeEmail: "ana@example.org",
  attendeeName: "Ana Popescu",
  sequence: 2,
  now: NOW,
};

const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const lines = (ics: string) => unfold(ics).split("\r\n");

/** Today's file for `event` with one programme row, as the code before §NNN wrote it (captured from it). */
const TODAY = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Brasov Runners//events//RO",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:BVR",
  "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  "X-PUBLISHED-TTL:PT1H",
  "BEGIN:VEVENT",
  "UID:11111111-1111-1111-1111-111111111111@example.test",
  "DTSTAMP:20260919T100000Z",
  "LAST-MODIFIED:20260919T100000Z",
  "DTSTART:20261011T060000Z",
  "DTEND:20261011T090000Z",
  "SUMMARY:Crosul aniversar\\; ediția a 3-a\\, Brașov",
  "DESCRIPTION:📍 Parcul Tractorul\\, intrarea principală\\n\\nCursa clubului.",
  " \\nVino devreme.\\n\\nPagina evenimentului: https://example.test/ro/eveniment",
  " e/crosul-aniversar\\nProgram: https://example.test/ro/evenimente/crosul-ani",
  " versar#schedule\\n\\nProgramul evenimentului:\\n08:00 — Ridicarea numerelor",
  "  (Cort)\\n07:00 ridicarea numerelor\\, 09:00 start",
  "X-ALT-DESC;FMTTYPE=text/html:<html><body><p>📍 Parcul Tractorul\\, intrare",
  " a principală</p><p>Cursa clubului.<br>Vino devreme.</p><p><a href=\"https:",
  " //example.test/ro/evenimente/crosul-aniversar\">Pagina evenimentului</a><br",
  " ><a href=\"https://example.test/ro/evenimente/crosul-aniversar#schedule\">Pr",
  " ogram</a></p><p>Programul evenimentului:<br>08:00 — Ridicarea numerelor ",
  " (Cort)<br>07:00 ridicarea numerelor\\, 09:00 start</p></body></html>",
  "URL:https://example.test/ro/evenimente/crosul-aniversar",
  "LOCATION:Parcul Tractorul\\, intrarea principală",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:11111111-1111-1111-1111-111111111111-1@example.test",
  "DTSTAMP:20260919T100000Z",
  "LAST-MODIFIED:20260919T100000Z",
  "DTSTART:20261011T050000Z",
  "DTEND:20261011T050000Z",
  "SUMMARY:Crosul aniversar\\; ediția a 3-a\\, Brașov — Ridicarea numerelor",
  "DESCRIPTION:https://example.test/ro/evenimente/crosul-aniversar",
  "URL:https://example.test/ro/evenimente/crosul-aniversar",
  "LOCATION:Cort",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

describe("BR-REQ-020-01 criterion 7 the calendar entry as an invitation (§NNN)", () => {
  it("without the option, writes today's file byte for byte — the feed and the page's .ics are unchanged", () => {
    expect(buildCalendar({ events: [event], baseUrl: "https://example.test", name: "BVR", labels })).toBe(TODAY);
    expect(buildCalendar({ events: [event], baseUrl: "https://example.test", name: "BVR", labels, rsvp: undefined })).toBe(TODAY);
  });

  it("asks: METHOD:REQUEST, the club as organizer, the runner as the one attendee who is asked to answer", () => {
    const ics = buildCalendar({ events: [event], baseUrl: "https://example.test", name: "BVR", labels, rsvp: request });
    const all = lines(ics);
    expect(all.slice(0, 5)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Brasov Runners//events//RO", "CALSCALE:GREGORIAN", "METHOD:REQUEST"]);
    // A feed's own lines belong to a calendar one subscribes to, not to an invitation.
    expect(ics).not.toContain("X-WR-CALNAME");
    expect(ics).not.toContain("REFRESH-INTERVAL");
    expect(ics).not.toContain("X-PUBLISHED-TTL");
    expect(all).toContain("ORGANIZER;CN=Brașov Runners:mailto:club+calendar@example.org");
    expect(all).toContain("ATTENDEE;CN=Ana Popescu;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ana@example.org");
    expect(all).toContain("STATUS:CONFIRMED");
    expect(all).toContain("SEQUENCE:2");
    // The same UID as the public feed's entry: one event in the app, not two.
    expect(all).toContain("UID:11111111-1111-1111-1111-111111111111@example.test");
    // DTSTAMP is when the message was made (RFC 5546 §2.1.5); LAST-MODIFIED the entry's own change.
    expect(all).toContain("DTSTAMP:20261008T123456Z");
    expect(all).toContain("LAST-MODIFIED:20260919T100000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("is one entry: the programme rows are words in the description, never invitations of their own", () => {
    const ics = buildCalendar({ events: [event], baseUrl: "https://example.test", name: "BVR", labels, rsvp: request });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(unfold(ics)).not.toContain("UID:11111111-1111-1111-1111-111111111111-1@");
    const description = lines(ics).find((line) => line.startsWith("DESCRIPTION:"));
    expect(description).toContain("Programul evenimentului:\\n08:00 — Ridicarea numerelor (Cort)");
    // And buildVEvent alone says the same.
    expect(buildVEvent(event, "https://example.test", labels, { rsvp: request }).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(buildVEvent(event, "https://example.test", labels).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(2);
  });

  it("cancels: METHOD:CANCEL, STATUS:CANCELLED, the sequence it was given, and an attendee asked nothing", () => {
    const ics = buildCalendar({
      events: [{ ...event, eventStatus: "CANCELLED" }],
      baseUrl: "https://example.test",
      name: "BVR",
      labels,
      rsvp: { ...request, method: "CANCEL", sequence: 3 },
    });
    const all = lines(ics);
    expect(all).toContain("METHOD:CANCEL");
    expect(all).toContain("STATUS:CANCELLED");
    expect(all).not.toContain("STATUS:CONFIRMED");
    expect(all).toContain("SEQUENCE:3");
    expect(all).toContain("ATTENDEE;CN=Ana Popescu;ROLE=REQ-PARTICIPANT:mailto:ana@example.org");
    expect(ics).not.toContain("RSVP=TRUE");
    expect(ics).not.toContain("NEEDS-ACTION");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("folds a long attendee line at 75 octets without splitting a letter, and quotes a name that needs it", () => {
    const longName = "Ștefănescu-Popescu, Ana-Maria Alexandra Ioana";
    const longAddress = `ana.maria.alexandra.ioana.stefanescu.popescu.${"x".repeat(40)}@example.org`;
    const ics = buildCalendar({
      events: [event],
      baseUrl: "https://example.test",
      name: "BVR",
      labels,
      rsvp: { ...request, attendeeName: longName, attendeeEmail: longAddress },
    });
    for (const physical of ics.split("\r\n")) expect(Buffer.byteLength(physical, "utf8")).toBeLessThanOrEqual(75);
    // A comma in a parameter value is quoted (RFC 5545 §3.2), so the line reads back whole.
    expect(lines(ics)).toContain(`ATTENDEE;CN="${longName}";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${longAddress}`);
    expect(ics.split("\r\n").filter((physical) => physical.startsWith("ATTENDEE")).length).toBe(1);
  });

  it("keeps a typed name from breaking the line: no double quote, no line break, no bare separator", () => {
    const ics = buildCalendar({
      events: [event],
      baseUrl: "https://example.test",
      name: "BVR",
      labels,
      rsvp: { ...request, attendeeName: 'Ana "Nana"\r\nPopescu;X-EVIL:1' },
    });
    expect(lines(ics)).toContain("ATTENDEE;CN=\"Ana 'Nana' Popescu;X-EVIL:1\";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ana@example.org");
    expect(lines(ics).some((line) => line.startsWith("X-EVIL"))).toBe(false);
    // No name at all: the attendee is the address alone.
    const bare = buildCalendar({ events: [event], baseUrl: "https://example.test", name: "BVR", labels, rsvp: { ...request, attendeeName: null } });
    expect(lines(bare)).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ana@example.org");
  });

  it("marks the entry on QA as the file does (§174), and only the entry: an invitation has no calendar name", async () => {
    const previous = process.env.APP_ENV;
    try {
      process.env.APP_ENV = "qa";
      vi.resetModules();
      const qa = await import("@/modules/events/ical");
      const marked = qa.buildCalendar({ events: [event], baseUrl: "https://example.test", name: "BVR", labels, rsvp: request });
      expect(unfold(marked)).toContain("SUMMARY:[QA] Crosul aniversar");
      expect(marked).not.toContain("X-WR-CALNAME");
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
      vi.resetModules();
    }
  });
});
