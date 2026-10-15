import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import {
  describesVolunteerAgreement,
  describesVolunteerProfile,
  describesVolunteers,
  MERGE_FIELDS,
  mergeText,
  VOLUNTEER_PROFILE_NOTICE_MERGE_FIELD,
} from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import {
  agreementRoleWords,
  descriptionHead,
  descriptionNeedsFold,
  refusedFields,
  ROLE_DESCRIPTION_FOLD_CHARS,
  sameDescription,
  tasksWords,
  VOLUNTEER_AGE_MAX,
  VOLUNTEER_CITY_MAX,
  VOLUNTEER_MINIMUM_AGE,
  VOLUNTEER_ROLE_DESCRIPTION_MAX,
  volunteerPublicInputSchema,
  volunteerPublicProfileSchemaFor,
  volunteerPublicSchemaFor,
  volunteerRoleInputSchema,
  volunteerStaffInputSchemaFor,
} from "@/modules/volunteers/domain/volunteer";
import { volunteerProfileClause, volunteersMergeValues } from "@/modules/volunteers/notice-words";
import { parseVolunteerBoxes } from "@/modules/volunteers/ui/volunteer-box";
import { SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import { CLUB_NAME } from "@/theme/brand";
import { bornAgedOn } from "../../helpers/volunteer-birth";

/**
 * §765 — what a volunteer says about themselves, the role's description as a document, and the notice that must
 * name both before the form asks: the pure rules, no database (`tests/integration/volunteers/profile.test.ts`
 * keeps them in the rows).
 */
/** The event's day, the day every age is counted on (§773); `aged(n)` is the last day of being `n` on it. */
const EVENT_DAY = "2026-11-21";
const aged = (years: number) => bornAgedOn(years, EVENT_DAY);
const volunteerPublicProfileSchema = volunteerPublicProfileSchemaFor(false, EVENT_DAY);
const volunteerStaffInputSchema = volunteerStaffInputSchemaFor(EVENT_DAY);
const ID = "5d7a2f64-3b0c-4f25-9d57-0a9a6b3a1c11";
const PUBLIC = {
  roleIds: [ID],
  name: " Ana  Test ",
  email: " ana@example.test ",
  phone: "+40712345678",
  message: "",
  locale: "ro",
  consent: true,
  agreement: true,
  birthDate: aged(34),
  sex: "FEMALE",
  city: " Brașov ",
};

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...lines: string[]) => JSON.stringify({ type: "doc", content: lines.map(paragraph) });

