import { describe, expect, it } from "vitest";
import {
  aliasRedirect,
  ANONYMOUS_NAME_LINE,
  audiencesFor,
  BRANCH_FIELDS,
  chosenAudience,
  defaultAudience,
  effectiveFeedbackSettings,
  FEEDBACK_NAME_MAX,
  FEEDBACK_NAME_MIN,
  namedModeFor,
  BRANCH_SLUG,
  BRANCH_SLUG_ALIASES,
  branchFromSlug,
  DEFAULT_VIA,
  replyAddressForInput,
  replyAddressOf,
  roadBranch,
  viaFor,
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
  safetyMessageSeenByMailboxReaders,
  sentReader,
  wizardStep,
} from "@/modules/feedback/domain/branches";
import { describesFeedbackForms, describesFeedbackFormsNamed, describesFeedbackSafetyGmail } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { feedbackFormsClause, feedbackFormsMergeValues, feedbackFormsNamedClause, feedbackSafetyGmailClause } from "@/modules/feedback/notice-words";

/**
 * BR-REQ-070-04, `DECISIONS.md` §676 — «Spune-ne ceva»'s rules, pure: which branches are offered,
 * the step skipped with one on, the address bar read and never trusted, and the email each branch
 * becomes — the subject, the fields in the form's order, the ticks' words and the anonymity line.
 * Every address here is made up, on `example.org`.
 */
const ON: FeedbackSettings = {
  howItWent: { on: true, to: "how@example.org", via: "gmail" },
  suggestion: { on: true, to: "ideas@example.org", via: "gmail" },
  complaint: { on: true, to: "complaints@example.org", via: "gmail" },
  safety: { on: true, to: "safety@example.org", via: "mailgun", name: "Maria", fallbackToGmail: false },
};
/** Both roads there, and the deployment with no SMTP road (`CONTACT_FORM_MODE=off`). */
const BOTH = { gmail: true, mailgun: true };
const NO_GMAIL = { gmail: false, mailgun: true };

const parse = (raw: Record<string, unknown>): FeedbackInput => feedbackFields.parse({ locale: "ro", ...raw });

