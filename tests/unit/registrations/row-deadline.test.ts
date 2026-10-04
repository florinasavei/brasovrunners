import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { buildRegistrationsCsv } from "@/modules/registrations/csv";
import {
  deadlineHoldsAPlace,
  deadlinePassed,
  ROW_DEADLINE_EXPORT_WORDS,
  rowDeadlineOf,
  type RowDeadlineInput,
} from "@/modules/registrations/domain/row-deadline";
import { REGISTRATION_SHEET_HEADERS } from "@/modules/registrations/workbook";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §650 — «Vreau să văd exact pe fiecare candidat până când poate semna declarația» (the owner,
 * 2026-10-03): the registrations list's «Până când» column says, on every live row, the moment it waits on
 * — the declaration's, the offer's, a family's reservation or the email's link — read from the row by
 * one helper that the column, its sort, the export and the registration's timeline share.
 */
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => locale,
}));

const { default: RowDeadlineCell } = await import("@/modules/registrations/ui/RowDeadlineCell");

const NOW = new Date("2026-10-03T09:00:00.000Z");
const AHEAD = new Date("2026-11-19T08:00:00.000Z");
const PAST = new Date("2026-10-02T18:00:00.000Z");
const LINK = new Date("2026-10-04T16:42:00.000Z");

const input = (overrides: Partial<RowDeadlineInput>): RowDeadlineInput => ({ status: "PENDING_DECLARATION", holdExpiresAt: null, emailLinkExpiresAt: null, ...overrides });

/** The text a person reads: Emotion's style blocks and the tags gone, entities back. */
function text(html: string): string {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<\/span>/g, "</span>\n").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim();
}

async function cell(row: RowDeadlineInput): Promise<string> {
  return renderToStaticMarkup(await RowDeadlineCell({ deadline: rowDeadlineOf(row, NOW) }));
}

// Inside the sentence with the hour's «la» (§452); at its start, capitalised.
const inline = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });

beforeEach(() => {
  locale = "ro";
});

describe("§650 rowDeadlineOf: the one moment a live row waits on", () => {
  it("a place held for the declaration, before and past its deadline (§160)", () => {
    expect(rowDeadlineOf(input({ holdExpiresAt: AHEAD }), NOW)).toEqual({ kind: "hold", at: AHEAD });
    expect(rowDeadlineOf(input({ holdExpiresAt: PAST }), NOW)).toEqual({ kind: "kept", at: PAST });
    // The deadline's own instant has passed: the comparison is the sweep's (`<=`).
    expect(rowDeadlineOf(input({ holdExpiresAt: NOW }), NOW)?.kind).toBe("kept");
  });

  it("a waiting-list offer, open and lapsed", () => {
    expect(rowDeadlineOf(input({ status: "WAITLIST_OFFERED", holdExpiresAt: AHEAD }), NOW)).toEqual({ kind: "offer", at: AHEAD });
    expect(rowDeadlineOf(input({ status: "WAITLIST_OFFERED", holdExpiresAt: PAST }), NOW)).toEqual({ kind: "offerLapsed", at: PAST });
  });

  it("an offer whose first email is still queued has not lapsed, whatever its stored deadline says (§520)", () => {
    expect(rowDeadlineOf(input({ status: "WAITLIST_OFFERED", holdExpiresAt: PAST, offerEmailQueued: true }), NOW)).toEqual({ kind: "offer", at: PAST });
    expect(deadlineHoldsAPlace(rowDeadlineOf(input({ status: "WAITLIST_OFFERED", holdExpiresAt: PAST, offerEmailQueued: true }), NOW))).toBe(true);
    // The queue says nothing of any other state.
    expect(rowDeadlineOf(input({ holdExpiresAt: PAST, offerEmailQueued: true }), NOW)?.kind).toBe("kept");
  });

  it("a row waiting for its address: a family's reservation while it holds (§543), else the email's link", () => {
    const waiting = { status: "PENDING_EMAIL_CONFIRMATION" as const, emailLinkExpiresAt: LINK };
    expect(rowDeadlineOf(input({ ...waiting, holdExpiresAt: AHEAD }), NOW)).toEqual({ kind: "reserved", at: AHEAD });
    expect(rowDeadlineOf(input({ ...waiting, holdExpiresAt: PAST }), NOW)).toEqual({ kind: "link", at: LINK });
    expect(rowDeadlineOf(input({ ...waiting, emailLinkExpiresAt: PAST }), NOW)).toEqual({ kind: "linkLapsed", at: PAST });
    // A row written before the link's column (§377): nothing rather than a wrong date.
    expect(rowDeadlineOf(input({ status: "PENDING_EMAIL_CONFIRMATION" }), NOW)).toBeNull();
  });

  it("every other state waits on none — whatever date its row still carries", () => {
    for (const status of ["WAITLISTED", "CONFIRMED", "CANCELLED", "EXPIRED"] as const) {
      expect(rowDeadlineOf(input({ status, holdExpiresAt: AHEAD, emailLinkExpiresAt: LINK }), NOW), status).toBeNull();
    }
    expect(rowDeadlineOf(input({}), NOW)).toBeNull();
  });

  it("says whether it is a place's, and whether it has passed", () => {
    expect(deadlineHoldsAPlace(rowDeadlineOf(input({ holdExpiresAt: PAST }), NOW))).toBe(true);
    expect(deadlineHoldsAPlace(rowDeadlineOf(input({ status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: LINK }), NOW))).toBe(false);
    expect(deadlineHoldsAPlace(null)).toBe(false);
    // A lapsed offer holds nothing any more (`countOccupied`): the timeline does not say «Ține locul».
    expect(deadlineHoldsAPlace(rowDeadlineOf(input({ status: "WAITLIST_OFFERED", holdExpiresAt: PAST }), NOW))).toBe(false);
    expect(deadlinePassed(rowDeadlineOf(input({ holdExpiresAt: PAST }), NOW))).toBe(true);
    expect(deadlinePassed(rowDeadlineOf(input({ holdExpiresAt: AHEAD }), NOW))).toBe(false);
  });
});