describe("§765 the public form's date of birth, sex and city (the notice names them)", () => {
  it("takes the date of birth, derives the age on the event's day, takes the registration form's two answers and a short city, folding the city's whitespace", () => {
    const parsed = volunteerPublicProfileSchema.parse(PUBLIC);
    expect(parsed).toMatchObject({ birthDate: aged(34), age: 34, sex: "FEMALE", city: "Brașov", volunteeredBefore: false, clubMember: false, shirtSize: null });
  });

  it("reads the date the way the registration form does — day first, any separator, eight digits or the posted shape — and counts the age on the event's day, not today's", () => {
    // Born 11 May 1984: forty-two on 21 November 2026, whatever the clock says today.
    for (const typed of ["11.05.1984", " 11/5/1984 ", "11-05-1984", "11 05 1984", "11051984", "1984-05-11"]) {
      const parsed = volunteerPublicProfileSchema.parse({ ...PUBLIC, birthDate: typed });
      expect(parsed, typed).toMatchObject({ birthDate: "1984-05-11", age: 42 });
    }
    // The birthday after the event is not yet: born 22 November 1984 is forty-one on 21 November 2026.
    expect(volunteerPublicProfileSchema.parse({ ...PUBLIC, birthDate: "22.11.1984" }).age).toBe(41);
    expect(volunteerPublicProfileSchema.parse({ ...PUBLIC, birthDate: "21.11.1984" }).age).toBe(42);
  });

  it("asks for no tick «Am cel puțin 18 ani»: the age answers it", () => {
    expect(volunteerPublicProfileSchema.safeParse(PUBLIC).success).toBe(true);
    expect(volunteerPublicProfileSchema.safeParse({ ...PUBLIC, adult: false }).success).toBe(true);
    // Without the notice naming the profile, §758's form stands: the tick is required and no age is asked.
    const legacy = { ...PUBLIC, adult: true };
    expect(volunteerPublicInputSchema.safeParse(legacy).success).toBe(true);
    const missing = volunteerPublicInputSchema.safeParse({ ...legacy, adult: undefined });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(refusedFields(missing.error)).toEqual(["adult"]);
  });

  it("holds the age to the minimum: 13 is refused on the date's own box; with minors closed 17 is too, 18 and the top bound are taken", () => {
    // §768: fourteen, not eighteen — a person of fourteen to seventeen needs a guardian (below), and only while the texts allow it.
    expect(VOLUNTEER_MINIMUM_AGE).toBe(14);
    for (const age of [13, 1]) {
      const under = volunteerPublicProfileSchemaFor(true, EVENT_DAY).safeParse({ ...PUBLIC, birthDate: aged(age) });
      expect(under.success, String(age)).toBe(false);
      if (!under.success) expect(refusedFields(under.error), String(age)).toEqual(["birthDate"]);
    }
    // A birth date after the event's day is no age at all.
    for (const birthDate of ["2026-11-22", "2030-01-01"]) {
      const future = volunteerPublicProfileSchemaFor(true, EVENT_DAY).safeParse({ ...PUBLIC, birthDate });
      expect(future.success, birthDate).toBe(false);
    }
    const closed = volunteerPublicProfileSchema.safeParse({ ...PUBLIC, birthDate: aged(17) });
    expect(closed.success).toBe(false);
    if (!closed.success) expect(refusedFields(closed.error)).toEqual(["birthDate"]);
    // The age is named together with the other boxes that failed, never held back until they are mended.
    const several = volunteerPublicProfileSchema.safeParse({ ...PUBLIC, birthDate: aged(13), sex: "", city: "", roleIds: [] });
    if (!several.success) expect(refusedFields(several.error).sort()).toEqual(["birthDate", "city", "roleIds", "sex"]);
    expect(several.success).toBe(false);
    expect(volunteerStaffInputSchema.safeParse({ roleIds: [ID], assignedRoleId: "", name: "Ana", email: "ana@example.test", phone: "+40712345678", birthDate: aged(13) }).success).toBe(false);
    expect(volunteerPublicProfileSchema.parse({ ...PUBLIC, birthDate: aged(18) }).age).toBe(18);
    expect(volunteerPublicProfileSchema.parse({ ...PUBLIC, birthDate: aged(VOLUNTEER_AGE_MAX) }).age).toBe(VOLUNTEER_AGE_MAX);
  });

  it("refuses a birth date that is no date, or makes more than the ceiling, naming the box", () => {
    for (const birthDate of ["", "  ", "abc", "34", "31.02.1990", "1990", "11.05", "1990-13-01", "0001-01-01", aged(VOLUNTEER_AGE_MAX + 1), "٣٤"]) {
      const verdict = volunteerPublicProfileSchema.safeParse({ ...PUBLIC, birthDate });
      expect(verdict.success, JSON.stringify(birthDate)).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), JSON.stringify(birthDate)).toEqual(["birthDate"]);
    }
    const absent = { ...PUBLIC } as Record<string, unknown>;
    delete absent.birthDate;
    expect(volunteerPublicProfileSchema.safeParse(absent).success).toBe(false);
  });

  it("requires a sex of the registration form's two answers — the retired «prefer not to say» is no answer", () => {
    for (const sex of ["", "UNSPECIFIED", "OTHER", "female", undefined]) {
      const verdict = volunteerPublicProfileSchema.safeParse({ ...PUBLIC, sex });
      expect(verdict.success, String(sex)).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error)).toEqual(["sex"]);
    }
    expect(volunteerPublicProfileSchema.parse({ ...PUBLIC, sex: "MALE" }).sex).toBe("MALE");
  });

  it("requires a city of at most 80 characters", () => {
    for (const city of ["", "   ", undefined, "x".repeat(VOLUNTEER_CITY_MAX + 1)]) {
      const verdict = volunteerPublicProfileSchema.safeParse({ ...PUBLIC, city });
      expect(verdict.success, String(city)).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error)).toEqual(["city"]);
    }
    expect(volunteerPublicProfileSchema.safeParse({ ...PUBLIC, city: "x".repeat(VOLUNTEER_CITY_MAX) }).success).toBe(true);
  });

  it("reads the two optional ticks as true only when posted, and the size as one of the kit's or none", () => {
    const ticked = volunteerPublicProfileSchema.parse({ ...PUBLIC, volunteeredBefore: true, clubMember: true, shirtSize: "XL" });
    expect(ticked).toMatchObject({ volunteeredBefore: true, clubMember: true, shirtSize: "XL" });
    for (const size of SHIRT_SIZES) expect(volunteerPublicProfileSchema.parse({ ...PUBLIC, shirtSize: size }).shirtSize).toBe(size);
    // «Fără tricou» is none, never a size.
    expect(volunteerPublicProfileSchema.parse({ ...PUBLIC, shirtSize: "" }).shirtSize).toBeNull();
    for (const shirtSize of ["NONE", "XXXL", "m"]) {
      const verdict = volunteerPublicProfileSchema.safeParse({ ...PUBLIC, shirtSize });
      expect(verdict.success, shirtSize).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error)).toEqual(["shirtSize"]);
    }
  });

  it("keeps every other rule of the form: the consent, the agreement, the roles", () => {
    for (const tick of ["consent", "agreement"] as const) {
      const verdict = volunteerPublicProfileSchema.safeParse({ ...PUBLIC, [tick]: false });
      expect(verdict.success).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error)).toEqual([tick]);
    }
    const noRole = volunteerPublicProfileSchema.safeParse({ ...PUBLIC, roleIds: [] });
    if (!noRole.success) expect(refusedFields(noRole.error)).toEqual(["roleIds"]);
  });

  it("picks the schema by the notice: the profile's while it names it, §758's otherwise", () => {
    expect(volunteerPublicSchemaFor({ profile: false, minors: false, eventDay: EVENT_DAY })).toBe(volunteerPublicInputSchema);
    // §758's form takes no age and no guardian, whatever the minors' texts say: adults only, by its own tick.
    expect(volunteerPublicSchemaFor({ profile: false, minors: true, eventDay: EVENT_DAY })).toBe(volunteerPublicInputSchema);
    // The profile's, with or without the minors' path: the same adult, a different verdict on a minor.
    const adult = { ...PUBLIC, birthDate: aged(34) };
    expect(volunteerPublicSchemaFor({ profile: true, minors: false, eventDay: EVENT_DAY }).safeParse(adult).success).toBe(true);
    expect(volunteerPublicSchemaFor({ profile: true, minors: true, eventDay: EVENT_DAY }).safeParse(adult).success).toBe(true);
    const minor = { ...PUBLIC, birthDate: aged(15) };
    expect(volunteerPublicSchemaFor({ profile: true, minors: false, eventDay: EVENT_DAY }).safeParse(minor).success).toBe(false);
    expect(volunteerPublicSchemaFor({ profile: true, minors: true, eventDay: EVENT_DAY }).safeParse(minor).success).toBe(false);
  });

  it("names the boxes a refusal can point at, in the form's order, including the new ones", () => {
    expect(parseVolunteerBoxes("city,birthDate,sex,shirtSize,phone,<b>")).toEqual(["phone", "birthDate", "sex", "city", "shirtSize"]);
  });
});

