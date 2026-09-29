import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-060-01, BR-REQ-040-04 (`DECISIONS.md` §527) — the backoffice events list is searched,
 * filtered by state and ordered from one row above the list, a GET form in the address.
 *
 * On both projects, the 320-px phone included: the row is on the page on arrival (never behind a
 * fold), every control wears its glyph, «tampa» finds the seeded «Tură pe Tâmpa», the order is
 * the one select's value in the address, the count line says «N din M evenimente», and nothing
 * scrolls sideways. Reads the seed only, so the two projects sharing a database cannot collide.
 */
test.describe("§527 the backoffice events list: search, state, order", () => {
  test("searches without accents, orders by one select and keeps it in the address", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin");

    const form = page.getByRole("search", { name: "Caută și filtrează evenimentele" });
    await expect(form).toBeVisible();
    const search = form.getByRole("searchbox", { name: "Caută un eveniment" });
    const state = form.getByRole("combobox", { name: "Starea" });
    const sort = form.getByRole("combobox", { name: "Ordinea" });
    for (const control of [search, state, sort]) {
      await expect(control).toBeVisible();
      // The glyph sits in the field's own frame, before the words (the owner's rule, 2026-09-27).
      // The adornment's glyph alone: a native select also draws MUI's arrow as an svg in the frame.
      const frame = control.locator("xpath=ancestor::div[contains(@class,'MuiInputBase-root')][1]");
      const glyph = frame.locator(".MuiInputAdornment-positionStart svg");
      await expect(glyph).toHaveCount(1);
      await expect(glyph).toHaveAttribute("aria-hidden", "true");
      const [glyphBox, controlBox] = [await glyph.boundingBox(), await control.boundingBox()];
      expect(glyphBox && controlBox && glyphBox.x + glyphBox.width <= controlBox.x + 1).toBe(true);
    }
    await expect(sort).toHaveValue("date-near");
    // The plain address opens on «Viitoare» (§555, amending §527), and says it narrows.
    await expect(state).toHaveValue("UPCOMING");
    await expect(page.getByTestId("events-list-count").filter({ visible: true })).toHaveText(/^\d+ din \d+ evenimente$/);

    // «Toate» is its own choice, written into the address.
    await state.selectOption({ label: "Toate" });
    await form.getByRole("button", { name: "Aplică" }).click();
    await expect(page).toHaveURL(/[?&]state=ALL(&|$)/);
    await expect(page.getByRole("combobox", { name: "Starea" })).toHaveValue("ALL");
    await expect(page.getByTestId("events-list-count")).toHaveCount(0);

    await search.fill("tampa");
    await sort.selectOption({ label: "Nume Z–A" });
    await form.getByRole("button", { name: "Aplică" }).click();

    await expect(page).toHaveURL(/[?&]q=tampa(&|$)/);
    await expect(page).toHaveURL(/[?&]sort=title-desc(&|$)/);
    const main = page.locator("#main");
    await expect(main.getByRole("link", { name: "Tură pe Tâmpa", exact: true }).filter({ visible: true }).first()).toBeVisible();
    // The visible copy, as the link above: after the press the page can hold the previous render hidden.
    await expect(page.getByTestId("events-list-count").filter({ visible: true })).toHaveText(/^\d+ din \d+ evenimente$/);
    await expect(page.getByRole("searchbox", { name: "Caută un eveniment" })).toHaveValue("tampa");

    // «Anulate» with the same search: the seed calls nothing off, so the list says why it is empty.
    await page.getByRole("combobox", { name: "Starea" }).selectOption({ label: "Anulate" });
    await page.getByRole("search").getByRole("button", { name: "Aplică" }).click();
    await expect(page).toHaveURL(/[?&]state=CANCELLED(&|$)/);
    await expect(main.getByText("Niciun eveniment nu se potrivește.", { exact: false }).first()).toBeVisible();

    // Nothing wider than the phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole("link", { name: "Șterge filtrele" }).click();
    await expect(page).toHaveURL(/\/ro\/admin$/);
    await expect(page.getByRole("combobox", { name: "Starea" })).toHaveValue("UPCOMING");
  });
});
