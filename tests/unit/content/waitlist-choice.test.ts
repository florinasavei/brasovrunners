import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import {
  choiceAfterTyping,
  typedMeansNoLimit,
  WAITLIST_CHOICES,
  waitlistChoiceOf,
  waitlistLengthPosted,
} from "@/modules/content/events/waitlist-choice";

/**
 * BR-REQ-035-01 (§NNN) — «Lista de așteptare» in the editor is a choice in words. The owner, 2026-10-02:
 * «Trebuie tooltip și în back-office că 0 înseamnă listă de așteptare infinită + ceva bifă care să
 * fie mai explicită, dacă pun 0 să se bifeze automat listă infinită». Until now an empty box was
 * "no limit" and 0 "no waiting list", the opposite of what he meant. The select now says which:
 * «Nelimitată», «Limitată la un număr de locuri» (the number shown only then), «Fără listă de
 * așteptare»; an «i» beside it says the three meanings; and a 0 or an emptied box under «Limitată»
 * switches the select to «Nelimitată» — on the screen and on the server — so a 0 never closes a list.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale, messages: messages[locale], namespace: namespace as "Admin" }),
    getLocale: async () => locale,
  };
});

vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, children }: { href: string; children: unknown }) => h("a", { href }, children as string), getPathname: () => "/" };
});

// The bib's design reads the club's settings from the database; not what this reads.
vi.mock("@/modules/content/events/ui/BibDesignPanel", () => ({ default: () => null }));

const { default: RegistrationBox } = await import("@/modules/content/events/ui/boxes/RegistrationBox");

const RACE = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "RACE",
  eventStatus: "SCHEDULED",
  registrationMode: "INTERNAL",
  timezone: "Europe/Bucharest",
  startsAt: new Date("2026-11-21T08:00:00Z"),
  capacity: 150,
  waitlistCapacity: null,
  confirmationOpensDaysBefore: 7,
  confirmationDeadlineDaysBefore: 2,
  bibStartNumber: 1,
  bibColour: null,
  bibDesign: null,
  declarationDocumentId: null,
  reminderHoursBefore: null,
  kitShirt: false,
} as unknown as EditableEvent;

async function render(event: EditableEvent | null, language: "ro" | "en" = "ro") {
  locale = language;
  const element = await RegistrationBox({
    event,
    mayEditSettings: true,
    declarations: [],
    bibCounts: null,
    locale: language,
    now: new Date("2026-10-02T08:00:00Z"),
    clubDeadlines: { reminderHours: 48, holdMinutes: 30, offerHours: 24, raceWeekDays: 7 },
  } as Parameters<typeof RegistrationBox>[0]);
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(
    createElement(
      NextIntlClientProvider,
      { locale: language, messages: messages[language] } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      element as ReactElement,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

/** The `<select>` the choice posts, up to its end. */
function choiceSelect(html: string): string {
  const start = html.lastIndexOf("<select", html.indexOf('name="event.waitlistMode"'));
  expect(start, "the select is drawn").toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</select>", start));
}

/** The option the select opens on: React marks the `defaultValue`'s option `selected` on the server. */
function selectedChoice(html: string): string | undefined {
  return /<option[^>]*value="(\w+)"[^>]*selected/.exec(choiceSelect(html))?.[1] ?? /<option[^>]*selected[^>]*value="(\w+)"/.exec(choiceSelect(html))?.[1];
}

/** Whether the number's block is hidden (`ShownWhen`'s marker on the block that holds it). */
function numberHidden(html: string): boolean {
  const at = html.indexOf('data-testid="waitlist-limit"');
  expect(at, "the number's block is drawn").toBeGreaterThan(-1);
  const block = html.lastIndexOf("<div", html.lastIndexOf("<div", at) - 1);
  return html.slice(block, at).includes("data-hidden-block");
}

