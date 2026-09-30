import { describe, expect, it } from "vitest";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { contrastRatio, MIN_TEXT_CONTRAST } from "@/modules/appearance/domain/tint-contrast";
import { emailSampleFamilyConfirmed, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { HIGHLIGHT_TEXT_MARK, renderBilingual, renderContent, type TemplateContent } from "@/modules/notifications/templates";
import { COLOR, EMAIL_EMPHASIS } from "@/theme/brand";

/**
 * BR-REQ-080-01, `DECISIONS.md` §580 (amending §68 and §392; the owner, 2026-09-30: «I need more bold
 * and highlight in the emails sent to participants») — one emphasis vocabulary in the renderer:
 * `**bold**` for the facts a runner hunts for, one highlighted band for the fact a message is about,
 * the same in every message, the one button under the line that asks for it, the quieter sentences
 * smaller and muted, and the plain-text twin keeping all of it with `▶` and blank lines.
 */

const ACTION = "https://example.invalid/action";

function content(extra: Partial<TemplateContent> = {}): TemplateContent {
  return {
    subject: "S",
    greeting: "Salut, Ana,",
    paragraphs: ["Primul rând.", "Faptul cu **42** în el.", "Al treilea rând.", "Ignoră mesajul dacă nu ai cerut."],
    closing: "Alergare plăcută,",
    ...extra,
  };
}

/** The highlighted bands of a message's HTML, their inner HTML, in order. */
function bands(html: string): string[] {
  return [...html.matchAll(/<div data-email-part="highlight"[^>]*>([^]*?)<\/div>/g)].map((match) => match[1]);
}

/** The words of an HTML fragment, tags dropped. */
function words(html: string): string {
  return html
    .replace(/<\/p>|<br>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A naive dark-mode inversion, as Gmail's app does to a message that declares itself light. */
function inverted(hex: string): string {
  const value = 0xffffff - Number.parseInt(hex.slice(1), 16);
  return `#${value.toString(16).padStart(6, "0")}`;
}

describe("§580 the renderer's emphasis vocabulary", () => {
  it("draws `**x**` as bold in the HTML and drops the markers in the plain text", () => {
    const message = renderContent(content(), "ro");
    expect(message.html).toContain("Faptul cu <strong>42</strong> în el.");
    expect(message.text).toContain("Faptul cu 42 în el.");
    expect(message.text).not.toContain("**");
  });

  it("puts the highlighted paragraph on one band, in the club's blue, and marks it in the text half apart by blank lines", () => {
    const message = renderContent(content({ highlight: ["Faptul cu 42 în el."] }), "ro");
    const found = bands(message.html);
    expect(found).toHaveLength(1);
    expect(words(found[0])).toBe("Faptul cu 42 în el.");
    expect(found[0]).toContain("<strong>42</strong>");
    expect(message.html).toContain(`background-color:${EMAIL_EMPHASIS.band}`);
    expect(message.html).toContain(`border-left:4px solid ${EMAIL_EMPHASIS.edge}`);
    // Matched by its words: the markers do not count.
    expect(message.text).toContain(`Primul rând.\n\n${HIGHLIGHT_TEXT_MARK}Faptul cu 42 în el.\n\nAl treilea rând.`);
  });

  it("shares one band between consecutive highlighted paragraphs, each line marked", () => {
    const message = renderContent(content({ highlight: ["Primul rând.", "Faptul cu **42** în el."] }), "ro");
    const found = bands(message.html);
    expect(found).toHaveLength(1);
    expect(words(found[0])).toBe("Primul rând. Faptul cu 42 în el.");
    expect(message.text).toContain(`${HIGHLIGHT_TEXT_MARK}Primul rând.\n${HIGHLIGHT_TEXT_MARK}Faptul cu 42 în el.\n\n`);
  });

  it("draws a quieter sentence smaller and muted, the same words in the text half", () => {
    const message = renderContent(content({ quiet: ["Ignoră mesajul dacă nu ai cerut."] }), "ro");
    expect(message.html).toContain(`font-size:14px;line-height:1.5;color:${EMAIL_EMPHASIS.quiet}">Ignoră mesajul dacă nu ai cerut.</p>`);
    expect(message.text).toContain("Ignoră mesajul dacă nu ai cerut.");
  });

  it("puts the button right under the line that asks for it, and at the end when that line is not there", () => {
    const action = { label: "Apasă aici", url: ACTION };
    const early = renderContent(content({ action, highlight: ["Faptul cu 42 în el."], actionAfter: "Faptul cu 42 în el." }), "ro");
    expect(early.html.indexOf(ACTION)).toBeGreaterThan(early.html.indexOf("Faptul cu"));
    expect(early.html.indexOf(ACTION)).toBeLessThan(early.html.indexOf("Al treilea rând."));
    expect(early.text).toContain(`${HIGHLIGHT_TEXT_MARK}Faptul cu 42 în el.\n\nApasă aici: ${ACTION}\n\nAl treilea rând.`);
    // The button keeps its size: the same style wherever it stands.
    expect(early.html).toContain("font-weight:700;font-size:16px;padding:14px 22px;border-radius:10px");

    const late = renderContent(content({ action, actionAfter: "Un rând pe care mesajul nu îl are." }), "ro");
    expect(late.html.indexOf(ACTION)).toBeGreaterThan(late.html.indexOf("Ignoră mesajul"));
  });

  it("leaves a message that names nothing exactly as it was: no band, no quiet line", () => {
    const message = renderContent(content(), "ro");
    expect(bands(message.html)).toHaveLength(0);
    expect(message.text).not.toContain(HIGHLIGHT_TEXT_MARK);
    expect(message.html).not.toContain(EMAIL_EMPHASIS.quiet);
  });
});

describe("§580 the band's colours read on a light card and on one a client darkens", () => {
  it("keeps the words readable on the band, as sent and inverted", () => {
    expect(contrastRatio(EMAIL_EMPHASIS.ink, EMAIL_EMPHASIS.band)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(inverted(EMAIL_EMPHASIS.ink), inverted(EMAIL_EMPHASIS.band))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("keeps the band's edge visible beside it, the band apart from the card, and the quiet words readable", () => {
    // The edge is a shape, not text: the 3:1 of a non-text contrast.
    expect(contrastRatio(EMAIL_EMPHASIS.edge, EMAIL_EMPHASIS.band)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(inverted(EMAIL_EMPHASIS.edge), inverted(EMAIL_EMPHASIS.band))).toBeGreaterThanOrEqual(3);
    // A soft band: visibly not the card, far from a block of colour.
    const step = contrastRatio(EMAIL_EMPHASIS.band, COLOR.surface);
    expect(step).toBeGreaterThan(1.05);
    expect(step).toBeLessThan(1.3);
    expect(contrastRatio(EMAIL_EMPHASIS.quiet, COLOR.surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(inverted(EMAIL_EMPHASIS.quiet), inverted(COLOR.surface))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});

/**
 * Per message type, what is on the band, in each half's own language, from the sample `/admin/emails`
 * previews with — the table of the § in code. `button` says the one button stands right under the band.
 */
const HIGHLIGHTED: ReadonlyArray<{ type: EmailMessageType; ro: readonly string[]; en: readonly string[]; button?: boolean }> = [
  { type: "VERIFY_REGISTRATION_EMAIL", ro: ["Apasă butonul ca să confirmi adresa."], en: ["Press the button to confirm your address."], button: true },
  { type: "COMPLETE_DECLARATION", ro: ["este rezervat pentru tine", "declarația pe proprie răspundere semnată"], en: ["is held for you", "signed declaration of own responsibility"], button: true },
  { type: "WAITLIST_JOINED", ro: ["pe lista de așteptare"], en: ["the waiting list"] },
  { type: "WAITLIST_SPOT_OFFER", ro: ["vineri, 2 octombrie 2026, la 18:30", "24 de ore"], en: ["Friday, 2 October 2026, at 18:30", "24 hours"], button: true },
  { type: "REGISTRATION_CONFIRMED", ro: ["Numărul tău de concurs: 42.", "spune codul EXAMPL"], en: ["Your race number: 42.", "say the code EXAMPL"] },
  { type: "EVENT_REMINDER", ro: ["Duminică, 4 oct. 2026, la 09:00 · Stația de telecabină Tâmpa"], en: ["Sunday, 4 Oct 2026, at 09:00 · Tâmpa cable-car station"] },
  { type: "EVENT_THANKS", ro: ["Rezultatele și pozele"], en: ["The results and the photos"], button: true },
  { type: "DECLARATION_SIGNED", ro: ["Păstreaz-o: este copia ta."], en: ["Keep it: it is your copy."] },
  { type: "BIB_ASSIGNED", ro: ["numărul 42", "codul EXAMPL"], en: ["number 42", "the code EXAMPL"] },
  { type: "REGISTRATION_OPENED", ro: ["s-au deschis"], en: ["is open"], button: true },
  { type: "REGISTRATION_CANCELLED", ro: ["a fost anulată", "Locul a fost eliberat."], en: ["has been cancelled", "The place has been released."] },
  { type: "WAITLIST_OFFER_EXPIRED", ro: ["a expirat", "Rămâi pe lista de așteptare"], en: ["has expired", "You remain on the waiting list"] },
  { type: "REGISTRATION_MANAGE_LINK", ro: ["Iată linkul"], en: ["Here is the link"], button: true },
  { type: "PROFILE_MANAGE_LINK", ro: ["Iată linkul"], en: ["Here is the link"], button: true },
  { type: "REGISTRATION_STATE_NOTICE", ro: ["are starea: confirmată."], en: ["this status: confirmed."] },
  { type: "EVENT_UPDATE_NOTICE", ro: ["Locul de întâlnire este acum", "Data și ora sunt acum"], en: ["The meeting point is now", "The date and time are now"] },
  { type: "EVENT_CANCELLED", ro: ["a fost anulat."], en: ["has been cancelled."] },
  { type: "GROUP_RUN_DECLARATION_SIGNED", ro: ["Păstreaz-o: este copia ta."], en: ["Keep it: it is your copy."] },
  { type: "REGISTER_ANOTHER_PERSON", ro: ["pentru o altă persoană"], en: ["for another person"], button: true },
  { type: "NEWSLETTER_CONFIRM", ro: ["Confirmă abonarea cu butonul de mai jos."], en: ["Confirm your subscription with the button below."], button: true },
  { type: "NEW_EVENT_ALERT", ro: ["Duminică, 4 oct. 2026, la 09:00"], en: ["Sunday, 4 Oct 2026, at 09:00"] },
];

/** The club's copies, the staff's and the club's own words: no band (out of scope, §580). */
const UNEMPHASISED: readonly EmailMessageType[] = [
  "DECLARATION_ARCHIVE",
  "GROUP_RUN_DECLARATION_ARCHIVE",
  "CLUB_CONFIRMATION_NOTICE",
  "STAFF_INVITATION",
  "MEMBER_INVITATION",
  "NEWSLETTER",
  "ORGANIZER_MESSAGE",
];

describe("§580 every participant message puts its one fact on the band, in both languages", () => {
  for (const { type, ro, en, button } of HIGHLIGHTED) {
    it(`${type}: ${ro.join(" · ")}`, () => {
      const message = renderBilingual(type, "ro", emailSampleFor(type, "ro"), ACTION, null);
      const found = bands(message.html);
      // One band per half, the same look in both.
      expect(found).toHaveLength(2);
      for (const fact of ro) expect(words(found[0])).toContain(fact);
      for (const fact of en) expect(words(found[1])).toContain(fact);
      const [roText, enText] = message.text.split("\n— — —\n");
      const marked = (half: string) => half.split("\n").filter((line) => line.startsWith(HIGHLIGHT_TEXT_MARK)).join("\n");
      for (const fact of ro) expect(marked(roText)).toContain(fact);
      for (const fact of en) expect(marked(enText)).toContain(fact);
      if (button) {
        // The one button right under the band, before anything else the half says.
        const afterBand = message.html.slice(message.html.indexOf('data-email-part="highlight"'));
        const next = afterBand.slice(afterBand.indexOf("</div>") + 6).trimStart();
        expect(next.startsWith('<p style="margin:20px 0"><a href=')).toBe(true);
      }
    });
  }

  it("bolds the deadline of the offer with its month spelled out", () => {
    const message = renderBilingual("WAITLIST_SPOT_OFFER", "ro", emailSampleFor("WAITLIST_SPOT_OFFER", "ro"), ACTION, null);
    expect(message.html).toContain("<strong>vineri, 2 octombrie 2026, la 18:30</strong>");
    expect(message.html).toContain("<strong>Friday, 2 October 2026, at 18:30</strong>");
  });

  it("bolds the facts block's day, hours and place name", () => {
    const message = renderBilingual("REGISTRATION_CONFIRMED", "ro", emailSampleFor("REGISTRATION_CONFIRMED", "ro"), ACTION, null);
    const facts = message.html.slice(message.html.indexOf('data-email-part="event-facts"'));
    expect(facts).toContain("<strong>Stația de telecabină Tâmpa</strong>");
    expect(facts).toMatch(/<strong>[^<]*09:00[^<]*<\/strong>/);
  });

  it("puts each person's number and desk code on a band of their own in a family's confirmation", () => {
    const data = { ...emailSampleFor("REGISTRATION_CONFIRMED", "ro"), familyConfirmed: emailSampleFamilyConfirmed() };
    const message = renderBilingual("REGISTRATION_CONFIRMED", "ro", data, ACTION, null);
    const people = emailSampleFamilyConfirmed();
    // Every person, in each half.
    expect(bands(message.html).length).toBeGreaterThanOrEqual(people.length * 2);
    for (const person of people.filter((one) => one.checkinCode)) {
      const code = person.checkinCode ?? "—";
      expect(message.text.split("\n").some((line) => line.startsWith(HIGHLIGHT_TEXT_MARK) && line.endsWith(`: ${code}`))).toBe(true);
      expect(bands(message.html).some((band) => band.includes(person.checkinCode ?? "—"))).toBe(true);
    }
  });

  for (const type of UNEMPHASISED) {
    it(`${type} keeps its words as they were: no band`, () => {
      const message = renderBilingual(type, "ro", emailSampleFor(type, "ro"), ACTION, null);
      expect(bands(message.html)).toHaveLength(0);
      expect(message.text).not.toContain(HIGHLIGHT_TEXT_MARK);
    });
  }
});

/** The participant messages the club gets a copy of (§320), each with its one fact on the band in the participant's own. */
const CLUB_COPIED: readonly EmailMessageType[] = ["REGISTRATION_CONFIRMED", "REGISTRATION_CANCELLED", "COMPLETE_DECLARATION", "WAITLIST_SPOT_OFFER"];

describe("§580 the club's copy of a participant message keeps the plain look", () => {
  const quietLine = `font-size:14px;line-height:1.5;color:${EMAIL_EMPHASIS.quiet}`;
  for (const type of CLUB_COPIED) {
    it(`${type} as the club's copy: no band, no quieter line, no ▶`, () => {
      const participant = renderBilingual(type, "ro", emailSampleFor(type, "ro"), ACTION, null);
      // The participant's own does draw the band — so the copy's plain look is the gate, not the sample.
      expect(bands(participant.html).length).toBeGreaterThan(0);
      const message = renderBilingual(type, "ro", { ...emailSampleFor(type, "ro"), clubCopy: true }, ACTION, null);
      expect(message.html).not.toContain('data-email-part="highlight"');
      expect(message.html).not.toContain(quietLine);
      expect(message.text).not.toContain(HIGHLIGHT_TEXT_MARK);
    });
  }

  it("a family's confirmation as the club's copy draws no band in anybody's block", () => {
    const data = { ...emailSampleFor("REGISTRATION_CONFIRMED", "ro"), familyConfirmed: emailSampleFamilyConfirmed(), clubCopy: true };
    const message = renderBilingual("REGISTRATION_CONFIRMED", "ro", data, ACTION, null);
    expect(message.html).toContain('data-email-part="family-person"');
    expect(message.html).not.toContain('data-email-part="highlight"');
    expect(message.text).not.toContain(HIGHLIGHT_TEXT_MARK);
  });
});
