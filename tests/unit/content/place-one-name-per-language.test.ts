import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ro from "../../../messages/ro.json";
import { eventInputConstraints } from "@/modules/content/events/constraints";
import { eventFieldsSchema, newEventSchema } from "@/modules/content/events/fields";
import { eventFormFieldName, PLACE_NAMES_AS_TYPED_FIELD } from "@/modules/content/events/form-names";
import { placeSummary, type SummaryTranslation, type SummaryWords } from "@/modules/content/events/ui/box-summaries";
import PlaceToBeAnnounced from "@/modules/content/events/ui/PlaceToBeAnnounced";
import { eventChangesToAnnounce, type EventChangeFacts } from "@/modules/events/domain/event-changes";
import {
  englishFollowsTyping,
  englishLeftBehind,
  englishNameAfterSave,
  mayCopyToEnglish,
  PLACE_NAME_FIELD,
  placeInBox,
  placeNameIn,
  placeShown,
} from "@/modules/events/domain/place";
import { textFieldConstraints } from "@/shared/forms/constraints";
import { RecallProvider } from "@/shared/forms/recall";

/**
 * BR-REQ-011-01 criterion 30 (`DECISIONS.md` §NNN) — "Punct de întâlnire", once per language.
 *
 * The owner, 2026-09-24, with a screenshot of the Locul box: "There is some redundance on this
 * meeting spot location". The shared meeting point and each language's "Denumirea locului" are
 * one question asked twice; they are now two boxes side by side, Română and English, both
 * required unless the place is to be announced (§328), with a button that copies the Romanian
 * name into the English box. The pure halves are here; the save, the readers and the series are
 * `tests/integration/cms/location-name-per-language.test.ts`.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const BASE = {
  type: "RACE",
  surface: "",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-11-21T09:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Parcul Tractorul",
  locationNameEn: "Tractorul Park",
  locationAddress: "",
  difficulty: "",
  costType: "",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "NONE",
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
  participantListVisibility: "HIDDEN",
} as const;

const refusedPaths = (value: unknown) => eventFieldsSchema.safeParse(value).error?.issues.map((issue) => issue.path.join(".")) ?? [];

describe("BR-REQ-011-01 criterion 30 the schema: a meeting point in each language", () => {
  it("takes both names, trimmed", () => {
    const parsed = eventFieldsSchema.safeParse({ ...BASE, locationName: " Parcul Tractorul ", locationNameEn: " Tractorul Park " });
    expect(parsed.data).toMatchObject({ locationName: "Parcul Tractorul", locationNameEn: "Tractorul Park" });
  });

  it("refuses a blank one, naming that language's box — both when both are blank", () => {
    expect(refusedPaths({ ...BASE, locationNameEn: "  " })).toEqual(["locationNameEn"]);
    expect(refusedPaths({ ...BASE, locationName: "" })).toEqual(["locationName"]);
    expect(refusedPaths({ ...BASE, locationName: "", locationNameEn: "" })).toEqual(["locationName", "locationNameEn"]);
  });

  it("asks for neither while the place is to be announced, and keeps what was typed", () => {
    const later = eventFieldsSchema.safeParse({ ...BASE, locationToBeAnnounced: true, locationName: "", locationNameEn: "Sports Hall" });
    expect(later.success).toBe(true);
    expect(later.data).toMatchObject({ locationName: null, locationNameEn: "Sports Hall" });
  });

  it("does not refuse a caller that posts no English box at all: it is not editing the English name", () => {
    const { locationNameEn: _english, ...older } = BASE;
    void _english;
    const parsed = eventFieldsSchema.safeParse(older);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.locationNameEn).toBeUndefined();
  });

  it("holds the English name to the Romanian one's ceiling, and is the create form's rule too", () => {
    expect(refusedPaths({ ...BASE, locationNameEn: "x".repeat(201) })).toEqual(["locationNameEn"]);
    const language = { slug: "crosul", title: "Crosul", excerpt: "Rezumat." };
    const fields = { ...BASE, translations: { ro: language, en: { ...language, slug: "the-cross" } } };
    expect(newEventSchema.safeParse(fields).success).toBe(true);
    expect(newEventSchema.safeParse({ ...fields, locationNameEn: "" }).success).toBe(false);
  });

  it("gives both boxes the same browser rule, read off the schema (§315)", () => {
    expect(eventInputConstraints("locationNameEn")).toEqual(eventInputConstraints("locationName"));
    expect(eventInputConstraints("locationNameEn")).toMatchObject({ required: true, maxLength: 200 });
  });

  it("names each box by the name the form posts it under, for the refusal summary", () => {
    expect(PLACE_NAME_FIELD).toEqual({ ro: "locationName", en: "locationNameEn" });
    expect(eventFormFieldName("locationNameEn")).toBe("event.locationNameEn");
    const labels = read("src/modules/content/events/ui/field-labels.ts");
    expect(labels).toContain('"event.locationNameEn": inBox("place", `${t("editor.fields.locationName")} (${tSite("languageName.en")})`)');
  });
});

describe("BR-REQ-011-01 criterion 30 what each language's page shows", () => {
  it("reads the language's own name, else the event's — never the other language's", () => {
    expect(placeNameIn({ locationName: "Parcul Tractorul" }, "Tractorul Park")).toBe("Tractorul Park");
    expect(placeNameIn({ locationName: "Parcul Tractorul" }, "  ")).toBe("Parcul Tractorul");
    expect(placeNameIn({ locationName: "Parcul Tractorul" }, null)).toBe("Parcul Tractorul");
    expect(placeNameIn({ locationName: " " }, null)).toBeNull();
  });

  it("opens the box of an event saved before with what its page shows, the address folded in", () => {
    const older = { locationName: "Parcul Tractorul", locationAddress: "Str. Turnului 5" };
    expect(placeInBox(older, null)).toBe("Parcul Tractorul, Str. Turnului 5");
    expect(placeInBox(older, "Tractorul Park")).toBe("Tractorul Park, Str. Turnului 5");
    expect(placeInBox({ locationName: "Parcul Tractorul", locationAddress: null }, undefined)).toBe("Parcul Tractorul");
    expect(placeInBox({ locationName: null, locationAddress: null }, null)).toBe("");
  });

  it("compares the place as the page shows it, spacing aside, the address after a language's own name too", () => {
    const older = { locationName: "Parcul  Tractorul ", locationAddress: " Str. Turnului 5" };
    expect(placeShown(older, null)).toBe("Parcul Tractorul, Str. Turnului 5");
    expect(placeShown(older, " Tractor   Park")).toBe("Tractor Park, Str. Turnului 5");
  });
});

/**
 * Found by review: an older event's English page had no name of its own — it showed the event's —
 * so its English box opens with the Romanian words. Moving only the Romanian must move the English
 * with it, or the date keeps the old place in English while a series save sends the new one to
 * every other date.
 */
