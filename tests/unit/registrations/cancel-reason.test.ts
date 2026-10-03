import { describe, expect, it } from "vitest";
import { registrationCancelReasonKind } from "@/db/schema/registrations";
import { buildRegistrationsCsv, type RegistrationCsvRow } from "@/modules/registrations/csv";
import { CANCEL_REASON_KINDS, cancelReasonCell, cancelReasonProblemOf } from "@/modules/registrations/domain/cancel-reason";
import { REGISTRATION_SHEET_HEADERS } from "@/modules/registrations/workbook";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §558 — the participant's reason for cancelling: the form's three answers are the column's enum,
 * in both languages on the page and the backoffice, and the export's column after the family says it
 * (last until the offers and benefits, §562, came after it).
 */
describe("§558 the cancellation reason", () => {
  it("the form's three answers are the column's enum values, in order", () => {
    expect([...CANCEL_REASON_KINDS]).toEqual(registrationCancelReasonKind.enumValues);
  });

  it("every answer has its words in both languages, on the page and in the backoffice", () => {
    for (const catalogue of [ro, en]) {
      for (const kind of CANCEL_REASON_KINDS) {
        expect(catalogue.Registrations.cancelReason.kinds[kind]).toBeTruthy();
        expect(catalogue.Admin.registrations.cancelReasonKinds[kind]).toBe(catalogue.Registrations.cancelReason.kinds[kind]);
      }
    }
    expect(ro.Registrations.cancelReason.kinds).toEqual({ INJURY_OR_ILLNESS: "Accidentare sau boală", OTHER_PLANS: "Alt program", OTHER: "Alt motiv" });
  });

  it("reads back only a problem it knows from the address", () => {
    expect(cancelReasonProblemOf("kind")).toBe("kind");
    expect(cancelReasonProblemOf("long")).toBe("long");
    expect(cancelReasonProblemOf("<script>")).toBeUndefined();
    expect(cancelReasonProblemOf(undefined)).toBeUndefined();
  });

  it("the export's «Cancellation reason» column, just before the offers and benefits, the answer and the words of «Another reason»", () => {
    expect(cancelReasonCell(null, null)).toBe("");
    expect(cancelReasonCell("INJURY_OR_ILLNESS", null)).toBe("Injury or illness");
    expect(cancelReasonCell("OTHER_PLANS", "ignored")).toBe("Other plans");
    expect(cancelReasonCell("OTHER", "Nunta fratelui")).toBe("Another reason: Nunta fratelui");

    const row: RegistrationCsvRow = {
      eventTitle: "Crosul",
      registeredName: "Ana Pop",
      firstName: "Ana",
      lastName: "Pop",
      idDocument: "",
      email: "ana@example.ro",
      status: "CANCELLED",
      clubMemberDeclared: false,
      fitnessDeclaredAt: null,
      stravaUrl: "",
      instagramHandle: "",
      guardianName: "",
      guardianIdDocument: "",
      submittedAt: "2026-09-29T10:00:00.000Z",
      confirmedAt: "",
      checkedInAt: "",
      emailBounced: false,
      cancelReason: cancelReasonCell("OTHER", "=cmd, nunta"),
    };
    const [header, line] = buildRegistrationsCsv([row]).split("\r\n");
    // Followed only by the offers and benefits (§562), which came after it.
    expect(header.split(",").slice(-4, -2)).toEqual(["Cancellation reason", "Offers and benefits"]);
    // A reason is typed on a public form: neutralized and quoted like every other cell — then the offers' cell, empty here.
    expect(line.endsWith(',"Another reason: =cmd, nunta",,,')).toBe(true);
    expect(REGISTRATION_SHEET_HEADERS.slice(-4, -2)).toEqual(["Cancellation reason", "Offers and benefits"]);
  });
});
