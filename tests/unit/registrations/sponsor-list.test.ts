import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesPromotionalMaterials, describesPromotionalMaterialsShared, isMergeField, mergeText } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { noticeVersionInForceAt, sharedWithSponsors, sponsorShareGate } from "@/modules/registrations/domain/sponsor-share";
import { promotionalMaterialsMergeValues, promotionalMaterialsSharedClause } from "@/modules/registrations/promo-consent-words";
import { buildSponsorListCsv, sponsorListFileName, sponsorRecipient, SPONSOR_RECIPIENT_MAX } from "@/modules/registrations/sponsor-list";
import { copyDeleteBy, copyOverdue, listsOfDoor, recipientSuggestions, SPONSOR_COPY_DAYS, SPONSOR_RECIPIENT_SUGGESTIONS } from "@/modules/registrations/sponsor-register";

/**
 * §570 — the list for sponsors (amending §562) and the public-list tick's words (amending §143):
 * the new merge field and its gate, the template's sections 4–7, the words in both languages, the
 * CSV's shape and its file name.
 */
const text = (...paragraphs: string[]) => ({ sections: [{ paragraphs }] });
const all = (body: typeof privacyNoticeRo) => body.sections.flatMap((section) => section.paragraphs);
const section = (body: typeof privacyNoticeRo, number: string) => body.sections.find((entry) => entry.heading?.startsWith(number))!.paragraphs.join(" ");

describe("§570 the privacy notice's marker for the sponsor list", () => {
  it("is a merge field of its own, beside the box's — the box keeps {{promotionalMaterials}} exactly", () => {
    expect(isMergeField("promotionalMaterialsShared")).toBe(true);
    expect(describesPromotionalMaterialsShared(text("Bifa {{promotionalMaterials}}."))).toBe(false);
    expect(describesPromotionalMaterials(text("Le dăm {{promotionalMaterialsShared}}."))).toBe(false);
    expect(describesPromotionalMaterialsShared(text("Le dăm {{ promotionalMaterialsShared }}."))).toBe(true);
    expect(describesPromotionalMaterialsShared("not a body")).toBe(false);
  });

  it("is named by the platform's notice in both languages, in sections 5 and 6, and the legend lists it", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesPromotionalMaterials(body)).toBe(true);
      expect(describesPromotionalMaterialsShared(body)).toBe(true);
      expect(section(body, "5.")).toContain("{{promotionalMaterialsShared}}");
      expect(section(body, "6.")).toContain("{{promotionalMaterialsShared}}");
    }
    const legend = DECLARATION_TOKENS.find((entry) => entry.token === "{{promotionalMaterialsShared}}");
    expect(legend?.example).toEqual({ ro: "prenumele, numele și adresa ta de e-mail", en: "your first name, last name and email address" });
    expect(ro.Admin.legal.tokens.promotionalMaterialsShared).toContain("partenerii clubului");
    expect(en.Admin.legal.tokens.promotionalMaterialsShared).toContain("club's partners");
  });

  it("is filled with the three data a partner receives, so the approved sentence names what the file carries", () => {
    expect(promotionalMaterialsSharedClause("ro")).toBe("prenumele, numele și adresa ta de e-mail");
    expect(promotionalMaterialsSharedClause("en")).toBe("your first name, last name and email address");
    for (const [locale, body] of [["ro", privacyNoticeRo], ["en", privacyNoticeEn]] as const) {
      const merged = all(body).map((paragraph) => mergeText(paragraph, promotionalMaterialsMergeValues(locale))).join(" ");
      expect(merged).toContain(promotionalMaterialsSharedClause(locale));
      expect(merged).not.toContain("{{promotionalMaterialsShared}}");
    }
  });

  it("says in section 5 who the partners are, never sold, consent to both, withdrawal stops the sharing and the partners are told, the complaint", () => {
    const [ro5] = all(privacyNoticeRo).filter((paragraph) => paragraph.startsWith("Lista pentru parteneri:"));
    const [en5] = all(privacyNoticeEn).filter((paragraph) => paragraph.startsWith("The list for partners:"));
    for (const words of ["sponsorilor clubului și partenerilor evenimentelor", "Nu vindem lista", "și mesajele clubului, și pe ale partenerilor", "nu îți mai dăm datele niciunui partener", "le cerem să nu îți mai scrie", "6(1)(a)", "ANSPDCP", "sub o versiune a acestei note care spune asta"]) {
      expect(ro5, words).toContain(words);
    }
    for (const words of ["the club's sponsors and the partners of its events", "We never sell the list", "both the club's messages and the partners'", "we give your data to no partner from then on", "we ask the partners who already hold it to stop writing to you", "6(1)(a)", "ANSPDCP", "under a version of this notice that says so"]) {
      expect(en5, words).toContain(words);
    }
    // §562's promise is gone from every paragraph: the next sentence would contradict it.
    expect(all(privacyNoticeRo).join(" ")).not.toContain("partenerii nu primesc adresa");
    expect(all(privacyNoticeEn).join(" ")).not.toContain("partners never receive your address");
  });

  it("carries the retention in section 7 and keeps the four placeholders and the twelve sections", () => {
    expect(section(privacyNoticeRo, "7.")).toContain("Lista dată partenerilor: copia clubului, ștearsă în cel mult 30 de zile de la descărcare");
    expect(section(privacyNoticeEn, "7.")).toContain("The list given to partners: the club's copy, deleted within 30 days of the download");
    expect(all(privacyNoticeRo).join(" ")).toContain("<EMAIL DE CONTACT>");
    expect(all(privacyNoticeEn).join(" ")).toContain("<CONTACT EMAIL>");
    expect(privacyNoticeRo.sections).toHaveLength(12);
    expect(privacyNoticeEn.sections).toHaveLength(12);
  });
});

