import { describe, expect, it } from "vitest";
import {
  clubNoticesSchema,
  confirmationNoticeRecipients,
  declarationArchiveIsConfigured,
  DEFAULT_CLUB_NOTICES,
  resolveDeclarationCopies,
} from "@/modules/notifications/domain/club-notices";

/**
 * BR-REQ-080-01, `DECISIONS.md` §244 and §245 — who at the club receives a copy of a signed
 * declaration, and who is told when somebody confirms.
 *
 * The rules here are the ones the interface cannot be trusted with: what counts as an address,
 * what happens when the same mailbox is typed twice, and which of the two sources — the club's
 * setting or the deployment's `DECLARATIONS_ARCHIVE_TO` — is in force. The last one is the
 * reason this exists as a pure function: a club that has not touched the new panel must keep
 * receiving exactly what §99 sent it.
 */
describe("DECISIONS.md §244 the club's copies of a signed declaration", () => {
  const parse = (value: unknown) => clubNoticesSchema.parse(value);

  it("takes one archive address, a Cc list and a Bcc list", () => {
    expect(
      parse({
        declarations: { to: "club@example.ro", cc: ["amalia@example.ro"], bcc: ["arhiva@example.ro"] },
        confirmations: { to: ["presedinte@example.ro"] },
      }),
    ).toEqual({
      declarations: { to: "club@example.ro", cc: ["amalia@example.ro"], bcc: ["arhiva@example.ro"] },
      confirmations: { to: ["presedinte@example.ro"] },
    });
  });

  it("reads an untouched setting as nobody named", () => {
    expect(parse({})).toEqual(DEFAULT_CLUB_NOTICES);
    expect(declarationArchiveIsConfigured(parse({}), undefined)).toBe(false);
  });

  it("refuses anything that is not an address", () => {
    expect(() => parse({ declarations: { to: "not an address" } })).toThrow();
    expect(() => parse({ declarations: { cc: ["club@example.ro", "@example.ro"] } })).toThrow();
    // A key nobody defined is a setting somebody wrote by hand, and it is refused rather than
    // stripped: the panel posts exactly these fields.
    expect(() => parse({ declarations: { to: "club@example.ro", reallyTo: "x@example.ro" } })).toThrow();
  });

  it("sends one mailbox one copy, whichever box it was typed in", () => {
    // Nodemailer and Mailgun both build the envelope from every list at once, so the club's own
    // address in two boxes is two copies of a declaration and two messages of the allowance.
    const stored = parse({
      declarations: { to: "club@example.ro", cc: ["CLUB@example.ro", "amalia@example.ro"], bcc: ["amalia@example.ro"] },
      confirmations: { to: [] },
    });
    expect(stored.declarations.cc).toEqual(["amalia@example.ro"]);
    expect(stored.declarations.bcc).toEqual([]);
  });

  it("keeps the club's setting above the deployment's variable, and the variable above nothing", () => {
    const named = parse({ declarations: { to: "club@example.ro", cc: ["amalia@example.ro"] } });
    expect(resolveDeclarationCopies(named, "old@example.ro")).toEqual({
      to: "club@example.ro",
      cc: ["amalia@example.ro"],
      bcc: [],
      source: "setting",
    });

    // §99's deployment, untouched since: the variable still decides, and the club may still
    // add a Cc without a developer.
    const ccOnly = parse({ declarations: { cc: ["amalia@example.ro"] } });
    expect(resolveDeclarationCopies(ccOnly, "old@example.ro")).toEqual({
      to: "old@example.ro",
      cc: ["amalia@example.ro"],
      bcc: [],
      source: "environment",
    });

    // Nobody named anywhere: no copy at all. A Cc is never promoted to the recipient — that
    // would send a participant's declaration somewhere the club did not choose.
    expect(resolveDeclarationCopies(ccOnly, undefined)).toEqual({
      to: null,
      cc: ["amalia@example.ro"],
      bcc: [],
      source: "none",
    });
    expect(declarationArchiveIsConfigured(ccOnly, undefined)).toBe(false);
    expect(declarationArchiveIsConfigured(ccOnly, "old@example.ro")).toBe(true);
  });

  it("does not deduplicate the confirmation notices against the declaration's copies", () => {
    // Two different messages to the same person is correct here: one is a document to archive,
    // the other is "somebody has confirmed".
    const both = parse({
      declarations: { to: "club@example.ro" },
      confirmations: { to: ["club@example.ro", "CLUB@example.ro"] },
    });
    expect(confirmationNoticeRecipients(both)).toEqual(["club@example.ro"]);
  });
});
