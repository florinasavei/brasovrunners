import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { TASK_TARGETS } from "@/modules/diagnostics/domain/task-targets";
import { describesRsvp, describesRsvpMember, MERGE_FIELDS, mergeFieldsIn, mergeText, RSVP_MEMBER_MERGE_FIELD } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { accountIdentity } from "@/modules/rsvp/domain/account-identity";
import { identityClubMember, identityOf, isConsistent } from "@/modules/rsvp/domain/identity";
import { accountClubMember, answerClubMember, mergeClubMember, parseClubMember, publicRsvpMember } from "@/modules/rsvp/domain/public-member";
import { rsvpCountText, rsvpSummarySuffix } from "@/modules/rsvp/domain/summary";
import { rsvpMemberClause, rsvpMergeValues } from "@/modules/rsvp/notice-words";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * §829 (BR-REQ-039-01, BR-REQ-060-01; amends §812 and §796) — «Cine vine» says who is a member: the pure rules. A declared tick is `DECLARED`; an answer from
 * the members' zone by an account of the club is `ACCOUNT`, from the role and never from a tick; the mark and the member count are read against the notice
 * version that described them (§421); the privacy notice's own marker `{{rsvpMember}}` is the switch. The service over a database is in
 * `tests/integration/rsvp/member-mark.test.ts`, the pages in `member-page.test.ts`.
 */
describe("§829 which kind of member an answer is", () => {
  it("reads «declared» from the person's own tick on the three doors that prove an address, and nothing without it", () => {
    for (const source of ["remembered", "link"] as const) {
      expect(identityClubMember(identityOf(source, { email: "a@example.test", showName: false, locale: "ro", clubMember: true }))).toBe("DECLARED");
      expect(identityClubMember(identityOf(source, { email: "a@example.test", showName: false, locale: "ro", clubMember: false }))).toBeNull();
      expect(identityClubMember(identityOf(source, { email: "a@example.test", showName: false, locale: "ro" }))).toBeNull();
    }
    expect(identityClubMember(identityOf("page", { email: "a@example.test", showName: false, locale: "ro", clubMember: true }))).toBe("DECLARED");
  });

  it("reads «account» from the role of a signed-in account — every role the club's accounts have is at least a member — whatever was posted", () => {
    for (const role of STAFF_ROLES) {
      expect(accountClubMember(role), role).toBe("ACCOUNT");
      // The form has no tick for an account, and a forged `clubMember: true` makes the identity inconsistent rather than «declared».
      expect(identityClubMember(accountIdentity({ email: "a@example.test", displayName: "Ana", role }, "ro", true)), role).toBe("ACCOUNT");
      expect(identityClubMember(accountIdentity({ email: "a@example.test", displayName: "Ana", role }, "ro", false)), role).toBe("ACCOUNT");
    }
  });

  it("marks nothing for an account read without a role, and an account never carries a tick", () => {
    expect(identityClubMember(accountIdentity({ email: "a@example.test", displayName: "Ana" }, "ro", true))).toBeNull();
    const forged = { ...accountIdentity({ email: "a@example.test", displayName: "Ana", role: "MEMBER" }, "ro", false), clubMember: true };
    expect(isConsistent(forged)).toBe(false);
    expect(answerClubMember({ accountRole: "MEMBER", tick: true })).toBe("ACCOUNT");
    expect(answerClubMember({ accountRole: null, tick: true })).toBe("DECLARED");
    expect(answerClubMember({ accountRole: null, tick: false })).toBeNull();
  });

  it("lets a role belong to an account only: a page, remembered or link identity that claims one is refused", () => {
    for (const source of ["page", "remembered", "link"] as const) {
      expect(isConsistent({ ...identityOf(source, { email: "a@example.test", showName: false, locale: "ro" }), role: "ADMIN" })).toBe(false);
    }
    expect(isConsistent(accountIdentity({ email: "a@example.test", displayName: "Ana", role: "ADMIN" }, "ro", false))).toBe(true);
  });

  it("keeps the stronger kind when a press arrives for an answer already held, and a silent press leaves what was said", () => {
    expect(mergeClubMember(null, "DECLARED")).toBe("DECLARED");
    expect(mergeClubMember("DECLARED", null)).toBe("DECLARED");
    expect(mergeClubMember("DECLARED", "ACCOUNT")).toBe("ACCOUNT");
    // The same person pressing from a remembered browser is still a member by their account.
    expect(mergeClubMember("ACCOUNT", "DECLARED")).toBe("ACCOUNT");
    expect(mergeClubMember("ACCOUNT", null)).toBe("ACCOUNT");
    expect(mergeClubMember(null, null)).toBeNull();
  });

  it("knows two kinds and treats anything else in the column as nothing said", () => {
    expect(parseClubMember("DECLARED")).toBe("DECLARED");
    expect(parseClubMember("ACCOUNT")).toBe("ACCOUNT");
    for (const value of [null, undefined, "", "VERIFIED", "declared"]) expect(parseClubMember(value)).toBeNull();
  });
});

