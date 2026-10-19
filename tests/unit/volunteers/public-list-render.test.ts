import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicVolunteersList } from "@/modules/volunteers/domain/public-list";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — what the event page draws for the volunteers' public list: the card «Voluntarii» (a native fold, closed on arrival like
 * «Condiții de participare»; the owner, 2026-10-19: «asta ar trebui să fie collapsed»), with the names and roles the cached read lets through, «și încă N voluntari»
 * for the rest, the one sentence while the team is forming, and nothing at all when the gate says no. The gate and the read are proved in
 * `public-list-domain.test.ts` and `tests/integration/volunteers/`; the editor's ticks and the form's tick below; the whole journey, at 320
 * pixels and at desktop width, in `tests/e2e/volunteers.spec.ts`.
 */
const state = vi.hoisted(() => ({
  language: "ro" as "ro" | "en",
  described: true,
  first: 1 as number | null,
  accepts: true,
  list: { count: 0, named: [], others: 0 } as PublicVolunteersList,
  away: false,
}));
const messages = { ro, en };

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string | { namespace: string }) =>
      createTranslator({ locale: state.language, messages: messages[state.language] as never, namespace: (typeof namespace === "string" ? namespace : namespace.namespace) as never }),
    getLocale: async () => state.language,
  };
});
vi.mock("@/modules/public-cache/reads", () => ({
  cachedVolunteersListDescribed: async () => state.described,
  cachedFirstVolunteersListNoticeVersion: async () => state.first,
  cachedPublicVolunteersList: async () => {
    if (state.away) throw new Error("away");
    return { acceptsVolunteers: state.accepts, list: state.list };
  },
}));
vi.mock("@/modules/resilience/optional-read", () => ({
  readOrWhileAway: async <T>(read: () => Promise<T>, whileAway: T) => {
    try {
      return await read();
    } catch {
      return whileAway;
    }
  },
}));

const { default: VolunteersList } = await import("@/modules/volunteers/ui/VolunteersList");

async function html(element: ReactElement): Promise<string> {
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale: state.language, messages: messages[state.language] } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
}

const NOW = new Date("2026-10-19T10:00:00.000Z");
const DAY = 86_400_000;
const EVENT = "11111111-1111-4111-8111-111111111111";

const card = async (locale: "ro" | "en" = "ro", over: Partial<ComponentProps<typeof VolunteersList>> = {}) => {
  state.language = locale;
  const element = await VolunteersList({ eventId: EVENT, locale, startsAt: new Date(NOW.getTime() + 10 * DAY), offerOpen: true, now: NOW, ...over });
  return element === null ? "" : html(element);
};

const ANA = { name: "Ana Popescu", roleNameRo: "Punct de apă", roleNameEn: "Water point" };
const ION = { name: "Ion Ionescu", roleNameRo: null, roleNameEn: null };

beforeEach(() => {
  state.language = "ro";
  state.described = true;
  state.first = 1;
  state.accepts = true;
  state.away = false;
  state.list = { count: 0, named: [], others: 0 };
});