describe("§676 the branches a visitor is offered", () => {
  it("offers none by default, and none while the notice in force does not describe the forms", () => {
    expect(offeredBranches(DEFAULT_FEEDBACK_SETTINGS, true, BOTH)).toEqual([]);
    expect(offeredBranches(ON, false, BOTH)).toEqual([]);
  });

  it("offers each branch switched on with a recipient, in the wizard's order — the safety branch only with its first name", () => {
    expect(offeredBranches(ON, true, BOTH)).toEqual(["howItWent", "suggestion", "complaint", "safety"]);
    expect(offeredBranches({ ...ON, suggestion: { on: true, to: null, via: "gmail" } }, true, BOTH)).toEqual(["howItWent", "complaint", "safety"]);
    expect(offeredBranches({ ...ON, complaint: { on: false, to: "complaints@example.org", via: "gmail" } }, true, BOTH)).toEqual(["howItWent", "suggestion", "safety"]);
    expect(offeredBranches({ ...ON, safety: { on: true, to: "safety@example.org", via: "mailgun", name: null, fallbackToGmail: false } }, true, BOTH)).toEqual(["howItWent", "suggestion", "complaint"]);
  });

  it("offers the three ordinary branches only where the deployment has the SMTP road; the safety branch leaves by Mailgun and stays", () => {
    // `CONTACT_FORM_MODE=off`: every post on them would answer «Nu am putut trimite acum…» forever.
    expect(offeredBranches(ON, true, NO_GMAIL)).toEqual(["safety"]);
    expect(offeredBranches({ ...ON, safety: { on: false, to: null, via: "mailgun", name: null, fallbackToGmail: false } }, true, NO_GMAIL)).toEqual([]);
    expect(offeredBranches(ON, false, NO_GMAIL)).toEqual([]);
  });

  it("says the door's sentence from what is offered: the safety form's own with «Girl Zone» alone, the three forms' otherwise", () => {
    expect(doorIntroKey(offeredBranches(ON, true, NO_GMAIL))).toBe("door.introSafety");
    expect(doorIntroKey(["safety"])).toBe("door.introSafety");
    expect(doorIntroKey(offeredBranches(ON, true, BOTH))).toBe("door.intro");
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

describe("§676 the address bar, read and never trusted", () => {
  it("reads the branch by its Romanian word in both languages, a slug, and a real day", () => {
    expect(readFeedbackQuery({ tip: "cum-a-fost", eveniment: "crosul-de-toamna", data: "2026-10-04" })).toEqual({
      branch: "howItWent",
      eventSlug: "crosul-de-toamna",
      date: "2026-10-04",
      chip: "all",
    });
    expect(readFeedbackQuery({ filtru: "grup" }).chip).toBe("group");
    expect(readFeedbackQuery({ filtru: "speciale" }).chip).toBe("special");
    expect(readFeedbackQuery({ tip: BRANCH_SLUG.safety }).branch).toBe("safety");
  });

  it("drops an unknown branch, a slug that is not one, and a day that does not exist", () => {
    expect(readFeedbackQuery({ tip: "admin", eveniment: "../etc/passwd", data: "2026-02-31" })).toEqual({ branch: null, eventSlug: null, date: null, chip: "all" });
    expect(readFeedbackQuery({ eveniment: "<script>", data: "4.10.2026" })).toEqual({ branch: null, eventSlug: null, date: null, chip: "all" });
    expect(readDay("2028-02-29")).toBe("2028-02-29");
    expect(readDay("2027-02-29")).toBeNull();
  });

  it("writes the thank-you's and the event page's link as the branch, the event and its day", () => {
    expect(feedbackQueryFor("crosul", "2026-10-04")).toEqual({ tip: "cum-a-fost", eveniment: "crosul", data: "2026-10-04" });
    expect(feedbackQueryFor(null, null)).toEqual({ tip: "cum-a-fost" });
  });
});

describe("§676 the forms", () => {
  it("requires what happened, keeps it to 2 000 characters, and takes an address only when it is one", () => {
    expect(feedbackFields.safeParse({ locale: "ro", branch: "suggestion", message: "", email: "" }).success).toBe(false);
    expect(feedbackFields.safeParse({ locale: "ro", branch: "suggestion", message: "x".repeat(2001), email: "" }).success).toBe(false);
    expect(feedbackFields.safeParse({ locale: "ro", branch: "suggestion", identity: "named", name: "Ana Pop", message: "Mai multe alergări seara.", email: "not an address" }).success).toBe(false);
    expect(parse({ branch: "suggestion", message: "Mai multe alergări seara.", email: "" })).toMatchObject({ email: null });
  });

  it("keeps the ticks in the form's order, whatever order they were posted in, and refuses a rating outside 1–5", () => {
    const input = parse({ branch: "howItWent", event: "", date: "", rating: "4", message: "Bine.", reasons: ["moved", "time"], reasonOther: "", email: "" });
    expect(input).toMatchObject({ rating: 4, reasons: ["time", "moved"], event: null, date: null });
    expect(feedbackFields.safeParse({ locale: "ro", branch: "howItWent", event: "", date: "", rating: "6", message: "x", reasons: [], reasonOther: "", email: "" }).success).toBe(false);
  });
});

describe("§678 anonymous, or with one's name", () => {
  it("every branch's form starts with the name and its way back, inside the choice at the very top", () => {
    for (const [branch, fields] of Object.entries(BRANCH_FIELDS)) {
      expect(fields[0], branch).toBe("name");
      // The optional email is every named form's second box; Girl Zone's telephone follows it (§772).
      expect(fields[1], branch).toBe("email");
    }
    expect(BRANCH_FIELDS.safety[2]).toBe("contact");
  });

  it("reads anything but «Cu nume și prenume» as anonymous, and then drops the name and the way back — even a box the page hid that would not pass", () => {
    for (const identity of [undefined, "", "anonymous", "someone"]) {
      const suggestion = parse({ branch: "suggestion", identity, name: "Ana Pop", message: "Seara.", email: "not an address" });
      expect(suggestion).toMatchObject({ identity: "anonymous", name: "", email: null });
      const safety = parse({ branch: "safety", identity, name: "Ana Pop", message: "Cineva m-a urmărit.", whereWhen: "", contact: "0700 000 000" });
      expect(safety).toMatchObject({ identity: "anonymous", name: "", contact: "" });
    }
  });

  it("requires a name in the named mode and names the box, beside any other refusal", () => {
    const refused = feedbackFields.safeParse({ locale: "ro", branch: "complaint", identity: "named", name: "   ", message: "", event: "", date: "", email: "" });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((issue) => issue.path[0]).sort()).toEqual(["message", "name"]);
    expect(parse({ branch: "complaint", identity: "named", name: " Ana  Pop\n", message: "Nimeni la start.", event: "", date: "", email: "ana@example.org" })).toMatchObject({
      identity: "named",
      name: "Ana  Pop",
      email: "ana@example.org",
    });
  });

  it("takes a name of 2 to 80 characters in the named mode, and refuses one outside on the box", () => {
    expect([FEEDBACK_NAME_MIN, FEEDBACK_NAME_MAX]).toEqual([2, 80]);
    const named = (name: string) => feedbackFields.safeParse({ locale: "ro", branch: "suggestion", identity: "named", name, message: "Seara.", email: "" });
    for (const length of [1, 81]) {
      const refused = named("A".repeat(length));
      expect(refused.success, String(length)).toBe(false);
      expect(refused.error?.issues.map((issue) => issue.path[0])).toEqual(["name"]);
    }
    for (const length of [2, 80]) expect(named("A".repeat(length)).success, String(length)).toBe(true);
    // Measured once the edges are trimmed: two letters inside spaces are two.
    expect(named("  Io  ").data?.name).toBe("Io");
    // Anonymous, a name of any length is simply dropped, never refused.
    expect(feedbackFields.safeParse({ locale: "ro", branch: "suggestion", identity: "anonymous", name: "A", message: "Seara.", email: "" }).success).toBe(true);
  });

  it("opens the email with «Nume: …» — the name given, or «(anonim)»", () => {
    const anonymous = composeFeedbackEmail(parse({ branch: "suggestion", message: "Seara.", email: "" }), { eventTitle: null }, "production");
    expect(anonymous.text.split("\n")[0]).toBe(`Nume: ${ANONYMOUS_NAME_LINE}`);
    const named = composeFeedbackEmail(
      parse({ branch: "safety", identity: "named", name: "Ana Pop", message: "Cineva m-a urmărit.", whereWhen: "", contact: "0700 000 000" }),
      { eventTitle: null },
      "production",
    );
    expect(named.text.split("\n")[0]).toBe("Nume: Ana Pop");
    expect(named.html.startsWith("<p><strong>Nume:</strong> Ana Pop<br>")).toBe(true);
    expect(named.text).toContain("Contact: 0700 000 000");
    // The subject still names nobody.
    expect(named.subject).toBe(SAFETY_SUBJECT);
  });
});

describe("§678 «Cine să afle?»: the club or the safety branch's person", () => {
  const roads = { ...BOTH, clubFallback: true };

  it("offers the club and the person on every branch while both exist, the club first", () => {
    for (const branch of ["howItWent", "suggestion", "complaint", "safety"] as const) expect(audiencesFor(branch, ON, roads), branch).toEqual(["club", "person"]);
  });

  it("offers the person whenever the safety branch has its recipient and its first name, switched on or not", () => {
    expect(audiencesFor("suggestion", { ...ON, safety: { on: false, to: "safety@example.org", via: "mailgun", name: "Maria", fallbackToGmail: false } }, roads)).toEqual(["club", "person"]);
    expect(audiencesFor("suggestion", { ...ON, safety: { on: true, to: null, via: "mailgun", name: "Maria", fallbackToGmail: false } }, roads)).toEqual(["club"]);
    expect(audiencesFor("suggestion", { ...ON, safety: { on: true, to: "safety@example.org", via: "mailgun", name: null, fallbackToGmail: false } }, roads)).toEqual(["club"]);
  });

  it("offers the club on the safety form through «O reclamație»'s recipient or else the contact form's, and only where the SMTP road exists", () => {
    const noComplaint = { ...ON, complaint: { on: false, to: null, via: "gmail" as const } };
    expect(audiencesFor("safety", noComplaint, { ...BOTH, clubFallback: true })).toEqual(["club", "person"]);
    expect(audiencesFor("safety", noComplaint, { ...BOTH, clubFallback: false })).toEqual(["person"]);
    expect(audiencesFor("safety", ON, { ...BOTH, clubFallback: false })).toEqual(["club", "person"]);
    expect(audiencesFor("safety", ON, { ...NO_GMAIL, clubFallback: true })).toEqual(["person"]);
  });

  it("reaches the branch's own reader when anonymous or when the named post chose nobody, the one chosen otherwise, and nobody for a choice not offered", () => {
    expect([defaultAudience("safety"), defaultAudience("complaint")]).toEqual(["person", "club"]);
    expect(chosenAudience({ branch: "complaint", identity: "anonymous", audience: "" }, ["club", "person"])).toBe("club");
    expect(chosenAudience({ branch: "safety", identity: "anonymous", audience: "" }, ["club", "person"])).toBe("person");
    expect(chosenAudience({ branch: "complaint", identity: "named", audience: "" }, ["club", "person"])).toBe("club");
    expect(chosenAudience({ branch: "complaint", identity: "named", audience: "person" }, ["club", "person"])).toBe("person");
    expect(chosenAudience({ branch: "safety", identity: "named", audience: "club" }, ["club", "person"])).toBe("club");
    expect(chosenAudience({ branch: "complaint", identity: "named", audience: "person" }, ["club"])).toBeNull();
    // An anonymous post never chooses: whatever it carried was dropped before.
    expect(parse({ branch: "complaint", identity: "anonymous", audience: "person", message: "Nimeni.", event: "", date: "", email: "" }).audience).toBe("");
  });

  it("refuses an answer that is not one of the two, on the box", () => {
    const refused = feedbackFields.safeParse({ locale: "ro", branch: "suggestion", identity: "named", name: "Ana Pop", audience: "someone@example.org", message: "Seara.", email: "" });
    expect(refused.error?.issues.map((issue) => issue.path[0])).toEqual(["audience"]);
  });

  it("is no named mode at all while the notice in force does not name {{feedbackFormsNamed}}", () => {
    expect(namedModeFor("suggestion", ON, false, roads)).toBeNull();
    expect(namedModeFor("suggestion", ON, true, roads)).toEqual({ audiences: ["club", "person"] });
  });

  it("a message for the person carries the neutral subject and says the sender chose her", () => {
    const input = parse({ branch: "suggestion", identity: "named", name: "Ana Pop", audience: "person", message: "Seara.", email: "ana@example.org" });
    const toPerson = composeFeedbackEmail(input, { eventTitle: null, toPerson: true }, "production");
    expect(toPerson.subject).toBe(SAFETY_SUBJECT);
    expect(toPerson.text).toContain("cine a scris a ales să afli doar tu");
    expect(toPerson.text.split("\n")[1]).toBe("Din formularul: „O sugestie”");
    const toClub = composeFeedbackEmail(input, { eventTitle: null }, "production");
    expect(toClub.subject).toBe("O sugestie de pe site");
    expect(toClub.text).not.toContain("Din formularul");
    // Her own form needs no such line.
    const safety = parse({ branch: "safety", message: "Cineva m-a urmărit.", whereWhen: "", contact: "" });
    expect(composeFeedbackEmail(safety, { eventTitle: null, toPerson: true }, "production").text).not.toContain("Din formularul");
  });

  it("§679 the safety email's footer names «Girl Zone»; its subject stays neutral", () => {
    const safety = parse({ branch: "safety", message: "Cineva m-a urmărit.", whereWhen: "", contact: "" });
    const email = composeFeedbackEmail(safety, { eventTitle: null }, "production");
    expect(SAFETY_SUBJECT).toBe("Mesaj confidențial de pe site");
    expect(email.subject).toBe(SAFETY_SUBJECT);
    expect(email.text).toContain("— Trimis prin formularul confidențial „Girl Zone” al site-ului. Site-ul nu a păstrat nimic din el.");
    expect(email.subject).not.toContain("Girl Zone");
  });
});

describe("§676 the email each branch becomes", () => {
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
    expect(lines.slice(0, 7)).toEqual([
      `Nume: ${ANONYMOUS_NAME_LINE}`,
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
    const input = parse({ branch: "complaint", identity: "named", name: "Ana Pop", message: "<b>Nimeni</b> la start.", event: "nu-exista", date: "", email: "ana@example.org" });
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
    const reachable = composeFeedbackEmail(
      parse({ branch: "safety", identity: "named", name: "Ana Pop", message: "Cineva m-a urmărit după alergare.", whereWhen: "", contact: "0700 000 000" }),
      { eventTitle: null },
      "production",
    );
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

describe("§676 the picker's order", () => {
  it("lists the events held, the most recent first, then the ones ahead, the soonest first", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const at = (iso: string) => ({ startsAt: new Date(iso), id: iso });
    const order = pickerOrder([at("2026-10-01T08:00:00Z"), at("2026-10-20T08:00:00Z"), at("2026-10-07T08:00:00Z"), at("2026-10-10T08:00:00Z")], now);
    expect(order.map((event) => event.id)).toEqual(["2026-10-07T08:00:00Z", "2026-10-01T08:00:00Z", "2026-10-10T08:00:00Z", "2026-10-20T08:00:00Z"]);
  });
});

describe("§772 Girl Zone's road follows the notice in force", () => {
  const gmail = { ...DEFAULT_FEEDBACK_SETTINGS, safety: { ...DEFAULT_FEEDBACK_SETTINGS.safety, via: "gmail" as const } };

  it("is Gmail only while the notice names {{feedbackSafetyGmail}}; Mailgun otherwise, and the other forms are never touched", () => {
    expect(effectiveFeedbackSettings(gmail, true).safety.via).toBe("gmail");
    expect(effectiveFeedbackSettings(gmail, false).safety.via).toBe("mailgun");
    expect(effectiveFeedbackSettings(gmail, false).complaint.via).toBe("gmail");
    expect(effectiveFeedbackSettings(DEFAULT_FEEDBACK_SETTINGS, false)).toBe(DEFAULT_FEEDBACK_SETTINGS);
  });

  it("tells the visitor her message is seen by the mailbox's readers only on the Gmail road", () => {
    expect(safetyMessageSeenByMailboxReaders(effectiveFeedbackSettings(gmail, true))).toBe(true);
    expect(safetyMessageSeenByMailboxReaders(effectiveFeedbackSettings(gmail, false))).toBe(false);
    expect(safetyMessageSeenByMailboxReaders(DEFAULT_FEEDBACK_SETTINGS)).toBe(false);
  });

  it("is a marker of the notice's template, in both languages, read by the same function as the others", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesFeedbackSafetyGmail(body)).toBe(true);
      expect(describesFeedbackSafetyGmail(JSON.parse(JSON.stringify(body).split("{{feedbackSafetyGmail}}").join("Gmail-ul său")))).toBe(false);
    }
  });
});

describe("§676 the notice's marker", () => {
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

  it("§678 the template names the named mode too, in both languages, beside the forms' own marker; a text without it has no named mode", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesFeedbackForms(body)).toBe(true);
      expect(describesFeedbackFormsNamed(body)).toBe(true);
    }
    const strip = (body: unknown) => JSON.parse(JSON.stringify(body).split("{{feedbackFormsNamed}}").join("cu numele"));
    expect(describesFeedbackFormsNamed(strip(privacyNoticeRo))).toBe(false);
    expect(describesFeedbackForms(strip(privacyNoticeRo))).toBe(true);
  });

  it("§678 fills the named mode's marker with the radio's own words, quoted", () => {
    expect(feedbackFormsNamedClause("ro")).toBe("„Cu nume și prenume”");
    expect(feedbackFormsNamedClause("en")).toBe("“With my name”");
    expect(feedbackFormsMergeValues("en")).toEqual({ feedbackForms: "“Tell us something”", feedbackFormsNamed: "“With my name”", feedbackSafetyGmail: "the club's Gmail" });
    expect(feedbackSafetyGmailClause("ro")).toBe("Gmail-ul clubului");
  });
});

