import { describe, expect, it } from "vitest";
import { bibDesignFromQuery, readBibDesign } from "@/modules/registrations/bib-design";
import { bibDesignSearchParams, readBibDesignForm } from "@/modules/registrations/bib-design-query";
import { qrIdentity } from "@/modules/registrations/domain/qr-identity";
import {
  formatRaceNumber,
  raceNumberTextOf,
  raceNumberWidth,
  readRaceNumberFormat,
} from "@/modules/registrations/domain/race-number";

/**
 * BR-REQ-038-01, `DECISIONS.md` §NNN — «Cum arată numărul»: the bib designer's choice of leading
 * zeros, and the one formatter the bib, the emails, the pages and the desk write a number with.
 */
describe("§NNN how a race number is written", () => {
  it("pads to three or four digits, never cuts a longer number, and writes it as it is by default", () => {
    expect(formatRaceNumber(7, "plain")).toBe("7");
    expect(formatRaceNumber(7, "pad3")).toBe("007");
    expect(formatRaceNumber(42, "pad3")).toBe("042");
    expect(formatRaceNumber(150, "pad3")).toBe("150");
    expect(formatRaceNumber(1234, "pad3")).toBe("1234");
    expect(formatRaceNumber(7, "pad4")).toBe("0007");
    expect(formatRaceNumber(7, null)).toBe("7");
    expect(formatRaceNumber(7, undefined)).toBe("7");
    expect(raceNumberWidth("pad3")).toBe(3);
    expect(raceNumberWidth("plain")).toBe(0);
  });

  it("reads anything it does not know as plain, never a throw", () => {
    expect(readRaceNumberFormat("pad3")).toBe("pad3");
    expect(readRaceNumberFormat("pad4")).toBe("pad4");
    for (const value of [null, undefined, "", "pad5", 3, {}]) expect(readRaceNumberFormat(value), String(value)).toBe("plain");
  });

  it("is a bib design setting: absent in an old design it reads plain, and the form and the preview carry it", () => {
    expect(readBibDesign({}).numberFormat).toBe("plain");
    expect(readBibDesign({ numberScale: "large" }).numberFormat).toBe("plain");
    expect(readBibDesign({ numberFormat: "pad3" }).numberFormat).toBe("pad3");
    expect(readBibDesign({ numberFormat: "nonsense" }).numberFormat).toBe("plain");

    const posted = new Map([["event.bibDesign.numberFormat", "pad3"]]);
    const values = readBibDesignForm((name) => posted.get(name) ?? null);
    expect(values.numberFormat).toBe("pad3");
    expect(bibDesignFromQuery(bibDesignSearchParams(values)).numberFormat).toBe("pad3");
    // A form that posts nothing for it keeps today's numbers.
    expect(readBibDesignForm(() => null).numberFormat).toBe("plain");
  });

  it("writes the number a row shows with its event's choice, and nothing before the confirmation", () => {
    expect(raceNumberTextOf({ status: "CONFIRMED", bibNumber: 7, raceNumberFormat: "pad3" })).toBe("007");
    expect(raceNumberTextOf({ status: "CANCELLED", bibNumber: 7, raceNumberFormat: "pad3" })).toBe("007");
    expect(raceNumberTextOf({ status: "PENDING_DECLARATION", bibNumber: 7, raceNumberFormat: "pad3" })).toBeNull();
    expect(raceNumberTextOf({ status: "CONFIRMED", bibNumber: 7 })).toBe("7");
  });

  it("puts the same written number beside the QR on the pages and in the email", () => {
    expect(qrIdentity({ registeredName: "Ana", status: "CONFIRMED", bibNumber: 7, raceNumberFormat: "pad3" }).number).toBe("007");
    expect(qrIdentity({ registeredName: "Ana", status: "CONFIRMED", bibNumber: 7 }).number).toBe("7");
    expect(qrIdentity({ registeredName: "Ana", status: "WAITLISTED", bibNumber: null, raceNumberFormat: "pad3" }).number).toBe("—");
  });
});
