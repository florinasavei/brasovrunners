import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN, finding (5) of the review of `feat/neon-budget-governor`: the listing and an event page,
 * under a database whose every query Neon refuses for the month, serve their last good copy and
 * say so — with the governor still reading `critical`, which is what a project-scoped key reads
 * once Neon has cut the project off (the operations log stops growing).
 *
 * The pages compose two things: `readWithLastGood` under the page's own key (`events:<locale>`,
 * `event:<locale>:<slug>`) and `LastGoodNotice` over its result. This drives both, for real, with
 * a loader that throws the way Drizzle wraps Neon's refusal, and renders the notice in each
 * language. The page components themselves pull in the whole public tree; the composition is the
 * part the outage touches.
 */
const locale = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));

vi.mock("@/shared/config/env", () => ({ env: { APP_ENV: "test", STORAGE_MODE: "fake", APP_BASE_URL: "https://example.test" } }));
vi.mock("@/modules/diagnostics/neon-budget", () => ({
  readNeonBudget: async () => ({ level: "critical", effects: { restingCopies: false }, meter: null }),
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => locale.current,
  getTranslations: async (namespace: string) => {
    const messages = (locale.current === "ro" ? ro : en) as unknown as Record<string, Record<string, string>>;
    return createTranslator({ locale: locale.current, messages: messages[namespace], namespace: undefined });
  },
}));

const { readWithLastGood, forgetLastGood } = await import("@/modules/resilience/last-good");
const { default: LastGoodNotice } = await import("@/modules/resilience/ui/LastGoodNotice");

const TAKEN = new Date("2026-10-23T09:00:00.000Z");
const LATER = new Date("2026-10-26T09:00:00.000Z"); // three days on: past §281's twelve hours
const NEON_REFUSAL = new Error("Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.");
const refused = () => Promise.reject(Object.assign(new Error("Failed query: select … from events"), { cause: NEON_REFUSAL }));

beforeEach(() => {
  forgetLastGood();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("§NNN the listing and an event page while Neon refuses the month's queries", () => {
  it.each([
    ["ro", "events:ro", "copie salvată", "noiembrie"],
    ["en", "events:en", "saved copy", "November"],
  ] as const)("the listing (%s) serves its copy and the resting notice names the month's end", async (lang, key, phrase, month) => {
    locale.current = lang;
    await readWithLastGood(key, async () => ({ events: ["Crosul de toamnă"], hasUpcoming: true }), TAKEN);

    const read = await readWithLastGood(key, refused, LATER);
    expect(read).toMatchObject({ freshness: "stale", value: { events: ["Crosul de toamnă"] } });
    expect(read.restingUntil).toEqual(new Date("2026-11-01T00:00:00.000Z"));

    const html = renderToStaticMarkup(await LastGoodNotice({ read }));
    expect(html).toContain('data-testid="resting-notice"');
    expect(html).toContain(phrase);
    expect(html).toContain(month);
  });

  it("an event page serves its copy with the notice, and a page never copied still fails", async () => {
    locale.current = "ro";
    const key = "event:ro:crosul-de-toamna";
    await readWithLastGood(key, async () => ({ event: { slug: "crosul-de-toamna" }, interestBox: false }), TAKEN);

    const read = await readWithLastGood(key, refused, LATER);
    expect(read.value).toEqual({ event: { slug: "crosul-de-toamna" }, interestBox: false });
    const html = renderToStaticMarkup(await LastGoodNotice({ read }));
    expect(html).toContain("înscrierile și formularele sunt în pauză");

    // No copy: the error page, never invented content.
    await expect(readWithLastGood("event:ro:alt-eveniment", refused, LATER)).rejects.toThrow("Failed query");
  });

  it("says nothing while the database answers", async () => {
    const read = await readWithLastGood("events:ro", async () => ({ events: [] }), TAKEN);
    expect(await LastGoodNotice({ read })).toBeNull();
  });
});