describe("§676 the addresses the action sends the browser back to", () => {
  it("keeps ?tip=, names the boxes, carries ?since= and lands on the summary; without a branch, no ?tip=", () => {
    expect(feedbackRefusalUrl("/ro/contact/spune-ne", "complaint", "VALIDATION_ERROR", { fields: ["message", "date"], renderedAt: "2026-10-08T12:00:00.000Z" })).toBe(
      "/ro/contact/spune-ne?tip=reclamatie&error=VALIDATION_ERROR&fields=message,date&since=2026-10-08T12%3A00%3A00.000Z#feedback-errors",
    );
    expect(feedbackRefusalUrl("/en/contact/tell-us", null, "UNAVAILABLE")).toBe("/en/contact/tell-us?error=UNAVAILABLE#feedback-errors");
    expect(feedbackRefusalUrl("/ro/contact/spune-ne", "safety", "LIMITED", { fields: [], renderedAt: "" })).toBe("/ro/contact/spune-ne?tip=girl-zone&error=LIMITED#feedback-errors");
  });

  it("answers a sent post with the branch's slug", () => {
    expect(feedbackSentUrl("/ro/contact/spune-ne", "howItWent")).toBe("/ro/contact/spune-ne?sent=cum-a-fost");
    expect(feedbackSentUrl("/ro/contact/spune-ne", null)).toBe("/ro/contact/spune-ne?sent=");
  });

  it("§678 names the other reader a named message reached, by a word, and reads it back", () => {
    expect(feedbackSentUrl("/ro/contact/spune-ne", "safety", "club")).toBe("/ro/contact/spune-ne?sent=girl-zone&catre=clubul");
    expect(feedbackSentUrl("/ro/contact/spune-ne", "complaint", "person")).toBe("/ro/contact/spune-ne?sent=reclamatie&catre=persoana");
    expect(sentReader("safety", "clubul")).toBe("club");
    expect(sentReader("complaint", "persoana")).toBe("person");
    expect(sentReader("safety", null)).toBe("person");
    expect(sentReader("complaint", "someone@example.org")).toBe("club");
  });
});

