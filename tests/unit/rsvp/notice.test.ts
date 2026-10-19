import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesRsvp, describesRsvpAsk, MERGE_FIELDS, mergeFieldsIn, mergeText, RSVP_ASK_MERGE_FIELD, RSVP_MERGE_FIELD } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { TASK_TARGETS } from "@/modules/diagnostics/domain/task-targets";
import { RSVP_CONFIRM_HOURS } from "@/modules/rsvp/domain/link-life";
import { topicsPhrase } from "@/modules/newsletter/topic-words";
import { rsvpAskClause, rsvpClause, rsvpMergeValues } from "@/modules/rsvp/notice-words";

/**
 * §811 («Vin!» part 1) — the privacy notice's `{{rsvp}}`: the switch the page, the service and the tasks list read, filled with the
 * button's own name; the template's paragraphs in both languages; the tasks row; the terms left alone (nothing is bought, booked or
 * signed by an answer).
 */
const sentences = (body: { sections: readonly { paragraphs: readonly string[] }[] }) => body.sections.flatMap((section) => section.paragraphs);

describe("§811 {{rsvp}} is a merge field, the notice's switch, and the button's name", () => {
  it("is known to the editor and filled with the button's own name in each language", () => {
    expect(MERGE_FIELDS).toContain(RSVP_MERGE_FIELD);
    expect(rsvpClause("ro")).toBe(`„${ro.Event.rsvp.submit}”`);
    expect(rsvpClause("en")).toBe(`“${en.Event.rsvp.submit}”`);
    expect(mergeText("Răspunsul {{rsvp}} apare", rsvpMergeValues("ro"))).toBe("Răspunsul „Vin!” apare");
    expect(mergeText("The {{rsvp}} answer", rsvpMergeValues("en"))).toBe("The “I'm coming!” answer");
  });

  it("is explained in the legal editor's legend, in both languages", () => {
    const entry = DECLARATION_TOKENS.find((token) => token.token === "{{rsvp}}");
    expect(entry?.messageKey).toBe("rsvp");
    expect(entry?.example.ro).toBe(rsvpClause("ro"));
    expect(entry?.example.en).toBe(rsvpClause("en"));
    expect(ro.Admin.legal.tokens.rsvp.length).toBeGreaterThan(20);
    expect(en.Admin.legal.tokens.rsvp.length).toBeGreaterThan(20);
  });

  it("is what makes a notice describe «Vin!» — a text with the marker does, one without it, or any non-body, does not", () => {
    expect(describesRsvp(privacyNoticeRo)).toBe(true);
    expect(describesRsvp(privacyNoticeEn)).toBe(true);
    expect(describesRsvp(JSON.parse(JSON.stringify(privacyNoticeRo).replaceAll("{{rsvp}}", "")))).toBe(false);
    expect(describesRsvp({ sections: [{ heading: "4. Lista publică", paragraphs: ["Nimic despre răspunsuri."] }] })).toBe(false);
    expect(describesRsvp("not a body")).toBe(false);
    expect(describesRsvp(null)).toBe(false);
  });
});