describe("BR-REQ-011-01 criterion 30 an older event's English name follows its Romanian one", () => {
  const older = { locationName: "Parcul Tractorul", locationAddress: null };

  it("takes the Romanian name when the English box posted the page's old name and the Romanian moved", () => {
    expect(englishNameAfterSave(older, { ro: null, en: null }, { ro: "Parcul Titulescu", en: "Parcul Tractorul" })).toBe("Parcul Titulescu");
    // Spacing is not an edit of the English box, and the address folded in is the page's old name.
    expect(englishNameAfterSave(older, { ro: null, en: " " }, { ro: "Parcul Titulescu", en: " Parcul  Tractorul" })).toBe("Parcul Titulescu");
    const withAddress = { locationName: "Parcul Tractorul", locationAddress: "Str. Turnului 5" };
    expect(
      englishNameAfterSave(withAddress, { ro: null, en: null }, { ro: "Parcul Titulescu", en: "Parcul Tractorul, Str. Turnului 5" }),
    ).toBe("Parcul Titulescu");
  });

  it("keeps what was posted otherwise: a name of its own, an English box changed, a Romanian place not moved", () => {
    expect(englishNameAfterSave(older, { ro: null, en: "Tractorul Park" }, { ro: "Parcul Titulescu", en: "Tractorul Park" })).toBe("Tractorul Park");
    expect(englishNameAfterSave(older, { ro: null, en: null }, { ro: "Parcul Titulescu", en: "Titulescu Park" })).toBe("Titulescu Park");
    // The first save of an older event, nothing moved: both rows take the page's name.
    expect(englishNameAfterSave(older, { ro: null, en: null }, { ro: "Parcul Tractorul", en: "Parcul Tractorul" })).toBe("Parcul Tractorul");
  });

  it("never fills a blank English box: an event with no place yet does not get the Romanian one in English (found by re-review)", () => {
    // The place to be announced, nothing named yet; the organizer types only the Romanian venue.
    const noPlace = { locationName: null, locationAddress: null };
    expect(englishNameAfterSave(noPlace, { ro: null, en: null }, { ro: "Sala Sporturilor", en: null })).toBeNull();
    expect(englishNameAfterSave(noPlace, { ro: null, en: null }, { ro: "Sala Sporturilor", en: "  " })).toBe("  ");
    // An older event's blank English box is the organizer's too.
    expect(englishNameAfterSave(older, { ro: null, en: null }, { ro: "Parcul Titulescu", en: null })).toBeNull();
  });

  it("keeps the English as posted when the Romanian row had a name of its own, as the editor's line says (found by re-review)", () => {
    // The two pages already said different things: the Romanian its own name, the English the event's.
    const rows = { ro: "Parcul Tractorul, intrarea nord", en: null };
    expect(englishNameAfterSave(older, rows, { ro: "Parcul Titulescu", en: "Parcul Tractorul" })).toBe("Parcul Tractorul");
    expect(englishLeftBehind({ ro: "Parcul Tractorul, intrarea nord", en: "Parcul Tractorul" }, { ro: "Parcul Titulescu", en: "Parcul Tractorul" })).toBe(true);
  });
});