describe("§772 Girl Zone's address is `girl-zone`, and `siguranta` still opens it", () => {
  it("writes the new slug everywhere an address is built, and keeps the other three", () => {
    expect(BRANCH_SLUG).toEqual({ howItWent: "cum-a-fost", suggestion: "sugestie", complaint: "reclamatie", safety: "girl-zone" });
    expect(feedbackRefusalUrl("/ro/contact/spune-ne", "safety", "LIMITED")).toContain("?tip=girl-zone&");
    expect(feedbackSentUrl("/en/contact/tell-us", "safety")).toBe("/en/contact/tell-us?sent=girl-zone");
    expect(JSON.stringify(BRANCH_SLUG)).not.toContain("siguranta");
  });

  it("reads the old word as the same branch — an old link in a sent email or on paper keeps working", () => {
    expect(BRANCH_SLUG_ALIASES).toEqual({ siguranta: "safety" });
    expect(branchFromSlug("girl-zone")).toBe("safety");
    expect(branchFromSlug("siguranta")).toBe("safety");
    expect(readFeedbackQuery({ tip: "siguranta" }).branch).toBe("safety");
    // Not a door for anything else the address bar may carry, `Object` prototype names included.
    for (const word of ["admin", "", "toString", "__proto__", "constructor", undefined, null]) expect(branchFromSlug(word as string | null | undefined), String(word)).toBeNull();
  });

  it("moves a link with the old word to the new address on a GET, keeping every other word of the query", () => {
    expect(aliasRedirect("/ro/contact/spune-ne", { tip: "siguranta" })).toBe("/ro/contact/spune-ne?tip=girl-zone");
    expect(aliasRedirect("/en/contact/tell-us", { tip: "siguranta", eveniment: "crosul", data: "2026-10-04" })).toBe("/en/contact/tell-us?tip=girl-zone&eveniment=crosul&data=2026-10-04");
    // The sent page's word too, and a refusal's field names with their commas.
    expect(aliasRedirect("/ro/contact/spune-ne", { sent: "siguranta", catre: "clubul" })).toBe("/ro/contact/spune-ne?sent=girl-zone&catre=clubul");
    expect(aliasRedirect("/ro/contact/spune-ne", { tip: "siguranta", error: "VALIDATION_ERROR", fields: "message,whereWhen" })).toBe(
      "/ro/contact/spune-ne?tip=girl-zone&error=VALIDATION_ERROR&fields=message,whereWhen",
    );
  });

  it("moves nothing that does not need it, so the page never loops", () => {
    expect(aliasRedirect("/ro/contact/spune-ne", { tip: "girl-zone" })).toBeNull();
    expect(aliasRedirect("/ro/contact/spune-ne", {})).toBeNull();
    expect(aliasRedirect("/ro/contact/spune-ne", { tip: "cum-a-fost", sent: "reclamatie" })).toBeNull();
    // A word that merely contains the old one is not it.
    expect(aliasRedirect("/ro/contact/spune-ne", { eveniment: "siguranta" })).toBeNull();
    // The redirect's own target needs no second move.
    expect(aliasRedirect("/ro/contact/spune-ne", { tip: "girl-zone", eveniment: "siguranta" })).toBeNull();
  });
});

