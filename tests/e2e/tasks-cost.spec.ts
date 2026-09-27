import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-090-05 — the money question, on the screen a volunteer treasurer actually opens.
 *
 * Two things only, because the arithmetic and the wording are unit-tested and this is the part
 * a unit test cannot see: that an Administrator gets an answer rather than a raw message key,
 * and that the answer fits a phone. The second is not decoration — the widest thing on the page
 * is a vendor quotation like `$0.106/CU-hour` sitting in a grid cell, and §18.5 forbids sideways
 * scrolling at any width.
 */
test.describe("BR-REQ-090-05 the club's money, «Setări» → «Costuri» (§NNN)", () => {
  test("tells an Administrator what the club pays, with no sideways scroll", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    // The cost half was its own panel of «Sarcini» since §265, and is «Setări» → «Costuri» since §NNN.
    await page.goto("/ro/admin/settings/costs");

    /**
     * Scoped to the page's own `<main>`, and not for tidiness. This route streams behind
     * `loading.tsx`, and React 19.2 reveals a streamed Suspense boundary on the next animation
     * frame rather than in the script that delivers it. On a slow CI box that frame comes
     * *after* hydration, and MUI's colour-scheme provider re-renders once right after mounting
     * (`useCurrentColorScheme`'s `setIsClient`), which reaches the still-dehydrated boundary and
     * makes React client-render it from the RSC payload instead of waiting. For about one frame
     * the page then holds two copies of this text: the rendered one in `#main` and the streamed
     * one still parked in React's `<div hidden id="S:0">` at the end of `<body>` — invisible to
     * anyone, but not to a strict text locator. `getByRole` ignores hidden nodes; `getByText`
     * does not. Traced in CI on 2026-09-18 (`DECISIONS.md` §93).
     */
    const main = page.locator("#main");

    // The month's total first, straight under the tabs (§NNN): ONE line in the owner's words, in
    // euro, before every card that justifies it; the provider rows folded closed under it (§336).
    const total = main.getByRole("heading", { name: /^Luna aceasta: .* € până acum · estimare la sfârșitul lunii: .* €/ });
    await expect(total).toBeVisible();
    await expect(main.getByTestId("month-costs-domain-year")).toContainText("Domeniul .com:");
    await expect(main.locator('details[data-testid="month-costs"]')).not.toHaveAttribute("open", /.*/);
    await expect(main.getByRole("heading", { name: "Cât costă" })).toBeVisible();
    // The verdict and the number, before the table that justifies them.
    await expect(main.getByText(/Astăzi clubul (nu plătește nimic|plătește)/)).toBeVisible();
    await expect(main.getByText(/Prima cheltuială care urmează/)).toBeVisible();
    // A row per service, each carrying its own ceiling and how close this deployment is to it.
    await expect(main.getByRole("heading", { name: "Mailgun (trimiterea e-mailurilor)" })).toBeVisible();
    // A price with no age is a claim, so the page states how old these are.
    await expect(main.getByText(/Prețurile au fost verificate /)).toBeVisible();

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });

  test("keeps the costs from an Organizer: no tab offered, and a real 404 for the typed address", async ({ page }) => {
    // BR-REQ-060-01. What a club is close to exceeding is not an Organizer's business. The
    // Organizer opens «Setări» for the club's content tabs and is offered no «Costuri»; the
    // address itself, typed or reached through the old `?panel=costs` (308), answers 404 —
    // decided before anything streams, since «Setări» has no loading boundary (§NNN).
    await signIn(page, "Dev Moderator");
    const main = page.locator("#main");
    await page.goto("/ro/admin/settings");
    const nav = main.getByRole("navigation", { name: "Setări" });
    await expect(nav.getByRole("link", { name: "Emailuri" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Costuri" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Platformă" })).toHaveCount(0);

    expect((await page.goto("/ro/admin/settings/costs"))?.status()).toBe(404);
    expect((await page.goto("/ro/admin/tasks?panel=costs"))?.status()).toBe(404);
    await expect(page).toHaveURL(/\/ro\/admin\/settings\/costs$/);
    await expect(main.getByRole("heading", { name: "Cât costă" })).toHaveCount(0);
  });

  test("still refuses a volunteer, with the answer a missing route gives", async ({ page }) => {
    await signIn(page, "Dev Contributor");
    const response = await page.goto("/ro/admin/tasks");
    expect(response?.status()).toBe(404);
    // «Setări» too: the volunteer's backoffice is the desk and the guide (§103).
    expect((await page.goto("/ro/admin/settings"))?.status()).toBe(404);
    expect((await page.goto("/ro/admin/settings/emails"))?.status()).toBe(404);
  });
});
