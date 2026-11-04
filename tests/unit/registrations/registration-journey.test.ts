import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §614 — the journey's third step says where the declaration is. The owner found «aici» selected
 * on the confirmation page, Google offering a search for it: the page has no form and no link.
 * Each variant, in both languages, says its own place; none says «aici» / «here» bare; the held
 * one carries the `{opens}` phrase; the scheduled-delivery clause (§513) still rides along.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en", wait: null as number | null }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getLocale: async () => state.locale,
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: state.locale, messages: catalogues[state.locale], namespace: namespace as "Registration.journey" }),
  };
});
vi.mock("@/modules/public-cache/reads", () => ({
  cachedEmailWaitMinutes: async () => state.wait,
}));

const { default: RegistrationJourney } = await import("@/modules/registrations/ui/RegistrationJourney");
const { formatDay } = await import("@/i18n/dates");

type Where = "emailJustSent" | "onThisPage" | "emailReceived";

async function render(locale: "ro" | "en", declaration: Where | "emailHeldUntil", wait: number | null = null, release: Date | null = null): Promise<string> {
  const opens = locale === "ro" ? "7 zile" : "7 days";
  state.locale = locale;
  state.wait = wait;
  const moment = release ? { at: release, timeZone: "Europe/Bucharest" } : null;
  const props =
    declaration === "emailHeldUntil"
      ? ({ current: "declare", declaration, opens, release: moment } as const)
      : ({ current: "declare", declaration, release: moment } as const);
  const element = (await RegistrationJourney(props)) as ReactElement;
  return renderToStaticMarkup(createElement("div", null, element)).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

const PHRASES: Record<"ro" | "en", Record<Where | "emailHeldUntil", string>> = {
  ro: {
    emailJustSent: "din emailul pe care tocmai ți l-am trimis",
    emailHeldUntil: "Declarația ți-o cerem pe email cu 7 zile înainte de start",
    onThisPage: "declarația mai jos",
    emailReceived: "din emailul pe care l-ai primit",
  },
  en: {
    emailJustSent: "from the email we have just sent you",
    emailHeldUntil: "We ask for the declaration by email 7 days before the start",
    onThisPage: "declaration below",
    emailReceived: "from the email you received",
  },
};

describe("RegistrationJourney, the declaration step (§614)", () => {
  for (const locale of ["ro", "en"] as const) {
    for (const where of ["emailJustSent", "emailHeldUntil", "onThisPage", "emailReceived"] as const) {
      it(`${locale} · ${where} says where the declaration is, and never a bare «aici»`, async () => {
        const html = await render(locale, where);
        expect(html).toContain(PHRASES[locale][where]);
        expect(html).not.toMatch(/— aici,|— here,/);
        expect(html).not.toContain("{opens}");
      });
    }

    it(`${locale} · the scheduled-delivery clause stays when the outbox waits`, async () => {
      for (const where of ["emailJustSent", "emailHeldUntil", "onThisPage", "emailReceived"] as const) {
        const html = await render(locale, where, 30);
        if (where !== "emailJustSent") expect(html).toContain(PHRASES[locale][where]);
        expect(html).toMatch(locale === "ro" ? /în cel mult 30 de minute/ : /within 30 minutes at the most/);
      }
    });
  }

  it("the scheduled emailJustSent says the email is on its way, names the wait once, and never says it was just sent", async () => {
    for (const locale of ["ro", "en"] as const) {
      const html = await render(locale, "emailJustSent", 30);
      expect(html).toContain(locale === "ro" ? "din emailul care pleacă spre tine în cel mult 30 de minute" : "from the email on its way to you");
      expect(html.match(/30 (de minute|minutes)/g)).toHaveLength(1);
      expect(html).not.toMatch(/tocmai|just sent|have just/);
    }
  });

  it("the held variant carries the phrase it was given", async () => {
    expect(await render("ro", "emailHeldUntil")).toContain("cu 7 zile înainte de start");
  });
});

/*
  «Eliberează singur locurile nesemnate la termen» (§NNN; the review's should-fix): while the release will take the place,
  every one of the step's sentences — the four places, with and without the scheduled delivery, both languages — says to
  sign online by the release's deadline and that the place goes then, and none offers the paper at the desk on race day.
  The pages pass the deadline (`journey-release.test.ts` renders each of them); without it, today's words.
*/
describe("RegistrationJourney, the declaration step with the release at the deadline (§NNN)", () => {
  const RELEASE = new Date("2026-11-19T08:00:00.000Z");
  const said = (locale: "ro" | "en") => formatDay(RELEASE, { locale, timeZone: "Europe/Bucharest", style: "long", withTime: true, position: "inline" });
  const DESK = { ro: /pe hârtie|masa de înscrieri/, en: /on paper|registration desk/ } as const;

  for (const locale of ["ro", "en"] as const) {
    for (const where of ["emailJustSent", "emailHeldUntil", "onThisPage", "emailReceived"] as const) {
      for (const wait of [null, 30] as const) {
        it(`${locale} · ${where}${wait ? " · scheduled" : ""}: signs online by the release's deadline, never the desk`, async () => {
          const html = await render(locale, where, wait, RELEASE);
          expect(html).toContain(said(locale));
          expect(html).toContain("online");
          expect(html).toMatch(locale === "ro" ? /se eliberează/ : /is released/);
          expect(html).not.toMatch(DESK[locale]);
          expect(html).not.toMatch(/\{(release|wait|opens)\}/);
          // Today's words, without the release: the desk is still offered.
          expect(await render(locale, where, wait)).toMatch(DESK[locale]);
        });
      }
    }
  }

  it("every sentence with the release has its twin in both catalogues, and only the release's names {release}", async () => {
    const { default: roCatalogue } = await import("../../../messages/ro.json");
    const { default: enCatalogue } = await import("../../../messages/en.json");
    for (const catalogue of [roCatalogue, enCatalogue]) {
      const now = catalogue.Registration.journey.now;
      for (const [plain, released] of [
        [now.declare, now.declareReleased],
        [now.declareScheduled, now.declareScheduledReleased],
      ] as const) {
        expect(Object.keys(released).sort()).toEqual(Object.keys(plain).sort());
        for (const sentence of Object.values(released)) expect(sentence).toContain("{release}");
        for (const sentence of Object.values(plain)) expect(sentence).not.toContain("{release}");
      }
    }
  });
});