describe("§772 the road each form leaves by", () => {
  it("is, until the club chooses, what §676 fixed in code: Gmail for the three, Mailgun for Girl Zone", () => {
    expect(DEFAULT_VIA).toEqual({ howItWent: "gmail", suggestion: "gmail", complaint: "gmail", safety: "mailgun" });
    for (const branch of ["howItWent", "suggestion", "complaint", "safety"] as const) expect(DEFAULT_FEEDBACK_SETTINGS[branch].via, branch).toBe(DEFAULT_VIA[branch]);
  });

  it("follows the form whose reader the message reaches: the form for the club's mailbox, Girl Zone's own for the person", () => {
    // The defaults reproduce §676 and §678 exactly: the club's mailbox by Gmail, the person by Mailgun.
    for (const branch of ["howItWent", "suggestion", "complaint", "safety"] as const) {
      expect(viaFor(ON, branch, "person"), `${branch} to the person`).toBe("mailgun");
      expect(viaFor(ON, branch, "club"), `${branch} to the club`).toBe("gmail");
    }
    // A Girl Zone message for «Clubul» reaches the mailbox «O reclamație» names, so it leaves by that form's road.
    expect(roadBranch("safety", "club")).toBe("complaint");
    expect(roadBranch("safety", "person")).toBe("safety");
    expect(roadBranch("suggestion", "club")).toBe("suggestion");
    expect(roadBranch("suggestion", "person")).toBe("safety");
  });

  it("is what the club chose when it chose otherwise", () => {
    const swapped: FeedbackSettings = { ...ON, suggestion: { ...ON.suggestion, via: "mailgun" }, safety: { ...ON.safety, via: "gmail" } };
    expect(viaFor(swapped, "suggestion", "club")).toBe("mailgun");
    expect(viaFor(swapped, "howItWent", "club")).toBe("gmail");
    expect(viaFor(swapped, "howItWent", "person")).toBe("gmail");
    expect(viaFor(swapped, "safety", "person")).toBe("gmail");
  });

  it("offers a form only where its own road exists — Gmail where there is the SMTP road, Mailgun where the email service transmits", () => {
    const NO_MAILGUN = { gmail: true, mailgun: false };
    expect(offeredBranches(ON, true, NO_MAILGUN)).toEqual(["howItWent", "suggestion", "complaint"]);
    expect(offeredBranches(ON, true, NO_GMAIL)).toEqual(["safety"]);
    expect(offeredBranches(ON, true, { gmail: false, mailgun: false })).toEqual([]);
    // Girl Zone by Gmail needs the SMTP road, not Mailgun; «Cum a fost» by Mailgun needs Mailgun, not the SMTP road.
    const crossed: FeedbackSettings = { ...ON, howItWent: { ...ON.howItWent, via: "mailgun" }, safety: { ...ON.safety, via: "gmail" } };
    expect(offeredBranches(crossed, true, NO_GMAIL)).toEqual(["howItWent"]);
    expect(offeredBranches(crossed, true, NO_MAILGUN)).toEqual(["suggestion", "complaint", "safety"]);
  });

  it("offers «Cine să afle?» only the readers whose road exists", () => {
    const roads = { clubFallback: true };
    expect(audiencesFor("suggestion", ON, { ...BOTH, ...roads })).toEqual(["club", "person"]);
    // No Gmail: the club's mailbox by Gmail has no road; the person by Mailgun does.
    expect(audiencesFor("suggestion", ON, { ...NO_GMAIL, ...roads })).toEqual(["person"]);
    // No Mailgun: the person by Mailgun has no road.
    expect(audiencesFor("suggestion", ON, { gmail: true, mailgun: false, ...roads })).toEqual(["club"]);
    // The club chose Gmail for Girl Zone: she is reached wherever Gmail is.
    const gmailGirlZone: FeedbackSettings = { ...ON, safety: { ...ON.safety, via: "gmail" } };
    expect(audiencesFor("suggestion", gmailGirlZone, { gmail: true, mailgun: false, ...roads })).toEqual(["club", "person"]);
  });
});

