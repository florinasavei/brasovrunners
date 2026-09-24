import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  addressSummary,
  bibsSummary,
  coHostsSummary,
  conditionsSummary,
  confirmationSummary,
  courseSummary,
  descriptionSummary,
  incompleteLocales,
  BLANK,
  linksSummary,
  placeSummary,
  programmeSummary,
  promotionSummary,
  registrationSummary,
  registrationWindowSummary,
  rulesSummary,
  startListSummary,
  type SummaryTranslation,
  type SummaryWords,
  summaryDate,
  summaryDateTime,
  timezoneSummary,
  titleSummarySummary,
  whenSummary,
} from "@/modules/content/events/ui/box-summaries";
import { fillIn } from "@/shared/forms/fill-in";

/**
 * §350 — the line each box of the event editor shows while it is shut, so the editor reads like
 * the event's fact sheet. Pure functions of the saved event, with the real catalogue's templates:
 * a template whose placeholder the function does not fill would show `{count}` to an organizer,
 * which is what this would catch.
 */
const words = ro.Admin.editor.boxes.summary as SummaryWords;
const wordsEn = en.Admin.editor.boxes.summary as SummaryWords;
const ZONE = "Europe/Bucharest";

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };

function language(locale: string, overrides: Partial<SummaryTranslation> = {}): SummaryTranslation {
  return {
    locale,
    title: "",
    slug: "",
    excerpt: null,
    excerptJson: null,
    bodyJson: null,
    rulesJson: null,
    scheduleJson: null,
    checklist: null,
    locationName: null,
    ...overrides,
  };
}

describe("§350 dates in the summaries: the site's short form (src/i18n/dates.ts), the reader's language, the event's zone", () => {
  it("writes a Saturday race start as `Sâm., 21 nov. 2026, 09:00` in Bucharest, whatever the server's zone", () => {
    const start = new Date("2026-11-21T07:00:00Z"); // 09:00 in Bucharest (UTC+2 in November)
    expect(summaryDateTime(start, ZONE, "ro")).toBe("Sâm., 21 nov. 2026, 09:00");
    expect(summaryDate(start, ZONE, "ro")).toBe("Sâm., 21 nov. 2026");
  });

  it("writes it in English for an English reader, and in lower case inside a Romanian sentence", () => {
    const start = new Date("2026-11-21T07:00:00Z");
    expect(summaryDateTime(start, ZONE, "en")).toBe("Sat, 21 Nov 2026, 09:00");
    expect(summaryDate(start, ZONE, "ro", "inline")).toBe("sâm., 21 nov. 2026");
  });

  it("names the date the zone's own day, not UTC's", () => {
    // 23:30 UTC on the 30th is already 02:30 on 1 October in Bucharest (UTC+3 in summer).
    expect(summaryDateTime(new Date("2026-09-30T23:30:00Z"), ZONE, "ro")).toBe("Joi, 1 oct. 2026, 02:30");
  });
});

