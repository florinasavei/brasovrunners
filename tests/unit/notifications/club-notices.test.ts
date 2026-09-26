import { describe, expect, it } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import {
  clubCopyPayload,
  clubCopyRecipients,
  clubNoticesSchema,
  confirmationNoticeRecipients,
  declarationArchiveIsConfigured,
  declarationPdfAudience,
  DEFAULT_CLUB_NOTICES,
  isClubCopy,
  isParticipantMessage,
  participantMessageBcc,
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
      // The third list (2026-09-22), empty until the club asks for it.
      participants: { bcc: [] },
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

/**
 * BR-REQ-033-02 criterion 12's rule, applied to every message a participant receives
 * (2026-09-22; the owner: "să putem seta și unde mai merg în BCC mailurile de înregistrare").
 * The list itself, and the two pure decisions `enqueueEmail` makes with it: which message types
 * carry the copy, and how the copy is merged into a row's payload.
 */
describe("BR-REQ-033-02 criterion 12 the club's hidden copy of every participant message", () => {
  const parse = (value: unknown) => clubNoticesSchema.parse(value);

  it("reads a setting stored before the list existed as having none", () => {
    // §244's rows carry `declarations` and `confirmations` only. No migration touches a JSON
    // setting, so the schema is what keeps them readable — and the copy off until it is asked for.
    const stored = parse({ declarations: { to: "club@example.ro" }, confirmations: { to: [] } });
    expect(stored.participants).toEqual({ bcc: [] });
    expect(participantMessageBcc(stored)).toEqual([]);
    expect(participantMessageBcc(null)).toEqual([]);
    expect(DEFAULT_CLUB_NOTICES.participants).toEqual({ bcc: [] });
  });

  it("keeps the list, one spelling each, and refuses the whole setting on one bad address", () => {
    expect(parse({ participants: { bcc: ["arhiva@example.ro", "ARHIVA@example.ro", "presedinte@example.ro"] } }).participants).toEqual({
      bcc: ["arhiva@example.ro", "presedinte@example.ro"],
    });
    expect(() => parse({ participants: { bcc: ["arhiva@example.ro", "not an address"] } })).toThrow();
    expect(() => parse({ participants: { bcc: [], cc: ["x@example.ro"] } })).toThrow();
    // Not deduplicated against the other lists: a copy of the runner's confirmation and a copy
    // of their signed declaration are two messages, and one mailbox may want both.
    const both = parse({ declarations: { to: "club@example.ro" }, participants: { bcc: ["club@example.ro"] } });
    expect(participantMessageBcc(both)).toEqual(["club@example.ro"]);
  });

  it("copies every message to a participant and none of the club's, the staff's or the interest list's", () => {
    const excluded = [
      "DECLARATION_ARCHIVE",
      "GROUP_RUN_DECLARATION_ARCHIVE",
      "CLUB_CONFIRMATION_NOTICE",
      "STAFF_INVITATION",
      "REGISTRATION_OPENED",
      // The newsletter's three (§445): to a subscriber, never about a registration.
      "NEWSLETTER_CONFIRM",
      "NEWSLETTER",
      "NEW_EVENT_ALERT",
    ];
    for (const type of emailMessageType.enumValues) {
      expect(isParticipantMessage(type), type).toBe(!excluded.includes(type));
    }
  });

});

/**
 * BR-REQ-033-02 criterion 14 as amended by §320: the club's copy is a message of its own, one per
 * address, and never the participant's envelope. These are the pure halves of `enqueueClubCopies`
 * and of the renderer's attachment rule; `tests/integration/notifications/club-copy.test.ts`
 * renders every participant type through them.
 */
describe("BR-REQ-033-02 criterion 14 the club copy's recipients, payload and attachments (§320)", () => {
  it("sends one copy per club address, never to the participant, one spelling each", () => {
    expect(clubCopyRecipients("ana@example.ro", [])).toEqual([]);
    expect(clubCopyRecipients("ana@example.ro", ["arhiva@example.ro", "presedinte@example.ro"])).toEqual([
      "arhiva@example.ro",
      "presedinte@example.ro",
    ]);
    // The participant receives their own message; the stripped copy of it would be a second one.
    expect(clubCopyRecipients("Ana@Example.ro", ["ana@example.ro", "arhiva@example.ro"])).toEqual(["arhiva@example.ro"]);
    // The same mailbox twice is one copy, compared without regard to case.
    expect(clubCopyRecipients("ana@example.ro", ["arhiva@example.ro", "ARHIVA@example.ro"])).toEqual(["arhiva@example.ro"]);
    expect(clubCopyRecipients("ana@example.ro", ["ana@example.ro"])).toEqual([]);
  });

  it("keeps what the template needs, marks the copy, and never lets it fan out", () => {
    expect(clubCopyPayload({})).toEqual({ clubCopy: true });
    expect(clubCopyPayload({ alreadyRegistered: true, bibNumber: 42, url: "https://example.org/poze" })).toEqual({
      alreadyRegistered: true,
      bibNumber: 42,
      url: "https://example.org/poze",
      clubCopy: true,
    });
    // A copy goes to the one address its row is for: any list the original carried stays behind.
    expect(clubCopyPayload({ cc: ["a@example.ro"], bcc: ["b@example.ro"], bibNumber: 7 })).toEqual({ bibNumber: 7, clubCopy: true });
  });

  it("recognises a club copy by the literal flag and nothing else", () => {
    expect(isClubCopy({ clubCopy: true })).toBe(true);
    expect(isClubCopy(clubCopyPayload({ bibNumber: 1 }))).toBe(true);
    for (const payload of [{}, { clubCopy: "true" }, { clubCopy: 1 }, { clubCopy: false }, null, undefined, "clubCopy", []]) {
      expect(isClubCopy(payload), JSON.stringify(payload)).toBe(false);
    }
  });

  it("attaches the whole declaration to the participant, a masked one to the archive, and nothing to a club copy", () => {
    expect(declarationPdfAudience("REGISTRATION_CONFIRMED", false)).toBe("participant");
    expect(declarationPdfAudience("DECLARATION_SIGNED", false)).toBe("participant");
    expect(declarationPdfAudience("DECLARATION_ARCHIVE", false)).toBe("club");
    // A group run's self-declaration (§393): whole to the signer, masked to the archive.
    // The group run's signer's copy is masked too (§419): its address was never confirmed.
    expect(declarationPdfAudience("GROUP_RUN_DECLARATION_SIGNED", false)).toBe("club");
    expect(declarationPdfAudience("GROUP_RUN_DECLARATION_ARCHIVE", false)).toBe("club");
    for (const type of emailMessageType.enumValues) {
      // A club copy of any message attaches no PDF at all.
      expect(declarationPdfAudience(type, true), type).toBeNull();
      if (!["REGISTRATION_CONFIRMED", "DECLARATION_SIGNED", "DECLARATION_ARCHIVE", "GROUP_RUN_DECLARATION_SIGNED", "GROUP_RUN_DECLARATION_ARCHIVE"].includes(type)) {
        expect(declarationPdfAudience(type, false), type).toBeNull();
      }
    }
  });
});
