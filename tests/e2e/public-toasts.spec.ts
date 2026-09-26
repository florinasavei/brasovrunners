import { expect, test, type Page } from "@playwright/test";
import { FEATURED } from "./support/featured-event";

/**
 * §NNN — the public site's toasts are mounted only where a public flow lands, never in a layout.
 *
 * The listing and an event page are what every visitor pays for (`AGENTS.md` §1.5): neither
 * renders the toast's live region, and no script either page loads carries the toast island —
 * not even when the browser still holds a public flash, which a visitor with JavaScript off
 * leaves behind for its minute (`flash.ts`). The unit source-walk
 * (`tests/unit/shared/public-toasts.test.ts`) holds the imports; this holds what the browser gets.
 */
test.describe("§NNN the listing and an event page carry no toast island", () => {
  /** Every script body the page loads, collected while it loads. */
  function collectScripts(page: Page): Promise<string>[] {
    const bodies: Promise<string>[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() !== "script") return;
      bodies.push(response.text().catch(() => ""));
    });
    return bodies;
  }

  for (const [label, path] of [
    ["the listing", "/ro"],
    ["an event page", `/ro/evenimente/${FEATURED.slug}`],
  ] as const) {
    for (const staleFlash of [false, true]) {
      test(`${label}${staleFlash ? ", with a public flash still in the browser," : ""} renders no live region and loads no toast script`, async ({ page, context, baseURL }) => {
        if (staleFlash) {
          // What `flashPublic("contactSent")` writes (`notice.ts`, `encodeFlash`).
          await context.addCookies([
            {
              name: "br-flash",
              value: encodeURIComponent(JSON.stringify({ k: "success", n: "contactSent", v: {} })),
              url: baseURL ?? "http://localhost:4783",
            },
          ]);
        }
        const scripts = collectScripts(page);
        const response = await page.goto(path, { waitUntil: "networkidle" });
        expect(response?.status()).toBe(200);

        await expect(page.getByTestId("toast-live")).toHaveCount(0);
        await expect(page.getByTestId("toast")).toHaveCount(0);
        await expect(page.getByText("Mesaj trimis clubului.")).toHaveCount(0);

        // The island's own marker is in its compiled chunk; no chunk this page loaded holds it.
        const bodies = await Promise.all(scripts);
        expect(bodies.length).toBeGreaterThan(0);
        expect(bodies.filter((body) => body.includes("toast-live"))).toHaveLength(0);

        // Not the page's to clear: a stale flash is left for its own minute.
        if (staleFlash) {
          const kept = (await context.cookies()).some((cookie) => cookie.name === "br-flash");
          expect(kept).toBe(true);
        }
      });
    }
  }
});