describe("§350 each box's summary, empty and filled", () => {
  const event = {
    type: "RACE",
    startsAt: new Date("2026-11-21T07:00:00Z"),
    endsAt: new Date("2026-11-21T10:00:00Z"),
    raceStartsAt: new Date("2026-11-21T07:30:00Z"),
    timezone: ZONE,
  } as const;

  it("Data și ora", () => {
    expect(whenSummary(words, null, "ro")).toBe(words.when.none);
    expect(whenSummary(words, event as never, "ro")).toBe("Sâm., 21 nov. 2026, 09:00 · startul cursei 09:30 · 180 min");
    expect(whenSummary(wordsEn, event as never, "en")).toBe("Sat, 21 Nov 2026, 09:00 · race start 09:30 · 180 min");
    // A gun time is a race's alone (§71).
    expect(whenSummary(words, { ...event, type: "GROUP_RUN" } as never, "ro")).toBe("Sâm., 21 nov. 2026, 09:00 · 180 min");
  });

  it("Fus orar", () => {
    expect(timezoneSummary(words, ZONE)).toBe("Europe/Bucharest — ora României");
    expect(timezoneSummary(words, "Europe/Vienna")).toBe("Europe/Vienna");
  });

  it("Titlu și rezumat: the titles, then what is missing and where", () => {
    const both = [language("ro", { title: "Crosul Tâmpei", excerptJson: doc("Sus pe Tâmpa.") }), language("en", { title: "Tâmpa Cross", excerptJson: doc("Up Tâmpa.") })];
    expect(titleSummarySummary(words, both)).toBe("„Crosul Tâmpei” · „Tâmpa Cross”");
    const englishShort = [both[0], language("en", { title: "Tâmpa Cross", excerptJson: emptyDoc })];
    expect(titleSummarySummary(words, englishShort)).toBe("„Crosul Tâmpei” · „Tâmpa Cross” · lipsește rezumatul (EN)");
  });

  it("Descrierea and Regulamentul: per language, and what the empty language's page shows", () => {
    const one = [language("ro", { bodyJson: doc("Totul despre cursă."), rulesJson: doc("Casca e obligatorie.") }), language("en")];
    expect(descriptionSummary(words, one)).toBe("RO: completat · EN: gol — pagina EN arată rezumatul");
    expect(rulesSummary(words, one)).toBe("RO: completat · EN: gol — pagina EN nu are regulament");
    // Both empty: no half-sentence about a fallback nobody wrote.
    expect(descriptionSummary(words, [language("ro"), language("en")])).toBe("RO: gol · EN: gol");
  });

  it("Locul: the place, its other names, the map — or to be announced", () => {
    const place = { locationName: "Parcul Titulescu", locationAddress: null, locationToBeAnnounced: false, mapUrl: "https://maps.example.test" };
    expect(placeSummary(words, place, [language("ro"), language("en", { locationName: "Titulescu Park" })])).toBe("Parcul Titulescu (EN: Titulescu Park) · hartă");
    expect(placeSummary(words, { ...place, locationToBeAnnounced: true }, [])).toBe("Se anunță mai târziu");
    expect(placeSummary(words, { ...place, locationName: null, mapUrl: null }, [])).toBe(words.place.none);
  });

  it("Programul zilei: rows counted in Romanian, the span, what to bring — or the group run's words", () => {
    const rows = {
      timezone: ZONE,
      scheduleItems: [
        { startsAt: "2026-11-21T06:00:00.000Z", endsAt: null, label: { ro: "Kituri", en: "Kits" }, place: null },
        { startsAt: "2026-11-21T07:30:00.000Z", endsAt: "2026-11-21T10:30:00.000Z", label: { ro: "Start", en: "Start" }, place: null },
      ],
    };
    const checklist = [language("ro", { checklist: "apă" }), language("en", { checklist: "water" })];
    expect(programmeSummary(words, rows as never, true, checklist, "ro")).toBe("2 momente, 08:00–12:30 · ce să aduci: RO, EN");
    expect(programmeSummary(words, null, false, [language("ro", { checklist: "frontală" }), language("en")], "ro")).toBe(
      "Fără program (alergare de grup) · ce să aduci: RO",
    );
    expect(programmeSummary(words, { timezone: ZONE, scheduleItems: null } as never, true, [], "ro")).toBe("Fără program");
  });

  it("Participare și înscrieri: by mode, the places counted in Romanian, the declaration, the list", () => {
    const internal = {
      type: "RACE",
      registrationMode: "INTERNAL",
      capacity: 150,
      minAge: 14,
      declarationDocumentId: "d",
      participantListVisibility: "HIDDEN",
      externalProvider: null,
      costType: "FREE",
    };
    const options = { takesRegistrations: true, costLabel: "Gratuit", declarationVersion: 3, defaultMinAge: 14, locale: "ro", creating: false };
    expect(registrationSummary(words, internal as never, options)).toBe("Pe site · 150 de locuri · de la 14 ani · Gratuit · declarația v3 · lista ascunsă");
    expect(registrationSummary(words, { ...internal, capacity: 1 } as never, options)).toContain("1 loc");
    expect(registrationSummary(words, { ...internal, capacity: 12 } as never, { ...options, declarationVersion: null })).toContain("12 locuri · de la 14 ani · Gratuit · lipsește declarația");
    expect(registrationSummary(words, { ...internal, registrationMode: "EXTERNAL", externalProvider: "Asociația X" } as never, { ...options, costLabel: "Cu taxă" })).toBe(
      "La organizator: Asociația X · Cu taxă",
    );
    expect(registrationSummary(words, null, { ...options, costLabel: null, creating: true })).toBe(words.registration.noneInvite);
    expect(registrationSummary(words, internal as never, { ...options, takesRegistrations: false })).toBe("Alergare de grup — fără înscrieri · Gratuit");
  });

  it("the registration box's cards", () => {
    expect(registrationWindowSummary(words, null, "ro")).toBe("De la publicare – până la start");
    expect(
      registrationWindowSummary(words, { registrationOpensAt: new Date("2026-10-01T07:00:00Z"), registrationClosesAt: null, timezone: ZONE }, "ro"),
    ).toBe("Joi, 1 oct. 2026, 10:00 – până la start");
    // A span: the second date continues the first, in the language's own case.
    expect(
      registrationWindowSummary(
        words,
        { registrationOpensAt: new Date("2026-10-01T07:00:00Z"), registrationClosesAt: new Date("2026-11-19T21:59:00Z"), timezone: ZONE },
        "ro",
      ),
    ).toBe("Joi, 1 oct. 2026, 10:00 – joi, 19 nov. 2026, 23:59");
    expect(conditionsSummary(words, 14, { version: 3, title: "Declarația" })).toBe("de la 14 ani · declarația v3");
    expect(conditionsSummary(words, 16, null)).toBe(`de la 16 ani · ${words.conditions.noDeclaration}`);
    expect(confirmationSummary(words, 7, 2)).toBe("Cerută cu 7 zile înainte, termen cu 2 zile înainte");
    expect(bibsSummary(words, 100, "Verde", { allocated: 42, unprinted: 2 })).toBe("De la 100 · Verde · alocate: 42, de tipărit: 2");
    expect(bibsSummary(words, 1, null, null)).toBe("De la 1 · culoarea clubului");
    expect(startListSummary(words, "HIDDEN")).toBe("Ascunsă");
    expect(startListSummary(words, "NAMES")).toBe(words.startList.shown);
  });

  it("Traseul, Linkuri, Parteneri, Evidențiere — and the empty state of each", () => {
    expect(courseSummary(words, null, { surface: null, difficulty: null })).toBe("Nimic completat");
    expect(courseSummary(words, { distanceMeters: 12_000, elevationGainMeters: 450, routeUrl: "https://x.test" }, { surface: "Trail", difficulty: "Mediu" })).toBe(
      "Trail · Mediu · 12 km · +450 m · traseu",
    );
    expect(courseSummary(words, { distanceMeters: 21_100, elevationGainMeters: null, routeUrl: null }, { surface: null, difficulty: null })).toBe("21,1 km");
    expect(linksSummary(words, null, {}, "ro")).toBe("Niciun link");
    expect(
      linksSummary(
        words,
        { stravaEventUrl: "https://s.test", facebookEventUrl: null, links: [{ kind: "GPX", url: "https://g.test" }, { kind: "MAP", url: "https://m.test" }] },
        { GPX: "GPX", MAP: "Hartă" },
        "ro",
      ),
    ).toBe("Strava · 2 linkuri (GPX, Hartă)");
    expect(coHostsSummary(words, null, "ro")).toBe("Fără parteneri");
    expect(coHostsSummary(words, { coHosts: [{ name: "Salvamont" }, { name: "Decathlon" }], coHostName: null, coHostUrl: null }, "ro")).toBe(
      "Împreună cu Salvamont și Decathlon",
    );
    // The partner's links counted, and its description in one word (§352)…
    const festival = {
      name: "Brașov Running Festival",
      descriptionRo: "Alergăm împreună.",
      descriptionEn: "We run together.",
      links: [
        { kind: "SITE", url: "https://festival.example.test" },
        { kind: "REGISTRATION", url: "https://festival.example.test/inscriere" },
      ],
    };
    expect(coHostsSummary(words, { coHosts: [festival], coHostName: null, coHostUrl: null }, "ro")).toBe(
      "Împreună cu Brașov Running Festival · 2 linkuri · cu descriere",
    );
    // …and a description in one language only named, since the next save will refuse it.
    expect(coHostsSummary(words, { coHosts: [{ ...festival, descriptionEn: null, links: [] }], coHostName: null, coHostUrl: null }, "ro")).toBe(
      "Împreună cu Brașov Running Festival · descriere într-o singură limbă",
    );
    expect(promotionSummary(words, null)).toBe("Nimic în evidență");
    expect(promotionSummary(words, { featured: true, isSpecial: true })).toBe("Eveniment principal · Ediție specială");
  });

  it("Adresa paginii: each language's path, and the lock", () => {
    const paths = { ro: "/ro/evenimente", en: "/en/events" };
    const translations = [language("ro", { slug: "crosul-tampei" }), language("en", { slug: "tampa-cross" })];
    expect(addressSummary(words, translations, paths, true)).toBe("/ro/evenimente/crosul-tampei · /en/events/tampa-cross · blocată după publicare");
    expect(addressSummary(words, [language("ro"), language("en", { slug: "x" })], paths, false)).toBe("RO: fără adresă · /en/events/x");
  });
});

