import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  buildCalendar,
  calendarDescription,
  calendarDescriptionHtml,
  calendarRegistration,
  calendarStamp,
  googleCalendarDetails,
  googleCalendarUrl,
  icalFold,
  icalText,
  icalUtc,
  webcalUrl,
  type CalendarEvent,
  type CalendarLabels,
} from "@/modules/events/ical";
import type { CoHost } from "@/modules/events/domain/co-hosts";

/** A partner with its one page, the shape a bare `url` always meant (§168, §344). */
const partner = (name: string, url: string | null): CoHost => ({
  name,
  descriptionRo: null,
  descriptionEn: null,
  links: url ? [{ kind: "SITE", url, labelRo: null, labelEn: null }] : [],
});

/** BR-REQ-020-01 criterion 7 (`DECISIONS.md` §107, §159) — events as a calendar file and a feed. */
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

/**
 * The calendar's words are the catalogue's own (§159): `t` reads the real "Event" messages,
 * so a key the builder asks for and the catalogue lacks fails here, not on a subscriber's phone.
 */
function translator(catalogue: { Event: Record<string, unknown> }): CalendarLabels["t"] {
  return (key, values) => {
    const message = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue.Event);
    if (typeof message !== "string") throw new Error(`missing Event.${key}`);
    return Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), message);
  };
}

