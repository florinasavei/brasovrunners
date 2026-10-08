import { describe, expect, it } from "vitest";
import {
  BRANCH_SLUG,
  composeFeedbackEmail,
  DEFAULT_FEEDBACK_SETTINGS,
  doorIntroKey,
  feedbackFields,
  type FeedbackInput,
  type FeedbackSettings,
  feedbackQueryFor,
  feedbackRefusalUrl,
  feedbackSentUrl,
  NO_CONTACT_LINE,
  offeredBranches,
  pickerOrder,
  readDay,
  readFeedbackQuery,
  SAFETY_SUBJECT,
  wizardStep,
} from "@/modules/feedback/domain/branches";
import { describesFeedbackForms } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { feedbackFormsClause } from "@/modules/feedback/notice-words";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN — «Spune-ne ceva»'s rules, pure: which branches are offered,
 * the step skipped with one on, the address bar read and never trusted, and the email each branch
 * becomes — the subject, the fields in the form's order, the ticks' words and the anonymity line.
 * Every address here is made up, on `example.org`.
 */
const ON: FeedbackSettings = {
  howItWent: { on: true, to: "how@example.org" },
  suggestion: { on: true, to: "ideas@example.org" },
  complaint: { on: true, to: "complaints@example.org" },
  safety: { on: true, to: "safety@example.org", name: "Maria" },
};

const parse = (raw: Record<string, unknown>): FeedbackInput => feedbackFields.parse({ locale: "ro", ...raw });

describe("§NNN the branches a visitor is offered", () => {
  it("offers none by default, and none while the notice in force does not describe the forms", () => {
    expect(offeredBranches(DEFAULT_FEEDBACK_SETTINGS, true, true)).toEqual([]);
    expect(offeredBranches(ON, false, true)).toEqual([]);
  });

  it("offers each branch switched on with a recipient, in the wizard's order — the safety branch only with its first name", () => {
    expect(offeredBranches(ON, true, true)).toEqual(["howItWent", "suggestion", "complaint", "safety"]);
    expect(offeredBranches({ ...ON, suggestion: { on: true, to: null } }, true, true)).toEqual(["howItWent", "complaint", "safety"]);
    expect(offeredBranches({ ...ON, complaint: { on: false, to: "complaints@example.org" } }, true, true)).toEqual(["howItWent", "suggestion", "safety"]);
    expect(offeredBranches({ ...ON, safety: { on: true, to: "safety@example.org", name: null } }, true, true)).toEqual(["howItWent", "suggestion", "complaint"]);
  });

  it("offers the three ordinary branches only where the deployment has the SMTP road; the safety branch leaves by Mailgun and stays", () => {
    // `CONTACT_FORM_MODE=off`: every post on them would answer «Nu am putut trimite acum…» forever.
    expect(offeredBranches(ON, true, false)).toEqual(["safety"]);
    expect(offeredBranches({ ...ON, safety: { on: false, to: null, name: null } }, true, false)).toEqual([]);
    expect(offeredBranches(ON, false, false)).toEqual([]);
  });

  it("says the door's sentence from what is offered: the safety form's own with «Siguranță» alone, the three forms' otherwise", () => {
    expect(doorIntroKey(offeredBranches(ON, true, false))).toBe("door.introSafety");
    expect(doorIntroKey(["safety"])).toBe("door.introSafety");
    expect(doorIntroKey(offeredBranches(ON, true, true))).toBe("door.intro");
    expect(doorIntroKey(["howItWent"])).toBe("door.intro");
    expect(doorIntroKey(["suggestion", "safety"])).toBe("door.intro");
  });

  it("skips the choice when one branch is on, chooses by ?tip= among several, and has no page with none", () => {
    expect(wizardStep([], "howItWent")).toEqual({ kind: "none" });
    expect(wizardStep(["safety"], null)).toEqual({ kind: "form", branch: "safety", single: true });
    expect(wizardStep(["safety"], "howItWent")).toEqual({ kind: "form", branch: "safety", single: true });
    expect(wizardStep(["howItWent", "suggestion"], null)).toEqual({ kind: "choose", branches: ["howItWent", "suggestion"] });
    expect(wizardStep(["howItWent", "suggestion"], "suggestion")).toEqual({ kind: "form", branch: "suggestion", single: false });
    // A branch that is not on is the choice again, never its form.
    expect(wizardStep(["howItWent", "suggestion"], "safety")).toEqual({ kind: "choose", branches: ["howItWent", "suggestion"] });
  });
});