describe("§350 the tabs' first-paint marks", () => {
  it("marks a required text missing here, and an optional one written only in the other language", () => {
    const translations = [language("ro", { title: "Cros", excerptJson: doc("x"), bodyJson: doc("Tot.") }), language("en", { title: "" })];
    expect(incompleteLocales(translations, "required", BLANK.titleSummary)).toEqual(["en"]);
    expect(incompleteLocales(translations, "parity", BLANK.description)).toEqual(["en"]);
    // Nobody wrote rules: no language is behind the other.
    expect(incompleteLocales(translations, "parity", BLANK.rules)).toEqual([]);
  });

  it("applies parity to each field of the programme on its own, as the strip does while typing", () => {
    // The notes in Romanian, the checklist in English: each language lacks one field the other
    // has, so both tabs are marked on first paint — the same answer the live watch gives on the
    // first keystroke (`names: ["schedule", "checklist"]`), not a mark that appears from nowhere.
    const split = [language("ro", { scheduleJson: doc("09:00 start") }), language("en", { checklist: "Water" })];
    expect(incompleteLocales(split, "parity", BLANK.programme)).toEqual(["ro", "en"]);
    // Both fields in one language only: the other is behind; both in both: nobody is.
    const oneSided = [language("ro", { scheduleJson: doc("09:00 start"), checklist: "Apă" }), language("en")];
    expect(incompleteLocales(oneSided, "parity", BLANK.programme)).toEqual(["en"]);
    const full = [language("ro", { scheduleJson: doc("09:00"), checklist: "Apă" }), language("en", { scheduleJson: doc("09:00"), checklist: "Water" })];
    expect(incompleteLocales(full, "parity", BLANK.programme)).toEqual([]);
  });
});

describe("§350 every summary template, in both catalogues, fills without a stray placeholder", () => {
  const leaves = (node: unknown, prefix = ""): Array<[string, string]> =>
    node && typeof node === "object"
      ? Object.entries(node).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key))
      : [[prefix, String(node)]];

  it("has the same templates in Romanian and English", () => {
    expect(leaves(wordsEn).map(([key]) => key)).toEqual(leaves(words).map(([key]) => key));
  });

  it("leaves nothing in braces once the values it names are given", () => {
    for (const [key, template] of [...leaves(words), ...leaves(wordsEn)]) {
      const values = Object.fromEntries([...template.matchAll(/\{(\w+)\}/g)].map((match) => [match[1], "x"]));
      expect(fillIn(template, values), key).not.toMatch(/\{\w+\}/);
    }
  });
});