describe("§570 which yes may reach a partner", () => {
  const versions = [
    { version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), shares: false },
    { version: 2, effectiveAt: new Date("2026-06-01T00:00:00Z"), shares: true },
    { version: 3, effectiveAt: new Date("2026-09-01T00:00:00Z"), shares: false },
  ];
  const gate = sponsorShareGate(versions);

  it("reads the version in force at a moment, as the site answered then", () => {
    expect(noticeVersionInForceAt(versions, new Date("2025-12-31T00:00:00Z"))).toBeNull();
    expect(noticeVersionInForceAt(versions, new Date("2026-03-01T00:00:00Z"))).toBe(1);
    expect(noticeVersionInForceAt(versions, new Date("2026-07-01T00:00:00Z"))).toBe(2);
    expect(noticeVersionInForceAt(versions, new Date("2026-09-02T00:00:00Z"))).toBe(3);
  });

  it("shares only a yes whose recorded notice and whose notice at the moment both describe the sharing — an exact set, never a lower bound", () => {
    const yes = (privacyNoticeVersion: number, at: string | null) => sharedWithSponsors({ promoConsent: true, promoConsentAt: at ? new Date(at) : null, privacyNoticeVersion }, gate);
    expect(yes(2, "2026-07-01T00:00:00Z")).toBe(true);
    expect(yes(1, "2026-03-01T00:00:00Z")).toBe(false);
    expect(yes(1, "2026-07-01T00:00:00Z")).toBe(false);
    // A later notice that dropped the marker: its registrants are not shared, whatever came before (§421's warning).
    expect(yes(3, "2026-09-02T00:00:00Z")).toBe(false);
    expect(yes(2, "2026-09-02T00:00:00Z")).toBe(false);
    expect(yes(2, null)).toBe(false);
    expect(sharedWithSponsors({ promoConsent: false, promoConsentAt: new Date("2026-07-01T00:00:00Z"), privacyNoticeVersion: 2 }, gate)).toBe(false);
  });
});