describe("§650 the «Până când» cell", () => {
  it("one sentence with the exact moment: until when the person can sign, accept or confirm", async () => {
    expect(text(await cell(input({ holdExpiresAt: AHEAD })))).toBe(`Poate semna până ${inline(AHEAD)}`);
    expect(text(await cell(input({ status: "WAITLIST_OFFERED", holdExpiresAt: AHEAD })))).toBe(`Poate accepta până ${inline(AHEAD)}`);
    expect(text(await cell(input({ status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: AHEAD, emailLinkExpiresAt: LINK })))).toBe(
      `Locul e rezervat până ${inline(AHEAD)}`,
    );
    expect(text(await cell(input({ status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: LINK })))).toBe(`Linkul e valabil până ${inline(LINK)}`);
    // No «până la» before a date with its hour (§452): the hour says its own «la».
    expect(inline(AHEAD)).toMatch(/, la \d\d:\d\d$/);
  });

  it("a passed deadline starts with its moment, then what it means (§160)", async () => {
    expect(text(await cell(input({ holdExpiresAt: PAST })))).toBe(`${day(PAST)} — termenul a trecut, locul e păstrat`);
    expect(text(await cell(input({ status: "WAITLIST_OFFERED", holdExpiresAt: PAST })))).toBe(`${day(PAST)} — termenul ofertei a trecut`);
    expect(text(await cell(input({ status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: PAST })))).toBe(`${day(PAST)} — linkul a expirat`);
  });

  it("an offer whose email is still queued reads as open, not lapsed (§520)", async () => {
    expect(text(await cell(input({ status: "WAITLIST_OFFERED", holdExpiresAt: PAST, offerEmailQueued: true })))).toBe(`Poate accepta până ${inline(PAST)}`);
  });

  it("«—» on a row that waits on nothing, and a handle for each kind", async () => {
    expect(text(await cell(input({ status: "CONFIRMED" })))).toBe("—");
    expect(await cell(input({ holdExpiresAt: AHEAD }))).toContain('data-deadline-kind="hold"');
  });

  it("in English", async () => {
    locale = "en";
    expect(text(await cell(input({ holdExpiresAt: AHEAD })))).toBe(`Can sign until ${inline(AHEAD)}`);
    expect(text(await cell(input({ holdExpiresAt: PAST })))).toBe(`${day(PAST)} — the deadline has passed, the place is kept`);
    expect(text(await cell(input({ status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: LINK })))).toBe(`The link is valid until ${inline(LINK)}`);
  });

  it("every word in both catalogues, each under 200 characters (§511); the hint names the timeline", () => {
    const kinds = ["hold", "kept", "offer", "offerLapsed", "reserved", "link", "linkLapsed"];
    for (const catalogue of [ro, en]) {
      const words = catalogue.Admin.registrations;
      expect(Object.keys(words.untilWhen).sort()).toEqual([...kinds].sort());
      for (const value of [words.columnUntilWhen, words.untilWhenHint, ...Object.values(words.untilWhen)]) {
        expect(value.length).toBeLessThan(200);
      }
      for (const value of Object.values(words.untilWhen)) expect(value).toContain("{instant}");
    }
    expect(ro.Admin.registrations.columnUntilWhen).toBe("Până când");
    expect(en.Admin.registrations.columnUntilWhen).toBe("Until when");
    expect(ro.Admin.registrations.untilWhenHint).toContain("cronologia înscrierii");
    expect(en.Admin.registrations.untilWhenHint).toContain("timeline");
    expect(Object.keys(ROW_DEADLINE_EXPORT_WORDS).sort()).toEqual([...kinds].sort());
  });
});

describe("§650 the export carries the moment and what it is for", () => {
  const base = {
    eventTitle: "Test",
    registeredName: "Ana",
    firstName: "Ana",
    lastName: "Pop",
    idDocument: "",
    email: "ana@example.ro",
    status: "PENDING_DECLARATION",
    clubMemberDeclared: false,
    fitnessDeclaredAt: null,
    stravaUrl: "",
    instagramHandle: "",
    guardianName: "",
    guardianIdDocument: "",
    submittedAt: "2026-09-04T10:00:00.000Z",
    confirmedAt: "",
    checkedInAt: "",
    emailBounced: false,
  };

  // Before the age, the country and the city, which came last with §NNN.
  it("the CSV, last: the moment in ISO 8601 and the kind's token, or two empty cells", () => {
    const [header, held, none] = buildRegistrationsCsv([{ ...base, deadline: AHEAD.toISOString(), deadlineFor: "hold" }, base]).split("\r\n");
    expect(header.split(",").slice(-5, -3)).toEqual(["Until when", "Waiting on"]);
    expect(held.split(",").slice(-5, -3)).toEqual([AHEAD.toISOString(), "hold"]);
    expect(none.split(",").slice(-5, -3)).toEqual(["", ""]);
  });

  it("the spreadsheet: «Until when» and «Waiting on» right after «Status», as on the list", () => {
    const status = REGISTRATION_SHEET_HEADERS.indexOf("Status");
    expect(REGISTRATION_SHEET_HEADERS.slice(status, status + 3)).toEqual(["Status", "Until when", "Waiting on"]);
  });
});