const labelsRo: CalendarLabels = { locale: "ro", t: translator(ro) };
const labelsEn: CalendarLabels = { locale: "en", t: translator(en) };
const rules = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Fără căști." }] }] };
const paragraphs = (texts: string[]) => ({ type: "doc", content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });

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

  it("makes the map link the place and keeps the meeting point's name, with the map, in the description (§129, §159)", () => {
    const mapUrl = "https://maps.app.goo.gl/abc123";
    const ics = buildCalendar({ events: [{ ...event, mapUrl }], baseUrl: "https://example.test", name: "🏃 BVR", labels: labelsRo });
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("X-WR-CALNAME:🏃 BVR");
    expect(unfolded).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(unfolded).toContain(`LOCATION:${mapUrl}`);
    expect(unfolded).not.toContain("LOCATION:Parcul");
    expect(unfolded).toContain(`DESCRIPTION:📍 Parcul Tractorul\\, intrarea principală — ${mapUrl}\\n\\nCursa clubului.`);
    const url = new URL(googleCalendarUrl({ ...event, mapUrl }, labelsRo));
    expect(url.searchParams.get("location")).toBe(mapUrl);
    expect(url.searchParams.get("details")).toContain(`<a href="${mapUrl}">📍 Parcul Tractorul, intrarea principală</a>`);
    // The HTML twin makes the name the link.
    expect(calendarDescriptionHtml({ ...event, mapUrl }, labelsRo)).toContain(`<p><a href="${mapUrl}">📍 Parcul Tractorul, intrarea principală</a></p>`);
  });

  it("writes the street address under the name, and 'Vezi pe hartă' for a map link without a name (§159)", () => {
    const mapUrl = "https://maps.app.goo.gl/abc123";
    const address = "Str. Turnului 5, Brașov";
    // The address is its own line, as the page's "Adresă"; without a map link, name and address are the place.
    const withAddress = calendarDescription({ ...event, locationAddress: address }, labelsRo);
    expect(withAddress.startsWith(`📍 Parcul Tractorul, intrarea principală\nAdresă: ${address}\n\nCursa clubului.`)).toBe(true);
    const ics = buildCalendar({ events: [{ ...event, locationAddress: address }], baseUrl: "https://example.test", name: "x", labels: labelsRo });
    expect(ics.replace(/\r\n /g, "")).toContain(`LOCATION:Parcul Tractorul\\, intrarea principală\\, Str. Turnului 5\\, Brașov`);
    expect(new URL(googleCalendarUrl({ ...event, locationAddress: address }, labelsRo)).searchParams.get("location")).toBe(`Parcul Tractorul, intrarea principală, ${address}`);
    // A map link and no name: the page's "Vezi pe hartă" stands for the name; the map stays the place.
    const noName = calendarDescription({ ...event, locationName: null, mapUrl, locationAddress: address }, labelsRo);
    expect(noName.startsWith(`📍 Vezi pe hartă — ${mapUrl}\nAdresă: ${address}\n\n`)).toBe(true);
    expect(calendarDescription({ ...event, locationName: null, mapUrl }, labelsEn).startsWith(`📍 Open the map — ${mapUrl}\n\n`)).toBe(true);
    expect(buildCalendar({ events: [{ ...event, locationName: null, mapUrl }], baseUrl: "https://example.test", name: "x", labels: labelsRo })).toContain(`LOCATION:${mapUrl}`);
    // Neither: no line, no place.
    expect(calendarDescription({ ...event, locationName: null }, labelsRo)).not.toContain("📍");
  });

  it("is a VCALENDAR with one VEVENT per event, the programme in the description and the page as URL", () => {
    const ics = buildCalendar({ events: [event], baseUrl: "https://example.test", name: "Brașov Runners", labels: labelsRo });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:11111111-1111-1111-1111-111111111111@example.test");
    expect(ics).toContain("DTSTART:20261011T060000Z");
    expect(ics).toContain("DTEND:20261011T090000Z");
    expect(ics).toContain("DTSTAMP:20260919T100000Z");
    // Escaped: the semicolon and the comma in the title, the comma in the place.
    expect(ics).toContain("SUMMARY:Crosul aniversar\\; ediția a 3-a\\, Brașov");
    expect(ics).toContain("LOCATION:Parcul Tractorul\\, intrarea principală");
    // The description, unfolded: the meeting point, the excerpt, the links, the programme — nothing the event lacks.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(
      "DESCRIPTION:📍 Parcul Tractorul\\, intrarea principală\\n\\nCursa clubului.\\nVino devreme.\\n\\nPagina evenimentului: https://example.test/ro/evenimente/crosul-aniversar\\nProgram: https://example.test/ro/evenimente/crosul-aniversar#schedule\\n\\nProgramul evenimentului:\\n07:00 ridicarea numerelor\\, 09:00 start\r\n",
    );
    expect(unfolded).toContain("URL:https://example.test/ro/evenimente/crosul-aniversar");
    expect(unfolded).not.toContain("Regulament");
    expect(unfolded).not.toContain("Înscrieri");
    expect(unfolded).not.toContain("🏃 ");
    expect(unfolded).not.toContain("STATUS:");
    // Every line short of the RFC's 75 octets.
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8"), line).toBeLessThanOrEqual(75);
  });

  it("uses the start as the end when the event has none, and skips a missing place", () => {
    const ics = buildCalendar({ events: [{ ...event, endsAt: null, locationName: null }], baseUrl: "https://example.test", name: "x", labels: labelsRo });
    expect(ics).toContain("DTEND:20261011T060000Z");
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("📍");
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
      labels: labelsEn,
    });
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(unfolded).toContain("UID:11111111-1111-1111-1111-111111111111-1@example.test");
    expect(unfolded).toContain("DTSTART:20261010T130000Z\r\nDTEND:20261010T160000Z\r\nSUMMARY:Crosul aniversar\\; ediția a 3-a\\, Brașov — Kit pickup");
    expect(unfolded).toContain("LOCATION:Start tent");
    // The briefing has no place of its own, so it is at the event's.
    expect(unfolded).toContain("SUMMARY:Crosul aniversar\\; ediția a 3-a\\, Brașov — Briefing\r\nDESCRIPTION:https://example.test/ro/evenimente/crosul-aniversar\r\nURL:https://example.test/ro/evenimente/crosul-aniversar\r\nLOCATION:Parcul Tractorul\\, intrarea principală");
    // The event's own description lists the rows before the text, with the day since they span two, under the page's heading.
    expect(unfolded).toContain("Event programme:\\nSat\\, 10 Oct 2026\\, 16:00–19:00 — Kit pickup (Start tent)\\nSun\\, 11 Oct 2026\\, 08:30 — Briefing\\n07:00 ridicarea numerelor\\, 09:00 start");
  });

  const full: CalendarEvent = {
    ...event,
    type: "RACE",
    raceStartsAt: new Date("2026-10-11T07:00:00.000Z"),
    timezone: "Europe/Bucharest",
    mapUrl: "https://maps.app.goo.gl/abc123",
    locationAddress: "Str. Turnului 5, Brașov",
    bodyJson: paragraphs(["Ediția a treia a crosului nostru.", "Traseul urcă pe Tâmpa."]),
    distanceMeters: 10_000,
    elevationGainMeters: 300,
    surface: "TRAIL",
    difficulty: "MODERATE",
    costType: "FREE",
    rulesJson: rules,
    routeUrl: "https://www.strava.com/routes/1",
    videoUrl: "https://www.youtube.com/watch?v=abc",
    stravaEventUrl: "https://www.strava.com/clubs/1/group_events/2",
    facebookEventUrl: "https://www.facebook.com/events/3",
    checklist: "număr de concurs, apă",
    coHosts: [partner("Clubul Alpin", "https://alpin.example.test")],
    registration: { kind: "OPEN", url: "https://example.test/ro/evenimente/crosul-aniversar/inscriere" },
  };

  it("carries every detail the page has, in the page's words, each only when set (§159)", () => {
    expect(calendarDescription(full, labelsRo)).toBe(
      [
        "📍 Parcul Tractorul, intrarea principală — https://maps.app.goo.gl/abc123",
        "Adresă: Str. Turnului 5, Brașov",
        "",
        "Cursa clubului.\nVino devreme.",
        "",
        "Ediția a treia a crosului nostru.\nTraseul urcă pe Tâmpa.",
        "",
        "întâlnire la 09:00 · start la 10:00",
        "Concurs · 🏃 10 km · ↗ 300 m diferență de nivel · Trail · Mediu · Gratuit",
        "",
        "Înscrierile sunt deschise — https://example.test/ro/evenimente/crosul-aniversar/inscriere",
        "",
        "Pagina evenimentului: https://example.test/ro/evenimente/crosul-aniversar",
        "Regulament: https://example.test/ro/evenimente/crosul-aniversar#rules",
        "Program: https://example.test/ro/evenimente/crosul-aniversar#schedule",
        "Traseu: https://www.strava.com/routes/1",
        "Vezi filmul evenimentului: https://www.youtube.com/watch?v=abc",
        "Evenimentul pe Strava: https://www.strava.com/clubs/1/group_events/2",
        "Evenimentul pe Facebook: https://www.facebook.com/events/3",
        "",
        "Programul evenimentului:",
        "07:00 ridicarea numerelor, 09:00 start",
        "",
        "Ce să aduci: număr de concurs, apă",
        "",
        "Împreună cu Clubul Alpin — https://alpin.example.test",
      ].join("\n"),
    );
    // The same words in English, with the English separator for 14,5 km.
    const english = calendarDescription({ ...full, distanceMeters: 14_500 }, labelsEn);
    expect(english).toContain("gather at 09:00 · start at 10:00\nRace · 🏃 14.5 km · ↗ 300 m elevation gain · Trail · Moderate · Free");
    expect(english).toContain("Registration is open — ");
    expect(english).toContain("Event page: ");
    expect(english).toContain("Watch the event film: ");
    expect(calendarDescription({ ...full, distanceMeters: 14_500 }, labelsRo)).toContain("🏃 14,5 km");
    // Nothing set, nothing said: neither the line nor its label.
    const bare = calendarDescription({ ...event, excerpt: null, scheduleJson: null, locationName: null }, labelsRo);
    expect(bare).toBe("Pagina evenimentului: https://example.test/ro/evenimente/crosul-aniversar");
    // A difficulty alone is a facts line of one word; a cost left unstated is not "free"; no gun time, no times line.
    expect(calendarDescription({ ...event, difficulty: "HARD" }, labelsRo)).toContain("\n\nAvansat\n\n");
    expect(calendarDescription({ ...event, difficulty: "HARD" }, labelsRo)).not.toContain("Gratuit");
    expect(calendarDescription({ ...event, difficulty: "HARD" }, labelsRo)).not.toContain("întâlnire");
  });

  it("carries a paid event's amount and where it is paid, and a donation's host and suggested amount (§343)", () => {
    const paid = calendarDescription({ ...full, costType: "PAID", costAmount: "50 lei", costUrl: "https://revolut.me/brasovrunners" }, labelsRo);
    expect(paid).toContain("Taxă: 50 lei · plata pe revolut.me");
    const paidEn = calendarDescription({ ...full, costType: "PAID", costAmount: "50 lei", costUrl: "https://revolut.me/brasovrunners" }, labelsEn);
    expect(paidEn).toContain("Fee: 50 lei · payment on revolut.me");
    const donation = calendarDescription(
      { ...full, costType: "DONATION", costAmount: "50 lei", costUrl: "https://www.wingsforlifeworldrun.com/en/donate" },
      labelsRo,
    );
    expect(donation).toContain("Donație: pe wingsforlifeworldrun.com · sugerat 50 lei");
  });

  it("carries an EXTERNAL-registration PAID event's cost as «Cost: {amount}, la organizator», with the discount note (§394)", () => {
    const external = calendarDescription(
      { ...full, costType: "PAID", costAmount: "75 lei", registrationMode: "EXTERNAL", discountNote: "40 lei pentru membri" },
      labelsRo,
    );
    expect(external).toContain("Cost: 75 lei, la organizator · 40 lei pentru membri");
    expect(external).not.toContain("plata pe");

    const externalEn = calendarDescription(
      { ...full, costType: "PAID", costAmount: "75 lei", registrationMode: "EXTERNAL", discountNote: "40 lei for members" },
      labelsEn,
    );
    expect(externalEn).toContain("Cost: 75 lei, paid to the organizer · 40 lei for members");

    // No discount stated: the cost line alone, still "la organizator".
    const noDiscount = calendarDescription({ ...full, costType: "PAID", costAmount: "75 lei", registrationMode: "EXTERNAL", discountNote: null }, labelsRo);
    expect(noDiscount).toContain("Cost: 75 lei, la organizator");
    expect(noDiscount).not.toContain("40 lei pentru membri");

    // An INTERNAL paid event is unaffected: the plain amount and payment link, as before.
    const internal = calendarDescription({ ...full, costType: "PAID", costAmount: "50 lei", costUrl: "https://revolut.me/brasovrunners", registrationMode: "INTERNAL" }, labelsRo);
    expect(internal).toContain("Taxă: 50 lei · plata pe revolut.me");
    expect(internal).not.toContain("la organizator");
  });

  // §394 (review round 3): the file reads the span as the pill and the reminder do — a daylight
  // start whose own end, or whose programme's last row, falls after dusk is a night event here too.
  it("says the night line for a daylight start that ends after dusk, from the end or the programme (§394)", () => {
    // 16:00 on 18 November in Brașov, ninety minutes: dusk (~17:15) falls inside.
    const november = {
      ...event,
      type: "RACE" as const,
      timezone: "Europe/Bucharest",
      startsAt: new Date("2026-11-18T14:00:00.000Z"),
      endsAt: new Date("2026-11-18T15:30:00.000Z"),
      nightOverride: null,
    };
    expect(calendarDescription(november, labelsRo)).toContain("Eveniment de noapte: începe la 16:00, apusul la 16:44, se termină la 17:30 — ia o frontală");
    expect(calendarDescription(november, labelsEn)).toContain("Night event: starts at 16:00, sunset at 16:44, ends at 17:30 — bring a headlamp");
    // The same start ending at 16:45: in the light throughout, no line.
    expect(calendarDescription({ ...november, endsAt: new Date("2026-11-18T14:45:00.000Z") }, labelsRo)).not.toContain("de noapte");

    // No end of its own: the programme's last row of the day (17:45) carries it past dusk.
    const programme = [
      { startsAt: new Date("2026-11-18T14:00:00.000Z"), endsAt: null, label: "Start", place: null },
      { startsAt: new Date("2026-11-18T15:30:00.000Z"), endsAt: new Date("2026-11-18T15:45:00.000Z"), label: "Premiere", place: null },
    ];
    expect(calendarDescription({ ...november, endsAt: null, programme }, labelsRo)).toContain("Eveniment de noapte: începe la 16:00, apusul la 16:44, ultimul punct din program la 17:45 — ia o frontală");

    // A group run is «Alergare de noapte» in the file, as on its card and in its reminder.
    expect(calendarDescription({ ...november, type: "GROUP_RUN" }, labelsRo)).toContain("Alergare de noapte: începe la 16:00, apusul la 16:44, se termină la 17:30 — ia o frontală");
    expect(calendarDescription({ ...november, type: "GROUP_RUN" }, labelsEn)).toContain("Night run: starts at 16:00, sunset at 16:44, ends at 17:30 — bring a headlamp");
    expect(calendarDescription({ ...november, type: "GROUP_RUN" }, labelsRo)).not.toContain("Eveniment de noapte");
  });

  it("writes one line per partner, the label said once, each keeping its own page (§168)", () => {
    const three = calendarDescription(
      {
        ...event,
        coHosts: [
          partner("Brașov Marathon", "https://example.test/bm"),
          partner("Clubul Alpin", "https://alpin.example.test"),
          partner("Salvamont", null),
        ],
      },
      labelsRo,
    );
    const group = three.split("\n\n").at(-1);
    expect(group).toBe(
      [
        "Împreună cu Brașov Marathon — https://example.test/bm",
        "Clubul Alpin — https://alpin.example.test",
        "Salvamont",
      ].join("\n"),
    );
    // The label belongs to the group, not to every line of it.
    expect(three.match(/Împreună cu/g)).toHaveLength(1);
    // The same group as paragraphs and links for Outlook, each partner its own anchor.
    const html = calendarDescriptionHtml(
      { ...event, coHosts: [partner("Brașov Marathon", "https://example.test/bm"), partner("Salvamont", null)] },
      labelsRo,
    );
    expect(html).toContain('<p><a href="https://example.test/bm">Împreună cu Brașov Marathon</a><br>Salvamont</p>');
    // A single partner reads exactly as it did before the list existed.
    expect(calendarDescription({ ...event, coHosts: [partner("Salvamont", null)] }, labelsRo).split("\n\n").at(-1)).toBe(
      "Împreună cu Salvamont",
    );
    // No partners, no line and no label.
    expect(calendarDescription({ ...event, coHosts: [] }, labelsRo)).not.toContain("Împreună cu");
  });

  it("carries the start of the long description, cut at a word, and the page for the rest (§156, §159)", () => {
    const long = paragraphs(Array.from({ length: 30 }, (_, i) => `Paragraful ${i + 1}: alergăm împreună pe Tâmpa, apoi coborâm la cafea în Piața Sfatului.`));
    const description = calendarDescription({ ...event, bodyJson: long }, labelsRo);
    expect(description).toContain("Cursa clubului.\nVino devreme.\n\nParagraful 1: alergăm împreună");
    const body = description.split("\n\n")[2] ?? "";
    expect(body.endsWith("…")).toBe(true);
    expect(body.length).toBeLessThanOrEqual(601);
    expect(body).not.toContain("Paragraful 30");
    // An empty document is no group at all.
    expect(calendarDescription({ ...event, bodyJson: { type: "doc", content: [] } }, labelsRo)).not.toContain("\n\n\n");
  });

  it("says where registration stands — open, ahead, closed, at the organizer — or nothing, in the page's sentences (§146, §159)", () => {
    const register = "https://example.test/ro/evenimente/crosul-aniversar/inscriere";
    const at = (registration: CalendarEvent["registration"]) => calendarDescription({ ...event, timezone: "Europe/Bucharest", registration }, labelsRo);
    expect(at({ kind: "OPEN", url: register })).toContain(`\n\nÎnscrierile sunt deschise — ${register}\n\n`);
    // The opening date in the event's zone, the page's own sentence, and the door after it.
    expect(at({ kind: "NOT_YET_OPEN", opensAt: new Date("2026-10-01T15:00:00.000Z"), url: register })).toContain(
      `\n\nÎnscrierile se deschid pe joi, 1 oct. 2026, 18:00 — ${register}\n\n`,
    );
    expect(at({ kind: "CLOSED" })).toContain("\n\nÎnscrierile s-au închis\n\n");
    expect(at({ kind: "EXTERNAL", url: "https://organizer.example.test/entries" })).toContain("\n\nÎnscriere pe site-ul organizatorului — https://organizer.example.test/entries\n\n");
    expect(at({ kind: "EXTERNAL", url: null })).toContain("\n\nÎnscriere pe site-ul organizatorului\n\n");
    expect(at(null)).not.toContain("Înscrieri");
    expect(at(undefined)).not.toContain("Înscrieri");
  });

  it("decides where registration stands from the window and the clock, like the page", () => {
    const register = "https://example.test/ro/evenimente/x/inscriere";
    const base = {
      registrationMode: "INTERNAL" as const,
      eventStatus: "SCHEDULED" as const,
      startsAt: new Date("2026-10-11T06:00:00.000Z"),
      registrationOpensAt: new Date("2026-10-01T15:00:00.000Z"),
      registrationClosesAt: null,
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      externalRegistrationUrl: null,
    };
    expect(calendarRegistration(base, register, new Date("2026-09-20T00:00:00.000Z"))).toEqual({ kind: "NOT_YET_OPEN", opensAt: base.registrationOpensAt, url: register });
    expect(calendarRegistration(base, register, new Date("2026-10-02T00:00:00.000Z"))).toEqual({ kind: "OPEN", url: register });
    expect(calendarRegistration(base, register, new Date("2026-10-11T07:00:00.000Z"))).toEqual({ kind: "CLOSED" });
    expect(calendarRegistration({ ...base, registrationMode: "EXTERNAL", externalRegistrationUrl: "https://o.example.test" }, register, new Date("2026-09-20T00:00:00.000Z"))).toEqual({
      kind: "EXTERNAL",
      url: "https://o.example.test",
    });
    expect(calendarRegistration({ ...base, registrationMode: "NONE" }, register, new Date("2026-09-20T00:00:00.000Z"))).toBeNull();
    expect(calendarRegistration({ ...base, eventStatus: "CANCELLED" }, register, new Date("2026-10-02T00:00:00.000Z"))).toBeNull();
    expect(calendarRegistration({ ...base, eventStatus: "COMPLETED" }, register, new Date("2026-10-12T00:00:00.000Z"))).toBeNull();
  });

  it("moves the stamp when the registration line does — the window's last boundary passed, or the row's own change (§159)", () => {
    const base = {
      registrationMode: "INTERNAL" as const,
      eventStatus: "SCHEDULED" as const,
      startsAt: new Date("2026-10-11T06:00:00.000Z"),
      registrationOpensAt: new Date("2026-10-01T15:00:00.000Z"),
      registrationClosesAt: null,
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-19T10:00:00.000Z"),
    };
    // Before the window opens: the row's change.
    expect(calendarStamp(base, new Date("2026-09-20T00:00:00.000Z"))).toEqual(base.updatedAt);
    // Once it has opened: the opening; once the event has started (the window closed with it): the start.
    expect(calendarStamp(base, new Date("2026-10-02T00:00:00.000Z"))).toEqual(base.registrationOpensAt);
    expect(calendarStamp(base, new Date("2026-10-11T07:00:00.000Z"))).toEqual(base.startsAt);
    // A later edit of the row wins over a boundary already passed.
    const edited = new Date("2026-10-05T00:00:00.000Z");
    expect(calendarStamp({ ...base, updatedAt: edited }, new Date("2026-10-06T00:00:00.000Z"))).toEqual(edited);
    // The opening falls back to publication like the window does; no window, no boundary.
    expect(calendarStamp({ ...base, registrationOpensAt: null }, new Date("2026-09-20T00:00:00.000Z"))).toEqual(base.updatedAt);
    expect(calendarStamp({ ...base, registrationOpensAt: null, updatedAt: new Date("2026-08-01T00:00:00.000Z") }, new Date("2026-09-20T00:00:00.000Z"))).toEqual(base.publishedAt);
    expect(calendarStamp({ ...base, registrationMode: "NONE" }, new Date("2026-10-12T00:00:00.000Z"))).toEqual(base.updatedAt);
    expect(calendarStamp({ ...base, updatedAt: null }, new Date("2026-09-20T00:00:00.000Z"))).toBeNull();
    // In the file: DTSTAMP and LAST-MODIFIED are the stamp.
    const ics = buildCalendar({ events: [{ ...event, updatedAt: base.registrationOpensAt }], baseUrl: "https://example.test", name: "x", labels: labelsRo });
    expect(ics).toContain("DTSTAMP:20261001T150000Z\r\nLAST-MODIFIED:20261001T150000Z");
  });

  it("marks a cancelled event as cancelled, and opens with the page's notice when it is cancelled or over (§159)", () => {
    const programme = [{ startsAt: new Date("2026-10-11T05:30:00.000Z"), endsAt: null, label: "Briefing", place: null }];
    const cancelled = buildCalendar({ events: [{ ...event, programme, eventStatus: "CANCELLED" }], baseUrl: "https://example.test", name: "x", labels: labelsRo });
    const unfolded = cancelled.replace(/\r\n /g, "");
    // The event's entry and the row's: both cancelled.
    expect(unfolded.match(/STATUS:CANCELLED/g)).toHaveLength(2);
    expect(unfolded).toContain("DTEND:20261011T090000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:");
    expect(unfolded).toContain("DESCRIPTION:Acest eveniment a fost anulat.\\n\\n📍 Parcul Tractorul");
    expect(calendarDescriptionHtml({ ...event, eventStatus: "CANCELLED" }, labelsEn)).toContain("<html><body><p>This event has been cancelled.</p><p>📍 ");
    expect(new URL(googleCalendarUrl({ ...event, eventStatus: "CANCELLED" }, labelsRo)).searchParams.get("details")?.startsWith("Acest eveniment a fost anulat.<br><br>")).toBe(true);
    // Finished: the notice, no STATUS — the entry stays a past event, not a struck-through one.
    const completed = buildCalendar({ events: [{ ...event, eventStatus: "COMPLETED" }], baseUrl: "https://example.test", name: "x", labels: labelsRo });
    expect(completed).not.toContain("STATUS:");
    expect(completed.replace(/\r\n /g, "")).toContain("DESCRIPTION:Evenimentul s-a încheiat. Mulțumim tuturor celor care au venit.\\n\\n📍 ");
    // Scheduled: neither.
    const scheduled = calendarDescription({ ...event, eventStatus: "SCHEDULED" }, labelsRo);
    expect(scheduled.startsWith("📍 ")).toBe(true);
  });

  it("writes the same description as HTML in X-ALT-DESC, links as links, escaped and folded like the rest (§159)", () => {
    const full: CalendarEvent = {
      ...event,
      title: "Crosul <aniversar> & co, ediția a 3-a",
      coHosts: [partner("A & B <sport>", "https://alpin.example.test/?a=1&b=2")],
      rulesJson: rules,
      registration: { kind: "OPEN", url: "https://example.test/ro/evenimente/crosul-aniversar/inscriere" },
    };
    const html = calendarDescriptionHtml(full, labelsRo);
    expect(html.startsWith("<html><body><p>")).toBe(true);
    expect(html.endsWith("</p></body></html>")).toBe(true);
    // Paragraphs where the plain text has blank lines, <br> where it has lines.
    expect(html).toContain("<p>Cursa clubului.<br>Vino devreme.</p>");
    expect(html).toContain('<p><a href="https://example.test/ro/evenimente/crosul-aniversar/inscriere">Înscrierile sunt deschise</a></p>');
    expect(html).toContain(
      '<p><a href="https://example.test/ro/evenimente/crosul-aniversar">Pagina evenimentului</a><br><a href="https://example.test/ro/evenimente/crosul-aniversar#rules">Regulament</a><br><a href="https://example.test/ro/evenimente/crosul-aniversar#schedule">Program</a></p>',
    );
    // Escaped for HTML: the co-host's name and the ampersand in its address.
    expect(html).toContain('<p><a href="https://alpin.example.test/?a=1&amp;b=2">Împreună cu A &amp; B &lt;sport&gt;</a></p>');
    expect(html).not.toContain("<sport>");
    // In the file: one property, escaped as TEXT (the commas, the semicolons), folded under 75 octets.
    const ics = buildCalendar({ events: [full], baseUrl: "https://example.test", name: "x", labels: labelsRo });
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8"), line).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("X-ALT-DESC;FMTTYPE=text/html:<html><body><p>📍 Parcul Tractorul\\, intrarea principală</p><p>Cursa clubului.<br>Vino devreme.</p>");
    expect(unfolded).toContain("07:00 ridicarea numerelor\\, 09:00 start</p>");
    expect(unfolded.match(/X-ALT-DESC/g)).toHaveLength(1);
    expect(unfolded).toContain("SUMMARY:Crosul <aniversar> & co\\, ediția a 3-a");
    // Google's dialog renders `details` as HTML: the same lines, escaped, the words as the links.
    const details = new URL(googleCalendarUrl(full, labelsRo)).searchParams.get("details") ?? "";
    expect(details).toBe(googleCalendarDetails(full, labelsRo));
    expect(details).toContain('<a href="https://alpin.example.test/?a=1&amp;b=2">Împreună cu A &amp; B &lt;sport&gt;</a>');
    expect(details).toContain("Cursa clubului.<br>Vino devreme.<br><br>");
    expect(details).not.toContain("<p>");
    expect(details).not.toContain("<sport>");
  });

  it("keeps Google's add-event link within a budget: the text cut at a word, the page's link last (§159)", () => {
    const programme = paragraphs(Array.from({ length: 30 }, (_, i) => `Ora ${i + 7}:00 — încălzire în Parcul Tractorul, apoi alergăm ușor până la Șchei și înapoi, cu opriri la fiecare țâșnitoare.`));
    const long: CalendarEvent = { ...full, scheduleJson: programme, checklist: "număr de concurs, apă, jachetă", coHosts: [partner("Clubul Alpin", null)] };
    // The file keeps the whole text.
    expect(calendarDescription(long, labelsRo)).toContain("Ora 36:00");
    expect(calendarDescription(long, labelsRo).length).toBeGreaterThan(3000);
    // The link does not.
    const url = googleCalendarUrl(long, labelsRo);
    expect(url.length).toBeLessThanOrEqual(4000);
    const details = new URL(url).searchParams.get("details") ?? "";
    expect(details).not.toContain("Ora 36:00");
    expect(details.endsWith("…")).toBe(true);
    // Nothing before the programme's text is lost: the place, the facts, the door, the links — the page's once.
    expect(details).toContain("Înscrierile sunt deschise");
    expect(details).toContain('<a href="https://www.facebook.com/events/3">');
    expect(details).toContain("Programul evenimentului:<br>Ora 7:00");
    expect(details.match(/Pagina evenimentului/g)).toHaveLength(1);
    // When the cut falls before the links, the page's link is written last, so the reader can still get there.
    const wordy = new URL(googleCalendarUrl({ ...full, excerpt: "Vino devreme. ".repeat(200) }, labelsRo)).searchParams.get("details") ?? "";
    expect(wordy).toMatch(/Vino devreme\. Vino(?: devreme\.)?…<br><br>/);
    expect(wordy.endsWith('…<br><br><a href="https://example.test/ro/evenimente/crosul-aniversar">Pagina evenimentului</a>')).toBe(true);
    expect(wordy).not.toContain("Înscrierile");
    // Under the budget the link says the whole description; the page's link is not written twice.
    const short = new URL(googleCalendarUrl(full, labelsRo)).searchParams.get("details") ?? "";
    expect(short.match(/Pagina evenimentului/g)).toHaveLength(1);
    expect(short).not.toContain("…");
    expect(short.endsWith('<a href="https://alpin.example.test">Împreună cu Clubul Alpin</a>')).toBe(true);
  });

  /**
   * §174 — the QA calendar says it is QA. The UIDs already differ per deployment, so two copies
   * never merge; what they do is sit side by side under the same name at the same hour, and the
   * club's own people subscribe to both while rehearsing.
   */
  it("marks the calendar and every entry on QA, and leaves production alone", async () => {
    const build = () =>
      buildCalendar({ events: [event], baseUrl: "https://example.test", name: "BVR", labels: labelsRo });

    // The module reads `env.APP_ENV` at call time, so the environment is set around a fresh
    // import rather than mutated behind the module's back.
    const previous = process.env.APP_ENV;
    try {
      expect(build()).toContain("X-WR-CALNAME:BVR");
      expect(build()).not.toContain("[QA]");

      process.env.APP_ENV = "qa";
      vi.resetModules();
      const qa = await import("@/modules/events/ical");
      const marked = qa.buildCalendar({ events: [event], baseUrl: "https://example.test", name: "BVR", labels: labelsRo });
      expect(marked).toContain("X-WR-CALNAME:[QA] BVR");
      // And on the entry itself: a single event added from an attachment lands in a calendar
      // that already has a name, and the only thing on screen is its title.
      expect(marked).toContain("SUMMARY:[QA] ");
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
      vi.resetModules();
    }
  });

  it("builds Google's add-event address and the webcal scheme", () => {
    const url = new URL(googleCalendarUrl(event, labelsRo));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("dates")).toBe("20261011T060000Z/20261011T090000Z");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("location")).toBe(event.locationName);
    expect(webcalUrl("https://example.test/ro/events/calendar.ics")).toBe("webcal://example.test/ro/events/calendar.ics");
  });
});
