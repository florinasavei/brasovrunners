import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesVolunteers } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { audienceOf } from "@/modules/notifications/domain/email-audience";
import { isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import { EMAIL_GROUP_OF } from "@/modules/notifications/domain/email-transport";
import { renderBilingual } from "@/modules/notifications/templates";

/**
 * §820 — `VOLUNTEER_INVITATION`, the club's invitation to volunteer: written in both languages for an address the club typed, with
 * the event, the roles still wanted, the club's own line, the button to the personal link and the privacy line that says why a
 * person who never offered received it; on the announcements' road, no participant's message, no club copy. The words of the
 * card and the pages are `access-render.test.ts`.
 */
const data = {
  participantName: "",
  eventTitle: "Crosul",
  eventTitleOther: "The cross",
  eventStartsAtFormatted: "sâmbătă, 21 nov. 2026, 10:00",
  eventStartsAtFormattedOther: "Saturday, 21 Nov 2026, 10:00",
  volunteerInvitation: { message: "Ne bucurăm să te vedem!", messageOther: "We are glad to see you!", rolesRo: ["Punct de apă", "Sosire (Start / Sosire)"], rolesEn: ["Water point", "Finish (Start / Finish)"] },
};
const LINK = "https://example.test/ro/evenimente/crosul/voluntari?invite=SECRET";

describe("§820 the VOLUNTEER_INVITATION email", () => {
  it("invites by name of the club to the event, names the roles wanted and the club's line, and puts the button to the link — in both languages", () => {
    const email = renderBilingual("VOLUNTEER_INVITATION", "ro", data, LINK);
    expect(email.subject).toBe("Te invităm să fii voluntar la Crosul / We invite you to volunteer at The cross");
    for (const words of [
      "Brașov Runners te invită să fii voluntar la Crosul, sâmbătă, 21 nov. 2026, 10:00.",
      "Căutăm oameni pentru: Punct de apă, Sosire (Start / Sosire).",
      "Mesajul clubului:",
      "Ne bucurăm să te vedem!",
      "Mă ofer voluntar",
      "Invitația e doar a ta, iar linkul se folosește o singură dată.",
      "ignoră-l",
      "invites you to volunteer at The cross",
      "We are looking for people for: Water point, Finish (Start / Finish).",
      "A message from the club:",
      "I want to volunteer",
      "The invitation is yours alone, and the link works once.",
      "ignore it",
      "We are glad to see you!",
    ]) {
      expect(email.text, words).toContain(words);
    }
    expect(email.text).toContain(LINK);
    // The event's facts block rides with it (§392): when, where and what, from the one function every such message uses.
    expect(email.text).toContain("sâmbătă, 21 nov. 2026, 10:00");
  });

  it("says the club's line in each half's own language — the Romanian words in the Romanian half only, the English in the English (§354)", () => {
    const email = renderBilingual("VOLUNTEER_INVITATION", "ro", data, LINK);
    // Each label is followed by its own language's line, and neither line follows the other language's label.
    expect(email.text).toMatch(/Mesajul clubului:\s*Ne bucurăm să te vedem!/);
    expect(email.text).toMatch(/A message from the club:\s*We are glad to see you!/);
    expect(email.text).not.toMatch(/A message from the club:\s*Ne bucurăm/);
    expect(email.text).not.toMatch(/Mesajul clubului:\s*We are glad/);
    // The English first half is the mirror: the message's language is the first half's.
    const mirrored = renderBilingual("VOLUNTEER_INVITATION", "en", { ...data, volunteerInvitation: { ...data.volunteerInvitation, message: "We are glad to see you!", messageOther: "Ne bucurăm să te vedem!" } }, LINK);
    expect(mirrored.text).toMatch(/A message from the club:\s*We are glad to see you!/);
    expect(mirrored.text).toMatch(/Mesajul clubului:\s*Ne bucurăm să te vedem!/);
  });

  it("greets nobody by name — the club knows an address, not a person — and carries no registration's links", () => {
    const email = renderBilingual("VOLUNTEER_INVITATION", "ro", data, LINK);
    expect(email.text).toMatch(/Bună ziua,/);
    expect(email.text).toMatch(/Hello,/);
    expect(email.text).not.toMatch(/Salut, \w/);
    expect(email.text).not.toMatch(/manage|gestionare|\/registrations\//i);
  });

  it("is written without the club's line or the roles when there are none, and says so in no empty sentence", () => {
    const bare = renderBilingual("VOLUNTEER_INVITATION", "ro", { ...data, volunteerInvitation: { message: null, messageOther: null, rolesRo: [], rolesEn: [] } }, LINK);
    expect(bare.text).not.toContain("Mesajul clubului:");
    expect(bare.text).not.toContain("Căutăm oameni pentru");
    expect(bare.text).toContain("Mă ofer voluntar");
  });

  it("escapes the club's line in the HTML half, as typed", () => {
    const email = renderBilingual("VOLUNTEER_INVITATION", "ro", { ...data, volunteerInvitation: { ...data.volunteerInvitation, message: "<b>Vino</b> & ajută\nLa 9:00" } }, LINK);
    expect(email.html).toContain("&lt;b&gt;Vino&lt;/b&gt; &amp; ajută<br>La 9:00");
    expect(email.html).not.toContain("<b>Vino</b>");
  });

  it("says in the privacy line why a person who never offered received it", () => {
    const email = renderBilingual("VOLUNTEER_INVITATION", "ro", data, LINK);
    expect(email.text).toContain("de la Brașov Runners pentru că ți-a trecut adresa ca să te invite voluntar la unul dintre evenimentele sale");
    expect(email.text).toContain("from Brașov Runners because it entered your address to invite you to volunteer at one of its events");
  });

  it("takes the announcements' road, is the public's mail and no participant's, and has its words in the emails page of both languages", () => {
    expect(EMAIL_GROUP_OF.VOLUNTEER_INVITATION).toBe("announcements");
    expect(audienceOf("VOLUNTEER_INVITATION")).toBe("public");
    expect(isParticipantMessage("VOLUNTEER_INVITATION")).toBe(false);
    for (const catalogue of [ro, en]) {
      for (const dictionary of ["types", "when", "whenShort", "whenMore"] as const) {
        expect((catalogue.Admin.emails[dictionary] as Record<string, string>).VOLUNTEER_INVITATION, dictionary).toBeTruthy();
      }
    }
  });
});

describe("§820 the privacy notice's one sentence", () => {
  it("is in the volunteers' paragraph of both languages, under the marker that already gates the form — no new marker", () => {
    for (const [body, words] of [
      [privacyNoticeRo, ["Dacă organizatorii te invită cu adresa ta de e-mail", "la un eveniment cu voluntari doar pe invitație", "formularul îți completează numele și adresa din contul tău de membru"]],
      [privacyNoticeEn, ["If the organizers invite you at your email address", "to an event whose volunteers are by invitation only", "the form fills in your name and address from your member account"]],
    ] as const) {
      const text = JSON.stringify(body);
      for (const piece of words) expect(text, piece).toContain(piece);
      // The sentence sits in the paragraph the marker names (`{{volunteers}}`), so a notice approved before keeps the gate it had.
      expect(text.indexOf(words[0])).toBeGreaterThan(text.indexOf("{{volunteers}}"));
      expect(describesVolunteers(body as never)).toBe(true);
    }
  });
});
