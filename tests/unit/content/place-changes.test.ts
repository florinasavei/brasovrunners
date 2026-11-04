import { describe, expect, it } from "vitest";
import {
  type PlaceChangeWords,
  type PlaceEffectKey,
  type PlaceFacts,
  type PlaceSettings,
  placeChangeLines,
  placeSettingsFromForm,
} from "@/modules/content/events/domain/place-changes";
import { type ConfirmSpec, resolvePlaceChanges } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * «Controlul înscrierilor e foarte sensibil» (§NNN; the owner, 2026-11-04; BR-REQ-050-02): before the event editor's
 * save commits a change to a place setting, ActionForm's one confirm says each change «before → after» and what it does,
 * from the numbers the page read on the server — what the site will announce, the free places on the site and kept for
 * the club, whether offers will be emailed, a lowering under the places taken — and an unchanged save asks nothing.
 * Read with the real catalogues, so a sentence that loses a `{name}` fails here.
 */
type Catalogue = typeof ro;

function wordsOf(catalogue: Catalogue): PlaceChangeWords {
  const editor = catalogue.Admin.editor as unknown as Record<string, string> & { waitlistModeChoices: Record<string, string> };
  const places = catalogue.Admin.confirm.places;
  return {
    title: places.title,
    intro: places.intro,
    line: places.line,
    labels: {
      capacity: editor.capacity,
      placesKeptForClub: editor.placesKeptForClub,
      waitlistCapacity: editor.waitlistMode,
      waitlistAutoOffer: editor.waitlistAutoOffer,
      publicRegistrationOpen: editor.publicRegistrationOpen,
      freePlacesByOfferOnly: editor.freePlacesByOfferOnly,
      releaseUnsignedAtDeadline: editor.releaseUnsignedAtDeadline,
      placesAlertAt: editor.placesAlertAt,
      confirmationOpensDaysBefore: editor.confirmationOpensDaysBefore,
      confirmationDeadlineDaysBefore: editor.confirmationDeadlineDaysBefore,
    },
    empty: places.empty,
    unlimited: places.unlimited,
    ticked: places.ticked,
    unticked: places.unticked,
    autoYes: editor.waitlistAutoOfferYes,
    autoNo: editor.waitlistAutoOfferNo,
    noWaitlist: editor.waitlistModeChoices.NONE,
    effects: places.effects as Record<PlaceEffectKey, string>,
  };
}

const DAY = 24 * 60 * 60_000;
const NOW = Date.now();
const STARTS = NOW + 30 * DAY;

/** The race as the owner had it: 175 places, «Da», nobody kept, the window 7 and 2 days before. */
const RACE: PlaceSettings = {
  capacity: 175,
  placesKeptForClub: 0,
  waitlistCapacity: null,
  waitlistAutoOffer: true,
  publicRegistrationOpen: true,
  freePlacesByOfferOnly: false,
  releaseUnsignedAtDeadline: false,
  placesAlertAt: null,
  confirmationOpensDaysBefore: 7,
  confirmationDeadlineDaysBefore: 2,
};
const FACTS: PlaceFacts = { occupied: 175, waiting: 20, datesOpen: true, startsAt: STARTS, now: NOW, releasedFor: null, zone: "Europe/Bucharest", locale: "ro" };
const RO = wordsOf(ro);
const EN = wordsOf(en as unknown as Catalogue);
const lines = (after: Partial<PlaceSettings>, facts: Partial<PlaceFacts> = {}, words = RO, before: PlaceSettings = RACE) =>
  placeChangeLines(before, { ...before, ...after }, { ...FACTS, ...facts }, words);

