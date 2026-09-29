import { expect, type Locator, test } from "@playwright/test";
import { hydrated, signIn } from "./support/featured-event";
import { cardOnListing, openEditorBox } from "./support/fold";

/**
 * `DECISIONS.md` §412 — the difficulty as a gauge ("un gauge icon custom mai degrabă"), replacing
 * §399's scale of weights; §526 — the owner's five bands, «ușor, mediu, greuț, greu, foarte greu»,
 * three steps each, fifteen levels. One glyph, drawn by `DifficultyGaugeIcon.tsx` and shared
 * through `RoutePills` (§388) by every surface: the event page's pill, the listing card's, the
 * backoffice's own list, and the editor's select.
 *
 * The gauge says its band with how many of its five arc segments are lit (`difficulty-gauge-on`)
 * and faint (`difficulty-gauge-off`), and an event's pill says the step as three dots under the hub
 * (`difficulty-step-on` / `-off`), with `data-band`, `data-step` and `data-level` (1 … 15). The
 * seeded Tâmpa run is «Mediu 4» (level 4: two segments lit, one dot — the owner's own example of «mediu 4»); the interval session
 * «Foarte greu 15» (level 15, the top); the Sunday run «Ușor 1» (level 1, the bottom). The number is
 * the level of fifteen, the dots are the step (§NNN — the owner, 2026-09-29: «ușor: 1,2,3, mediu
 * 4,5,6 și tot așa, în ordine»).
 *
 * The pill shows the band alone, «Mediu» (the owner, 2026-09-29 19:08: «the sub indicator is
 * enough»), hidden from a screen reader, and carries «Dificultate: mediu — nivelul
 * 4 din 15 (mediu: 4–6)» in a visually-hidden span in its place. A plain, roleless `<div>` (MUI's `Chip` when it is
 * not `clickable`) has no computed accessible name, so the check is the real text —
 * `toContainText` — and the visible span's `aria-hidden`.
 */
/** The pill's visible words, hidden from a screen reader, and the words it hears in their place. */
async function expectWords(pill: Locator, shown: string, heard: string) {
  await expect(pill.locator('.MuiChip-label > span[aria-hidden="true"]')).toHaveText(shown);
  await expect(pill).toContainText(heard);
}

async function expectGauge(pill: Locator, band: number, step?: number) {
  const gauge = pill.locator('svg[data-testid="difficulty-gauge"]');
  await expect(gauge).toHaveCount(1);
  await expect(gauge).toHaveAttribute("aria-hidden", "true");
  await expect(gauge).toHaveAttribute("data-band", String(band));
  await expect(gauge.locator('[data-testid="difficulty-gauge-on"]')).toHaveCount(band);
  await expect(gauge.locator('[data-testid="difficulty-gauge-off"]')).toHaveCount(5 - band);
  await expect(gauge.locator('[data-testid="difficulty-gauge-needle"]')).toHaveCount(1);
  if (step === undefined) {
    await expect(gauge.locator('[data-testid^="difficulty-step-"]')).toHaveCount(0);
    return;
  }
  await expect(gauge).toHaveAttribute("data-step", String(step));
  await expect(gauge).toHaveAttribute("data-level", String((band - 1) * 3 + step));
  await expect(gauge.locator('[data-testid="difficulty-step-on"]')).toHaveCount(step);
  await expect(gauge.locator('[data-testid="difficulty-step-off"]')).toHaveCount(3 - step);
}

test.describe("BR-REQ-041-01 the difficulty pill names its level of fifteen on a tap (§528)", () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 720 } });
  // The level, then every band's levels on a second line (§NNN; the owner, 2026-09-29 14:18).
  const SENTENCE = /^Mediu — nivelul 4 din 15\s+ușor 1–3 · mediu 4–6 · greuț 7–9 · greu 10–12 · foarte greu 13–15$/;

  test("on the event page, a tap on the «Mediu» pill opens the tooltip", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");
    await hydrated(page);
    const pill = page.getByTestId("event-facts").locator(".MuiChip-root", { hasText: "nivelul 4 din 15" });
    await pill.tap();
    await expect(page.getByRole("tooltip")).toHaveText(SENTENCE);
  });

  test("on the listing card, a tap opens the tooltip and does not follow the whole-card link (§486)", async ({ page }) => {
    await page.goto("/ro/evenimente");
    await hydrated(page);
    const card = (await cardOnListing(page, "Tură pe Tâmpa")).first();
    const pill = card.locator('[data-fact="pills"] .MuiChip-root', { hasText: "nivelul 4 din 15" });
    await expect(pill).toHaveAttribute("data-has-tooltip", "true");
    const before = page.url();
    await pill.tap();
    await expect(page.getByRole("tooltip")).toHaveText(SENTENCE);
    expect(page.url()).toBe(before);
  });
});

