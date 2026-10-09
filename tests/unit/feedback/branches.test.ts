import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_NAME_LINE,
  audiencesFor,
  BRANCH_FIELDS,
  chosenAudience,
  defaultAudience,
  FEEDBACK_NAME_MAX,
  FEEDBACK_NAME_MIN,
  namedModeFor,
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
  sentReader,
  wizardStep,
} from "@/modules/feedback/domain/branches";
import { describesFeedbackForms, describesFeedbackFormsNamed } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { feedbackFormsClause, feedbackFormsMergeValues, feedbackFormsNamedClause } from "@/modules/feedback/notice-words";

/**
 * BR-REQ-070-04, `DECISIONS.md` §676 — «Spune-ne ceva»'s rules, pure: which branches are offered,
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

describe("§676 the branches a visitor is offered", () => {
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

  it("says the door's sentence from what is offered: the safety form's own with «Girl Zone» alone, the three forms' otherwise", () => {
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

describe("§676 the address bar, read and never trusted", () => {
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
      expect(fields[1], branch).toBe(branch === "safety" ? "contact" : "email");
    }
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
  const roads = { smtp: true, clubFallback: true };

  it("offers the club and the person on every branch while both exist, the club first", () => {
    for (const branch of ["howItWent", "suggestion", "complaint", "safety"] as const) expect(audiencesFor(branch, ON, roads), branch).toEqual(["club", "person"]);
  });

  it("offers the person whenever the safety branch has its recipient and its first name, switched on or not", () => {
    expect(audiencesFor("suggestion", { ...ON, safety: { on: false, to: "safety@example.org", name: "Maria" } }, roads)).toEqual(["club", "person"]);
    expect(audiencesFor("suggestion", { ...ON, safety: { on: true, to: null, name: "Maria" } }, roads)).toEqual(["club"]);
    expect(audiencesFor("suggestion", { ...ON, safety: { on: true, to: "safety@example.org", name: null } }, roads)).toEqual(["club"]);
  });

  it("offers the club on the safety form through «O reclamație»'s recipient or else the contact form's, and only where the SMTP road exists", () => {
    const noComplaint = { ...ON, complaint: { on: false, to: null } };
    expect(audiencesFor("safety", noComplaint, { smtp: true, clubFallback: true })).toEqual(["club", "person"]);
    expect(audiencesFor("safety", noComplaint, { smtp: true, clubFallback: false })).toEqual(["person"]);
    expect(audiencesFor("safety", ON, { smtp: true, clubFallback: false })).toEqual(["club", "person"]);
    expect(audiencesFor("safety", ON, { smtp: false, clubFallback: true })).toEqual(["person"]);
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
    expect(feedbackFormsMergeValues("en")).toEqual({ feedbackForms: "“Tell us something”", feedbackFormsNamed: "“With my name”" });
  });
});

describe("§676 the addresses the action sends the browser back to", () => {
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

  it("§678 names the other reader a named message reached, by a word, and reads it back", () => {
    expect(feedbackSentUrl("/ro/contact/spune-ne", "safety", "club")).toBe("/ro/contact/spune-ne?sent=siguranta&catre=clubul");
    expect(feedbackSentUrl("/ro/contact/spune-ne", "complaint", "person")).toBe("/ro/contact/spune-ne?sent=reclamatie&catre=persoana");
    expect(sentReader("safety", "clubul")).toBe("club");
    expect(sentReader("complaint", "persoana")).toBe("person");
    expect(sentReader("safety", null)).toBe("person");
    expect(sentReader("complaint", "someone@example.org")).toBe("club");
  });
});