describe("§811 the template says what «Vin!» publishes, keeps, mails and remembers — in both languages", () => {
  it("names the marker in the notice's four paragraphs of each language", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(mergeFieldsIn(body).has(RSVP_MERGE_FIELD)).toBe(true);
      expect(sentences(body).filter((paragraph) => paragraph.includes("{{rsvp}}"))).toHaveLength(2);
    }
  });

  it("publishes the count and the name only of those who ticked, and says an answer is not a registration (section 4)", () => {
    const ro4 = privacyNoticeRo.sections[3].paragraphs.find((paragraph) => paragraph.includes("{{rsvp}}")) ?? "";
    expect(ro4).toContain("Vreau să apar cu numele");
    expect(ro4).toContain("doar al celor care au bifat");
    expect(ro4).toContain("nu ține un loc");
    const en4 = privacyNoticeEn.sections[3].paragraphs.find((paragraph) => paragraph.includes("{{rsvp}}")) ?? "";
    expect(en4).toContain("I want my name to show");
    expect(en4).toContain("holds no place");
  });

  it("says where the name is unticked, and that a hidden name stays in the answer, not public (§NNN)", () => {
    const ro4 = privacyNoticeRo.sections[3].paragraphs.find((paragraph) => paragraph.includes("{{rsvp}}")) ?? "";
    expect(ro4).toContain("debifând numele din browserul recunoscut, din zona membrilor sau pe pagina linkului „Nu mai vin”");
    expect(ro4).toContain("Debifat, numele rămâne în răspuns, dar nu mai apare public; îl poți bifa din nou.");
    const en4 = privacyNoticeEn.sections[3].paragraphs.find((paragraph) => paragraph.includes("{{rsvp}}")) ?? "";
    expect(en4).toContain("by unticking the name in a recognised browser, in the members' zone or on the page of the “I'm not coming any more” link");
    expect(en4).toContain("Unticked, the name stays in the answer but no longer shows publicly; you can tick it again.");
  });

  it("states the retention (section 7) and the cookie (section 10) with the numbers the sweep enforces", () => {
    const text = (body: typeof privacyNoticeRo, section: number) => body.sections[section - 1].paragraphs.join("\n");
    expect(text(privacyNoticeRo, 7)).toContain("30 de zile de la sfârșitul evenimentului");
    expect(text(privacyNoticeRo, 7)).toContain("după 7 zile");
    expect(text(privacyNoticeEn, 7)).toContain("30 days from the event's end");
    expect(text(privacyNoticeEn, 7)).toContain("after 7 days");
    expect(text(privacyNoticeRo, 10)).toContain("Legea nr. 506/2004, art. 4(6)");
    expect(text(privacyNoticeRo, 10)).toContain("Nu sunt eu");
    expect(text(privacyNoticeEn, 10)).toContain("art. 4(6)");
    expect(text(privacyNoticeEn, 10)).toContain("Not me");
  });

  it("leaves the terms alone: no marker, nothing about an answer", () => {
    for (const body of [termsRo, termsEn]) expect(mergeFieldsIn(body).has(RSVP_MERGE_FIELD)).toBe(false);
  });
});

describe("§811 the row on /admin/tasks", () => {
  it("has its words and its steps in both languages, pointing at /admin/legal", () => {
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.rsvpNotice;
      expect(item.title && item.todo && item.done).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
    expect(TASK_TARGETS.rsvpNotice).toEqual({ kind: "section", section: "legal" });
  });
});

describe("§812 the notice says what the links and the clean-up really do", () => {
  const ro5 = sentences(privacyNoticeRo).find((text) => text.startsWith("Răspunsul {{rsvp}}: dacă scrii"))!;
  const en5 = sentences(privacyNoticeEn).find((text) => text.startsWith("The {{rsvp}} answer: if you type"))!;

  it("states the «Da, vin» link's life from the constant the service mints it with, and «Nu vin» until the start", () => {
    expect(RSVP_CONFIRM_HOURS).toBe(48);
    expect(ro5).toContain(`„Da, vin” merge ${RSVP_CONFIRM_HOURS} de ore (cel târziu până la începutul evenimentului), „Nu vin”, până la începutul evenimentului`);
    expect(en5).toContain(`“Yes, I'm coming” works for ${RSVP_CONFIRM_HOURS} hours (at the latest until the event starts), “I'm not coming” until the event starts`);
    expect(ro5).not.toContain("expiră la începutul evenimentului");
  });

  it("says the throttle is per address AND event, and that «Nu mai vin» also recognises the browser", () => {
    expect(ro5).toContain("pentru aceeași adresă și același eveniment");
    expect(en5).toContain("for the same address and event");
    expect(ro5).toContain("recunoscut prin „Da, vin” sau „Nu mai vin” (secțiunea 10)");
    expect(en5).toContain("recognised by “Yes, I'm coming” or “I'm not coming any more” (section 10)");
  });

  it("deletes a cancelled event's answers at the next clean-up, not with the cancellation", () => {
    const all = (body: { sections: readonly { paragraphs: readonly string[] }[] }) => sentences(body).join("\n");
    expect(all(privacyNoticeRo)).toContain("la următoarea curățare automată după anulare");
    expect(all(privacyNoticeEn)).toContain("at the next automatic clean-up after the cancellation");
    expect(all(privacyNoticeRo)).not.toContain("odată cu anularea");
  });
});

