import { expect, type Page, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { editorBox, languageTab, openEditorBox } from "./support/fold";

/**
 * §406 — the event editor mirrors the page (BR-REQ-050-01). The owner, 2026-09-25: "am nevoie de
 * mai multe căsuțe la editor ca să văd exact ce flow am în pagină"; "I need to see on the cards as
 * well what info is required"; "I am missing the create and publish for some new events… this
 * should be consistent!"
 *
 * Walked on both pages, on both projects, against one event this spec creates: the map of the
 * page under Publicare and Recurență, a chip that opens its card, the numbered cards with whether
 * the page shows each, what a closed card says publication still needs, the editor's "Publică"
 * that opens the summary instead of posting, and a full save.
 */

let editorUrl = "";

/** A chip of the map, by the section's short name. */
const chip = (page: Page, name: RegExp) => page.getByTestId("section-map").getByRole("link", { name });

test.describe.serial("§406 the editor is the page, top to bottom", () => {
  test("the create page: the map, the numbered cards, a chip that opens its card, the required line", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    // The map: ten cards and the share links (the cost is inside card 1, §466; the place inside
    // «Când și unde» and the rules inside «Program, regulament și declarație», §481), in the page's
    // order, the share links named as automatic.
    const map = page.getByTestId("section-map");
    await expect(map).toBeVisible();
    await expect(map.getByRole("listitem")).toHaveCount(11);
    await expect(map.getByRole("link")).toHaveCount(10);
    for (const nested of ["cost", "place", "rules", "video"]) await expect(map.locator(`[data-section="${nested}"]`)).toHaveCount(0);
    await expect(map.locator('[data-section="share"]')).toHaveAttribute("aria-label", "Distribuie — automat, fără card");
    await expect(chip(page, /^1 · Tipul — apare pe pagină$/)).toHaveAttribute("href", "#box-kind");
    await expect(chip(page, /^10 · Lista participanților — gol, nu apare pe pagină$/)).toHaveAttribute("href", "#box-start-list");
    // A thumb's target, every one of them.
    for (const link of await map.getByRole("link").all()) {
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // The cards, numbered by the page and headed by whether it shows them.
    await expect(page.getByRole("heading", { name: /^4 · Când și unde — apare pe pagină/ })).toBeVisible();
    await expect(chip(page, /^4 · Când și unde/)).toHaveAttribute("href", "#box-when");
    await expect(page.getByRole("heading", { name: /^3 · Descrierea evenimentului — gol, nu apare pe pagină/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Starea evenimentului/ })).toBeVisible();
    // The cost is a plain card inside card 1 since §466: no number, no chip; the cards after it renumber.
    await expect(page.locator("#box-kind #box-cost")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: /^\d+ · Cost/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^6 · Participare și înscrieri — gol, nu apare pe pagină/ })).toBeVisible();

    // A chip opens its card (§336): shut on arrival, open after the press, and the address names it.
    const links = editorBox(page, "Linkuri și fișiere");
    await expect(links).not.toHaveAttribute("open", "");
    await chip(page, /^8 · Linkuri și fișiere/).click();
    await expect(links).toHaveAttribute("open", "");
    await expect(page).toHaveURL(/#box-links$/);

    // What publication needs, from outside the cards: every language on the title card, the
    // title's chip marked the same, and each tab counting its own.
    const titleLine = editorBox(page, "Titlu și rezumat").getByTestId("required-titleSummary");
    await expect(titleLine).toHaveText("lipsesc: Titlu (RO, EN) · Rezumat (RO, EN)");
    await expect(chip(page, /^2 · Titlul/).getByTestId("section-map-missing")).toBeVisible();
    await expect(languageTab(page, "title", "ro")).toHaveText("Română · 2 obligatorii lipsă");
    // The meeting point's gap is on «Când și unde», and on its chip (§481).
    await expect(editorBox(page, "Când și unde").getByTestId("required-place")).toHaveText("lipsesc: Punct de întâlnire (RO, EN)");
    await expect(chip(page, /^4 · Când și unde/).getByTestId("section-map-missing")).toBeVisible();

    await fillDateField(page, "Începutul evenimentului", "2027-06-06");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("event.locationNameEn").fill("Tractorul Park");
    await field("translations.ro.title").fill(`Pagina de sus în jos ${suffix}`);
    await field("translations.ro.slug").fill(`pagina-de-sus-in-jos-${suffix}`);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Top to bottom ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`top-to-bottom-${suffix}`);

    // Read again as it is typed: the titles and the place are there, the summaries are not.
    await expect(titleLine).toHaveText("lipsesc: Rezumat (RO, EN)");
    await expect(languageTab(page, "title", "en")).toHaveText("English · 1 obligatoriu lipsă");
    await expect(editorBox(page, "Când și unde").getByTestId("required-place")).toHaveText("complet");
    await expect(editorBox(page, "Adresa paginii").getByTestId("required-address")).toHaveText("complet");

    // A draft needs no summary: the plain create goes through.
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=created/);
    editorUrl = page.url().replace(/[?#].*$/, "");
  });

  test("the editor: the same map, the saved states, a full save, and «Publică» that says what is missing", async ({ page }) => {
    test.skip(!editorUrl, "the create step did not run");
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);

    // The same map, now from what is saved.
    await expect(page.getByTestId("section-map").getByRole("link")).toHaveCount(10);
    await expect(chip(page, /^2 · Titlul — apare pe pagină/)).toBeVisible();
    await expect(chip(page, /^4 · Când și unde — apare pe pagină/)).toBeVisible();
    await expect(chip(page, /^9 · Program și regulament — gol, nu apare pe pagină/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /^2 · Titlu și rezumat — apare pe pagină/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^5 · Traseul — gol, nu apare pe pagină/ })).toBeVisible();

    // A chip opens its card here too.
    const course = editorBox(page, "Traseul");
    await expect(course).not.toHaveAttribute("open", "");
    await chip(page, /^5 · Traseul/).click();
    await expect(course).toHaveAttribute("open", "");

    // Only the summaries are missing, in both languages, on the closed card and on its tabs.
    await expect(editorBox(page, "Titlu și rezumat").getByTestId("required-titleSummary")).toHaveText("lipsesc: Rezumat (RO, EN)");
    await expect(languageTab(page, "title", "en")).toHaveText("English · 1 obligatoriu lipsă");

    // A full save still works, the course with it — the card moved, its names did not.
    await page.getByRole("combobox", { name: "Suprafață" }).click();
    await page.getByRole("option", { name: "Trail" }).click();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
    await hydrated(page);
    await expect(page.getByRole("heading", { name: /^5 · Traseul — apare pe pagină/ })).toBeVisible();

    // «Publică» is on the draft itself (§423), as «Creează și publică» was on the create page, and
    // gated the same way: pressed with the summaries missing, it posts nothing.
    const onDraft = page.getByRole("button", { name: "Publică" });
    await expect(onDraft).toBeVisible();
    await onDraft.click();
    await expect(page.getByTestId("publish-gaps")).toBeFocused();
    await expect(page).not.toHaveURL(/saved=PUBLISHED/);

    // To review, then «Publică»: the same button, full look; pressed, it posts nothing and the
    // summary names the gaps of what is saved, focused, with the title card opened on them.
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await hydrated(page);
    const publish = page.getByRole("button", { name: "Publică" });
    await expect(publish).toBeVisible();
    await expect(publish).toHaveCSS("opacity", "1");
    await publish.click();
    const gaps = page.getByTestId("publish-gaps");
    await expect(gaps).toBeFocused();
    await expect(gaps.getByRole("link", { name: "Titlu și rezumat › Română › Rezumat" })).toBeVisible();
    await expect(gaps.getByRole("link", { name: "Titlu și rezumat › English › Rezumat" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).not.toHaveURL(/saved=PUBLISHED/);
    await expect(editorBox(page, "Titlu și rezumat")).toHaveAttribute("open", "");
    await expect(page.getByText("În verificare", { exact: true })).toBeVisible();
  });

  test("the grouped cards: «Când și unde», «Program, regulament și declarație», no film card, the start list last", async ({ page }) => {
    test.skip(!editorUrl, "the create step did not run");
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);
    // No film card (§481): a film is a figure in the description.
    await expect(page.locator("#box-video")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Filmul/ })).toHaveCount(0);
    const list = await openEditorBox(page, "Lista publică a participanților");
    // A group run takes no registration here, so there is nobody to list: the sentence stands in.
    await expect(list).toContainText("Lista publică există doar la înscrierile pe site");
    // The date, the place and the time zone in one card, in that order (§481).
    const when = await openEditorBox(page, "Când și unde");
    await expect(when.locator("#box-place")).toHaveCount(1);
    await expect(when.locator("#box-timezone")).toHaveCount(1);
    await expect(when.locator('[name="event.locationName"]')).toHaveCount(1);
    // The programme, the rules and the declaration as three cards in one, in the page's order.
    const cards = await page.locator("#box-programme details[id^='box-']").evaluateAll((nodes) => nodes.map((node) => node.id));
    expect(cards.filter((id) => ["box-schedule", "box-rules", "box-declaration"].includes(id))).toEqual(["box-schedule", "box-rules", "box-declaration"]);
    await expect(page.locator("#box-rules #box-declaration")).toHaveCount(0);
    // The start list after them, and before the cards that are not on the page.
    const order = await page.locator("details[id^='box-']").evaluateAll((nodes) => nodes.map((node) => node.id));
    expect(order.indexOf("box-programme")).toBeLessThan(order.indexOf("box-start-list"));
    // The status (§448) and the cost (§466) are cards inside the first box.
    await expect(page.locator("#box-kind #box-status")).toHaveCount(1);
    await expect(page.locator("#box-kind #box-cost")).toHaveCount(1);
  });
});
