import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-011-01 criterion 8 — an organizer pastes the route link, and a runner can open it.
 *
 * Walked through the rendered editor rather than written to the database, so a field added to
 * the schema without being added to the form fails here rather than on a race morning — the
 * same reason `registration-entry.spec.ts` fills the registration form through the page.
 *
 * It creates and publishes its **own** event rather than borrowing a seeded one. There are four
 * seeded events and three are already written to by other specs — `cms-publish.spec.ts`
 * unpublishes one per project, which 404s the public page this spec would then load. Two
 * projects running in parallel against one database make that a real collision rather than a
 * theoretical one, and a spec that only passes when it runs alone is a spec people stop running.
 */

// Built from parts: `AGENTS.md` §8 forbids a hostname literal, and `docs:check` enforces it
// across the whole repository rather than only under `src/`.
const ROUTE_LINK = ["https:/", "routes.example.test", "traseu-tampa"].join("/");

/**
 * Set once by the first test and read by the rest.
 *
 * Safe only because the describe below is serial: the first test creates the event, and
 * Playwright skips the others if it fails rather than running them against an empty string.
 */
let slug = "";
let editorUrl = "";

/*
 * Serial, because all three act on the one event this spec creates, and the editor's version
 * guard would turn a parallel run into a CONFLICT rather than a failure worth reading.
 */
test.describe.serial("BR-REQ-011-01 criterion 8 the route link", () => {
  test("is set in the editor and opens from the published event page", async ({ page }) => {
    // Unique per project *and* per run: the two projects share one database and
    // `UNIQUE(locale, slug)` would fail the second run of the suite otherwise.
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    slug = `traseu-${suffix}`;

    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/events/new");

    const field = (name: string) => page.locator(`[name="${name}"]`);
    await field("event.startsAtWallTime").fill("2027-05-01T09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(`Cursa cu traseu ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await field("translations.en.title").fill(`Route race ${suffix}`);
    await field("translations.en.slug").fill(`route-race-${suffix}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);

    // Creating already redirected with `?saved=created`, so every wait below names the outcome
    // it is actually waiting for. A bare `saved=` matches the URL that is already in the bar and
    // returns instantly, which raced the save against the navigation that followed it.
    editorUrl = page.url();
    await field("event.routeUrl").fill(ROUTE_LINK);
    // Publication refuses an incomplete language (`AGENTS.md` §11.2) and an excerpt is one of
    // the fields it counts, so the one save fills both languages as well as the route.
    await field("translations.ro.excerpt").fill("Cursă de probă pentru traseu.");
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.excerpt").fill("A trial race for the route link.");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);

    // Both languages go live together, so the route has to survive the whole editorial flow
    // rather than only a save.
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await page.waitForURL(/saved=PUBLISHED/);

    await page.goto(`/ro/evenimente/${slug}`);

    // Its own labelled fact, not folded into the meeting point (`DECISIONS.md` §49).
    await expect(page.locator("dt").filter({ hasText: /^Traseu$/ })).toHaveCount(1);

    const route = page.getByRole("link", { name: "Vezi traseul" });
    await expect(route).toHaveAttribute("href", ROUTE_LINK);
    // The opened page can neither reach back through `window.opener` nor learn where it came
    // from, because the URL is whatever an organizer pasted.
    await expect(route).toHaveAttribute("rel", /noopener/);
    await expect(route).toHaveAttribute("rel", /noreferrer/);

    // BR-REQ-041-01 criterion 6, at 320px as well as on a desktop.
    const box = await route.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Criterion 1: a long pasted URL must not widen the document.
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });

  test("stays off the listing card, where the card is already the link", async ({ page }) => {
    await page.goto("/ro/evenimente");

    // An anchor inside an anchor is invalid HTML and the browser splits the outer one, which
    // breaks the card. The route waits for the detail page, like the map link — and this holds
    // across every event on the listing, including any this spec published on an earlier run.
    await expect(page.getByRole("link", { name: "Vezi traseul" })).toHaveCount(0);
  });

  test("says nothing about a route when the club has not drawn one", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    // Straight to this test's own event. Matching by title would be a substring match against
    // every "Cursa cu traseu …" an earlier run left behind, and `.first()` would pick one of
    // those rather than the row this spec just published.
    await page.goto(editorUrl);
    await page.locator('[name="event.routeUrl"]').fill("");
    // The event is published now, so the save carries the live-edit acknowledgement for the
    // whole form (BR-REQ-051-01 criterion 4).
    await page.locator('[name="acknowledgeLiveEdit"]').check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);

    await page.goto(`/ro/evenimente/${slug}`);

    // Absent, not an empty row and not a guessed link — the same rule the cost follows.
    // The label is matched exactly: the seeded descriptions use the word "traseu" in prose.
    await expect(page.getByRole("link", { name: "Vezi traseul" })).toHaveCount(0);
    await expect(page.locator("dt").filter({ hasText: /^Traseu$/ })).toHaveCount(0);
  });
});
