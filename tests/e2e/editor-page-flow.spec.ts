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

    // The map: eight cards and the share links (the cost is inside card 1, §466; the place inside
    // «Când și unde», §481; the programme, the rules and the public list inside «Participare, înscrieri
    // și regulament», §760), in the page's order, the share links named as automatic.
    const map = page.getByTestId("section-map");
    await expect(map).toBeVisible();
    await expect(map.getByRole("listitem")).toHaveCount(9);
    await expect(map.getByRole("link")).toHaveCount(8);
    for (const nested of ["cost", "place", "programme", "rules", "startList", "video"]) await expect(map.locator(`[data-section="${nested}"]`)).toHaveCount(0);
    await expect(map.locator('[data-section="share"]')).toHaveAttribute("aria-label", "Distribuie — automat, fără card");
    await expect(chip(page, /^1 · Tipul — apare pe pagină$/)).toHaveAttribute("href", "#box-kind");
    await expect(chip(page, /^6 · Înscriere și regulament — gol, nu apare pe pagină$/)).toHaveAttribute("href", "#box-registration");
    await expect(chip(page, /^8 · Linkuri și fișiere/)).toHaveAttribute("href", "#box-links");
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
    await expect(page.getByRole("heading", { name: /^6 · Participare, înscrieri și regulament — gol, nu apare pe pagină/ })).toBeVisible();
    // No group of cards not on the page (§760): each is a card of the page's own.
    await expect(page.getByText("Nu sunt secțiuni ale paginii")).toHaveCount(0);
    await expect(page.locator("#box-kind #box-promotion")).toHaveCount(1);
    await expect(page.locator("#box-title #box-address")).toHaveCount(1);
    await expect(page.locator("#box-title #box-cover")).toHaveCount(1);

    // A chip opens its card (§336): shut on arrival, open after the press, and the address names it.
    const links = editorBox(page, "Linkuri și fișiere");
    await expect(links).not.toHaveAttribute("open", "");
    await chip(page, /^8 · Linkuri și fișiere/).click();
    await expect(links).toHaveAttribute("open", "");
    await expect(page).toHaveURL(/#box-links$/);

    // What publication needs, from outside the cards: every language on the title card — the page's
    // address with it, a card inside it since §760 — the title's chip marked the same, and each tab
    // counting its own.
    const titleLine = editorBox(page, "Titlu și rezumat").getByTestId("required-titleSummary").first();
    await expect(titleLine).toHaveText("lipsesc: Titlu (RO, EN) · Rezumat (RO, EN) · Adresa paginii (RO, EN)");
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

    // The same map, now from what is saved: eight cards to open, the public list inside card 6 (§760).
    await expect(page.getByTestId("section-map").getByRole("link")).toHaveCount(8);
    await expect(chip(page, /^2 · Titlul — apare pe pagină/)).toBeVisible();
    await expect(chip(page, /^4 · Când și unde — apare pe pagină/)).toBeVisible();
    await expect(chip(page, /^6 · Înscriere și regulament — gol, nu apare pe pagină/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /^2 · Titlu și rezumat — apare pe pagină/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^5 · Traseul — gol, nu apare pe pagină/ })).toBeVisible();

    // A chip opens its card here too.
    const course = editorBox(page, "Traseul");
    await expect(course).not.toHaveAttribute("open", "");
    await chip(page, /^5 · Traseul/).click();
    await expect(course).toHaveAttribute("open", "");

    // Only the summaries are missing, in both languages, on the closed card and on its tabs.
    await expect(editorBox(page, "Titlu și rezumat").getByTestId("required-titleSummary").first()).toHaveText("lipsesc: Rezumat (RO, EN)");
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

  /*
    §579 — «Previzualizare» (the owner, 2026-09-30: «vreau să pot face preview la eveniment, înainte
    de salvare și publicare, ca să știu cum arată, atât pe card cât și descrierea completă»): an
    unsaved title on the listing card and on the page, in Română and English, on a phone's width and
    a desktop's, with what each language still lacks — and nothing saved.
  */
  test("«Previzualizare»: the unsaved event as the card, the page and the form, both languages, both widths, nothing saved", async ({ page }) => {
    test.skip(!editorUrl, "the create step did not run");
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);
    const heading = (await page.getByTestId("editor-heading").textContent())?.trim() ?? "";

    // Closed on arrival, its line saying what it is for, a glyph before its title (§521).
    const box = editorBox(page, "Previzualizare");
    await expect(box).not.toHaveAttribute("open", "");
    await expect(box.locator(":scope > summary")).toContainText("Cum arată pe site — cardul, pagina și formularul, fără să salvezi");
    await expect(box.locator(":scope > summary svg").first()).toBeVisible();

    // A title typed and not saved.
    const unsaved = `${heading} — nesalvat`;
    await openEditorBox(page, "Titlu și rezumat");
    await page.locator('[name="translations.ro.title"]').fill(unsaved);

    await openEditorBox(page, "Previzualizare");
    const run = page.getByTestId("draft-preview-run");
    for (const control of [
      run,
      page.getByTestId("draft-preview-view-page"),
      page.getByTestId("draft-preview-view-form"),
      page.getByTestId("draft-preview-locale-en"),
      page.getByTestId("draft-preview-width-desktop"),
    ]) {
      expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId("draft-preview-locale-ro")).toHaveText("RO");
    await expect(page.getByTestId("draft-preview-locale-en")).toHaveText("EN");
    await run.click();

    // The card, as the listing draws it, with the unsaved title — and what each language still lacks.
    const ro = page.frameLocator('[data-testid="draft-preview-frame-ro"]');
    await expect(ro.getByTestId("draft-preview-card")).toBeVisible();
    await expect(ro.getByTestId("draft-preview-card").getByRole("heading", { name: unsaved })).toBeVisible();
    await expect(page.getByTestId("draft-preview-incomplete-en")).toContainText("English incomplet — lipsește:");
    await expect(page.getByTestId("draft-preview-incomplete-en")).toContainText("Titlu și rezumat › English › Rezumat");

    // The page: the same title as its heading. No new request needed to switch.
    await page.getByTestId("draft-preview-view-page").click();
    await expect(ro.getByTestId("draft-preview-page").getByRole("heading", { level: 1, name: unsaved })).toBeVisible();

    // English: its own frame, the English words of the page.
    await page.getByTestId("draft-preview-locale-en").click();
    const en = page.frameLocator('[data-testid="draft-preview-frame-en"]');
    await expect(en.getByTestId("draft-preview-page").getByRole("heading", { level: 1 })).toBeVisible();
    await expect(en.getByText("Back to events")).toBeVisible();

    /*
      «Formular» (amending §579; the owner, 2026-09-30 17:10: «adică preview card și pagină ȘI
      formular de înscriere»): the register page's form from the same press, with its glyph. This
      group run takes no registration on the site, so the frame says it has no form — and there is
      no form, no action and no Turnstile to load. The boxes of a race's form are proved in
      `tests/unit/content/event-draft-form.test.ts` and `tests/integration/cms/event-draft-preview.test.ts`.
    */
    const formTab = page.getByTestId("draft-preview-view-form");
    await expect(formTab).toContainText("Formular");
    await expect(formTab.locator("svg")).toBeVisible();
    await formTab.click();
    await expect(en.getByTestId("draft-preview-form-none")).toHaveText("Preview: this event takes no registrations on the site, so it has no form.");
    await expect(en.locator("#registration-form")).toHaveCount(0);
    await expect(en.locator('script[src*="challenges.cloudflare.com"]')).toHaveCount(0);
    await page.getByTestId("draft-preview-view-page").click();

    // A phone's 360 pixels, then a desktop's width, scaled to fit the card.
    const frame = page.getByTestId("draft-preview-frame-en");
    expect(await frame.evaluate((node) => (node as HTMLIFrameElement).clientWidth)).toBe(360);
    await page.getByTestId("draft-preview-width-desktop").click();
    expect(await frame.evaluate((node) => (node as HTMLIFrameElement).clientWidth)).toBe(1280);

    // Nothing was saved: the editor, read again, still carries the saved title.
    // (A second tab: this one holds unsaved boxes, and leaving it would be asked about.)
    const fresh = await page.context().newPage();
    await fresh.goto(editorUrl);
    await expect(fresh.getByTestId("editor-heading")).toHaveText(heading);
    await fresh.close();
  });

  test("the grouped cards: «Când și unde», «Participare, înscrieri și regulament» with the start list last in it, no film card", async ({ page }) => {
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
    // What were cards 6 and 9, one card since §760: the registration's life, what a participant
    // agrees to, the day, the public list last (§512) — each a card of its own inside it.
    const cards = await page.locator("#box-registration details[id^='box-']").evaluateAll((nodes) => nodes.map((node) => node.id));
    const inside = ["box-registration-window", "box-confirmation", "box-reminder", "box-rules", "box-declaration", "box-conditions", "box-schedule", "box-kit", "box-bibs", "box-start-list"];
    expect(cards.filter((id) => inside.includes(id))).toEqual(inside);
    await expect(page.locator("#box-programme")).toHaveCount(0);
    await expect(page.locator("#box-rules #box-declaration")).toHaveCount(0);
    await expect(page.locator("#box-declaration #box-start-list")).toHaveCount(0);
    await expect(page.getByTestId("declaration-moved")).toHaveCount(0);
    // No card of its own any more: no number, no chip.
    await expect(page.getByRole("heading", { name: /^\d+ · Lista publică/ })).toHaveCount(0);
    await expect(page.getByTestId("section-map").locator('[data-section="startList"]')).toHaveCount(0);
    // The status (§448), the cost (§466) and the promotion (§760) are cards inside the first box; the
    // page's address and the cover inside «Titlu și rezumat» (§760).
    await expect(page.locator("#box-kind #box-status")).toHaveCount(1);
    await expect(page.locator("#box-kind #box-cost")).toHaveCount(1);
    await expect(page.locator("#box-kind #box-promotion")).toHaveCount(1);
    await expect(page.locator("#box-title #box-address")).toHaveCount(1);
    await expect(page.locator("#box-title #box-cover")).toHaveCount(1);
  });

  /*
    §NNN, amending §757 and §760 — the owner, with a screenshot of the editor on production: «Partea cu
    „Puncte de control” ar trebui să fie băgată în cardul cu traseu (nested)». §760 drew the card above
    card 1, and this test then measured exactly that — so it passed while the owner saw it at the top.
    Now it measures what he asked: the card inside «Traseul» in the document AND on the screen (its box
    within «Traseul»'s, below card 1 and the route's fields), at this project's width (320 and 1280),
    its two forms beside the save form and never in it; neither save posts the other's boxes.
    «Voluntari» (§754) is with the registrations, below the grid.
  */
  test("«Puncte de control» inside «Traseul», in the document and on the screen; «Voluntari» below the grid", async ({ page }) => {
    test.skip(!editorUrl, "the create step did not run");
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await hydrated(page);

    // The document: a descendant of «Traseul», and so of the save form; its two forms are not.
    await expect(page.locator("#box-course #box-checkpoints")).toHaveCount(1);
    await expect(page.locator("#event-save-form #box-course #box-checkpoints")).toHaveCount(1);
    for (const form of ["checkpoints-form", "checkpoints-gpx-form"]) {
      await expect(page.locator(`form#${form}`)).toBeAttached();
      await expect(page.locator(`#event-save-form #${form}`)).toHaveCount(0);
    }
    await expect(page.locator("form form")).toHaveCount(0);
    // Between card 1 and card 6 in the document — what the tab key and a screen reader meet.
    const order = await page.evaluate(() => {
      const card = document.getElementById("box-checkpoints")!;
      const follows = (id: string) => Boolean(card.compareDocumentPosition(document.getElementById(id)!) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { kindBefore: !follows("box-kind"), registrationAfter: follows("box-registration") };
    });
    expect(order).toEqual({ kindBefore: true, registrationAfter: true });
    // A named card of «Traseul»: a level-3 heading, closed on arrival like every fold.
    await expect(page.locator("#box-checkpoints > summary h3")).toHaveCount(1);
    await expect(page.locator("#box-checkpoints")).not.toHaveAttribute("open", "");

    // The screen: opened the way a person does, its box inside «Traseul»'s box, under the route's fields and under card 1.
    const course = await openEditorBox(page, "Traseul");
    const card = await openEditorBox(page, "Puncte de control");
    const courseBox = (await course.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    const kindBox = (await page.locator("#box-kind").boundingBox())!;
    const strava = (await page.locator('[name="event.routeStrava"]').boundingBox())!;
    expect(cardBox.y).toBeGreaterThan(kindBox.y + kindBox.height);
    expect(cardBox.y).toBeGreaterThan(strava.y + strava.height);
    expect(cardBox.y).toBeGreaterThanOrEqual(courseBox.y);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(courseBox.y + courseBox.height + 0.5);
    expect(cardBox.x).toBeGreaterThanOrEqual(courseBox.x);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(courseBox.x + courseBox.width + 0.5);
    // No horizontal scroll at this width (320 on the phone project).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Its button, a thumb's target.
    const savePoints = card.getByRole("button", { name: "Salvează punctele" });
    expect((await savePoints.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // «Salvează» posts none of the points: a point typed in the card and the event saved — no point is kept.
    await openEditorBox(page, "Adaugă puncte");
    const spare = card.getByTestId("checkpoint-new-row").first();
    await spare.getByLabel("Kilometrul").fill("3");
    await spare.getByLabel("Numele (română)").fill("Nu se salvează cu evenimentul");
    await spare.getByLabel("Numele (engleză)").fill("Not saved with the event");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
    await hydrated(page);
    await expect(page.getByTestId("checkpoint-card")).toHaveCount(0);

    // «Salvează punctele» posts none of the event: a distance typed in «Traseul» and the points saved —
    // the point is kept, the distance is not.
    await openEditorBox(page, "Traseul");
    await page.locator('[name="event.distanceMeters"]').fill("4321");
    const cardAgain = await openEditorBox(page, "Puncte de control");
    await openEditorBox(page, "Adaugă puncte");
    const row = cardAgain.getByTestId("checkpoint-new-row").first();
    await row.getByLabel("Kilometrul").fill("2");
    await row.getByLabel("Numele (română)").fill("Izvorul");
    await row.getByLabel("Numele (engleză)").fill("The spring");
    await cardAgain.getByRole("button", { name: "Salvează punctele" }).click();
    await expect(page.getByTestId("toast-live")).toContainText("Punctele de control au fost salvate.", { timeout: 20_000 });
    await page.goto(editorUrl);
    await hydrated(page);
    await expect(page.getByTestId("checkpoint-card")).toHaveCount(1);
    await expect(page.locator('[name="event.distanceMeters"]')).toHaveValue("");

    // «Voluntari» under the save, with the registrations' operations, outside the save form.
    const save = (await page.locator("#box-save").boundingBox())!;
    const volunteers = (await page.locator("#box-volunteers").boundingBox())!;
    expect(volunteers.y).toBeGreaterThan(save.y + save.height);
    await expect(page.locator("#event-save-form #box-volunteers")).toHaveCount(0);
  });
});

/*
  §554 — «Kit de participare» in card 6 «Participare, înscrieri și regulament» (§760): a fold of its own, closed, its
  line saying «Tricou: nu» until the box is ticked, and only for a type that takes registrations
  with registration on the site — a group run takes none (§111).
*/
test.describe("§554 the race kit card", () => {
  test("hidden on a group run, shown closed with «Tricou: nu» for a race registering on the site", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const kit = page.locator("#box-kit");

    // A new event is a group run: no registration here, and no kit card to see.
    await openEditorBox(page, "Participare, înscrieri și regulament");
    await expect(kit).toBeHidden();

    await page.getByRole("combobox", { name: /Tip eveniment/ }).click();
    await page.getByRole("option", { name: "Concurs" }).click();
    await page.getByRole("combobox", { name: "Modul de înscriere" }).click();
    await page.getByRole("option", { name: "Înscrieri pe site" }).click();

    await expect(kit).toBeVisible();
    await expect(kit).not.toHaveAttribute("open", "");
    await expect(kit.locator(":scope > summary")).toContainText("Kit de participare");
    await expect(kit.locator(":scope > summary")).toContainText("Tricou: nu");
    // A glyph before the heading, like every fold (§521). By its element: a production build drops
    // MUI's `data-testid` on icons (the unit test `kit-card.test.ts` names the glyph).
    await expect(kit.locator(":scope > summary svg").first()).toBeVisible();

    const box = await openEditorBox(page, "Kit de participare");
    const shirt = box.locator('[name="event.kitShirt"]');
    await expect(shirt).not.toBeChecked();
    await expect(box).toContainText("Dacă e bifat, formularul cere mărimea tricoului.");
    await expect(box.locator('input[type="hidden"][name="event.kitShirt.present"]')).toHaveValue("1");
    await shirt.check();
    await expect(shirt).toBeChecked();
  });
});

/*
  §557 — «Condiții de participare» inside «Participare, înscrieri și regulament» (§760; the owner, 2026-09-29:
  «e mai bine să avem o bifă în backoffice la Condiții de participare»): a closed fold whose line says
  «Informații medicale: nu» until the box is ticked, on a saved event registering on the site; the tick only for a type that registers on the
  site, a group run getting a sentence in its place (§111).
*/
test.describe("§557 the participation conditions card", () => {
  test("a sentence on a group run, the tick closed and unticked for a race registering on the site", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const conditions = page.locator("#box-conditions");

    // A new event is a group run: the card says there is no form to ask it on.
    await openEditorBox(page, "Condiții de participare");
    await expect(page.getByTestId("conditions-not-registering")).toBeVisible();
    await expect(conditions.locator('[name="event.askHealthNote"]')).toBeHidden();
    // Nor does its line name the note, as the outer card's does not: the line is drawn from the saved type.
    await expect(conditions.locator(":scope > summary")).not.toContainText("Informații medicale");

    await openEditorBox(page, "Participare, înscrieri și regulament");
    await page.getByRole("combobox", { name: /Tip eveniment/ }).click();
    await page.getByRole("option", { name: "Concurs" }).click();
    await page.getByRole("combobox", { name: "Modul de înscriere" }).click();
    await page.getByRole("option", { name: "Înscrieri pe site" }).click();

    await expect(conditions.locator(":scope > summary")).toContainText("Condiții de participare");
    // A glyph before the heading, like every fold (§521); by its element, as the kit card's.
    await expect(conditions.locator(":scope > summary svg").first()).toBeVisible();

    const box = await openEditorBox(page, "Condiții de participare");
    const tick = box.locator('[name="event.askHealthNote"]');
    await expect(tick).toBeVisible();
    await expect(tick).not.toBeChecked();
    await expect(box).toContainText("Dacă e bifat, formularul cere informații medicale (afecțiuni, alergii, medicație); se șterg la 7 zile după eveniment.");
    await expect(box.locator('input[type="hidden"][name="event.askHealthNote.present"]')).toHaveValue("1");
    await tick.check();
    await expect(tick).toBeChecked();
  });
});