describe("§765 the organizers' entry takes the same answers, all optional", () => {
  const staff = { roleIds: [ID], assignedRoleId: "", name: "Ana Test", email: "ana@example.test", phone: "+40712345678", note: "" };

  it("keeps the age a row from before the date held when its date box is left empty — and only then", () => {
    // A row of sixteen with no date: saving it with the box empty is still a person of sixteen, so their guardian is still asked for.
    const kept = volunteerStaffInputSchemaFor(EVENT_DAY, 16);
    const verdict = kept.safeParse(staff);
    expect(verdict.success).toBe(false);
    if (!verdict.success) expect(refusedFields(verdict.error)).toEqual(["guardianName"]);
    expect(kept.parse({ ...staff, guardianName: "Maria Popescu" })).toMatchObject({ age: 16, birthDate: null, guardian: { name: "Maria Popescu", email: null } });
    // A date typed replaces it: the age is the date's.
    expect(kept.parse({ ...staff, birthDate: aged(40) })).toMatchObject({ age: 40, birthDate: aged(40), guardian: null });
    // A new entry has no age to keep.
    expect(volunteerStaffInputSchemaFor(EVENT_DAY).parse(staff)).toMatchObject({ age: null, birthDate: null });
  });

  it("leaves every answer empty without refusing", () => {
    expect(volunteerStaffInputSchema.parse(staff)).toMatchObject({ age: null, birthDate: null, sex: null, city: null, volunteeredBefore: false, clubMember: false, shirtSize: null });
  });

  it("takes the answers when given, and refuses an age under the minimum or a sex that is no answer", () => {
    expect(volunteerStaffInputSchema.parse({ ...staff, birthDate: aged(52), sex: "MALE", city: " Râșnov ", volunteeredBefore: true, clubMember: true, shirtSize: "S" })).toMatchObject({
      age: 52,
      birthDate: aged(52),
      sex: "MALE",
      city: "Râșnov",
      volunteeredBefore: true,
      clubMember: true,
      shirtSize: "S",
    });
    for (const [field, value] of [
      ["birthDate", aged(13)],
      ["birthDate", "abc"],
      ["birthDate", aged(101)],
      ["sex", "UNSPECIFIED"],
      ["city", "x".repeat(VOLUNTEER_CITY_MAX + 1)],
      ["shirtSize", "NONE"],
    ] as const) {
      const verdict = volunteerStaffInputSchema.safeParse({ ...staff, [field]: value });
      expect(verdict.success, `${field} ${value}`).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), `${field} ${value}`).toEqual([field]);
    }
  });
});