describe("BR-REQ-011-01 criterion 30 the English box while the Romanian is typed", () => {
  it("follows while the two say the same place, and never when the English is blank or its own", () => {
    expect(englishFollowsTyping("Parcul Tractorul", "Parcul Tractorul")).toBe(true);
    expect(englishFollowsTyping("Parcul Tractorul ", " Parcul  Tractorul")).toBe(true);
    expect(englishFollowsTyping("Parcul Tractorul", "Tractorul Park")).toBe(false);
    expect(englishFollowsTyping("", "")).toBe(false);
    expect(englishFollowsTyping("Parcul Tractorul", "")).toBe(false);
  });

  it("copies into an empty English box only, and only something", () => {
    expect(mayCopyToEnglish("Stadionul Tineretului", "")).toBe(true);
    expect(mayCopyToEnglish("Stadionul Tineretului", "  ")).toBe(true);
    expect(mayCopyToEnglish("Stadionul Tineretului", "Youth Stadium")).toBe(false);
    expect(mayCopyToEnglish("Stadionul Tineretului", "Stadionul Tineretului")).toBe(false);
    expect(mayCopyToEnglish(" ", "")).toBe(false);
  });

  it("says the English still names the old place when the Romanian moved away from a name of its own", () => {
    const stored = { ro: "Parcul Tractorul", en: "Tractorul Park" };
    expect(englishLeftBehind(stored, { ro: "Poiana Brașov", en: "Tractorul Park" })).toBe(true);
    // Nothing moved, the English changed too, or the English is empty: nothing to say.
    expect(englishLeftBehind(stored, stored)).toBe(false);
    expect(englishLeftBehind(stored, { ro: "Poiana Brașov", en: "Poiana Brasov" })).toBe(false);
    expect(englishLeftBehind(stored, { ro: "Poiana Brașov", en: "" })).toBe(false);
    // The create page: nothing stored, nothing left behind.
    expect(englishLeftBehind({ ro: "", en: "" }, { ro: "Poiana Brașov", en: "" })).toBe(false);
  });
});