describe("§772 the optional email beside the name", () => {
  const named = (raw: Record<string, unknown>) => feedbackFields.safeParse({ locale: "ro", identity: "named", name: "Ana Pop", message: "Seara.", ...raw });

  it("is kept as typed, trimmed, when the canonicalizer accepts it — capitals and a plus tag are the person's own", () => {
    expect(named({ branch: "suggestion", email: "  Ana.Pop+club@Example.org " }).data).toMatchObject({ email: "Ana.Pop+club@Example.org" });
    expect(named({ branch: "suggestion", email: "" }).data).toMatchObject({ email: null });
    expect(named({ branch: "complaint", event: "", date: "", email: "ana@example.org" }).data).toMatchObject({ email: "ana@example.org" });
  });

  it("refuses, on the box, an address the canonicalizer refuses — before anything is sent", () => {
    for (const bad of ["not an address", "ana@", "@example.org", "ana@@example.org", "ana@example", "a b@example.org", "ana@example.org, bob@example.org", "Ana <ana@example.org>", "ana@exa​mple.org", "+tag@gmail.com"]) {
      const refused = named({ branch: "suggestion", email: bad });
      expect(refused.success, bad).toBe(false);
      expect(refused.error?.issues.map((issue) => issue.path[0]), bad).toEqual(["email"]);
    }
  });

  it("is dropped, not refused, in the anonymous mode: a box the page hid never stops a post", () => {
    expect(feedbackFields.safeParse({ locale: "ro", branch: "suggestion", identity: "anonymous", message: "Seara.", email: "not an address" }).data).toMatchObject({ email: null });
  });

  it("reads as a reply address only when it is one", () => {
    expect(replyAddressOf(" ana@example.org ")).toBe("ana@example.org");
    for (const typed of ["", "0700 000 000", "ana@", "ana@example.org bob@example.org"]) expect(replyAddressOf(typed), typed).toBeNull();
  });

  it("is the message's Reply-To in the named mode, on every form: the box on three, Girl Zone's way back when it is an address", () => {
    const suggestion = named({ branch: "suggestion", email: "ana@example.org" }).data as FeedbackInput;
    expect(replyAddressForInput(suggestion)).toBe("ana@example.org");
    // Girl Zone has the same email box, beside the telephone (§772); an address typed in the telephone box still answers.
    const safetyByEmail = named({ branch: "safety", whereWhen: "", email: "ana@example.org", contact: "0700 000 000" }).data as FeedbackInput;
    expect(replyAddressForInput(safetyByEmail)).toBe("ana@example.org");
    const safetyByAddress = named({ branch: "safety", whereWhen: "", contact: "ana@example.org" }).data as FeedbackInput;
    expect(replyAddressForInput(safetyByAddress)).toBe("ana@example.org");
    // A telephone has no Reply-To, and the body carries it.
    const safetyByPhone = named({ branch: "safety", whereWhen: "", contact: "0700 000 000" }).data as FeedbackInput;
    expect(replyAddressForInput(safetyByPhone)).toBeNull();
    // Anonymous: nobody to answer.
    expect(replyAddressForInput(parse({ branch: "suggestion", message: "Seara.", email: "ana@example.org" }))).toBeNull();
  });
});
