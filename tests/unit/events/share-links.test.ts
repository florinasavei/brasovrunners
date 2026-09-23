import { describe, expect, it } from "vitest";
import { absoluteUrl, eventPageUrl, facebookShareUrl, whatsappShareUrl } from "@/modules/events/share-links";

/**
 * BR-REQ-052-02 criterion 8 — what the share buttons send (`DECISIONS.md` §90, §140, and the
 * 2026-09-23 section on the share buttons).
 *
 * A Facebook share opened a "Create post" whose card was the bare domain — no title, no
 * picture — which is what Facebook draws when the address it is handed is not the page that
 * carries the Open Graph tags. The Open Graph card itself is right (`structured-data.test.ts`
 * covers it); this holds the *address* the button carries to a fixed base and reads it back.
 */
const BASE = "https://example.test";

describe("BR-REQ-052-02 criterion 8 — the address every share carries", () => {
  it("is the event's own page under the base, in the locale's own pathname", () => {
    expect(eventPageUrl(BASE, "ro", "tura-pe-tampa")).toBe("https://example.test/ro/evenimente/tura-pe-tampa");
    expect(eventPageUrl(BASE, "en", "tampa-trail")).toBe("https://example.test/en/events/tampa-trail");
  });

  it("is never the site's root, and never a path without a host", () => {
    const url = new URL(eventPageUrl(BASE, "ro", "tura-pe-tampa"));
    expect(url.origin).toBe(BASE);
    expect(url.pathname).not.toBe("/");
  });

  it("puts one slash between the host and the path, whatever the base ends in", () => {
    // `APP_BASE_URL` is typed by a person; `z.url()` accepts a trailing slash.
    expect(eventPageUrl(`${BASE}/`, "ro", "tura-pe-tampa")).toBe("https://example.test/ro/evenimente/tura-pe-tampa");
    expect(absoluteUrl(`${BASE}//`, "/ro")).toBe("https://example.test/ro");
    expect(absoluteUrl(BASE, "ro/x")).toBe("https://example.test/ro/x");
  });

  it("keeps a base with a path prefix intact", () => {
    expect(absoluteUrl("https://example.test/site/", "/ro/evenimente")).toBe("https://example.test/site/ro/evenimente");
  });
});

describe("BR-REQ-052-02 criterion 8 — Facebook", () => {
  const url = eventPageUrl(BASE, "ro", "tura-pe-tampa");

  it("is the network's own share dialog, handed the event's page as u=", () => {
    const share = new URL(facebookShareUrl(url));
    expect(`${share.origin}${share.pathname}`).toBe("https://www.facebook.com/sharer/sharer.php");
    // Decoding once gives the page back, so the scraper lands on the page and not on the root.
    expect(share.searchParams.get("u")).toBe(url);
    expect(share.searchParams.get("u")).not.toBe(BASE);
  });

  it("encodes the address exactly once", () => {
    const href = facebookShareUrl(url);
    expect(href).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
    // Encoded twice, the `%3A` would itself be encoded and the scraper would be handed `https%3A…`.
    expect(href).not.toContain("%253A");
    expect(href).toContain("u=https%3A%2F%2Fexample.test%2Fro%2Fevenimente%2Ftura-pe-tampa");
  });
});

describe("BR-REQ-052-02 criterion 8 — WhatsApp", () => {
  it("sends the title and the event's page as the message text", () => {
    const url = eventPageUrl(BASE, "ro", "tura-pe-tampa");
    const share = new URL(whatsappShareUrl("Tură pe Tâmpa", url));
    expect(share.host).toBe("wa.me");
    expect(share.searchParams.get("text")).toBe(`Tură pe Tâmpa ${url}`);
  });
});