describe("BR-REQ-035-01 «Lista de așteptare» in the editor (§NNN)", () => {
  it("opens on «Nelimitată» for no limit, «Fără listă» for 0 and «Limitată» for a count — the number shown only then", async () => {
    const unlimited = await render(RACE);
    expect(selectedChoice(unlimited)).toBe("UNLIMITED");
    expect(numberHidden(unlimited)).toBe(true);

    const none = await render({ ...RACE, waitlistCapacity: 0 } as EditableEvent);
    expect(selectedChoice(none)).toBe("NONE");
    expect(numberHidden(none)).toBe(true);
    // 0 is the choice, not a limit: the number box opens empty, for a limit to be typed.
    expect(none).not.toMatch(/name="event.waitlistCapacity"[^>]*value="0"/);

    const limited = await render({ ...RACE, waitlistCapacity: 20 } as EditableEvent);
    expect(selectedChoice(limited)).toBe("LIMITED");
    expect(numberHidden(limited)).toBe(false);
    expect(limited).toMatch(/<input[^>]*name="event.waitlistCapacity"[^>]*>/);
    const box = /<input[^>]*name="event.waitlistCapacity"[^>]*>/.exec(limited)?.[0] ?? "";
    expect(box).toContain('value="20"');
    expect(box).toContain('min="1"');
    expect(box).toContain('inputMode="numeric"');
  });

  it("opens a new event on «Nelimitată»", async () => {
    expect(selectedChoice(await render(null))).toBe("UNLIMITED");
  });

  it("lists the three answers in order, in words, beside the places, in both languages", async () => {
    for (const language of ["ro", "en"] as const) {
      const html = await render(RACE, language);
      const select = choiceSelect(html);
      const values = [...select.matchAll(/<option[^>]*value="(\w+)"/g)].map((match) => match[1]);
      expect(values, language).toEqual([...WAITLIST_CHOICES]);
      for (const choice of WAITLIST_CHOICES) expect(select, language).toContain(messages[language].Admin.editor.waitlistModeChoices[choice]);
      // The row holds the places, then the choice, then its number.
      const row = html.indexOf('data-testid="capacity-row"');
      expect(row).toBeGreaterThan(-1);
      expect(html.indexOf('name="event.capacity"')).toBeGreaterThan(row);
      expect(html.indexOf('name="event.waitlistMode"')).toBeGreaterThan(html.indexOf('name="event.capacity"'));
      expect(html.indexOf('name="event.waitlistCapacity"')).toBeGreaterThan(html.indexOf('name="event.waitlistMode"'));
      // The short helper under the select, and the number's own note that lowering it removes nobody.
      expect(html, language).toContain(messages[language].Admin.editor.waitlistModeHelp);
      expect(html, language).toContain(messages[language].Admin.editor.waitlistCapacityHelp);
    }
  });

  it("says the three meanings in the «i» beside the select, in both languages", async () => {
    expect(ro.Admin.editor.waitlistModeTip).toBe(
      "Nelimitată: oricine poate intra pe listă când locurile s-au ocupat. Limitată: cel mult atâtea persoane. Fără listă: evenimentul plin refuză pe toată lumea.",
    );
    expect(en.Admin.editor.waitlistModeTip).toBe(
      "Unlimited: anyone may join the list once the places are taken. Limited: at most this many people. No waiting list: a full event turns everyone away.",
    );
    for (const language of ["ro", "en"] as const) {
      const html = await render(RACE, language);
      const tip = messages[language].Admin.editor.waitlistModeTip;
      // The tip is the button's accessible name, so a screen reader hears it without the hover.
      expect(html, language).toContain(`aria-label="${tip}"`);
      expect(tip.length, language).toBeLessThan(200);
    }
    expect(ro.Admin.editor.waitlistMode).toBe("Lista de așteptare");
    expect(en.Admin.editor.waitlistMode).toBe("Waiting list");
    expect(ro.Admin.editor.waitlistCapacity).toBe("Cel mult atâtea persoane pe listă");
    expect(en.Admin.editor.waitlistCapacity).toBe("At most this many people on the list");
  });

  it("no longer says anywhere in the catalogues that an empty box is unlimited and 0 is no list", () => {
    for (const catalogue of [ro, en]) {
      const text = JSON.stringify(catalogue);
      expect(text).not.toContain("0 = fără listă");
      expect(text).not.toContain("0: fără listă");
      expect(text).not.toContain("0 = no list");
      expect(text).not.toContain("0: no waiting list");
      expect(text).not.toContain("Lungimea maximă a listei de așteptare");
      expect(text).not.toContain("Maximum waiting-list length");
    }
  });
});

describe("BR-REQ-035-01 the rule the island and the server share (§NNN)", () => {
  it("reads the stored value as the answer the select opens on", () => {
    expect(waitlistChoiceOf(null)).toBe("UNLIMITED");
    expect(waitlistChoiceOf(undefined)).toBe("UNLIMITED");
    expect(waitlistChoiceOf(0)).toBe("NONE");
    expect(waitlistChoiceOf(1)).toBe("LIMITED");
    expect(waitlistChoiceOf(20)).toBe("LIMITED");
  });

  it("takes an empty box or nought as the limit taken away, and nothing else", () => {
    for (const typed of ["", " ", "0", "00", " 0 "]) expect(typedMeansNoLimit(typed), JSON.stringify(typed)).toBe(true);
    for (const typed of ["1", "10", "20", "-0", "0.5", "zece"]) expect(typedMeansNoLimit(typed), typed).toBe(false);
  });

  it("switches «Limitată» to «Nelimitată» when the box is left empty or at 0, and nothing else", () => {
    expect(choiceAfterTyping("LIMITED", "0")).toBe("UNLIMITED");
    expect(choiceAfterTyping("LIMITED", "")).toBe("UNLIMITED");
    expect(choiceAfterTyping("LIMITED", "20")).toBe("LIMITED");
    // A box the browser cannot read as a number reads "" — left for the browser to refuse, not taken for empty.
    expect(choiceAfterTyping("LIMITED", "", true)).toBe("LIMITED");
    // The other answers are never switched: «Fără listă» stays «Fără listă» whatever the hidden box holds.
    expect(choiceAfterTyping("NONE", "0")).toBe("NONE");
    expect(choiceAfterTyping("UNLIMITED", "")).toBe("UNLIMITED");
  });

  it("gives the schema the one length: null for «Nelimitată», 0 only for «Fără listă», the number for «Limitată»", () => {
    expect(waitlistLengthPosted("UNLIMITED", "20")).toBe("");
    expect(waitlistLengthPosted("NONE", "20")).toBe("0");
    expect(waitlistLengthPosted("NONE", "")).toBe("0");
    expect(waitlistLengthPosted("LIMITED", "20")).toBe("20");
    expect(waitlistLengthPosted("LIMITED", "0")).toBe("");
    expect(waitlistLengthPosted("LIMITED", "")).toBe("");
    expect(waitlistLengthPosted("LIMITED", undefined)).toBe("");
    // What is not a count is passed on, for the schema to refuse by name.
    expect(waitlistLengthPosted("LIMITED", "zece")).toBe("zece");
  });
});
