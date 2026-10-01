import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §NNN — the journey's third step says where the declaration is. The owner found «aici» selected
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

type Where = "emailJustSent" | "onThisPage" | "emailReceived";

async function render(locale: "ro" | "en", declaration: Where | "emailHeldUntil", wait: number | null = null): Promise<string> {
  state.locale = locale;
  state.wait = wait;
  const props = declaration === "emailHeldUntil" ? ({ current: "declare", declaration, opens: "7 zile" } as const) : ({ current: "declare", declaration } as const);
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
    emailHeldUntil: "We ask for the declaration by email 7 zile before the start",
    onThisPage: "declaration below",
    emailReceived: "from the email you received",
  },
};

describe("RegistrationJourney, the declaration step (§NNN)", () => {
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
        expect(html).toContain(PHRASES[locale][where]);
        expect(html).toMatch(locale === "ro" ? /în cel mult 30 de minute/ : /within 30 minutes at the most/);
      }
    });
  }

  it("the held variant carries the phrase it was given", async () => {
    expect(await render("ro", "emailHeldUntil")).toContain("cu 7 zile înainte de start");
  });
});