test.describe("BR-REQ-041-01 the difficulty gauge (§412)", () => {
  test("the event page's route row shows «Mediu» beside the gauge and is heard as «Dificultate: mediu — nivelul 4 din 15 (mediu: 4–6)»", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");
    const traseu = page.getByTestId("event-facts").locator("dt", { hasText: /^Traseu$/ }).locator("xpath=following-sibling::dd[1]");
    const difficultyPill = traseu.locator(".MuiChip-root", { hasText: "nivelul 4 din 15" });
    await expect(difficultyPill).toBeVisible();
    await expect(difficultyPill.locator("svg.MuiChip-icon")).toHaveAttribute("aria-hidden", "true");
    await expectWords(difficultyPill, "Mediu", "Dificultate: mediu — nivelul 4 din 15 (mediu: 4–6)");
    await expectGauge(difficultyPill, 2, 1);
  });

  test("the English page says the band in English and the level to a screen reader", async ({ page }) => {
    await page.goto("/en/events/tampa-trail");
    const pill = page.getByTestId("event-facts").locator(".MuiChip-root", { hasText: "level 4 of 15" });
    await expectWords(pill, "Medium", "Difficulty: medium — level 4 of 15 (medium: 4–6)");
    await expectGauge(pill, 2, 1);
  });

  for (const width of [320, 360] as const) {
    test(`the listing card's compact pill keeps the word beside the gauge and fits at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/ro/evenimente");
      // The "other events" fold opens by itself only up to four cards (§89): `cardOnListing` opens it (the fix origin/qa gave the old spec).
      const card = (await cardOnListing(page, "Tură pe Tâmpa")).first();
      const pill = card.locator('[data-fact="pills"] .MuiChip-root', { hasText: "nivelul 4 din 15" });
      await expect(pill).toBeVisible();
      await expectWords(pill, "Mediu", "Dificultate: mediu — nivelul 4 din 15 (mediu: 4–6)");
      await expectGauge(pill, 2, 1);
      // The hardest end of the scale, on the seeded interval session (§526's seed).
      const hardest = page.locator("li", { hasText: "Antrenament de intervale" }).first().locator('[data-fact="pills"] .MuiChip-root', { hasText: "nivelul 15 din 15" });
      await expectWords(hardest, "Foarte greu", "Dificultate: foarte greu — nivelul 15 din 15 (foarte greu: 13–15)");
      await expectGauge(hardest, 5, 3);
      // Nothing wider than the phone (§375's 320px lead).
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      // Measured and reported: the pill's own width, and the gauge's, at this viewport.
      const pillBox = await pill.boundingBox();
      const gaugeBox = await pill.locator("svg.MuiChip-icon").boundingBox();
      expect(gaugeBox?.width ?? 0).toBeLessThanOrEqual(24);
      const measured = `pill ${pillBox?.width ?? "unmeasured"}px, gauge ${gaugeBox?.width ?? "unmeasured"}px, "Foarte greu" pill ${(await hardest.boundingBox())?.width ?? "unmeasured"}px at viewport ${width}px (${testInfo.project.name})`;
      await testInfo.attach(`difficulty-pill-width-${width}px`, { body: measured });
      console.log(`difficulty-pill-width: ${measured}`);
      if (width === 320) {
        await testInfo.attach("difficulty-card-320px", { body: await card.screenshot(), contentType: "image/png" });
        await testInfo.attach("difficulty-card-very-hard-320px", {
          body: await page.locator("li", { hasText: "Antrenament de intervale" }).first().screenshot(),
          contentType: "image/png",
        });
      }
    });
  }

  test("the backoffice list's card keeps the word beside the gauge (§388)", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin");
    await hydrated(page);
    const pill = page.locator(".MuiChip-root:visible", { hasText: "nivelul 4 din 15" }).first();
    await expect(pill).toBeVisible();
    await expect(pill.locator("svg.MuiChip-icon")).toHaveAttribute("aria-hidden", "true");
    await expectWords(pill, "Mediu", "Dificultate: mediu — nivelul 4 din 15 (mediu: 4–6)");
    await expectGauge(pill, 2, 1);
  });

  test("the editor's select offers the owner's five bands in order, each with its gauge", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    await openEditorBox(page, "Ce fel de eveniment");
    await page.getByRole("combobox", { name: "Dificultate" }).click();
    const levels = ["Ușor", "Mediu", "Greuț", "Greu", "Foarte greu"];
    for (const [index, word] of levels.entries()) {
      const option = page.getByRole("option", { name: word, exact: true });
      await expect(option).toBeVisible();
      await expect(option.locator('svg[data-testid="difficulty-gauge"]')).toHaveAttribute("data-band", String(index + 1));
    }
    // The order is the scale's: "Nespecificat" first, then easy to very hard.
    await expect(page.getByRole("option")).toHaveText([/.+/, ...levels]);
    await page.getByRole("option", { name: "Foarte greu", exact: true }).click();
    await expect(page.locator('[name="event.difficulty"]')).toHaveValue("VERY_HARD");
    // A band alone draws no step dots (§526): the step is the second control's.
    await expectGauge(page.getByRole("combobox", { name: "Dificultate" }), 5);
  });

  test("the editor's «Nivelul» is a segmented control of the band's three levels beside the band, at the middle by default, each segment a 44-px target with its dots (§526, §NNN)", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    await openEditorBox(page, "Ce fel de eveniment");
    const steps = page.getByRole("radiogroup", { name: "Nivelul" });
    await expect(steps).toBeVisible();
    await expect(steps.getByRole("radio")).toHaveCount(3);
    // No band chosen yet: the segments show their dots and a dash, never a number of their own.
    await expect(steps.locator("label")).toHaveText(["–", "–", "–"]);
    await expect(steps.locator("svg")).toHaveCount(3);
    await expect(steps.getByRole("radio", { name: "Nivelul din mijlocul categoriei" })).toBeChecked();
    // A band chosen: its own three levels of fifteen, in order (§NNN) — «Mediu» is 4 · 5 · 6, «Ușor» 1 · 2 · 3.
    await page.getByRole("combobox", { name: "Dificultate" }).click();
    await page.getByRole("option", { name: "Mediu", exact: true }).click();
    await expect(steps.locator("label")).toHaveText(["4", "5", "6"]);
    await expect(steps.getByRole("radio", { name: "Nivelul 5 din 15" })).toBeChecked();
    await page.getByRole("combobox", { name: "Dificultate" }).click();
    await page.getByRole("option", { name: "Ușor", exact: true }).click();
    await expect(steps.locator("label")).toHaveText(["1", "2", "3"]);
    await page.getByRole("combobox", { name: "Dificultate" }).click();
    await page.getByRole("option", { name: "Mediu", exact: true }).click();
    // A press on the segment, not on the hidden radio, chooses it; what posts is still the step.
    await steps.locator("label", { hasText: "6" }).click();
    await expect(page.locator('[name="event.difficultyStep"]:checked')).toHaveValue("3");
    for (const segment of await steps.locator("label").all()) {
      const box = await segment.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    // The rule and the whole ladder in one sentence under the toggle (§NNN).
    const HELP = "Nivelul e de la 1 (ușor) la 15 (foarte greu): fiecare categorie are trei niveluri — ușor 1–3, mediu 4–6, greuț 7–9, greu 10–12, foarte greu 13–15.";
    await expect(page.getByText(HELP)).toBeVisible();
    // The whole scale behind a «?» beside the toggle and beside the band (§528, §537), one line per band.
    for (const testId of ["difficulty-scale-help", "difficulty-band-help"]) {
      const help = page.getByTestId(testId);
      await expect(help).toBeVisible();
      await expect(help).toHaveAttribute("aria-label", /mediu 4: alergarea de pe Tâmpa/);
    }
    // Side by side with the band from `sm`, on one centred axis (§537): the select's centre and the
    // toggle's segments' centre within a few pixels; the help line under the toggle, never beside it.
    // Below `sm` the two stack, the toggle under the select and as wide as the row.
    const select = await page.getByRole("combobox", { name: "Dificultate" }).boundingBox();
    const segment = await steps.locator("label").first().boundingBox();
    const control = await page.getByTestId("difficulty-step-control").boundingBox();
    const row = await page.getByTestId("difficulty-row").boundingBox();
    const helpLine = await page.getByText(HELP).boundingBox();
    const centre = (box: { y: number; height: number } | null) => (box?.y ?? 0) + (box?.height ?? 0) / 2;
    expect(helpLine?.y ?? 0).toBeGreaterThanOrEqual((segment?.y ?? 0) + (segment?.height ?? 0));
    if ((page.viewportSize()?.width ?? 0) >= 600) {
      expect(Math.abs(centre(segment) - centre(select))).toBeLessThan(6);
    } else {
      expect(segment?.y ?? 0).toBeGreaterThan((select?.y ?? 0) + (select?.height ?? 0));
      expect(Math.abs((control?.width ?? 0) - (row?.width ?? 0))).toBeLessThan(2);
    }
  });
});
