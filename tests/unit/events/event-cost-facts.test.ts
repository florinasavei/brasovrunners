import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §NNN — what a runner pays, and where, said the same short way everywhere the
 * public reads it (`EventFacts`, full and compact): a coin for `FREE`, an amount and where to
 * pay for `PAID`, a link to give at and what is suggested for `DONATION`. Never a raw URL — the
 * host a runner recognises, exactly as "Linkuri și fișiere" (§332) shows its own links.
 */
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator: translator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => translator({ locale: "ro", messages: ro, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: "ro", timeZone: "Europe/Bucharest" }),
    // The facts read the locale up front since the partners' links carry per-language labels.
    getLocale: async () => "ro",
  };
});

const { default: EventFacts } = await import("@/modules/events/ui/EventFacts");

const NOW = new Date("2026-10-01T09:00:00.000Z");

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "RACE",
    surface: "ASPHALT",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-11-21T07:00:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: null,
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    featured: false,
    isSpecial: false,
    distanceMeters: 10000,
    elevationGainMeters: null,
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    slug: "crosul-de-iarna",
    title: "Crosul de iarnă",
    excerpt: "Zece kilometri.",
    locationName: "Parcul Tractorul",
    locationAddress: "Strada Nicolae Labiș",
    locationToBeAnnounced: false,
    difficulty: null,
    costType: null,
    costAmount: null,
    costUrl: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

describe("the cost facts, full page (§NNN)", () => {
  it("says «Gratuit» for a free event, with no amount and no link", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event({ costType: "FREE" }), now: NOW, stacked: true }));
    expect(html).toContain("Gratuit");
    expect(html).not.toContain("Taxă");
    expect(html).not.toContain("Donație");
  });

  it("says the amount for a paid event, and links «plata pe {host}» when a link was given", async () => {
    const html = renderToStaticMarkup(
      await EventFacts({
        event: event({ costType: "PAID", costAmount: "50 lei", costUrl: "https://revolut.me/brasovrunners" }),
        now: NOW,
        stacked: true,
      }),
    );
    expect(html).toContain("Taxă: 50 lei");
    expect(html).toContain("plata pe revolut.me");
    expect(html).toContain('href="https://revolut.me/brasovrunners"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("says only the amount for a paid event with no payment link", async () => {
    const html = renderToStaticMarkup(
      await EventFacts({ event: event({ costType: "PAID", costAmount: "50 lei", costUrl: null }), now: NOW, stacked: true }),
    );
    expect(html).toContain("Taxă: 50 lei");
    expect(html).not.toContain("plata pe");
    expect(html).not.toContain("<a ");
  });

  it("falls back to «Cu taxă» for a paid event with no stated amount", async () => {
    const html = renderToStaticMarkup(
      await EventFacts({ event: event({ costType: "PAID", costAmount: null, costUrl: null }), now: NOW, stacked: true }),
    );
    expect(html).toContain("Cu taxă");
    expect(html).not.toContain("Taxă:");
  });

  it("links the whole «Donație: pe {host}» phrase, with the suggested amount after it", async () => {
    const html = renderToStaticMarkup(
      await EventFacts({
        event: event({
          costType: "DONATION",
          costAmount: "50 lei",
          costUrl: "https://www.wingsforlifeworldrun.com/en/donate",
        }),
        now: NOW,
        stacked: true,
      }),
    );
    expect(html).toContain("Donație: pe wingsforlifeworldrun.com");
    expect(html).toContain('href="https://www.wingsforlifeworldrun.com/en/donate"');
    expect(html).toContain("sugerat 50 lei");
  });

  it("never shows the raw donation URL as text — only the host, though the link still goes there", async () => {
    const url = "https://www.wingsforlifeworldrun.com/en/donate?utm_source=brasovrunners";
    const html = renderToStaticMarkup(
      await EventFacts({ event: event({ costType: "DONATION", costUrl: url }), now: NOW, stacked: true }),
    );
    // The real address is the href — a runner must land on the right page.
    expect(html).toContain(`href="${url}"`);
    // But the text a reader sees is the host alone, never the query string or the full address.
    const linkText = /<a [^>]*>([^<]*)<\/a>/.exec(html)?.[1];
    expect(linkText).toBe("Donație: pe wingsforlifeworldrun.com");
    expect(linkText).not.toContain("utm_source");
  });
});

describe("the cost facts, compact card (§NNN)", () => {
  it("keeps only the closed set's short word — no amount, no link, on any kind", async () => {
    for (const [costType, extra] of [
      ["FREE", {}],
      ["PAID", { costAmount: "50 lei", costUrl: "https://revolut.me/brasovrunners" }],
      ["DONATION", { costAmount: "50 lei", costUrl: "https://www.wingsforlifeworldrun.com/en/donate" }],
    ] as const) {
      const html = renderToStaticMarkup(
        await EventFacts({ event: event({ costType, ...extra }), now: NOW, variant: "compact" }),
      );
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("50 lei");
    }
  });
});

describe("the cost phrases exist in both catalogues, with the club's tokens (§NNN)", () => {
  const t = (locale: "ro" | "en", key: string, values?: Record<string, unknown>) =>
    (createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Event" }) as (key: string, values?: Record<string, unknown>) => string)(
      key,
      values,
    );

  it("names the amount in Romanian and English", () => {
    expect(t("ro", "costPaidAmount", { amount: "50 lei" })).toBe("Taxă: 50 lei");
    expect(t("en", "costPaidAmount", { amount: "50 lei" })).toBe("Fee: 50 lei");
  });

  it("names where to pay, and where the donation goes, in both languages", () => {
    expect(t("ro", "costPaidWhere", { host: "revolut.me" })).toBe("plata pe revolut.me");
    expect(t("en", "costPaidWhere", { host: "revolut.me" })).toBe("payment on revolut.me");
    expect(t("ro", "costDonation", { host: "wingsforlifeworldrun.com" })).toBe("Donație: pe wingsforlifeworldrun.com");
    expect(t("en", "costDonation", { host: "wingsforlifeworldrun.com" })).toBe("Donation: on wingsforlifeworldrun.com");
  });

  it("names the suggested amount in both languages", () => {
    expect(t("ro", "costDonationSuggested", { amount: "50 lei" })).toBe("sugerat 50 lei");
    expect(t("en", "costDonationSuggested", { amount: "50 lei" })).toBe("suggested 50 lei");
  });

  it("has the short word for every kind, in both catalogues", () => {
    for (const locale of ["ro", "en"] as const) {
      for (const kind of ["FREE", "PAID", "DONATION"] as const) {
        expect(t(locale, `costValues.${kind}`)).toBeTruthy();
      }
    }
  });
});
