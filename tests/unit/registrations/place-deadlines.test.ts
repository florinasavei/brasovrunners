import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import {
  type PlaceDeadlineCounts,
  type PlaceDeadlineEvent,
  placeDeadlineSentences,
} from "@/modules/registrations/domain/place-deadlines";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §635 — «Când pierde lumea locul? Trebuie să apară asta in back-office» (the owner, 2026-10-02): the
 * sentences under «Cine s-a înscris», in «Înscrierile primite» and beside the queue's «Rezervate»,
 * built from the event's window (§104, §407), the club's «Termene» (§377), the waiting-list setting
 * (§615) and the counts — read here through the real catalogues, in both languages.
 *
 * The race of the owner's question: 21 November, 10:00 in Brașov; the window asked seven days before
 * and owed two; 150 places. BR-REQ-033-01, BR-REQ-037-03.
 */
const START = new Date("2026-11-21T08:00:00.000Z");
const OPENS = new Date("2026-11-14T08:00:00.000Z");
const DUE = new Date("2026-11-19T08:00:00.000Z");
const OCT_2 = new Date("2026-10-02T09:00:00.000Z");

const RACE: PlaceDeadlineEvent = {
  startsAt: START,
  eventStatus: "SCHEDULED",
  registrationClosesAt: null,
  confirmationOpensDaysBefore: 7,
  confirmationDeadlineDaysBefore: 2,
  capacity: 150,
  waitlistCapacity: null,
  waitlistAutoOffer: true,
};

const NONE: PlaceDeadlineCounts = { held: 0, heldPast: 0, awaitingEmail: 0, familyReserved: 0, offered: 0 };

function sentences(
  locale: "ro" | "en",
  options: { event?: Partial<PlaceDeadlineEvent>; counts?: Partial<PlaceDeadlineCounts>; now?: Date; deadlines?: Partial<typeof DEFAULT_DEADLINES> } = {},
) {
  const catalogue = (locale === "ro" ? ro : en) as unknown as { Admin: Record<string, unknown> };
  const t = createTranslator({ locale, messages: catalogue.Admin as never });
  return placeDeadlineSentences({
    event: { ...RACE, ...options.event },
    counts: { ...NONE, ...options.counts },
    deadlines: { ...DEFAULT_DEADLINES, ...options.deadlines },
    now: options.now ?? OCT_2,
    locale,
    timeZone: CLUB_TIME_ZONE,
    t: (key, values) => (t as unknown as (key: string, values?: Record<string, string | number>) => string)(key, values),
  });
}

const texts = (lines: ReturnType<typeof sentences>) => lines.map((line) => line.text);
const day = (locale: "ro" | "en", at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });

describe("§635 when a place is lost — the sentences", () => {
  it("the window still ahead: every held place is the person's until the window's deadline, with its days (ro)", () => {
    const lines = sentences("ro", { counts: { held: 16, awaitingEmail: 7 } });
    expect(texts(lines)).toEqual([
      `16 persoane au de semnat declarația și își țin locul până ${day("ro", DUE)} (cu 2 zile înainte de start).`,
      "După termen locul nu se pierde singur: se eliberează doar când cineva de pe lista de așteptare n-are alt loc liber, și i se oferă primului din listă.",
      "La start, cine n-a semnat pierde locul; la masă poate fi confirmat pe hârtie, dacă mai e un loc liber.",
      "7 persoane n-au confirmat încă adresa: linkul e valabil 48 de ore de când pleacă emailul, apoi înscrierile expiră; până atunci nu țin niciun loc.",
    ]);
    expect(lines.map((line) => line.group)).toEqual(["held", "held", "held", "email"]);
  });

  it("the same in English", () => {
    expect(texts(sentences("en", { counts: { held: 16, awaitingEmail: 7 } }))).toEqual([
      `16 people have to sign the declaration and keep their place until ${day("en", DUE)} (2 days before the start).`,
      "Past the deadline a place is not lost by itself: it is released only when someone on the waiting list has no other free place, and offered to the first in line.",
      "At the start, whoever has not signed loses the place; at the desk they can be confirmed on paper, if a place is still free.",
      "7 people have not confirmed their address yet: the link is valid for 48 hours from when the email leaves, then the registrations expire; until then they hold no place.",
    ]);
  });

  it("a deadline of 0 is the start itself (§407): «până la start», and no sentence about a passed deadline", () => {
    const event = { confirmationDeadlineDaysBefore: 0 };
    expect(texts(sentences("ro", { event, counts: { held: 1 } }))).toEqual([
      "O persoană are de semnat declarația și își ține locul până la start.",
      "La start, cine n-a semnat pierde locul; la masă poate fi confirmat pe hârtie, dacă mai e un loc liber.",
    ]);
    expect(texts(sentences("en", { event, counts: { held: 1 } }))[0]).toBe("One person has to sign the declaration and keeps the place until the start.");
  });

  it("the window open: the places given before it keep its deadline, a new one gets the club's minutes", () => {
    const now = new Date("2026-11-15T10:00:00.000Z");
    const ro = texts(sentences("ro", { now, counts: { held: 20 }, deadlines: { holdMinutes: 45 } }));
    expect(ro.slice(0, 3)).toEqual([
      "20 de persoane au de semnat declarația.",
      `Cine și-a confirmat adresa înainte de ${day("ro", OPENS)} își ține locul până ${day("ro", DUE)} (cu 2 zile înainte de start).`,
      "Cine își confirmă adresa de acum are cel mult 45 de minute să semneze, de când pleacă emailul.",
    ]);
    const en = texts(sentences("en", { now, counts: { held: 20 }, deadlines: { holdMinutes: 45 } }));
    expect(en[2]).toBe("Whoever confirms their address from now on has at most 45 minutes to sign, from when the email leaves.");
  });

  it("no window (a weekly run): the club's minutes, never a window's date", () => {
    const lines = texts(sentences("ro", { event: { confirmationOpensDaysBefore: 0 }, counts: { held: 2 } }));
    expect(lines).toEqual([
      "2 persoane au de semnat declarația.",
      "Cine își confirmă adresa de acum are cel mult 30 de minute să semneze, de când pleacă emailul.",
      "După termen locul nu se pierde singur: se eliberează doar când cineva de pe lista de așteptare n-are alt loc liber, și i se oferă primului din listă.",
      "La start, cine n-a semnat pierde locul; la masă poate fi confirmat pe hârtie, dacă mai e un loc liber.",
    ]);
  });

  it("holds past their deadline are counted, and kept while nobody asks for the place (§160)", () => {
    const now = new Date("2026-11-19T12:00:00.000Z");
    expect(texts(sentences("ro", { now, counts: { held: 16, heldPast: 9 } }))).toContain("9 persoane au termenul depășit; locul li se ține cât nu-l cere nimeni.");
    expect(texts(sentences("en", { now, counts: { held: 1, heldPast: 1 } }))).toContain(
      "One person is past the deadline; the place is kept for them while nobody asks for it.",
    );
  });

  it("offers by hand («Nu»): a released place stays free for «Trimite-i oferta» or «Dă-i un loc», a lapsed offer too", () => {
    const lines = texts(sentences("ro", { event: { waitlistAutoOffer: false }, counts: { held: 3, offered: 2 }, deadlines: { offerHours: 12 } }));
    expect(lines).toContain(
      "După termen locul nu se pierde singur: se eliberează doar când cineva de pe lista de așteptare n-are alt loc liber, apoi stă liber pentru «Trimite-i oferta» sau «Dă-i un loc».",
    );
    expect(lines).toContain(
      "2 persoane au câte o ofertă din lista de așteptare, valabilă cel mult 12 ore de când pleacă emailul; nesemnată la timp, locul rămâne liber până îl dai tu.",
    );
    expect(texts(sentences("en", { event: { waitlistAutoOffer: false }, counts: { held: 3 } }))).toContain(
      "Past the deadline a place is not lost by itself: it is released only when someone on the waiting list has no other free place, then stays free for «Send them the offer» or «Give a place».",
    );
  });

  it("automatic offers («Da»): a lapsed offer goes to the next in line while registration is open", () => {
    expect(texts(sentences("ro", { counts: { offered: 1 } }))).toEqual([
      "O persoană are o ofertă din lista de așteptare, valabilă cel mult 24 de ore de când pleacă emailul; nesemnată la timp, trece la următorul din listă cât sunt deschise înscrierile.",
    ]);
  });

  it("after the close no offer is made in either setting: the desk's «Dă-i un loc», and no new hold to speak of", () => {
    const closed = { registrationClosesAt: new Date("2026-11-11T22:00:00.000Z") };
    const now = new Date("2026-11-15T10:00:00.000Z");
    for (const waitlistAutoOffer of [true, false]) {
      const lines = texts(sentences("ro", { now, event: { ...closed, waitlistAutoOffer }, counts: { held: 4 } }));
      expect(lines).toContain(
        "După termen locul nu se pierde singur: se eliberează doar când cineva de pe lista de așteptare n-are alt loc liber; înscrierile s-au închis, deci îl dai la masă cu «Dă-i un loc».",
      );
      expect(lines.some((line) => line.startsWith("Cine își confirmă adresa de acum"))).toBe(false);
    }
  });

  it("no waiting list: a newcomer with no other free place is who wants it (§348); no limit: never released", () => {
    expect(texts(sentences("ro", { event: { waitlistCapacity: 0 }, counts: { held: 2 } }))).toContain(
      "După termen locul nu se pierde singur: se eliberează doar când îl cere cineva nou și nu mai e alt loc liber.",
    );
    expect(texts(sentences("en", { event: { capacity: null }, counts: { held: 2 } }))).toContain("Past the deadline a place is not lost: the event has no limit of places.");
  });

  it("a family's reservation is the one place a row waiting for its address holds (§543)", () => {
    expect(texts(sentences("ro", { counts: { awaitingEmail: 3, familyReserved: 2 }, deadlines: { confirmationHours: 72 } }))).toEqual([
      "3 persoane n-au confirmat încă adresa: linkul e valabil 72 de ore de când pleacă emailul, apoi înscrierile expiră; până atunci țin un loc doar cei rezervați de o familie.",
    ]);
  });

  it("a count of zero drops its sentences; nothing at all for a cancelled or finished event", () => {
    expect(sentences("ro")).toEqual([]);
    expect(texts(sentences("ro", { counts: { awaitingEmail: 1 } }))).toHaveLength(1);
    expect(sentences("ro", { event: { eventStatus: "CANCELLED" }, counts: { held: 3, awaitingEmail: 1, offered: 1 } })).toEqual([]);
    expect(sentences("en", { event: { eventStatus: "COMPLETED" }, counts: { held: 3 } })).toEqual([]);
  });

  it("every sentence is short: under 200 characters, in both languages, with the longest numbers", () => {
    const counts = { held: 134, heldPast: 120, awaitingEmail: 107, familyReserved: 3, offered: 110 };
    const cases = [
      {},
      { now: new Date("2026-11-15T10:00:00.000Z") },
      { event: { waitlistAutoOffer: false } },
      { event: { registrationClosesAt: new Date("2026-11-11T22:00:00.000Z") }, now: new Date("2026-11-15T10:00:00.000Z") },
    ];
    for (const locale of ["ro", "en"] as const) {
      for (const options of cases) {
        for (const text of texts(sentences(locale, { ...options, counts, deadlines: { confirmationHours: 168, holdMinutes: 120, offerHours: 72 } }))) {
          expect(text.length, text).toBeLessThan(200);
        }
      }
    }
  });
});