/**
 * §818 — the day-before question has its own marker, `{{rsvpAsk}}`: the notice's switch for the question (the topic's name is listed by
 * `{{newsletterTopics}}` at once, so that marker alone could not be the switch), in the two paragraphs that describe it.
 */
describe("§818 {{rsvpAsk}} is the notice's switch for the «Vii mâine?» question", () => {
  it("is known to the editor, filled with the topic's own name, and explained in the legend in both languages", () => {
    expect(MERGE_FIELDS).toContain(RSVP_ASK_MERGE_FIELD);
    expect(rsvpAskClause("ro")).toBe(`„${ro.Newsletter.topics.RSVP_ASK}”`);
    expect(rsvpAskClause("en")).toBe(`“${en.Newsletter.topics.RSVP_ASK}”`);
    expect(rsvpMergeValues("ro").rsvpAsk).toBe(rsvpAskClause("ro"));
    const entry = DECLARATION_TOKENS.find((token) => token.token === "{{rsvpAsk}}");
    expect(entry?.messageKey).toBe("rsvpAsk");
    expect(entry?.example.ro).toBe(rsvpAskClause("ro"));
    for (const catalogue of [ro, en]) expect(catalogue.Admin.legal.tokens.rsvpAsk.length).toBeGreaterThan(20);
  });

  it("is what makes a notice describe the question: the template does, a notice without the marker or any non-body does not", () => {
    expect(describesRsvpAsk(privacyNoticeRo)).toBe(true);
    expect(describesRsvpAsk(privacyNoticeEn)).toBe(true);
    expect(describesRsvpAsk(JSON.parse(JSON.stringify(privacyNoticeRo).replaceAll("{{rsvpAsk}}", "")))).toBe(false);
    // A notice that names `{{newsletterTopics}}` lists the topic and still does not describe the question.
    expect(describesRsvpAsk({ sections: [{ heading: "5. Emails", paragraphs: ["Topics: {{newsletterTopics}}"] }] })).toBe(false);
    expect(describesRsvpAsk("not a body")).toBe(false);
  });

  it("is named in the newsletter's paragraph and in «Vin!»'s, in each language — and the terms say nothing of it", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      const paragraphs = sentences(body).filter((paragraph) => paragraph.includes("{{rsvpAsk}}"));
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs.some((paragraph) => paragraph.includes("{{newsletterTopics}}"))).toBe(true);
      expect(paragraphs.some((paragraph) => paragraph.includes("{{rsvp}}"))).toBe(true);
    }
    // What the «Vin!» paragraph says the question does with the address: an unconfirmed answer, deleted at «Nu vin» or after 7 days.
    const ro5 = sentences(privacyNoticeRo).find((text) => text.startsWith("Răspunsul {{rsvp}}: dacă scrii"))!;
    const en5 = sentences(privacyNoticeEn).find((text) => text.startsWith("The {{rsvp}} answer: if you type"))!;
    expect(ro5).toContain("răspuns neconfirmat");
    expect(ro5).toContain("după 7 zile");
    expect(en5).toContain("unconfirmed answer");
    expect(en5).toContain("after 7 days");
    for (const body of [termsRo, termsEn]) expect(mergeFieldsIn(body).has(RSVP_ASK_MERGE_FIELD)).toBe(false);
  });

  it("gives its /admin/tasks row words and steps in both languages, pointing at /admin/legal", () => {
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.rsvpAskNotice;
      expect(item.title && item.todo && item.done).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
    expect(TASK_TARGETS.rsvpAskNotice).toEqual({ kind: "section", section: "legal" });
  });

  it("names the topic without quotes inside its name, because every list wraps each name in a pair of its own", () => {
    for (const label of [ro.Newsletter.topics.RSVP_ASK, en.Newsletter.topics.RSVP_ASK]) expect(label).not.toMatch(/[„”“"]/);
    expect(mergeText("{{newsletterTopics}}", { newsletterTopics: topicsPhrase("ro", ["RSVP_ASK"]) })).toBe("„Întrebarea «Vii?» înaintea alergărilor”");
  });
});
