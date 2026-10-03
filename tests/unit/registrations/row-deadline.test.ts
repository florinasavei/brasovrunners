import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { buildRegistrationsCsv } from "@/modules/registrations/csv";
import { deadlineHoldsAPlace, deadlinePassed, rowDeadlineOf, type RowDeadlineInput } from "@/modules/registrations/domain/row-deadline";
import { REGISTRATION_SHEET_HEADERS } from "@/modules/registrations/workbook";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — «Vreau să văd exact pe fiecare candidat până când poate semna declarația» (the owner,
 * 2026-10-03): the registrations list's «Termen» column says, on every live row, the moment it waits on
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

const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });

beforeEach(() => {
  locale = "ro";
});

describe("§NNN rowDeadlineOf: the one moment a live row waits on", () => {
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
    expect(deadlinePassed(rowDeadlineOf(input({ holdExpiresAt: PAST }), NOW))).toBe(true);
    expect(deadlinePassed(rowDeadlineOf(input({ holdExpiresAt: AHEAD }), NOW))).toBe(false);
  });
});

describe("§NNN the «Termen» cell", () => {
  it("the day and the time, then what it is the deadline of", async () => {
    expect(text(await cell(input({ holdExpiresAt: AHEAD })))).toBe(`${day(AHEAD)}\nare de semnat declarația`);
    expect(text(await cell(input({ status: "WAITLIST_OFFERED", holdExpiresAt: AHEAD })))).toBe(`${day(AHEAD)}\nloc oferit: are de semnat declarația`);
    expect(text(await cell(input({ status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: AHEAD, emailLinkExpiresAt: LINK })))).toBe(
      `${day(AHEAD)}\nloc rezervat: are de confirmat adresa`,
    );
    expect(text(await cell(input({ status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: LINK })))).toBe(`${day(LINK)}\nare de confirmat adresa din email`);
  });

  it("a passed deadline keeps its date, with what it means (§160)", async () => {
    expect(text(await cell(input({ holdExpiresAt: PAST })))).toBe(`${day(PAST)}\ntermen depășit, locul se ține cât nu-l cere nimeni`);
    expect(text(await cell(input({ status: "WAITLIST_OFFERED", holdExpiresAt: PAST })))).toBe(`${day(PAST)}\noferta a expirat`);
    expect(text(await cell(input({ status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: PAST })))).toBe(`${day(PAST)}\nlinkul a expirat`);
    // The kept words are the journey's, word for word (§635).
    expect(ro.Admin.registrations.deadline.kept).toBe(ro.Admin.registrations.journey.heldKept);
    expect(en.Admin.registrations.deadline.kept).toBe(en.Admin.registrations.journey.heldKept);
  });

  it("«—» on a row that waits on nothing, and a handle for each kind", async () => {
    expect(text(await cell(input({ status: "CONFIRMED" })))).toBe("—");
    expect(await cell(input({ holdExpiresAt: AHEAD }))).toContain('data-deadline-kind="hold"');
  });

  it("in English", async () => {
    locale = "en";
    expect(text(await cell(input({ holdExpiresAt: AHEAD })))).toBe(`${day(AHEAD)}\nto sign the declaration`);
    expect(text(await cell(input({ holdExpiresAt: PAST })))).toBe(`${day(PAST)}\ndeadline passed, the place is kept while nobody asks for it`);
  });

  it("every word in both catalogues, each under 200 characters (§511)", () => {
    const kinds = ["hold", "kept", "offer", "offerLapsed", "reserved", "link", "linkLapsed"];
    for (const catalogue of [ro, en]) {
      const words = catalogue.Admin.registrations;
      expect(Object.keys(words.deadline).sort()).toEqual([...kinds].sort());
      for (const value of [words.columnDeadline, words.deadlineColumnHint, ...Object.values(words.deadline)]) {
        expect(value.length).toBeLessThan(200);
      }
    }
  });
});

describe("§NNN the export carries the deadline, last", () => {
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

  it("the CSV: the moment in ISO 8601, or an empty cell", () => {
    const [header, held, none] = buildRegistrationsCsv([{ ...base, deadline: AHEAD.toISOString() }, base]).split("\r\n");
    expect(header.split(",").at(-1)).toBe("Deadline");
    expect(held.split(",").at(-1)).toBe(AHEAD.toISOString());
    expect(none.split(",").at(-1)).toBe("");
  });

  it("the spreadsheet: a «Deadline» column, last", () => {
    expect(REGISTRATION_SHEET_HEADERS.at(-1)).toBe("Deadline");
  });
});