describe("§829 who counts as a member on the public page — the §421 line", () => {
  const base = { confirmed: true, clubMember: "DECLARED" as const, privacyNoticeVersion: 2, firstMemberNoticeVersion: 2 };

  it("counts a confirmed answer that says it is a member, given under the first notice that described the mark or a later one", () => {
    expect(publicRsvpMember(base)).toBe(true);
    expect(publicRsvpMember({ ...base, privacyNoticeVersion: 5 })).toBe(true);
    expect(publicRsvpMember({ ...base, clubMember: "ACCOUNT" })).toBe(true);
  });

  it("does not count an answer given under an older notice — it agreed to a name, never to a mark", () => {
    expect(publicRsvpMember({ ...base, privacyNoticeVersion: 1 })).toBe(false);
  });

  it("does not count anything while no notice describes the mark, an unconfirmed answer, or an answer that says nothing", () => {
    expect(publicRsvpMember({ ...base, firstMemberNoticeVersion: null })).toBe(false);
    expect(publicRsvpMember({ ...base, confirmed: false })).toBe(false);
    expect(publicRsvpMember({ ...base, clubMember: null })).toBe(false);
  });
});

describe("§829 the words of «N vin · M membri»", () => {
  it("joins the count and the members with the house's middle dot, and says only the count when there is no member", () => {
    expect(rsvpCountText("3 vin", "2 membri")).toBe("3 vin · 2 membri");
    expect(rsvpCountText("3 vin", null)).toBe("3 vin");
  });

  it("is what the closed fold's line carries after the heading", () => {
    const words = { countText: rsvpCountText("1 vine", "1 membru"), emptyText: "Fii primul care confirmă", goingText: "Tu vii" };
    expect(rsvpSummarySuffix(words, false, true)).toBe(" · 1 vine · 1 membru");
    expect(rsvpSummarySuffix(words, true, true)).toBe(" · Tu vii ✓ · 1 vine · 1 membru");
  });

  it("says the count and the members in both languages, in the house's three Romanian forms", () => {
    expect(ro.Event.rsvp.members).toEqual({ one: "{count} membru", few: "{count} membri", other: "{count} de membri" });
    expect(en.Event.rsvp.members).toEqual({ one: "{count} member", few: "{count} members", other: "{count} members" });
    for (const catalogue of [ro, en]) {
      for (const form of ["one", "few", "other"] as const) expect(catalogue.Event.who.withMembers[form]).toContain("{members}");
    }
    expect(ro.Event.who.withMembers.few).toBe("{count} vin · {members} · vezi cine");
    expect(en.Event.who.withMembers.other).toBe("{count} coming · {members} · see who");
  });
});

describe("§829 {{rsvpMember}} is a merge field, the notice's switch, and the mark's name", () => {
  it("is known to the editor and filled with the mark's own word, quoted, in each language", () => {
    expect(MERGE_FIELDS).toContain(RSVP_MEMBER_MERGE_FIELD);
    expect(rsvpMemberClause("ro")).toBe(`„${ro.Event.rsvp.memberMark}”`);
    expect(rsvpMemberClause("en")).toBe(`“${en.Event.rsvp.memberMark}”`);
    expect(mergeText("semnul {{rsvpMember}} apare", rsvpMergeValues("ro"))).toBe("semnul „BVR” apare");
    expect(mergeText("the mark {{rsvpMember}} shows", rsvpMergeValues("en"))).toBe("the mark “BVR” shows");
  });

  it("is explained in the legal editor's legend, in both languages", () => {
    const entry = DECLARATION_TOKENS.find((token) => token.token === "{{rsvpMember}}");
    expect(entry?.messageKey).toBe("rsvpMember");
    expect(entry?.example.ro).toBe(rsvpMemberClause("ro"));
    expect(entry?.example.en).toBe(rsvpMemberClause("en"));
    expect(ro.Admin.legal.tokens.rsvpMember.length).toBeGreaterThan(20);
    expect(en.Admin.legal.tokens.rsvpMember.length).toBeGreaterThan(20);
  });

  it("is what makes a notice describe the mark — the template does, the same template without the marker does not, and «Vin!» alone does not", () => {
    expect(describesRsvpMember(privacyNoticeRo)).toBe(true);
    expect(describesRsvpMember(privacyNoticeEn)).toBe(true);
    const without = JSON.parse(JSON.stringify(privacyNoticeRo).replaceAll("{{rsvpMember}}", ""));
    expect(describesRsvpMember(without)).toBe(false);
    // A notice approved before this existed names «Vin!» and nothing about the mark: the same words, no marker.
    expect(describesRsvp(without)).toBe(true);
    expect(describesRsvpMember("not a body")).toBe(false);
    expect(describesRsvpMember(null)).toBe(false);
  });

  it("is a marker of its own, not a sentence under {{rsvp}}: a sentence there would be in force in every notice already approved", () => {
    expect(RSVP_MEMBER_MERGE_FIELD).not.toBe("rsvp");
    for (const body of [privacyNoticeRo, privacyNoticeEn]) expect(mergeFieldsIn(body).has(RSVP_MEMBER_MERGE_FIELD)).toBe(true);
  });
});

