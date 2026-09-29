import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { listStateLegend } from "@/modules/events/ui/list-state-legend";

/**
 * BR-REQ-039-01, `DECISIONS.md` §NNN (the owner, 2026-09-29: «Acum trebuie să explic ce înseamnă
 * „în așteptarea confirmării”») — the public list's legend: one sentence per state the list
 * shows, from the real catalogues, with the event's own confirmation window or the club's hold
 * and offer said in words from their values.
 */
function translator(locale: "ro" | "en") {
  const messages = locale === "ro" ? ro.Event : en.Event;
  return createTranslator({ locale, messages, namespace: undefined }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
}

const startsAt = new Date("2026-11-21T07:00:00Z");
const race = { startsAt, confirmationOpensDaysBefore: 7, confirmationDeadlineDaysBefore: 2 };
const deadlines = { holdMinutes: 30, offerHours: 24 };
const ALL = ["CONFIRMED", "PENDING", "WAITLISTED"] as const;

describe("§NNN listStateLegend — what each state on the public list means", () => {
  it("says the event's own window and the club's hold and offer, in Romanian", () => {
    const lines = listStateLegend(translator("ro"), "ro", { groups: ALL, event: race, deadlines });
    expect(lines.map((line) => line.group)).toEqual(["CONFIRMED", "PENDING", "WAITLISTED"]);
    expect(lines[0].sentence).toBe(
      "„Confirmat”: a semnat declarația (online sau pe hârtie la masa de înscrieri) și are locul.",
    );
    expect(lines[1].sentence).toBe(
      "„Înscris, în așteptarea confirmării”: are loc păstrat, declarația nesemnată. Se cere la înscriere și cu o săptămână înainte; se semnează până cu 2 zile înainte de start, altfel pierde locul.",
    );
    expect(lines[2].sentence).toBe(
      "„Pe lista de așteptare”: nu are încă loc. Când se eliberează unul, primul primește o ofertă pe email și are 24 de ore ca să semneze declarația.",
    );
  });

  it("says the same in English", () => {
    const lines = listStateLegend(translator("en"), "en", { groups: ALL, event: race, deadlines });
    expect(lines[0].sentence).toBe("“Confirmed”: signed the declaration (online or on paper at the registration desk) and has the place.");
    expect(lines[1].sentence).toBe(
      "“Registered, awaiting confirmation”: holds a place, declaration not signed. It is emailed at registration and one week before; it is due by 2 days before the start, or the place is freed.",
    );
    expect(lines[2].sentence).toBe(
      "“On the waiting list”: has no place yet. When one is freed, the first gets an offer by email and has 24 hours to sign the declaration.",
    );
  });

  it("reads the values, never a number of its own: another window, another hold, another offer", () => {
    const lines = listStateLegend(translator("ro"), "ro", {
      groups: ALL,
      event: { startsAt, confirmationOpensDaysBefore: 10, confirmationDeadlineDaysBefore: 0 },
      deadlines: { holdMinutes: 60, offerHours: 12 },
    });
    expect(lines[1].sentence).toContain("cu 10 zile înainte;");
    expect(lines[1].sentence).toContain("până la start");
    expect(lines[1].sentence).not.toContain("oră");
    expect(lines[2].sentence).toContain("are 12 ore ca să semneze");
  });

  it("says the club's hold alone on an event with no participation window", () => {
    const noWindow = { startsAt, confirmationOpensDaysBefore: 0, confirmationDeadlineDaysBefore: 0 };
    const [pendingRo] = listStateLegend(translator("ro"), "ro", { groups: ["PENDING"], event: noWindow, deadlines });
    expect(pendingRo.sentence).toBe(
      "„Înscris, în așteptarea confirmării”: are loc păstrat 30 de minute ca să semneze declarația; altfel locul se eliberează.",
    );
    const [pendingEn] = listStateLegend(translator("en"), "en", { groups: ["PENDING"], event: noWindow, deadlines });
    expect(pendingEn.sentence).toBe(
      "“Registered, awaiting confirmation”: holds a place for 30 minutes to sign the declaration; otherwise the place is freed.",
    );
  });

  it("explains only the states the list shows, in the list's order", () => {
    const lines = listStateLegend(translator("ro"), "ro", { groups: ["WAITLISTED", "CONFIRMED"], event: race, deadlines });
    expect(lines.map((line) => line.group)).toEqual(["CONFIRMED", "WAITLISTED"]);
    expect(listStateLegend(translator("ro"), "ro", { groups: [], event: race, deadlines })).toEqual([]);
  });

  it("keeps every sentence at most 200 characters, in both languages, over every state and every window shape", () => {
    const windows = [
      { opens: 0, due: 0 }, { opens: 7, due: 2 }, { opens: 10, due: 0 }, { opens: 14, due: 7 }, { opens: 30, due: 13 }, { opens: 365, due: 364 },
    ];
    for (const locale of ["ro", "en"] as const) {
      for (const w of windows) {
        for (const d of [{ holdMinutes: 30, offerHours: 24 }, { holdMinutes: 1439, offerHours: 167 }, { holdMinutes: 2880, offerHours: 72 }]) {
          const lines = listStateLegend(translator(locale), locale, {
            groups: ALL,
            event: { startsAt, confirmationOpensDaysBefore: w.opens, confirmationDeadlineDaysBefore: w.due },
            deadlines: d,
          });
          expect(lines).toHaveLength(3);
          for (const line of lines) expect(line.sentence.length, line.sentence).toBeLessThanOrEqual(200);
        }
      }
    }
  });
});