describe("§NNN the address bar, read and never trusted", () => {
  it("reads the branch by its Romanian word in both languages, a slug, and a real day", () => {
    expect(readFeedbackQuery({ tip: "cum-a-fost", eveniment: "crosul-de-toamna", data: "2026-10-04" })).toEqual({
      branch: "howItWent",
      eventSlug: "crosul-de-toamna",
      date: "2026-10-04",
    });
    expect(readFeedbackQuery({ tip: BRANCH_SLUG.safety }).branch).toBe("safety");
  });

  it("drops an unknown branch, a slug that is not one, and a day that does not exist", () => {
    expect(readFeedbackQuery({ tip: "admin", eveniment: "../etc/passwd", data: "2026-02-31" })).toEqual({ branch: null, eventSlug: null, date: null });
    expect(readFeedbackQuery({ eveniment: "<script>", data: "4.10.2026" })).toEqual({ branch: null, eventSlug: null, date: null });
    expect(readDay("2028-02-29")).toBe("2028-02-29");
    expect(readDay("2027-02-29")).toBeNull();
  });

  it("writes the thank-you's and the event page's link as the branch, the event and its day", () => {
    expect(feedbackQueryFor("crosul", "2026-10-04")).toEqual({ tip: "cum-a-fost", eveniment: "crosul", data: "2026-10-04" });
    expect(feedbackQueryFor(null, null)).toEqual({ tip: "cum-a-fost" });
  });
});

describe("§NNN the forms", () => {
  it("requires what happened, keeps it to 2 000 characters, and takes an address only when it is one", () => {
    expect(feedbackFields.safeParse({ locale: "ro", branch: "suggestion", message: "", email: "" }).success).toBe(false);
    expect(feedbackFields.safeParse({ locale: "ro", branch: "suggestion", message: "x".repeat(2001), email: "" }).success).toBe(false);
    expect(feedbackFields.safeParse({ locale: "ro", branch: "suggestion", message: "Mai multe alergări seara.", email: "not an address" }).success).toBe(false);
    expect(parse({ branch: "suggestion", message: "Mai multe alergări seara.", email: "" })).toMatchObject({ email: null });
  });

  it("keeps the ticks in the form's order, whatever order they were posted in, and refuses a rating outside 1–5", () => {
    const input = parse({ branch: "howItWent", event: "", date: "", rating: "4", message: "Bine.", reasons: ["moved", "time"], reasonOther: "", email: "" });
    expect(input).toMatchObject({ rating: 4, reasons: ["time", "moved"], event: null, date: null });
    expect(feedbackFields.safeParse({ locale: "ro", branch: "howItWent", event: "", date: "", rating: "6", message: "x", reasons: [], reasonOther: "", email: "" }).success).toBe(false);
  });
});

describe("§NNN the email each branch becomes", () => {
  it("«Cum a fost»: the event, the day, the face, the ticks in words, the message and the anonymity line", () => {
    const input = parse({
      branch: "howItWent",
      event: "crosul",
      date: "2026-10-04",
      rating: "2",
      message: "Ritmul a fost prea alert.",
      reasons: ["pace", "other"],
      reasonOther: "Program\nde lucru",
      email: "",
    });
    const email = composeFeedbackEmail(input, { eventTitle: "Crosul de toamnă" }, "production");
    expect(email.subject).toBe("Cum a fost: Crosul de toamnă");
    const lines = email.text.split("\n");
    expect(lines.slice(0, 6)).toEqual([
      "Eveniment: Crosul de toamnă",
      "Data: 4.10.2026",
      "Cum a fost: 2 din 5 — rău",
      "Dacă nu mai vine, de ce: ritmul grupului, altceva",
      "Altceva, în cuvintele lui: Program de lucru",
      "Limba formularului: română",
    ]);
    expect(email.text).toContain("Ce s-a întâmplat:\nRitmul a fost prea alert.");
    expect(email.text).toContain(`Contact: ${NO_CONTACT_LINE}`);
  });

  it("names «altceva / în general» for no event, or a slug the club does not publish, and the typed address as the contact", () => {
    const input = parse({ branch: "complaint", message: "<b>Nimeni</b> la start.", event: "nu-exista", date: "", email: "ana@example.org" });
    const email = composeFeedbackEmail(input, { eventTitle: null }, "production");
    expect(email.subject).toBe("O reclamație de pe site");
    expect(email.text).toContain("Eveniment: altceva / în general");
    expect(email.text).toContain("Contact: ana@example.org");
    expect(email.text).not.toContain(NO_CONTACT_LINE);
    // The person's words are escaped in the HTML, never markup.
    expect(email.html).toContain("&lt;b&gt;Nimeni&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Nimeni");
  });

  it("the safety branch: a neutral subject, where and when, the contact line in the body only, [QA] on QA", () => {
    const input = parse({ branch: "safety", message: "Cineva m-a urmărit după alergare.", whereWhen: "Parcul Tractorul, joi seara", contact: "" });
    const email = composeFeedbackEmail(input, { eventTitle: null }, "qa");
    expect(email.subject).toBe(`[QA] ${SAFETY_SUBJECT}`);
    expect(email.subject).not.toMatch(/sigur|safety|femei/i);
    expect(email.text).toContain("Unde și când: Parcul Tractorul, joi seara");
    expect(email.text).toContain(`Contact: ${NO_CONTACT_LINE}`);
    const reachable = composeFeedbackEmail(parse({ branch: "safety", message: "Cineva m-a urmărit după alergare.", whereWhen: "", contact: "0700 000 000" }), { eventTitle: null }, "production");
    expect(reachable.subject).toBe(SAFETY_SUBJECT);
    expect(reachable.text).toContain("Contact: 0700 000 000");
  });

  it("a suggestion has no event line and says it is one", () => {
    const email = composeFeedbackEmail(parse({ branch: "suggestion", message: "Alergări de seară.", email: "" }), { eventTitle: null }, "production");
    expect(email.subject).toBe("O sugestie de pe site");
    expect(email.text).not.toContain("Eveniment:");
    expect(email.text).toContain("Sugestia:\nAlergări de seară.");
  });
});