describe("BR-REQ-011-01 criterion 30 the closed Locul box", () => {
  const words = ro.Admin.editor.boxes.summary as SummaryWords;
  const language = (locale: string, locationName: string | null): SummaryTranslation => ({
    locale,
    title: "",
    slug: "",
    excerpt: null,
    excerptJson: null,
    bodyJson: null,
    rulesJson: null,
    scheduleJson: null,
    checklist: null,
    locationName,
  });
  const event = { locationName: "Parcul Tractorul", locationAddress: null, locationToBeAnnounced: false, mapUrl: null };

  it("says the Romanian name, and the English one only when it says something else", () => {
    expect(placeSummary(words, event, [language("ro", "Parcul Tractorul"), language("en", "Tractorul Park")])).toBe("Parcul Tractorul (EN: Tractorul Park)");
    expect(placeSummary(words, event, [language("ro", "Parcul Tractorul"), language("en", "Parcul Tractorul")])).toBe("Parcul Tractorul");
    // An event saved before: the English row empty, the English page showing the event's name.
    expect(placeSummary(words, event, [language("ro", null), language("en", null)])).toBe("Parcul Tractorul");
  });
});

describe("BR-REQ-011-01 criterion 30 the two boxes and the copy button", () => {
  const box = textFieldConstraints(eventInputConstraints("locationName"));
  const labels = {
    toggle: "Locația se anunță mai târziu",
    toggleHelp: "Ajutor.",
    meetingPoint: "Punct de întâlnire",
    ro: "Română",
    en: "English",
    locationHelp: "Locul.",
    unpublished: "Nepublicat.",
    copyToEnglish: "Același nume și în engleză",
    englishLeftBehind: "În engleză scrie tot „{place}”.",
  };
  const render = (roName: string, enName: string, values: Record<string, string[]> | null = null) =>
    renderToStaticMarkup(
      createElement(
        RecallProvider,
        { value: { values, fields: [], generation: values ? 1 : 0, fieldError: "Verifică acest câmp." } } as unknown as ComponentProps<typeof RecallProvider>,
        createElement(
          PlaceToBeAnnounced,
          { defaultChecked: false, labels, names: { ro: { defaultValue: roName, box }, en: { defaultValue: enName, box } } } as ComponentProps<typeof PlaceToBeAnnounced>,
          createElement("input", { name: "event.mapUrl" }),
        ),
      ),
    );
  const copyButton = (html: string) => /<button[^>]*data-testid="place-copy-to-english"[^>]*>/.exec(html)?.[0] ?? "";

  it("puts the two names under one heading, each labelled by its language and read out with the heading", () => {
    const html = render("Parcul Tractorul", "Tractorul Park");
    expect(html).toContain("<legend");
    expect(html).toContain(">Punct de întâlnire</");
    expect(html).toMatch(/<input[^>]*name="event\.locationName"[^>]*value="Parcul Tractorul"/);
    expect(html).toMatch(/<input[^>]*name="event\.locationNameEn"[^>]*value="Tractorul Park"/);
    // The label's text is "Punct de întâlnire (English)" to a screen reader and to the save
    // button's "completează întâi: …"; on the screen, under the heading, "English".
    expect(html).toMatch(/Punct de întâlnire \(<\/span>English<span[^>]*>\)/);
  });

  it("offers the copy only into an empty English box: a name already there is never replaced by a tap", () => {
    expect(copyButton(render("Stadionul Tineretului", ""))).not.toMatch(/\bdisabled\b/);
    expect(copyButton(render("Stadionul Tineretului", "Youth Stadium"))).toMatch(/\bdisabled\b/);
    expect(copyButton(render("Stadionul Tineretului", "Stadionul Tineretului"))).toMatch(/\bdisabled\b/);
    expect(copyButton(render("", ""))).toMatch(/\bdisabled\b/);
    expect(render("a", "")).toContain(labels.copyToEnglish);
  });

  it("reads the boxes back after a refusal, the copy button with them", () => {
    const html = render("", "", { "event.locationName": ["Piața Sfatului"], "event.locationNameEn": ["Piața Sfatului"] });
    expect(html).toMatch(/<input[^>]*name="event\.locationNameEn"[^>]*value="Piața Sfatului"/);
    expect(copyButton(html)).toMatch(/\bdisabled\b/);
  });

  it("says under the English box that it still names the place the Romanian moved away from", () => {
    const moved = { "event.locationName": ["Poiana Brașov"], "event.locationNameEn": ["Tractorul Park"] };
    const html = render("Parcul Tractorul", "Tractorul Park", moved);
    expect(html).toContain('data-testid="place-english-left-behind"');
    expect(html).toContain("În engleză scrie tot „Tractorul Park”.");
    // Nothing moved, or the English moved too: no line.
    expect(render("Parcul Tractorul", "Tractorul Park")).not.toContain("place-english-left-behind");
    const both = { "event.locationName": ["Poiana Brașov"], "event.locationNameEn": ["Poiana Brasov"] };
    expect(render("Parcul Tractorul", "Tractorul Park", both)).not.toContain("place-english-left-behind");
  });

  it("keeps the unseen half of each label one pixel wide, never MUI's `1` (100%)", () => {
    // A label-wide span pushed a 320-pixel page sideways. The copy and the following themselves
    // are the pure rules above and the e2e steps (`cms-publish`, `event-notices`).
    const island = read("src/modules/content/events/ui/PlaceToBeAnnounced.tsx");
    expect(island).toContain('width: "1px"');
    expect(island).not.toMatch(/width: 1,/);
  });

  it("says its English name is final only once it runs: the server's HTML carries no marker (found by re-review)", () => {
    // With JavaScript off nothing followed on the screen, so the service's rule is the whole answer.
    expect(render("Parcul Tractorul", "Parcul Tractorul")).not.toContain(PLACE_NAMES_AS_TYPED_FIELD);
  });
});