describe("§765 «Descrierea rolului», a document per language with its plain words", () => {
  const ROLE = { nameRo: "Punct de apă", nameEn: "Water point", needed: "4" };

  it("takes the editor's two documents and keeps each with its plain words, one line per paragraph", () => {
    const parsed = volunteerRoleInputSchema.parse({
      ...ROLE,
      descriptionRoBody: doc("Stai la km 5.", "Dai apă de la 9:00."),
      descriptionEnBody: doc("Stand at km 5.", "Hand out water from 9:00."),
    });
    expect(parsed.descriptionWordsRo).toBe("Stai la km 5.\nDai apă de la 9:00.");
    expect(parsed.descriptionWordsEn).toBe("Stand at km 5.\nHand out water from 9:00.");
    expect(richTextToPlainText(parsed.descriptionRoJson!)).toBe(parsed.descriptionWordsRo);
    expect(parsed.descriptionRoJson?.content).toHaveLength(2);
  });

  it("refuses one language without the other, naming the box that is empty", () => {
    const onlyRo = volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRoBody: doc("Dai apă."), descriptionEnBody: doc() });
    expect(onlyRo.success).toBe(false);
    if (!onlyRo.success) expect(refusedFields(onlyRo.error)).toEqual(["descriptionEnBody"]);
    const onlyEn = volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRoBody: "", descriptionEnBody: doc("Hand out water.") });
    if (!onlyEn.success) expect(refusedFields(onlyEn.error)).toEqual(["descriptionRoBody"]);
    // Neither is no description at all.
    expect(volunteerRoleInputSchema.parse({ ...ROLE, descriptionRoBody: doc(), descriptionEnBody: "" })).toMatchObject({ descriptionRoJson: null, descriptionWordsEn: null });
  });

  it("holds the words to 2000 characters per language and allows no table", () => {
    const long = doc("x".repeat(VOLUNTEER_ROLE_DESCRIPTION_MAX + 1));
    const verdict = volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRoBody: long, descriptionEnBody: doc("ok") });
    expect(verdict.success).toBe(false);
    if (!verdict.success) expect(refusedFields(verdict.error)).toEqual(["descriptionRoBody"]);
    expect(volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRoBody: doc("x".repeat(VOLUNTEER_ROLE_DESCRIPTION_MAX)), descriptionEnBody: doc("ok") }).success).toBe(true);
    const table = JSON.stringify({
      type: "doc",
      content: [{ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [paragraph("a")] }] }] }],
    });
    const withTable = volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRoBody: table, descriptionEnBody: table });
    expect(withTable.success).toBe(false);
    // The refusal is the table's, on the box it is in — not a document the schema could not read.
    if (!withTable.success) expect(refusedFields(withTable.error).sort()).toEqual(["descriptionEnBody", "descriptionRoBody"]);
  });

  it("refuses a picture or a video, alone or beside words — a refusal, never the table's CHECK", () => {
    const image = { type: "image", attrs: { src: "/api/media/6f1c2a9e-0000-4000-8000-000000000001/web.webp", alt: "", caption: "" } };
    const only = JSON.stringify({ type: "doc", content: [image] });
    const mixed = JSON.stringify({ type: "doc", content: [paragraph("Stai la km 5."), image] });
    const imageOnly = volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRoBody: only, descriptionEnBody: only });
    expect(imageOnly.success).toBe(false);
    if (!imageOnly.success) expect(refusedFields(imageOnly.error).sort()).toEqual(["descriptionEnBody", "descriptionRoBody"]);
    const withWords = volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRoBody: mixed, descriptionEnBody: doc("Stand at km 5.") });
    expect(withWords.success).toBe(false);
    if (!withWords.success) expect(refusedFields(withWords.error)).toEqual(["descriptionRoBody"]);
    const video = JSON.stringify({ type: "doc", content: [{ type: "youtube", attrs: { src: "https://www.youtube-nocookie.com/embed/abcdefghijk" } }] });
    expect(volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRoBody: video, descriptionEnBody: doc("ok") }).success).toBe(false);
  });

  it("refuses a body that is not the editor's document, and lets the posted document win over the plain box", () => {
    const bad = volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRoBody: "{not json", descriptionEnBody: doc("ok") });
    expect(bad.success).toBe(false);
    const both = volunteerRoleInputSchema.parse({ ...ROLE, descriptionRo: "din cutie", descriptionEn: "from the box", descriptionRoBody: doc("din editor"), descriptionEnBody: doc("from the editor") });
    expect(both.descriptionWordsRo).toBe("din editor");
    // The plain boxes read as paragraphs when no editor posted.
    const plain = volunteerRoleInputSchema.parse({ ...ROLE, descriptionRo: "Linia 1\nLinia 2", descriptionEn: "Line 1\nLine 2" });
    expect(plain.descriptionWordsRo).toBe("Linia 1\nLinia 2");
    expect(plain.descriptionRoJson?.content).toHaveLength(2);
  });

  it("folds a description past about three lines behind «Detalii», on its plain words", () => {
    expect(descriptionNeedsFold(null)).toBe(false);
    expect(descriptionNeedsFold("")).toBe(false);
    expect(descriptionNeedsFold("Dai apă la km 5.")).toBe(false);
    expect(descriptionNeedsFold("unu\ndoi\ntrei")).toBe(false);
    expect(descriptionNeedsFold("unu\ndoi\ntrei\npatru")).toBe(true);
    expect(descriptionNeedsFold("x".repeat(ROLE_DESCRIPTION_FOLD_CHARS))).toBe(false);
    expect(descriptionNeedsFold("x".repeat(ROLE_DESCRIPTION_FOLD_CHARS + 1))).toBe(true);
  });

  it("shows a role's first line on the card and folds the rest", () => {
    expect(descriptionHead(null)).toEqual({ first: "", rest: null });
    expect(descriptionHead("Un singur rând")).toEqual({ first: "Un singur rând", rest: null });
    expect(descriptionHead("Primul\n\nAl doilea\nAl treilea")).toEqual({ first: "Primul", rest: "Al doilea\nAl treilea" });
  });

  it("tells whether two descriptions are one document, whatever order the database gives the keys in", () => {
    const a = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] };
    const reordered = { content: [{ content: [{ text: "x", type: "text" }], type: "paragraph" }], type: "doc" };
    expect(sameDescription(a, reordered)).toBe(true);
    expect(sameDescription(a, null)).toBe(false);
    expect(sameDescription(null, undefined)).toBe(true);
    expect(sameDescription(a, { ...a, content: [] })).toBe(false);
  });

  it("puts a description in the agreement's sentence as one line, losing the last full stop", () => {
    expect(tasksWords("Dai apă la km 5.")).toBe("Dai apă la km 5");
    // Several paragraphs: one sentence per line that ends one, «; » between the others (list items).
    expect(tasksWords("Stai la km 5.\nDai apă de la 9:00.")).toBe("Stai la km 5. Dai apă de la 9:00");
    expect(tasksWords("Pahare\nApă\nBanane")).toBe("Pahare; Apă; Banane");
    expect(tasksWords("Ai grijă de:\nPahare\nApă.")).toBe("Ai grijă de: Pahare; Apă");
    expect(tasksWords("  \n ")).toBe("");
    const words = agreementRoleWords(
      {
        assigned: { nameRo: "Punct de apă", nameEn: "Water point", descriptionRo: "Stai la km 5.\nDai apă.", descriptionEn: "Stand at km 5.\nHand out water." },
        chosen: [],
      },
      "en",
      true,
    );
    expect(words).toMatchObject({ role: "Water point", tasks: "Stand at km 5. Hand out water" });
  });
});