describe("BR-REQ-050-02 the place settings' summary before the editor's save (§NNN)", () => {
  it("an unchanged save asks nothing", () => {
    expect(lines({})).toBeNull();
    expect(lines({}, {}, EN)).toBeNull();
  });

  it("the capacity raised while people wait on «Da»: before → after, what the site announces, and the offers emailed", () => {
    expect(lines({ capacity: 190 })).toEqual([
      "Număr de locuri: 175 → 190.",
      "Locuri anunțate pe site: 190. Libere după salvare: 15 din 190.",
      "Pe lista de așteptare sunt 20: primii 15 primesc câte o ofertă pe email, imediat sau în câteva minute.",
      "Pe site, butonul este „Intră pe lista de așteptare”.",
    ]);
    expect(lines({ capacity: 190 }, {}, EN)?.[2]).toBe("20 are on the waiting list: the first 15 each get an offer by email, at once or within minutes.");
  });

  it("the same raise on «Nu»: nobody gets a place automatically", () => {
    const before = { ...RACE, waitlistAutoOffer: false };
    expect(lines({ capacity: 190 }, {}, RO, before)).toContain("Pe lista de așteptare sunt 20: nimeni nu primește loc automat, locurile libere le dai tu.");
  });

  it("places kept for the club: what the site announces, the free places on the site and kept — and no offer for a kept place", () => {
    const kept = lines({ capacity: 185, placesKeptForClub: 10 }, { occupied: 170 });
    expect(kept).toEqual([
      "Număr de locuri: 175 → 185.",
      "Locuri păstrate pentru club: 0 → 10.",
      "Locuri anunțate pe site: 175, adică 185 minus 10 păstrate pentru club. Libere după salvare: 15 din 185 — pe site 5, păstrate pentru club 10.",
      "Pe lista de așteptare sunt 20: primii 5 primesc câte o ofertă pe email, imediat sau în câteva minute.",
      "Pe site, butonul este „Intră pe lista de așteptare”.",
    ]);
  });

  it("lowered under the places taken, or K above the places: said alone, the save will be refused", () => {
    expect(lines({ capacity: 170 })).toEqual(["Număr de locuri: 175 → 170.", "Sunt deja 175 locuri ocupate: nu poți coborî sub ele, așa că salvarea va fi refuzată."]);
    expect(lines({ placesKeptForClub: 200 })?.[1]).toBe("Locurile păstrate pentru club ar fi mai multe decât cele 175 de locuri: salvarea va fi refuzată.");
  });

  it("the waiting list's limit and «Da»/«Nu» are said with the editor's own words", () => {
    expect(lines({ waitlistCapacity: 0 })?.[0]).toBe("Lista de așteptare: nelimitat → Fără listă de așteptare.");
    expect(lines({ waitlistCapacity: 30 })?.[0]).toBe("Lista de așteptare: nelimitat → 30.");
    expect(lines({ waitlistAutoOffer: false })?.[0]).toBe("Locurile din lista de așteptare se alocă automat: Da → Nu.");
  });

  it("the two ticks of the site's door", () => {
    expect(lines({ publicRegistrationOpen: false })).toEqual([
      "Înscrieri publice deschise: bifat → nebifat.",
      "Formularul de pe site e închis: înscrierile le faceți doar voi, din administrare.",
    ]);
    const offerOnly = lines({ freePlacesByOfferOnly: true }, { occupied: 170, waiting: 0 });
    expect(offerOnly?.[0]).toBe("Locurile libere le dau doar eu: nebifat → bifat.");
    expect(offerOnly).toContain("Pe site, butonul este „Intră pe lista de așteptare”.");
  });

  it("the release at the deadline: its instant, passed, no effect, off — and a moved deadline after it ran", () => {
    const at = lines({ releaseUnsignedAtDeadline: true });
    expect(at?.[0]).toBe("Eliberează singur locurile nesemnate la termen: nebifat → bifat.");
    expect(at?.[1]).toMatch(/^La .+, locurile celor care n-au semnat se eliberează și fiecare primește un email; de atunci locurile libere le dai doar tu\.$/);
    expect(lines({ releaseUnsignedAtDeadline: true }, { now: STARTS - DAY })?.[1]).toBe(
      "Termenul declarației a trecut: locurile nesemnate se eliberează în câteva minute și fiecare persoană primește un email.",
    );
    expect(lines({ releaseUnsignedAtDeadline: true, confirmationDeadlineDaysBefore: 0 })?.[1]).toBe(
      "Bifa nu are efect: termenul declarației e la start sau locurile sunt nelimitate.",
    );
    const on = { ...RACE, releaseUnsignedAtDeadline: true };
    expect(lines({ releaseUnsignedAtDeadline: false }, {}, RO, on)?.[1]).toBe(
      "Locurile nesemnate nu se mai eliberează la termen: rămân ale lor până le cere cineva sau până la start.",
    );
    // The window's deadline moved under the switch, after the release ran: said though no listed box changed.
    const moved = lines({ confirmationDeadlineDaysBefore: 1 }, { releasedFor: STARTS - 2 * DAY }, RO, on);
    expect(moved?.[moved.length - 1]).toBe(
      "Eliberarea a rulat deja: mutarea termenului nu aduce pe nimeni înapoi și pregătește o nouă eliberare la noul termen.",
    );
  });

  it("«Anunță-mă când rămân N locuri» set and cleared", () => {
    expect(lines({ placesAlertAt: 10 }, { occupied: 160 })).toEqual([
      "Anunță-mă când rămân N locuri: gol → 10.",
      "Administratorii primesc un email când locurile libere scad la 10; acum sunt 15.",
    ]);
    expect(lines({ placesAlertAt: null }, {}, RO, { ...RACE, placesAlertAt: 10 })?.[1]).toBe("Nu mai pleacă emailul când locurile se împuținează.");
  });
});

