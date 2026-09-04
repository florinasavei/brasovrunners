import { expect, test } from "@playwright/test";

/**
 * BR-REQ-051-01 — editorial workflow, over HTTP.
 * BR-REQ-051-02 — the preview is refused without staff authorization.
 * BR-REQ-060-01 criterion 3 — an unauthenticated request to /admin is refused.
 *
 * These run against the seeded database (`docker compose up -d db && yarn db:seed`) and sign
 * in through the development staff switcher, which is what AGENTS.md §20.4 means by "local
 * E2E uses mock staff auth".
 *
 * The publishing journey mutates real rows, so each Playwright project works on a different
 * event: the two projects run in parallel, and two browsers unpublishing the same translation
 * would collide on the version guard — correctly, but as a flake rather than a finding.
 */

/**
 * One event per project, and neither is read by another spec.
 *
 * The two Playwright projects run in parallel, so a journey that unpublishes an event would
 * otherwise 404 a page the other project is reading — and two browsers unpublishing the same
 * translation would collide on the version guard, correctly, but as a flake rather than a
 * finding. These two events are touched by this file alone.
 */
const EVENT_BY_PROJECT: Record<string, { title: string; slug: string }> = {
  mobile: { title: "Alergare de duminică", slug: "alergare-de-duminica-parcul-tractorul" },
  desktop: { title: "Antrenament de intervale", slug: "antrenament-de-intervale-olimpia" },
};

async function signIn(page: import("@playwright/test").Page, identity: string) {
  await page.goto("/ro/autentificare");
  await page.getByRole("button", { name: new RegExp(identity) }).click();
  await expect(page).toHaveURL(/\/ro\/admin$/);
}

test.describe("BR-REQ-060-01 the backoffice refuses an anonymous request", () => {
  test("sends a signed-out visitor to sign in rather than showing the backoffice", async ({
    page,
  }) => {
    const response = await page.goto("/ro/admin");

    // Locally there is a way in, so the answer is the sign-in page. What must never happen is
    // the backoffice rendering: the guard is on the server, not on the buttons.
    await expect(page).toHaveURL(/\/ro\/autentificare$/);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Administrare" })).toHaveCount(0);
  });

  test("refuses a draft preview to a signed-out visitor", async ({ page }) => {
    // The id does not have to exist: authorization is asserted before anything is read, so an
    // anonymous request never learns whether it does.
    await page.goto("/ro/previzualizare/evenimente/11111111-1111-1111-1111-111111111111");
    await expect(page).toHaveURL(/\/ro\/autentificare$/);
  });

  test("tells crawlers not to index the backoffice or the preview", async ({ page }) => {
    const admin = await page.goto("/ro/admin");
    expect(admin?.headers()["x-robots-tag"]).toContain("noindex");
    expect(admin?.headers()["cache-control"]).toContain("no-store");
  });
});

test.describe("BR-REQ-051-01 an Author may not publish", () => {
  test("shows an Author no publish control on published content", async ({ page }) => {
    await signIn(page, "Dev Author");
    await page.goto("/ro/admin");

    const event = EVENT_BY_PROJECT[test.info().project.name];
    await page.getByRole("link", { name: event.title }).first().click();
    await expect(page).toHaveURL(/\/admin\/events\//);

    const romanian = page.getByRole("region", { name: /Conținut \(RO\)/ });
    await expect(romanian.getByRole("button", { name: "Publică" })).toHaveCount(0);
    // And the reason is stated rather than the form simply being absent.
    await expect(romanian.getByText(/Nu poți edita acest text/)).toBeVisible();
  });

  test("refuses an Author the staff page", async ({ page }) => {
    await signIn(page, "Dev Author");
    // 404, the same answer a route that does not exist gives: an Author is not told that the
    // staff list is there and refused.
    const response = await page.goto("/ro/admin/staff");
    expect(response?.status()).toBe(404);
  });
});

test.describe("BR-REQ-051-01 an Editor publishes and unpublishes one locale", () => {
  test("takes an event off the public site and puts it back", async ({ page }) => {
    const event = EVENT_BY_PROJECT[test.info().project.name];

    await signIn(page, "Dev Editor");
    await page.getByRole("link", { name: event.title }).first().click();
    // Wait for the navigation before reading the URL: taken too early, this is still the list,
    // and every later `goto` in the test would quietly reload the wrong page.
    await expect(page).toHaveURL(/\/admin\/events\//);
    const editorUrl = page.url();

    const romanian = page.getByRole("region", { name: /Conținut \(RO\)/ });
    await expect(romanian.getByText("Publicat", { exact: true })).toBeVisible();

    // Unpublish: the public page must stop existing in this locale.
    await romanian.getByRole("button", { name: "Mută în ciornă" }).click();
    await expect(page.getByText("Modificările au fost salvate.")).toBeVisible();

    const whileDraft = await page.goto(`/ro/evenimente/${event.slug}`);
    expect(whileDraft?.status()).toBe(404);

    // The English translation was not touched: publication is per locale.
    await page.goto(editorUrl);
    const english = page.getByRole("region", { name: /Conținut \(EN\)/ });
    await expect(english.getByText("Publicat", { exact: true })).toBeVisible();

    // A staff preview still renders the draft, with a notice saying what it is.
    await page.goto(editorUrl);
    await romanian.getByRole("link", { name: "Previzualizare" }).click();
    await expect(page.getByText(/Previzualizare pentru echipă/)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );

    // Back through review to published, and the public page returns. Each step waits for the
    // status to change before the next: a transition carries the version it was rendered with,
    // so clicking twice against one render is exactly the stale save the guard refuses.
    await page.goto(editorUrl);
    await romanian.getByRole("button", { name: "Trimite spre verificare" }).click();
    await expect(romanian.getByText("În verificare", { exact: true })).toBeVisible();

    await romanian.getByRole("button", { name: "Publică" }).click();
    await expect(romanian.getByText("Publicat", { exact: true })).toBeVisible();

    const republished = await page.goto(`/ro/evenimente/${event.slug}`);
    expect(republished?.status()).toBe(200);
  });
});