describe("§765 the privacy notice's marker {{volunteerProfile}}", () => {
  it("is a merge field, and a notice describes the profile only when it names it", () => {
    expect(VOLUNTEER_PROFILE_NOTICE_MERGE_FIELD).toBe("volunteerProfile");
    expect(MERGE_FIELDS).toContain("volunteerProfile");
    expect(describesVolunteerProfile({ sections: [{ heading: "5.", paragraphs: ["Voluntari: vârsta, orașul ({{volunteerProfile}})."] }] })).toBe(true);
    // A notice approved from the earlier template names the volunteers and the agreement, and says nothing of the profile.
    const before = { sections: [{ heading: "5.", paragraphs: ["Voluntari ({{volunteers}}): … ({{volunteerAgreement}})"] }] };
    expect(describesVolunteers(before)).toBe(true);
    expect(describesVolunteerAgreement(before)).toBe(true);
    expect(describesVolunteerProfile(before)).toBe(false);
    expect(describesVolunteerProfile("not a body")).toBe(false);
  });

  it("is in both languages' templates, in the volunteers' own paragraph, naming the data and why — and no number or club name", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesVolunteerProfile(body)).toBe(true);
      const volunteers = body.sections.flatMap((section) => section.paragraphs).find((candidate) => candidate.includes("{{volunteers}}")) ?? "";
      expect(volunteers).toContain("{{volunteerProfile}}");
      expect(volunteers).not.toContain(CLUB_NAME);
    }
    const roParagraph = privacyNoticeRo.sections.flatMap((section) => section.paragraphs).find((candidate) => candidate.includes("{{volunteerProfile}}")) ?? "";
    for (const phrase of ["data nașterii", "calculăm vârsta ta în ziua evenimentului", "sexul", "orașul", "dacă ai mai fost voluntar la alte curse", "dacă spui că faci parte din grupul clubului", "doar cât timp clubul dă tricouri voluntarilor", "nu le verificăm", "repartizeze voluntarii pe roluri", "pe cele pe care organizatorii le notează pentru tine"]) {
      expect(roParagraph, phrase).toContain(phrase);
    }
    const enParagraph = privacyNoticeEn.sections.flatMap((section) => section.paragraphs).find((candidate) => candidate.includes("{{volunteerProfile}}")) ?? "";
    for (const phrase of ["your date of birth", "work out your age on the day of the event", "sex", "city", "volunteered at other races before", "whether you say you belong to the club's group", "only while the club gives volunteers T-shirts", "we check none of them", "place volunteers in roles", "the ones the organizers note for you"]) {
      expect(enParagraph, phrase).toContain(phrase);
    }
  });

  it("is in the token legend, and filled with the form's own labels, quoted — the club's name nowhere in it", () => {
    expect(DECLARATION_TOKENS.some((entry) => entry.token === "{{volunteerProfile}}")).toBe(true);
    expect(ro.Admin.legal.tokens.volunteerProfile).toBeTruthy();
    expect(en.Admin.legal.tokens.volunteerProfile).toBeTruthy();
    expect(volunteerProfileClause("ro")).toBe("„Data nașterii”, „Sex”, „Orașul”, „Am mai fost voluntar în trecut la alte curse”");
    expect(volunteerProfileClause("en")).toBe("“Date of birth”, “Sex”, “City”, “I have volunteered at other races before”");
    // The approved text never names the club: the group tick and the size are said in the paragraph's words.
    for (const locale of ["ro", "en"]) expect(volunteerProfileClause(locale)).not.toContain(CLUB_NAME);
    expect(volunteersMergeValues("ro").volunteerProfile).toBe(volunteerProfileClause("ro"));
    expect(mergeText("({{volunteerProfile}})", volunteersMergeValues("en"))).toContain("“Date of birth”");
  });
});

