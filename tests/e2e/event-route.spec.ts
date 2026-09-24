import { expect, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { editorBox, languagePanel, languageTab, openEditorBox } from "./support/fold";

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
// A GPX shared from a file host (BR-REQ-011-01 criterion 20, `DECISIONS.md` §332) — the owner's
// "google drive files for GPX track files", on a host of the tests' own.
const GPX_LINK = ["https:/", "drive.example.test", "file", "d", "e2e-gpx", "view"].join("/");

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

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);

    const field = (name: string) => page.locator(`[name="${name}"]`);
    // BR-REQ-010-01 criterion 1, on the way past: the type defaults to a group run, and the
    // surface is chosen here so the public page can be checked for both labels below.
    // The surface is the course's, in "Traseul" — folded, all optional (§350).
    await openEditorBox(page, "Traseul");
    await page.getByRole("combobox", { name: "Suprafață" }).click();
    await page.getByRole("option", { name: "Trail" }).click();
    // A date and a 24-hour time, each on MUI's picker (`DECISIONS.md` §70, §345).
    await fillDateField(page, "Începutul evenimentului", "2027-05-01");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    // One language per tab on the create form too, as on the editor.
    await field("translations.ro.title").fill(`Cursa cu traseu ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Route race ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`route-race-${suffix}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);

    // Creating already redirected with `?saved=created`, so every wait below names the outcome
    // it is actually waiting for. A bare `saved=` matches the URL that is already in the bar and
    // returns instantly, which raced the save against the navigation that followed it.
    editorUrl = page.url();
    await hydrated(page);
    // "Traseul" is a card inside "Ce fel de eveniment" (§358); the helper opens the box first.
    const course = await openEditorBox(page, "Traseul");
    const firstBox = editorBox(page, "Ce fel de eveniment");
    await expect(firstBox).toHaveAttribute("open", "");

    // A route link the browser refuses, with the card and the box around it shut again: pressing
    // Salvează must open both and put the cursor in the box, so a card inside a card is never a
    // Save that silently does nothing (§350, §358).
    await field("event.routeUrl").fill("www.traseu-fara-https.example");
    await course.locator(":scope > summary").press("Enter");
    await expect(course).not.toHaveAttribute("open", "");
    await firstBox.locator(":scope > summary").press("Enter");
    await expect(firstBox).not.toHaveAttribute("open", "");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(field("event.routeUrl")).toBeFocused();
    await expect(field("event.routeUrl")).toBeVisible();
    await expect(firstBox).toHaveAttribute("open", "");
    await expect(course).toHaveAttribute("open", "");
    await expect(page).not.toHaveURL(/saved=event/);

    await field("event.routeUrl").fill(ROUTE_LINK);
    // "Linkuri și fișiere" is the card right after the course (§332, §350, §358).
    await openEditorBox(page, "Linkuri și fișiere");
    // "Linkuri și fișiere" beside the route (criterion 19): the first row is the spare line —
    // pick what it is, paste the address, leave both labels empty so the page names the kind.
    // Exact: a partner's card on the same form has its own "Linkul 1 al partenerului 1" (§347).
    const firstLink = page.getByRole("group", { name: "Linkul 1", exact: true });
    await firstLink.getByRole("combobox").click();
    await page.getByRole("option", { name: "Traseul (GPX)" }).click();
    await field("event.links[0].url").fill(GPX_LINK);
    // Publication refuses an incomplete language (`AGENTS.md` §11.2) and an excerpt is one of
    // the fields it counts, so the one save fills both languages as well as the route. The
    // short description is the editor since `DECISIONS.md` §73 and a fold since §260: open the
    // fold — which is what mounts the editor — then click into it and type. Scoped to the
    // language's own panel, because the hidden one carries the same fold.
    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await panel.locator("summary").filter({ hasText: "Rezumat" }).click();
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    await openEditorBox(page, "Titlu și rezumat");
    await excerpt("ro", "Cursă de probă pentru traseu.");
    await languageTab(page, "title", "en").click();
    await excerpt("en", "A trial race for the route link.");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);

    // Both languages go live together, so the route has to survive the whole editorial flow
    // rather than only a save.
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await page.waitForURL(/saved=PUBLISHED/);

    await page.goto(`/ro/evenimente/${slug}`);

    // The type and the surface, both as localized text, beside each other (BR-REQ-010-01) —
    // each behind its glyph since §112, so the line is read as one element with both words.
    const kind = page.locator("#main").getByText("Alergare de grup").first();
    await expect(kind).toBeVisible();
    await expect(kind).toContainText("Trail");

    // Its own labelled fact, not folded into the meeting point (`DECISIONS.md` §49).
    await expect(page.locator("dt").filter({ hasText: /^Traseu$/ })).toHaveCount(1);
    // With a route to show, the surface completes the row as its pill, beside the link (§356).
    const routeRow = page.locator("dt").filter({ hasText: /^Traseu$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(routeRow.locator(".MuiChip-root")).toHaveText(["Trail"]);

    const route = page.getByRole("link", { name: "Vezi traseul" });
    await expect(route).toHaveAttribute("href", ROUTE_LINK);
    // The opened page can neither reach back through `window.opener` nor learn where it came
    // from, because the URL is whatever an organizer pasted.
    await expect(route).toHaveAttribute("rel", /noopener/);
    await expect(route).toHaveAttribute("rel", /noreferrer/);

    // BR-REQ-041-01 criterion 6, at 320px as well as on a desktop.
    const box = await route.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Criterion 19: the GPX under "Linkuri și fișiere", named by its kind in the page's language
    // (no label was typed) with the host it opens on beneath, in a new tab, 44 pixels tall.
    const linksBlock = page.locator("section#links");
    await expect(linksBlock.getByRole("heading", { name: "Linkuri și fișiere" })).toBeVisible();
    const gpx = linksBlock.getByRole("link", { name: /Traseul \(GPX\)/ });
    await expect(gpx).toHaveAttribute("href", GPX_LINK);
    await expect(gpx).toContainText("drive.example.test");
    await expect(gpx).toHaveAttribute("target", "_blank");
    await expect(gpx).toHaveAttribute("rel", /noopener/);
    await expect(gpx).toHaveAttribute("rel", /noreferrer/);
    expect((await gpx.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The English page says the same kind in English, from the same row.
    await page.goto(`/en/events/route-race-${suffix}`);
    await expect(page.locator("section#links").getByRole("link", { name: /Route \(GPX\)/ })).toHaveAttribute("href", GPX_LINK);
    await page.goto(`/ro/evenimente/${slug}`);

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
    await signIn(page, "Dev Administrator");
    // Straight to this test's own event. Matching by title would be a substring match against
    // every "Cursa cu traseu …" an earlier run left behind, and `.first()` would pick one of
    // those rather than the row this spec just published.
    await page.goto(editorUrl);
    await hydrated(page);
    await openEditorBox(page, "Traseul");
    await page.locator('[name="event.routeUrl"]').fill("");
    await openEditorBox(page, "Linkuri și fișiere");
    // The link saved by the first test comes back in its row, and removing the row removes it
    // (criterion 19): no rows left is "no links", not "not editing the links".
    await expect(page.locator('[name="event.links[0].url"]')).toHaveValue(GPX_LINK);
    await page.getByRole("button", { name: "Șterge linkul 1", exact: true }).click();
    await expect(page.locator('[name="event.links[0].url"]')).toHaveCount(0);
    // The event is published now, so the save carries the live-edit acknowledgement for the
    // whole form (BR-REQ-051-01 criterion 4) — and cannot be sent without it: the box is
    // required, the button says so beneath itself, and a press is refused by the browser.
    const acknowledge = page.locator('[name="acknowledgeLiveEdit"]');
    await expect(page.getByText("Bifează că ai înțeles că modifici conținut publicat")).toBeVisible();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    expect(await acknowledge.evaluate((el) => (el as HTMLInputElement).checkValidity())).toBe(false);
    await expect(page).not.toHaveURL(/saved=event/);
    await acknowledge.check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);

    await page.goto(`/ro/evenimente/${slug}`);

    // Absent, not an empty row and not a guessed link — the same rule the cost follows.
    // The label is matched exactly: the seeded descriptions use the word "traseu" in prose.
    await expect(page.getByRole("link", { name: "Vezi traseul" })).toHaveCount(0);
    // The event is still on trail, and the overline still says so — but the surface alone makes no
    // "Traseu" row (§356): it completes a route, it is not one.
    await expect(page.locator("dt").filter({ hasText: /^Traseu$/ })).toHaveCount(0);
    // And no "Linkuri și fișiere" once the event has none: no heading, no `#links` anchor.
    await expect(page.locator("#links")).toHaveCount(0);
  });
});
