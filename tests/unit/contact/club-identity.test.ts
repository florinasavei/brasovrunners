import { describe, expect, it } from "vitest";
import {
  CLUB_IDENTITY_PLACES,
  CLUB_IDENTITY_SEAT_MAX,
  clubIdentityShownSchema,
  DEFAULT_CLUB_IDENTITY_SHOWN,
  showsAt,
} from "@/modules/contact/domain/club-identity";

/**
 * §890 — «Ce arată site-ul despre asociație»: for each line (the name and CIF, the seat, the email)
 * the places it is ticked for, and the seat as the club typed it. Nothing stored is the name and the
 * CIF everywhere, as before, and the seat and the email nowhere: the owner would not have his seat
 * forced onto the home page. The address here is made up.
 */
describe("§890 what the site shows about the association", () => {
  it("defaults to the name and the CIF in all four places, the seat and the email in none, and no seat typed", () => {
    expect(DEFAULT_CLUB_IDENTITY_SHOWN).toEqual({ name: ["home", "contact", "pages", "footer"], seat: [], email: [], seatAddress: null });
    for (const place of CLUB_IDENTITY_PLACES) {
      expect(showsAt(DEFAULT_CLUB_IDENTITY_SHOWN, "name", place), place).toBe(true);
      expect(showsAt(DEFAULT_CLUB_IDENTITY_SHOWN, "seat", place), place).toBe(false);
      expect(showsAt(DEFAULT_CLUB_IDENTITY_SHOWN, "email", place), place).toBe(false);
    }
  });

  it("keeps each ticked place once, in the grid's order", () => {
    expect(clubIdentityShownSchema.parse({ name: ["footer", "home", "home"], seat: ["contact"], email: [] })).toEqual({
      name: ["home", "footer"],
      seat: ["contact"],
      email: [],
      seatAddress: null,
    });
  });

  it("keeps the seat as typed, trimmed, its inner spaces made one; an empty box is no seat", () => {
    const ticks = { name: [], seat: ["home"], email: [] };
    expect(clubIdentityShownSchema.parse({ ...ticks, seatAddress: "  Strada Exemplu  1, Localitate " }).seatAddress).toBe("Strada Exemplu 1, Localitate");
    expect(clubIdentityShownSchema.parse({ ...ticks, seatAddress: "   " }).seatAddress).toBeNull();
    expect(clubIdentityShownSchema.parse({ ...ticks, seatAddress: null }).seatAddress).toBeNull();
    expect(clubIdentityShownSchema.safeParse({ ...ticks, seatAddress: "x".repeat(CLUB_IDENTITY_SEAT_MAX + 1) }).success).toBe(false);
  });

  it("refuses a place it does not know, a missing line and an extra key", () => {
    expect(clubIdentityShownSchema.safeParse({ name: ["everywhere"], seat: [], email: [] }).success).toBe(false);
    expect(clubIdentityShownSchema.safeParse({ name: [], seat: [] }).success).toBe(false);
    expect(clubIdentityShownSchema.safeParse({ name: [], seat: [], email: [], phone: [] }).success).toBe(false);
  });
});