describe("§829 the template says what the mark shows, who decides, and how it is taken back — in both languages", () => {
  const paragraphOf = (body: { sections: readonly { paragraphs: readonly string[] }[] }, section: number, needle: string) =>
    body.sections[section].paragraphs.find((paragraph) => paragraph.includes(needle)) ?? "";

  it("says in section 4, in the «Vin!» paragraph, that the mark stands beside a shown name only, members are counted without names, the tick is the person's claim and the club does not check it", () => {
    const ro4 = paragraphOf(privacyNoticeRo, 3, "{{rsvpMember}}");
    expect(ro4).toContain("{{rsvp}}");
    expect(ro4).toContain("lângă numele afișat apare semnul {{rsvpMember}}");
    expect(ro4).toContain("fără nume");
    expect(ro4).toContain("Fără un nume afișat nu apare niciun semn");
    expect(ro4).toContain("declarația ta și clubul nu o verifică");
    expect(ro4).toContain("după ce această frază a intrat în vigoare");
    const en4 = paragraphOf(privacyNoticeEn, 3, "{{rsvpMember}}");
    expect(en4).toContain("{{rsvp}}");
    expect(en4).toContain("shows beside the name you show");
    expect(en4).toContain("With no name shown, no mark shows");
    expect(en4).toContain("the club does not check it");
    expect(en4).toContain("after this sentence took effect");
  });

  it("names the tick among what is kept, in section 5", () => {
    expect(paragraphOf(privacyNoticeRo, 4, "Răspunsul {{rsvp}}: dacă scrii")).toContain("dacă ai bifat că ești membru al grupului");
    expect(paragraphOf(privacyNoticeEn, 4, "The {{rsvp}} answer: if you type")).toContain("you ticked that you are a member of the group");
  });

  it("names the marker once per language, leaves the terms alone, and never writes the club's name into the sentence", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(body.sections.flatMap((section) => section.paragraphs).filter((paragraph) => paragraph.includes("{{rsvpMember}}"))).toHaveLength(1);
      expect(paragraphOf(body, 3, "{{rsvpMember}}")).not.toMatch(/Brașov Runners|Brasov Runners|BVR/);
    }
    for (const body of [termsRo, termsEn]) expect(mergeFieldsIn(body).has(RSVP_MEMBER_MERGE_FIELD)).toBe(false);
  });
});

describe("§829 the row on /admin/tasks", () => {
  it("has its words and its steps in both languages, pointing at /admin/legal", () => {
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.rsvpMemberNotice;
      expect(item.title && item.todo && item.done).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
    expect(TASK_TARGETS.rsvpMemberNotice).toEqual({ kind: "section", section: "legal" });
  });
});

describe("§829 the words of the tick, the mark and the editor's chips, in both catalogues", () => {
  it("says the mark in its own word and its accessible name with the club's name filled from the constant", () => {
    expect(ro.Event.rsvp.memberMark).toBe("BVR");
    expect(en.Event.rsvp.memberMark).toBe("BVR");
    expect(ro.Event.rsvp.memberLabel).toBe("Membru {club}");
    expect(en.Event.rsvp.memberLabel).toBe("{club} member");
  });

  it("says «declared» for the tick and «verified» for an account in the editor — the registrations' words, never «verified» for a tick", () => {
    expect(ro.Admin.registrations.member.declared).toBe("Membru (declarat)");
    expect(ro.Admin.registrations.member.verified).toBe("Membru (verificat)");
    expect(ro.Admin.editor.rsvpAnswers.memberDeclaredHint).toContain("clubul nu a verificat");
    expect(en.Admin.editor.rsvpAnswers.memberDeclaredHint).toContain("not checked");
  });

  it("keeps every new sentence plain: one short sentence each, no more than 200 characters", () => {
    const keys = [
      ro.Event.rsvp.memberHelp,
      ro.Event.rsvp.memberFactHelp,
      ro.Event.rsvp.memberOutcome.on,
      ro.Event.rsvp.memberOutcome.off,
      ro.Event.rsvp.memberOutcome.closed,
      en.Event.rsvp.memberHelp,
      en.Event.rsvp.memberFactHelp,
      en.Event.rsvp.memberOutcome.on,
      en.Event.rsvp.memberOutcome.off,
      en.Event.rsvp.memberOutcome.closed,
    ];
    for (const text of keys) for (const sentence of text.split(/(?<=[.!?])\s+/)) expect(sentence.length, sentence).toBeLessThanOrEqual(200);
  });
});