describe("§NNN the summary inside ActionForm's one confirm, from the form as posted", () => {
  const form = (values: Record<string, string>) => (field: string) => (field in values ? values[field] : null);
  const posted = {
    "event.registrationMode": "INTERNAL",
    "event.capacity": "175",
    "event.placesKeptForClub": "",
    "event.waitlistMode": "UNLIMITED",
    "event.waitlistCapacity": "",
    "event.waitlistAutoOffer": "true",
    "event.publicRegistrationOpen.present": "1",
    "event.publicRegistrationOpen": "on",
    "event.freePlacesByOfferOnly.present": "1",
    "event.releaseUnsignedAtDeadline.present": "1",
    "event.placesAlertAt": "",
    "event.confirmationOpensDaysBefore": "7",
    "event.confirmationDeadlineDaysBefore": "2",
  };
  const only: ConfirmSpec = { title: RO.title, body: RO.intro, confirmLabel: "Salvează", cancelLabel: "Înapoi", placeChanges: { before: RACE, facts: FACTS, words: RO, only: true } };

  it("reads the form with its own rules: the boxes as typed, a tick by its marker", () => {
    expect(placeSettingsFromForm(form(posted), RACE)).toEqual(RACE);
    expect(placeSettingsFromForm(form({ ...posted, "event.capacity": "", "event.placesKeptForClub": "4" }), RACE)).toMatchObject({ capacity: null, placesKeptForClub: 0 });
    expect(placeSettingsFromForm(form({ ...posted, "event.freePlacesByOfferOnly": "on" }), RACE).freePlacesByOfferOnly).toBe(true);
  });

  it("a dialog only for the places asks nothing when none moved, and lists them when one did", () => {
    expect(resolvePlaceChanges(only, form(posted))).toBeNull();
    const asked = resolvePlaceChanges(only, form({ ...posted, "event.placesKeptForClub": "10" }));
    expect(asked?.lines?.[0]).toBe("Locuri păstrate pentru club: 0 → 10.");
    expect(asked?.placeChanges).toBeUndefined();
  });

  it("another dialog keeps its own question, with the lines under its body when a place moved", () => {
    const notice: ConfirmSpec = { ...only, title: "Salvezi și anunți participanții?", placeChanges: { ...only.placeChanges!, only: false } };
    const unchanged = resolvePlaceChanges(notice, form(posted));
    expect(unchanged?.title).toBe("Salvezi și anunți participanții?");
    expect(unchanged?.lines).toBeUndefined();
    expect(resolvePlaceChanges(notice, form({ ...posted, "event.capacity": "180" }))?.lines?.[0]).toBe("Număr de locuri: 175 → 180.");
  });

  it("a form switched to another registration mode changes no place the service would read", () => {
    expect(resolvePlaceChanges(only, form({ ...posted, "event.registrationMode": "EXTERNAL", "event.capacity": "" }))).toBeNull();
  });
});