describe("§765 the catalogues say the new words in both languages", () => {
  it("keeps the owner's own sentences", () => {
    expect(ro.Event.volunteers.profile.before).toBe("Am mai fost voluntar în trecut la alte curse");
    expect(en.Event.volunteers.profile.before).toBe("I have volunteered at other races before");
    expect(ro.Event.volunteers.profile.club).toBe("Fac parte din grupul {club}");
    expect(ro.Event.volunteers.profile.shirt).toBe("Mărimea tricoului");
    expect(ro.Admin.volunteers.shirts.label).toBe("Oferim tricouri voluntarilor");
    expect(ro.Admin.volunteers.role.descriptionRo).toContain("Descrierea rolului");
    expect(en.Admin.volunteers.role.descriptionEn).toContain("Role description");
    expect(ro.Admin.volunteers.role.descriptionHelp).toContain("Ce presupune rolul: unde stă voluntarul, ce are de făcut, de la ce oră.");
    expect(en.Admin.volunteers.role.descriptionHelp).toContain("What the role involves: where the volunteer stands, what they do, from what hour.");
  });

  it("says «cel puțin {age}» for a date under the minimum on the event's day and «scrie data» for anything else", () => {
    expect(ro.Event.volunteers.errors.birthDateMinimum).toContain("{age}");
    expect(en.Event.volunteers.errors.birthDateMinimum).toContain("{age}");
    expect(ro.Event.volunteers.errors).not.toHaveProperty("birthDate");
    expect(ro.Registration.birthDateUnreadable).not.toContain("{age}");
    // The retired age sentences are gone, not left for a form that no longer asks.
    for (const words of [ro.Event.volunteers.errors, en.Event.volunteers.errors]) {
      expect(words).not.toHaveProperty("age");
      expect(words).not.toHaveProperty("ageMinimum");
      expect(words).not.toHaveProperty("ageMinors");
    }
  });
});