describe("§570 the sponsor list's file", () => {
  const header = { firstName: "Prenume", lastName: "Nume", email: "Email", event: "Eveniment", consentedAt: "Data acordului" };
  const row = { firstName: "Ana", lastName: "Pop", email: "ana@example.ro", eventTitle: "Crosul, toamna", consentedAt: new Date("2026-09-29T10:00:00.000Z") };

  it("is five columns — Prenume, Nume, Email, Eveniment, Data acordului — with a BOM, CRLF and every cell neutralized", () => {
    const csv = buildSponsorListCsv(header, [row, { ...row, firstName: "=HYPERLINK(1)", eventTitle: null, consentedAt: null }]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("﻿Prenume,Nume,Email,Eveniment,Data acordului");
    expect(lines[1]).toBe('Ana,Pop,ana@example.ro,"Crosul, toamna",2026-09-29T10:00:00.000Z');
    expect(lines[2]).toBe("'=HYPERLINK(1),Pop,ana@example.ro,,");
    expect(lines[0].split(",")).toHaveLength(5);
  });

  it("names the file by the event's slug or «toate», with the day, and nothing else reaches the header", () => {
    expect(sponsorListFileName("crosul-toamnei", "2026-09-29")).toBe("sponsori-crosul-toamnei-2026-09-29.csv");
    expect(sponsorListFileName(null, "2026-09-29")).toBe("sponsori-toate-2026-09-29.csv");
    expect(sponsorListFileName('a"b\r\nc', "2026-09-29")).toBe("sponsori-a-b-c-2026-09-29.csv");
  });

  it("has its words in both languages, the headers the owner named", () => {
    expect(ro.Admin.sponsors.columns).toEqual({ firstName: "Prenume", lastName: "Nume", email: "Email", event: "Eveniment", consentedAt: "Data acordului" });
    expect(Object.keys(en.Admin.sponsors.columns)).toEqual(Object.keys(ro.Admin.sponsors.columns));
    // The Excel file since §581; the CSV beside it.
    expect(ro.Admin.sponsors.button).toBe("Descarcă lista pentru sponsori (Excel)");
    expect(en.Admin.sponsors.button).toBe("Download the list for sponsors (Excel)");
    expect(ro.Admin.sponsors.buttonCsv).toBe("Descarcă CSV");
    expect(en.Admin.sponsors.buttonCsv).toBe("Download CSV");
    expect(ro.Admin.sponsors.noticeMissing).toBe("Nota de confidențialitate în vigoare nu spune că lista poate fi dată partenerilor.");
    for (const catalogue of [ro, en]) {
      for (const words of [catalogue.Admin.sponsors.help, catalogue.Admin.sponsors.noticeMissing, catalogue.Registrations.promo.yesShared]) {
        expect(words.length).toBeLessThanOrEqual(200);
        expect(words).not.toMatch(/platforma|de obicei|the platform/i);
      }
    }
  });
});

describe("§570 the public-list tick names the list and the results", () => {
  it("reads «… & rezultate» on the form, the switches, the backoffice and the list's own note", () => {
    expect(ro.Registration.listOptIn).toBe("Vreau să apar pe lista de participanți & rezultate");
    expect(en.Registration.listOptIn).toBe("I want to appear on the participants & results list");
    expect(ro.Registrations.list.optIn).toBe("Vreau să apar pe lista de participanți & rezultate");
    expect(ro.Registrations.list.optOut).toBe("Nu vreau să apar pe lista de participanți & rezultate");
    expect(en.Registrations.list.optIn).toBe("I want to appear on the participants & results list");
    expect(en.Registrations.list.optOut).toBe("I do not want to appear on the participants & results list");
    expect(ro.Admin.registrations.listOptIn).toBe("Persoana vrea să apară pe lista de participanți & rezultate");
    for (const words of [ro.Event.startList.note, ro.Event.startList.noteStates, ro.Admin.editor.participantListHelp]) expect(words).toContain("„Vreau să apar pe lista de participanți & rezultate”");
    for (const words of [en.Event.startList.note, en.Event.startList.noteStates, en.Admin.editor.participantListHelp]) expect(words).toContain("“I want to appear on the participants & results list”");
  });

  it("no catalogue still names the tick by its old words", () => {
    // The volunteers' own tick (§821) is «Vreau să apar pe lista publică a voluntarilor»: a different list, named by its own words.
    expect(JSON.stringify(ro)).not.toMatch(/Vreau să apar pe lista de participanți”|Vreau să apar pe lista publică(?! a voluntarilor)/);
    expect(JSON.stringify(en)).not.toMatch(/appear on the participant list|Show my name on the public list/);
  });

  it("section 4 names the list and the results as one disclosure behind one tick, in both languages", () => {
    const ro4 = section(privacyNoticeRo, "4.");
    const en4 = section(privacyNoticeEn, "4.");
    expect(ro4).toContain("au bifat „vreau să apar pe lista de participanți & rezultate”");
    expect(ro4).toContain("o singură bifă pentru listă și pentru rezultate");
    expect(ro4).not.toContain("te vom întreba separat");
    expect(en4).toContain("ticked “I want to appear on the participants & results list”");
    expect(en4).toContain("one tick for the list and the results");
    expect(en4).not.toContain("ask you separately");
  });
});

/**
 * §NNN (amending §570, §581) — «Liste date sponsorilor»: the register's own arithmetic and its words.
 * The read, the route's refusal and the drawing are `tests/integration/registrations/sponsor-list.test.ts`.
 */
describe("BR-REQ-071-01 §NNN the register of the lists given", () => {
  it("keeps the club's copy thirty days from the download — the number the notice's section 7 and the captions say", () => {
    expect(SPONSOR_COPY_DAYS).toBe(30);
    expect(copyDeleteBy(new Date("2026-09-10T09:00:00.000Z"))).toEqual(new Date("2026-10-10T09:00:00.000Z"));
    // One number, said in every place a person reads it.
    expect(section(privacyNoticeRo, "7.")).toContain(`ștearsă în cel mult ${SPONSOR_COPY_DAYS} de zile de la descărcare`);
    expect(section(privacyNoticeEn, "7.")).toContain(`deleted within ${SPONSOR_COPY_DAYS} days of the download`);
    expect(ro.Admin.sponsors.help).toContain(`Șterge fișierul în ${SPONSOR_COPY_DAYS} de zile.`);
    expect(en.Admin.sponsors.help).toContain(`Delete the file in ${SPONSOR_COPY_DAYS} days.`);
  });

  it("names nobody for an empty box, spaces or control characters alone — what the route refuses", () => {
    for (const raw of [null, "", "   ", "\t\n", String.fromCharCode(7)]) expect(sponsorRecipient(raw)).toBeNull();
    expect(sponsorRecipient("  Sport   Shop SRL ")).toBe("Sport Shop SRL");
    expect(sponsorRecipient("x".repeat(300))).toHaveLength(SPONSOR_RECIPIENT_MAX);
  });

  it("cuts a long name between characters: an emoji at the limit goes whole or not at all, never as a half the audit row would refuse", () => {
    // The 120th and 121st code units are one emoji: the cut would leave its first half.
    const cutThrough = sponsorRecipient(`${"x".repeat(SPONSOR_RECIPIENT_MAX - 1)}😀`);
    expect(cutThrough).toBe("x".repeat(SPONSOR_RECIPIENT_MAX - 1));
    expect(cutThrough?.isWellFormed()).toBe(true);
    // One place earlier it fits, both halves.
    const fits = sponsorRecipient(`${"x".repeat(SPONSOR_RECIPIENT_MAX - 2)}😀`);
    expect(fits).toBe(`${"x".repeat(SPONSOR_RECIPIENT_MAX - 2)}😀`);
    expect(fits).toHaveLength(SPONSOR_RECIPIENT_MAX);
    // The row is JSON: what is kept must survive the trip.
    expect(JSON.parse(JSON.stringify({ recipient: cutThrough }))).toEqual({ recipient: cutThrough });
  });

  it("says «termen trecut» from the day after the one the register names, on the club's clock — never during that day", () => {
    const ZONE = "Europe/Bucharest";
    // Downloaded on 12 September at 12:00 in Brașov: «Șterge fișierul tău până pe» reads 12 October.
    const deleteBy = copyDeleteBy(new Date("2026-09-12T09:00:00.000Z"));
    expect(copyOverdue(deleteBy, new Date("2026-10-11T20:00:00.000Z"), ZONE)).toBe(false);
    // The named day itself, before and after the download's hour, up to its last minute.
    expect(copyOverdue(deleteBy, new Date("2026-10-12T06:00:00.000Z"), ZONE)).toBe(false);
    expect(copyOverdue(deleteBy, new Date("2026-10-12T09:01:00.000Z"), ZONE)).toBe(false);
    expect(copyOverdue(deleteBy, new Date("2026-10-12T20:59:00.000Z"), ZONE)).toBe(false);
    // Midnight in Brașov — 21:00 by UTC, still the 12th there.
    expect(copyOverdue(deleteBy, new Date("2026-10-12T21:00:00.000Z"), ZONE)).toBe(true);
    expect(copyOverdue(deleteBy, new Date("2026-10-15T09:00:00.000Z"), ZONE)).toBe(true);
    // A file made at 01:30 in Brașov is that day's there, the day before by UTC: the day named, and judged, is Brașov's.
    const afterMidnight = copyDeleteBy(new Date("2026-09-11T22:30:00.000Z"));
    expect(copyOverdue(afterMidnight, new Date("2026-10-12T20:00:00.000Z"), ZONE)).toBe(false);
    expect(copyOverdue(afterMidnight, new Date("2026-10-12T20:00:00.000Z"), "UTC")).toBe(true);
  });

  it("suggests each recipient once whatever its capitals, as last written, newest first, never a list without one", () => {
    const lists = [{ recipient: "sport shop srl" }, { recipient: null }, { recipient: "Decathlon" }, { recipient: "Sport Shop SRL" }, { recipient: "DECATHLON" }, { recipient: "club" }];
    expect(recipientSuggestions(lists)).toEqual(["sport shop srl", "Decathlon", "club"]);
    expect(recipientSuggestions(lists, 2)).toEqual(["sport shop srl", "Decathlon"]);
    expect(recipientSuggestions([])).toEqual([]);
  });

  it("suggests at most fifty recipients unless told otherwise", () => {
    const lists = Array.from({ length: 60 }, (_, index) => ({ recipient: `Sponsor ${index}` }));
    expect(SPONSOR_RECIPIENT_SUGGESTIONS).toBe(50);
    expect(recipientSuggestions(lists)).toEqual(lists.slice(0, 50).map((list) => list.recipient));
  });

  it("shows an event's door its own lists and those made for every event; «Newsletter» all of them", () => {
    const lists = [{ eventId: "autumn" }, { eventId: null }, { eventId: "winter" }, { eventId: "autumn" }];
    expect(listsOfDoor(lists, "autumn")).toEqual([{ eventId: "autumn" }, { eventId: null }, { eventId: "autumn" }]);
    expect(listsOfDoor(lists, "spring")).toEqual([{ eventId: null }]);
    expect(listsOfDoor(lists)).toEqual(lists);
  });

  it("has its words in both languages: the box no longer optional, what to write when the list stays with the club, the register's headings", () => {
    expect(ro.Admin.sponsors.recipient).toBe("Cui dai lista");
    expect(en.Admin.sponsors.recipient).toBe("Who receives the list");
    expect(ro.Admin.sponsors.help).toContain("Scrie cui o dai, sau „club” dacă rămâne la club.");
    expect(en.Admin.sponsors.help).toContain("Write whom it goes to, or “club” if it stays with the club.");
    expect(ro.Admin.sponsors.given.title).toBe("Liste date sponsorilor");
    expect(en.Admin.sponsors.given.title).toBe("Lists given to sponsors");
    expect(ro.Admin.sponsors.given.columns).toEqual({ recipient: "Cui", at: "Când", event: "Eveniment", count: "Persoane", file: "Fișier", actor: "Descărcată de", deleteBy: "Șterge fișierul tău până pe" });
    expect(Object.keys(en.Admin.sponsors.given.columns)).toEqual(Object.keys(ro.Admin.sponsors.given.columns));
    expect(Object.keys(en.Admin.sponsors.given.formats)).toEqual(["csv", "xlsx"]);
    // The English register word for word: a file named as the other, or «past due» saying the opposite, is a different register.
    expect(en.Admin.sponsors.recipientTitle).toBe("Write who receives the list.");
    expect(en.Admin.sponsors.given).toEqual({
      title: "Lists given to sponsors",
      intro: "Every download of the list: whom you gave it to, how many people it held and the day your file must be deleted by.",
      aside: "{lists} · latest: {recipient}, {date}",
      everyEvent: "every event",
      overdue: "past due: delete your file",
      formats: { csv: "CSV", xlsx: "Excel" },
      columns: { recipient: "To whom", at: "When", event: "Event", count: "People", file: "File", actor: "Downloaded by", deleteBy: "Delete your file by" },
    });
    expect(ro.Admin.sponsors.given.formats).toEqual({ csv: "CSV", xlsx: "Excel" });
    expect(ro.Admin.sponsors.given.overdue).toBe("termen trecut: șterge fișierul tău");
    expect(ro.Admin.sponsors.given.intro).toBe("Fiecare descărcare a listei: cui ai dat-o, câte persoane avea și până când ștergi fișierul tău.");
    for (const catalogue of [ro, en]) {
      expect(JSON.stringify(catalogue.Admin.sponsors)).not.toMatch(/opțional|optional/i);
      // The guide tells the same story: the box by its name, and where the lists are read back.
      const steps = catalogue.Admin.guide.sections.flatMap((entry) => entry.tasks.flatMap((task) => task.steps)).filter((step) => step.includes(`«${catalogue.Admin.sponsors.button}»`));
      expect(steps).toHaveLength(2);
      for (const step of steps) {
        expect(step).toContain(`«${catalogue.Admin.sponsors.recipient}»`);
        expect(step).toContain(`«${catalogue.Admin.sponsors.given.title}»`);
      }
    }
  });
});

