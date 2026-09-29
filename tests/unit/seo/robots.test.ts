import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/config/env", () => ({ env: { APP_ENV: "production", APP_BASE_URL: "http://localhost:4783" } }));

const { default: robots } = await import("@/app/robots");

/**
 * BR-REQ-070-03 criterion 4, and §549 — production's robots.txt keeps a crawler out of what it has
 * no business in, each visit of which starts a function now that the public pages are static, and
 * never out of a canonical page.
 *
 * Read the way Google and Bing read a rule: a prefix of the path and query, `*` any run of
 * characters, `$` the end.
 */
function blocks(rule: string, address: string): boolean {
  const pattern = rule.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
  return new RegExp(`^${pattern}`).test(address);
}

const disallowed = (() => {
  const rules = robots().rules;
  const first = Array.isArray(rules) ? rules[0] : rules;
  const list = first?.disallow ?? [];
  return Array.isArray(list) ? list : [list];
})();
const isBlocked = (address: string) => disallowed.some((rule) => blocks(rule, address));

describe("§549 robots.txt on production", () => {
  it.each([
    "/ro/evenimente?type=RACE",
    "/en/events?surface=TRAIL&cost=FREE",
    "/ro/calendar?month=2026-11",
    "/en/calendar?year=2027&view=list",
    "/ro/evenimente/crosul-aniversar?lista=2",
    "/en/events/anniversary-cross?interest=1",
    "/en/events/anniversary-cross?since=1727500000",
    "/ro/evenimente/crosul-aniversar?declaratie=abc",
    "/ro/evenimente/crosul-aniversar?fbclid=x&lista=3",
    "/ro/live/events",
    "/en/live/events/anniversary-cross",
    "/ro/evenimente/crosul-aniversar/inscriere",
    "/en/events/anniversary-cross/register",
    "/ro/evenimente/tura-pe-tampa/declaratie",
    "/ro/inregistrari/confirmare/abc",
    "/en/registrations/manage/abc",
    "/ro/inscrieri/ale-mele",
    "/ro/noutati/abonament/abc",
    "/en/newsletter/confirm/abc",
    "/ro/events/crosul-aniversar/share-image?shape=og",
    "/api/health",
    "/ro/admin",
  ])("keeps a crawler out of %s", (address) => {
    expect(isBlocked(address)).toBe(true);
  });

  it.each([
    "/ro/evenimente",
    "/en/events",
    "/ro/calendar",
    "/en/calendar",
    "/ro/evenimente/crosul-aniversar",
    "/en/events/anniversary-cross",
    "/ro/events/crosul-aniversar/opengraph-image",
    "/ro/events/crosul-aniversar/opengraph-image?abc123",
    // Next's content-hash query on an English event's picture: its path is the public one.
    "/en/events/anniversary-cross/opengraph-image?abc123",
    "/en/events/anniversary-cross?fbclid=x",
    // One of the event's two JSON-LD images.
    "/ro/events/crosul-aniversar/share-image",
    "/ro/intrebari",
    "/ro/galerie",
    "/ro/termeni",
    "/ro/contact",
    "/ro/membri",
  ])("leaves the canonical %s crawlable", (address) => {
    expect(isBlocked(address)).toBe(false);
  });
});
