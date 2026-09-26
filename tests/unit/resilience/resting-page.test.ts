import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §447, finding (4) of the fix round on `feat/neon-budget-governor`: a red month's cache miss with
 * no last good copy sends the reader to the short resting page — «Pagina se reîncarcă în câteva
 * minute» — which answers 200 with `Retry-After`, in both languages, reading nothing, and brings the
 * reader back to the address they were on (a path on this site, never anywhere else).
 */
const request = vi.hoisted(() => ({ path: null as string | null }));

vi.mock("@/shared/config/env", () => ({ env: { APP_ENV: "test", STORAGE_MODE: "fake", APP_BASE_URL: "https://example.test" } }));
vi.mock("@/modules/diagnostics/neon-budget", () => ({
  readNeonBudget: async () => ({ level: "red", budget: { spent: false }, meter: null }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request.path ? { "x-br-path": request.path } : {}),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: "ro" | "en"; namespace: string }) =>
    createTranslator({ locale, messages: ((locale === "ro" ? ro : en) as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
}));

const { readWithLastGood, forgetLastGood } = await import("@/modules/resilience/last-good");
const { ColdMissError } = await import("@/modules/resilience/breaker");
const { RESTING_RETRY_SECONDS, restingPageHref, safeBackPath } = await import("@/modules/resilience/domain/resting-page");
const { GET } = await import("@/app/api/resting/route");

const NOW = new Date("2026-10-23T09:00:00.000Z");
const coldMiss = () => Promise.reject(new ColdMissError());

beforeEach(() => {
  forgetLastGood();
  request.path = null;
});

describe("§447 the way to the resting page", () => {
  it("sends a red month's miss with no copy there, naming the address it was on", async () => {
    request.path = "/ro/evenimente/crosul-de-toamna?lista=2";
    await expect(readWithLastGood("event:ro:crosul-de-toamna", coldMiss, NOW)).rejects.toMatchObject({
      redirectTo: `/api/resting?back=${encodeURIComponent("/ro/evenimente/crosul-de-toamna?lista=2")}`,
    });
  });

  it("serves the copy instead when there is one", async () => {
    await readWithLastGood("event:ro:crosul-de-toamna", async () => ({ title: "Crosul de toamnă" }), NOW);
    const read = await readWithLastGood("event:ro:crosul-de-toamna", coldMiss, NOW);
    expect(read).toMatchObject({ freshness: "stale", value: { title: "Crosul de toamnă" } });
  });

  it("keeps an ordinary outage with no copy on the error page, as before", async () => {
    await expect(readWithLastGood("events:ro", () => Promise.reject(new Error("connect ECONNREFUSED")), NOW)).rejects.toThrow("ECONNREFUSED");
  });

  it("comes back only to a path on this site", () => {
    expect(safeBackPath("/ro/evenimente")).toBe("/ro/evenimente");
    for (const unsafe of ["https://elsewhere.example", "//elsewhere.example", "/\\elsewhere.example", "ro", "", null, `/${"a".repeat(600)}`, "/ro\nSet-Cookie: x"]) {
      expect(safeBackPath(unsafe)).toBe("/");
    }
    expect(restingPageHref("//elsewhere.example")).toBe("/api/resting?back=%2F");
  });
});

describe("§447 the resting page", () => {
  it("answers 200 with Retry-After, in both languages, and goes back by itself", async () => {
    const response = await GET(new Request(`https://example.test/api/resting?back=${encodeURIComponent("/en/events?type=race")}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Retry-After")).toBe(String(RESTING_RETRY_SECONDS));
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const html = await response.text();
    expect(html).toContain(ro.Offline.reloadingTitle);
    expect(html).toContain(en.Offline.reloadingTitle);
    expect(html).toContain(`content="${RESTING_RETRY_SECONDS};url=/en/events?type=race"`);
  });

  it("never goes back anywhere but this site", async () => {
    const response = await GET(new Request("https://example.test/api/resting?back=https%3A%2F%2Felsewhere.example"));
    const html = await response.text();
    expect(html).not.toContain("elsewhere.example");
    expect(html).toContain(`content="${RESTING_RETRY_SECONDS};url=/"`);
  });
});