describe("§NNN the card «Voluntarii» — a fold closed on arrival", () => {
  it("is a native details with no open attribute, its title a real h2 inside the summary with the count — like «Condiții de participare»", async () => {
    state.list = { count: 3, named: [ANA, ION], others: 1 };
    const markup = await card();
    expect(markup).toContain('data-testid="volunteers-list"');
    expect(markup).toMatch(/<details\b/);
    // Closed on arrival: the boolean attribute is not there.
    expect(markup).not.toMatch(/<details[^>]*\sopen(=|\s|>)/);
    expect(markup).toMatch(/<summary[^>]*>\s*<h2[^>]*id="volunteers-list-title"[^>]*>[\s\S]*Voluntarii \(3\)<\/h2>\s*<\/summary>/);
    expect(markup).toMatch(/<details[^>]*aria-labelledby="volunteers-list-title"/);
    // Names stay out of search snippets, on the wrapper (Google honours it on a section, not on details).
    expect(markup).toMatch(/<section[^>]*data-nosnippet/);
  });

  it("names the people who ticked with the role given, one to a row, and says «și încă N de voluntari» for the rest — in Română", async () => {
    state.list = { count: 25, named: [ANA, ION], others: 23 };
    const markup = await card();
    expect(markup).toContain("Ana Popescu");
    expect(markup).toContain("Punct de apă");
    expect(markup).toContain("Ion Ionescu");
    // A person with no role given is named without one.
    expect(markup.match(/data-testid="volunteers-list-role"/g)).toHaveLength(1);
    expect(markup.match(/data-testid="volunteers-list-person"/g)).toHaveLength(2);
    expect(markup).toContain("și încă 23 de voluntari");
    expect(markup).toMatch(/<ul[^>]*aria-label="Voluntarii care au vrut să apară cu numele"/);
  });

  it("agrees the count's words in Română: one, a few, many", async () => {
    for (const [others, words] of [
      [1, "și încă 1 voluntar"],
      [4, "și încă 4 voluntari"],
      [20, "și încă 20 de voluntari"],
    ] as const) {
      state.list = { count: others + 1, named: [ANA], others };
      expect(await card(), String(others)).toContain(words);
    }
  });

  it("says it in English, with the role in English", async () => {
    state.list = { count: 2, named: [ANA], others: 1 };
    const markup = await card("en");
    expect(markup).toMatch(/Volunteers \(2\)/);
    expect(markup).toContain("Water point");
    expect(markup).not.toContain("Punct de apă");
    expect(markup).toContain("and 1 more volunteer");
    expect(markup).toMatch(/aria-label="Volunteers who chose to appear by name"/);
  });

  it("draws no row for the others when everybody is named", async () => {
    state.list = { count: 1, named: [ANA], others: 0 };
    expect(await card()).not.toContain("volunteers-list-others");
  });

  it("holds no address, telephone number or anything else of a person: the card is drawn from a name and a role", async () => {
    state.list = { count: 2, named: [ANA], others: 1 };
    const markup = await card();
    expect(markup).not.toMatch(/@|\+40|mailto:|tel:/);
  });
});

describe("§NNN when nobody may be named", () => {
  it("says only «Echipa de voluntari se formează.» while the offer is open, with no count in the title", async () => {
    state.list = { count: 2, named: [], others: 2 };
    const markup = await card();
    expect(markup).toContain('data-testid="volunteers-list-forming"');
    expect(markup).toContain("Echipa de voluntari se formează.");
    expect(markup).toMatch(/<h2[^>]*id="volunteers-list-title"[^>]*>[\s\S]*Voluntarii<\/h2>/);
    expect(markup).not.toMatch(/Voluntarii \(/);
    expect(markup).not.toContain("volunteers-list-person");
    expect(await card("en")).toContain("The volunteer team is taking shape.");
  });

  it("draws nothing when nobody may be named and the offer is closed", async () => {
    state.list = { count: 2, named: [], others: 2 };
    expect(await card("ro", { offerOpen: false })).toBe("");
  });
});

describe("§NNN the gate — nothing at all, not even a count", () => {
  beforeEach(() => {
    state.list = { count: 3, named: [ANA], others: 2 };
  });

  it("draws nothing while the notice in force does not describe the list", async () => {
    state.described = false;
    expect(await card()).toBe("");
  });

  it("draws nothing once the event no longer takes volunteers", async () => {
    state.accepts = false;
    expect(await card()).toBe("");
  });

  it("draws nothing thirty days after the start, when the volunteers' rows may be deleted", async () => {
    expect(await card("ro", { startsAt: new Date(NOW.getTime() - 29 * DAY) })).toContain("Ana Popescu");
    expect(await card("ro", { startsAt: new Date(NOW.getTime() - 30 * DAY) })).toBe("");
  });

  it("draws nothing while the database is away — a list that cannot be asked is not a list of nobody", async () => {
    state.away = true;
    expect(await card()).toBe("");
  });
});
