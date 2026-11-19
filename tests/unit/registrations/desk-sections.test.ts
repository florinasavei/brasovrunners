import { describe, expect, it } from "vitest";
import type { RegistrationKind, RegistrationStatus } from "@/db/schema/registrations";
import { DESK_SECTION_KEYS, type DeskSectionKey, deskSectionOf, deskSections, returnedRowOf } from "@/modules/registrations/domain/desk-sections";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { opensByItself } from "@/shared/ui/fold";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-037-08, `DECISIONS.md` §NNN — the desk's list in folding sections, one per state (the owner, 2026-11-19: «Pe ziua
 * cursei trebuie să fac secțiuni collapsible în funcție de status»): the table's working order, each section's rows in the list's
 * own order, the empty ones left out, which open by themselves and why, the count of the real rows only (§30), and the words of
 * every section in both catalogues.
 */
type Row = { id: string; status: RegistrationStatus; checkedInAt: Date | null; kind: RegistrationKind };

let serial = 0;
const row = (status: RegistrationStatus, over: Partial<Row> = {}): Row => {
  serial += 1;
  return { id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`, status, checkedInAt: null, kind: "REAL", ...over };
};
const HERE = new Date("2026-11-21T07:30:00.000Z");

/** The sections as `[key, ids, count, open]`, the way the page draws them. */
const drawn = (rows: readonly Row[], options: Parameters<typeof deskSections>[1]) =>
  deskSections(rows, options).map((section) => [section.key, section.rows.map((one) => one.id), section.count, opensByItself(section.openWhen)] as const);

describe("§NNN BR-REQ-037-08 the desk's sections", () => {
  it("place every state in its section — confirmed by whether the person is here, a row that is over by its state alone", () => {
    const cases: Array<[RegistrationStatus, Date | null, DeskSectionKey]> = [
      ["CONFIRMED", null, "toPickUp"],
      ["CONFIRMED", HERE, "checkedIn"],
      ["PENDING_DECLARATION", null, "unsigned"],
      ["PENDING_EMAIL_CONFIRMATION", null, "addressUnconfirmed"],
      ["WAITLIST_OFFERED", null, "offered"],
      ["WAITLISTED", null, "waitlisted"],
      ["CANCELLED", null, "voided"],
      ["EXPIRED", null, "voided"],
      // A check-in kept on a row cancelled afterwards: over is over, never «Prezenți».
      ["CANCELLED", HERE, "voided"],
    ];
    for (const [status, checkedInAt, key] of cases) expect(deskSectionOf({ status, checkedInAt }), `${status} ${checkedInAt ? "here" : ""}`).toBe(key);
  });

  it("stand in the table's working order, the empty ones not drawn, the rows of each in the list's own order", () => {
    // The list's order is by name: the rows arrive interleaved, as `listDeskRegistrations` reads them.
    const ana = row("WAITLISTED");
    const bogdan = row("CONFIRMED");
    const cristina = row("PENDING_DECLARATION");
    const dan = row("CONFIRMED", { checkedInAt: HERE });
    const elena = row("CONFIRMED");
    const florin = row("PENDING_EMAIL_CONFIRMATION");
    const gina = row("WAITLIST_OFFERED");
    const horia = row("WAITLISTED");
    const rows = [ana, bogdan, cristina, dan, elena, florin, gina, horia];
    expect(drawn(rows, { searching: false })).toEqual([
      ["toPickUp", [bogdan.id, elena.id], 2, true],
      ["unsigned", [cristina.id], 1, true],
      ["checkedIn", [dan.id], 1, false],
      ["addressUnconfirmed", [florin.id], 1, false],
      ["offered", [gina.id], 1, false],
      ["waitlisted", [ana.id, horia.id], 2, false],
    ]);
    // Only what holds somebody: no «Fără declarație semnată» without a row to confirm on paper, nothing at all for no rows.
    expect(drawn([bogdan, dan], { searching: false }).map(([key]) => key)).toEqual(["toPickUp", "checkedIn"]);
    expect(deskSections([], { searching: false })).toEqual([]);
    // The order is the table's whatever the rows: the seven keys, in it.
    expect([...DESK_SECTION_KEYS]).toEqual(["toPickUp", "unsigned", "checkedIn", "addressUnconfirmed", "offered", "waitlisted", "voided"]);
  });

  it("open by themselves for the reasons the house names (§336): the desk's work, a declaration to sign, a void bib to pull", () => {
    const rows = [row("CONFIRMED"), row("PENDING_DECLARATION"), row("CONFIRMED", { checkedInAt: HERE }), row("PENDING_EMAIL_CONFIRMATION"), row("WAITLIST_OFFERED"), row("WAITLISTED"), row("CANCELLED")];
    const why = Object.fromEntries(deskSections(rows, { searching: false }).map((section) => [section.key, section.openWhen]));
    expect(why).toEqual({
      toPickUp: { primary: true },
      unsigned: { attention: true },
      checkedIn: {},
      addressUnconfirmed: {},
      offered: {},
      waitlisted: {},
      voided: { attention: true },
    });
  });

  it("open every section a search found somebody in — and only those are drawn", () => {
    // A name fragment that found a waiting runner and a confirmed one: two sections, both open.
    const waiting = row("WAITLISTED");
    const here = row("CONFIRMED", { checkedInAt: HERE });
    expect(drawn([here, waiting], { searching: true })).toEqual([
      ["checkedIn", [here.id], 1, true],
      ["waitlisted", [waiting.id], 1, true],
    ]);
    // A number that found a cancelled runner (criterion 8): «Anulate sau expirate», open.
    const voided = row("EXPIRED");
    expect(drawn([voided], { searching: true })).toEqual([["voided", [voided.id], 1, true]]);
    expect(deskSections([voided], { searching: true })[0].openWhen).toEqual({ attention: true, inUse: true });
  });

  it("open the section that now holds the row a press came back with — saved, or refused — and no other", () => {
    const ana = row("CONFIRMED", { checkedInAt: HERE });
    const bogdan = row("CONFIRMED");
    const cristina = row("WAITLISTED");
    // Checked in: the row stands in «Prezenți» now, which opens; the waiting list stays shut.
    expect(drawn([ana, bogdan, cristina], { searching: false, returned: { id: ana.id, refused: false } })).toEqual([
      ["toPickUp", [bogdan.id], 1, true],
      ["checkedIn", [ana.id], 1, true],
      ["waitlisted", [cristina.id], 1, false],
    ]);
    expect(deskSections([ana], { searching: false, returned: { id: ana.id, refused: false } })[0].openWhen).toEqual({ saved: true });
    // A refused press opens the row's section too, under its own reason.
    expect(deskSections([cristina], { searching: false, returned: { id: cristina.id, refused: true } })[0].openWhen).toEqual({ refused: true });
    // A row that is not on the list opens nothing.
    expect(drawn([cristina], { searching: false, returned: { id: "00000000-0000-4000-8000-999999999999", refused: false } })).toEqual([["waitlisted", [cristina.id], 1, false]]);
  });

  it("count the real rows: a test registration is drawn in its section and left out of its number, as the desk's counters leave it", () => {
    const real = row("CONFIRMED");
    const test = row("CONFIRMED", { kind: "TEST" });
    expect(drawn([real, test], { searching: false })).toEqual([["toPickUp", [real.id, test.id], 1, true]]);
    expect(drawn([test], { searching: false })).toEqual([["toPickUp", [test.id], 0, true]]);
  });

  it("read the returned row only when it is a registration's id, in lower case", () => {
    const id = "8F0C5D0E-1B7A-4C1D-9C55-0A1B2C3D4E5F";
    expect(returnedRowOf(id)).toBe(id.toLowerCase());
    for (const value of [undefined, "", "admin-alert", 'x"><script>', ["a", "b"], 7]) expect(returnedRowOf(value)).toBeNull();
  });

  it("say «<words> (N)» for every section in both languages, the waiting list in the state's own words (§35)", () => {
    const words = (catalogue: unknown) => (catalogue as { Admin: { desk: { sections: Record<string, string> } } }).Admin.desk.sections;
    for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
      expect(Object.keys(words(catalogue)).sort(), locale).toEqual([...DESK_SECTION_KEYS].sort());
      for (const key of DESK_SECTION_KEYS) expect(words(catalogue)[key], `${locale} ${key}`).toMatch(/^\S.* \(\{n\}\)$/);
    }
    expect(words(ro).waitlisted).toBe(`${REGISTRATION_STATUS_LABEL.WAITLISTED} ({n})`);
    expect(words(ro)).toEqual({
      toPickUp: "De ridicat numărul ({n})",
      unsigned: "Fără declarație semnată ({n})",
      checkedIn: "Prezenți ({n})",
      addressUnconfirmed: "Adresă neconfirmată ({n})",
      offered: "Ofertă de loc deschisă ({n})",
      waitlisted: "Pe lista de așteptare ({n})",
      voided: "Anulate sau expirate ({n})",
    });
    expect(words(en)).toEqual({
      toPickUp: "To pick up ({n})",
      unsigned: "Declaration not signed ({n})",
      checkedIn: "Present ({n})",
      addressUnconfirmed: "Address not confirmed ({n})",
      offered: "Place offered ({n})",
      waitlisted: "On the waiting list ({n})",
      voided: "Cancelled or expired ({n})",
    });
  });
});