describe("BR-REQ-011-01 criterion 30 the participants' notice (§331)", () => {
  const before: EventChangeFacts = {
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-10-11T05:00:00.000Z"),
    raceStartsAt: null,
    locationName: "Parcul Tractorul",
    locationAddress: "Str. Turnului 5",
    mapUrl: null,
    scheduleItems: null,
  };

  it("counts no change when a first save writes the pages' own names into the columns", () => {
    const after = { ...before, locationName: "Parcul Tractorul, Str. Turnului 5", locationAddress: null };
    const languagesBefore = [
      { locale: "ro", locationName: null },
      { locale: "en", locationName: null },
    ];
    const languagesAfter = [
      { locale: "ro", locationName: "Parcul Tractorul, Str. Turnului 5" },
      { locale: "en", locationName: "Parcul Tractorul, Str. Turnului 5" },
    ];
    expect(eventChangesToAnnounce(before, after, languagesBefore, languagesAfter)).toEqual([]);
  });

  it("counts no change when an older event's own English name takes the address it was shown with", () => {
    // Found by review: the page shows the address after a language's own name too, so the box
    // opens with "Tractor Park, Str. Turnului 5" — and saving that is the same place, as the series
    // edit already said.
    const after = { ...before, locationName: "Parcul Tractorul, Str. Turnului 5", locationAddress: null };
    const languagesBefore = [
      { locale: "ro", locationName: null },
      { locale: "en", locationName: "Tractor Park" },
    ];
    const languagesAfter = [
      { locale: "ro", locationName: "Parcul Tractorul, Str. Turnului 5" },
      { locale: "en", locationName: "Tractor Park, Str. Turnului 5" },
    ];
    expect(eventChangesToAnnounce(before, after, languagesBefore, languagesAfter)).toEqual([]);
    // And a real move of the English name still counts.
    const moved = [languagesAfter[0], { locale: "en", locationName: "Titulescu Park" }];
    expect(eventChangesToAnnounce(before, after, languagesBefore, moved)).toEqual(["place"]);
  });

  it("counts a place moved in English alone", () => {
    const languages = [
      { locale: "ro", locationName: "Parcul Tractorul" },
      { locale: "en", locationName: "Tractorul Park" },
    ];
    const moved = [languages[0], { locale: "en", locationName: "Tractorul Park, main gate" }];
    expect(eventChangesToAnnounce(before, before, languages, moved)).toEqual(["place"]);
  });
});