describe("§NNN the picker's order", () => {
  it("lists the events held, the most recent first, then the ones ahead, the soonest first", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const at = (iso: string) => ({ startsAt: new Date(iso), id: iso });
    const order = pickerOrder([at("2026-10-01T08:00:00Z"), at("2026-10-20T08:00:00Z"), at("2026-10-07T08:00:00Z"), at("2026-10-10T08:00:00Z")], now);
    expect(order.map((event) => event.id)).toEqual(["2026-10-07T08:00:00Z", "2026-10-01T08:00:00Z", "2026-10-10T08:00:00Z", "2026-10-20T08:00:00Z"]);
  });
});

describe("§NNN the notice's marker", () => {
  it("is named in both languages of the platform's privacy notice, and absent from a text without it", () => {
    expect(describesFeedbackForms(privacyNoticeRo)).toBe(true);
    expect(describesFeedbackForms(privacyNoticeEn)).toBe(true);
    const strip = (body: unknown) => JSON.parse(JSON.stringify(body).split("{{feedbackForms}}").join("formularele"));
    expect(describesFeedbackForms(strip(privacyNoticeRo))).toBe(false);
  });

  it("becomes the forms' own name, quoted, in each language", () => {
    expect(feedbackFormsClause("ro")).toBe("„Spune-ne ceva”");
    expect(feedbackFormsClause("en")).toBe("“Tell us something”");
  });
});

describe("§NNN the addresses the action sends the browser back to", () => {
  it("keeps ?tip=, names the boxes, carries ?since= and lands on the summary; without a branch, no ?tip=", () => {
    expect(feedbackRefusalUrl("/ro/contact/spune-ne", "complaint", "VALIDATION_ERROR", { fields: ["message", "date"], renderedAt: "2026-10-08T12:00:00.000Z" })).toBe(
      "/ro/contact/spune-ne?tip=reclamatie&error=VALIDATION_ERROR&fields=message,date&since=2026-10-08T12%3A00%3A00.000Z#feedback-errors",
    );
    expect(feedbackRefusalUrl("/en/contact/tell-us", null, "UNAVAILABLE")).toBe("/en/contact/tell-us?error=UNAVAILABLE#feedback-errors");
    expect(feedbackRefusalUrl("/ro/contact/spune-ne", "safety", "LIMITED", { fields: [], renderedAt: "" })).toBe("/ro/contact/spune-ne?tip=siguranta&error=LIMITED#feedback-errors");
  });

  it("answers a sent post with the branch's slug", () => {
    expect(feedbackSentUrl("/ro/contact/spune-ne", "howItWent")).toBe("/ro/contact/spune-ne?sent=cum-a-fost");
    expect(feedbackSentUrl("/ro/contact/spune-ne", null)).toBe("/ro/contact/spune-ne?sent=");
  });
});
