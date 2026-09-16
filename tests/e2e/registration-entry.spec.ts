import { expect, test } from "@playwright/test";
import {
  ensureRegistrationIsOpen,
  FEATURED,
  HUMAN_PAUSE_MS,
  signIn,
} from "./support/featured-event";

/**
 * BR-REQ-030-01, BR-REQ-031-01 — a visitor can actually reach the registration form.
 * BR-REQ-034-01 — the free-place count is on the page.
 * BR-REQ-041-01 — the whole journey works at 320px as well as on a desktop.
 *
 * The registration lifecycle was built, tested and unreachable: `/events/[slug]/register`
 * existed and nothing on the site linked to it. This walks the door that was missing — the
 * featured event on the landing page, through to a submitted form.
 *
 * Runs against the seeded database (`docker compose up -d db && yarn db:seed`), and signs in
 * through the development staff switcher like `cms-publish.spec.ts`. The setup it shares with
 * `registration-form.spec.ts` lives in `support/featured-event.ts`.
 */

test.describe("BR-REQ-030-01 the featured event leads to the registration form", () => {
  test("walks hero → register → submitted, and shows the free places on the way", async ({
    page,
  }) => {
    await signIn(page, "Dev Moderator");
    await ensureRegistrationIsOpen(page);

    await page.goto("/ro/evenimente");

    const hero = page.getByRole("region", { name: new RegExp(FEATURED.title) });
    await expect(hero).toBeVisible();
    // BR-REQ-034-01: the count is a number of places, stated in words next to the button.
    await expect(hero.getByText(/locuri libere/)).toBeVisible();

    const enter = hero.getByRole("link", { name: "Înscrie-te la eveniment" });
    // BR-REQ-041-01 criterion 6: a 44px tap target, on the page whose whole purpose is to be
    // tapped on a phone.
    const box = await enter.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await enter.click();
    await expect(page).toHaveURL(new RegExp(`/ro/evenimente/${FEATURED.slug}/inscriere$`));

    // Criterion 1: the document never wider than the viewport, on the new page too.
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);

    // Unique per project and per run: a second registration for the same address on the same
    // event is a duplicate, and would be answered with the same generic success — which would
    // make this assertion pass while proving nothing.
    const address = `e2e-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;
    // BR-REQ-031-04: every field the public form insists on. Filled through the rendered
    // page rather than posted directly, so a field added to the schema without being added
    // to the form fails here instead of on a race morning.
    await page.locator('[name="firstName"]').fill("Ana");
    await page.locator('[name="lastName"]').fill("Popescu");
    await page.locator('[name="email"]').fill(address);
    await page.locator('[name="birthDate"]').fill("1990-05-17");
    await page.locator('[name="city"]').fill("Brașov");

    // Sex, nationality and t-shirt size are MUI selects — a hidden input and a listbox, not
    // a <select> — and all three carry a default the schema accepts. Left untouched on
    // purpose: this asserts that somebody who fills in only the text fields is still
    // accepted, which is what most people will actually do.
    await page.locator('[name="phone"]').fill("+40711111111");
    await page.locator('[name="emergencyContactName"]').fill("Ion Popescu");
    await page.locator('[name="emergencyContactPhone"]').fill("+40722222222");
    await page.locator('[name="privacyAcknowledged"]').check();

    // BR-REQ-039-02: the display name is behind a collapsed <details>, closed by default,
    // and left alone here — a submission that never opens it must still be accepted, and the
    // stored display name is then the legal name. The t-shirt, club and health questions are
    // collapsed for the same reason; `registration-form.spec.ts` is where that is asserted.

    // The submission timing check answers a too-fast form with the same generic success it
    // gives a real one, so a test that submitted immediately would pass without ever creating
    // a registration.
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    await expect(page.getByText("Verifică-ți emailul")).toBeVisible();
  });

  test("offers the same door on the event's own page", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await ensureRegistrationIsOpen(page);

    await page.goto(`/ro/evenimente/${FEATURED.slug}`);

    const enter = page.getByRole("link", { name: "Înscrie-te la eveniment" });
    await expect(enter).toBeVisible();
    await enter.click();
    await expect(page).toHaveURL(new RegExp(`/inscriere$`));
    await expect(page.getByRole("heading", { name: new RegExp(FEATURED.title) })).toBeVisible();
  });
});

test.describe("BR-REQ-030-01 criterion 1 an event that takes no registration", () => {
  test("offers no registration control at all", async ({ page }) => {
    // The three other seeded events are `NONE`, and the page says the registration requirement
    // in words in the facts list rather than offering a button that cannot work.
    await page.goto("/ro/evenimente/tura-pe-tampa");

    await expect(page.getByRole("link", { name: "Înscrie-te la eveniment" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Intră pe lista de așteptare" })).toHaveCount(0);
    await expect(page.getByText("Nu este necesară înscrierea")).toBeVisible();
  });
});
