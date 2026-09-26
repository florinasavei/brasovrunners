import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { editorBox, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * `DECISIONS.md` §315 on a small form — adding a colleague.
 *
 * The event form is the owner's report and `cms-publish.spec.ts` walks it; this is the same
 * promise on the smallest form that has it: a refusal the browser could not see coming keeps
 * every box, and names the one that was wrong. "amalia@club" is an address to the browser — the
 * HTML rule takes a domain without a dot — and not to the service, whose rule wants one; so the
 * browser lets the press through and the server refuses it, which is the path this is about.
 * Nothing is written by a refused add, so the spec can run as often as it likes.
 */
test.describe("§315 a refused form keeps what was typed", () => {
  test("adding a colleague with an address the server refuses keeps the name and the address", async ({ page }) => {
    // The team is the Superadministrator's (`canManageStaff`).
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin/staff");
    await hydrated(page);

    const panel = page.getByTestId("staff-invite");
    // A fold, closed on arrival like every backoffice fold (§336); opened the way a person does.
    await openFold(panel);
    await panel.getByLabel(/Adresă de email/).fill("amalia@club");
    await panel.getByLabel(/^Nume/).fill("Amalia Probă");
    await panel.getByRole("button", { name: "Adaugă" }).click();
    await confirmDialog(page);

    const refusal = panel.getByTestId("form-refusal");
    await expect(refusal).toBeVisible();
    // In the fold it was pressed in, which is still open: nothing re-rendered it (§336).
    await expect(panel).toHaveAttribute("open", "");
    // The summary names the box and links to it (§47); the box says so where it is.
    await expect(refusal.getByRole("link", { name: "Adresă de email" })).toHaveAttribute("href", "#field-email");
    await expect(panel.getByText("Verifică acest câmp.")).toBeVisible();
    await expect(panel.getByLabel(/Adresă de email/)).toHaveValue("amalia@club");
    await expect(panel.getByLabel(/^Nume/)).toHaveValue("Amalia Probă");
    // Nothing of what was typed went into the address bar.
    expect(page.url()).not.toContain("amalia");
  });
});

/*
  With JavaScript off (§315), which until now was checked only by hand — and the version guard
  (§36), the hole the review found there.

  `useActionState` is what makes a kept form work without a script: on a plain POST the server
  runs the action and renders the page with the returned state, so the summary and the kept
  values are in the HTML itself. The event editor is where this is walked, because it renders
  whole without a script; the team page streams behind its `loading.tsx`, and a browser without
  JavaScript never swaps the streamed page in for the "Se încarcă…" placeholder (a limit of that
  route, not of its form).

  A refused POST without JavaScript renders the editor again **from the database**, while every
  box is recalled from the press. If the save's hidden version were re-read too, a CONFLICT would
  leave the boxes holding edits made against version N under a hidden field now saying N+1, and
  the second press would overwrite the colleague's save without a word. The version is recalled
  with the boxes (`RecallHidden`), so the second press is refused exactly like the first.

  The event is made with JavaScript on (the English tab needs it), and the scriptless browser is a
  second context with the same session — the colleague is the first one.
*/
test.describe("§315 a stale save stays refused with JavaScript off", () => {
  test("the second press after a CONFLICT is refused too, and the colleague's save stands", async ({ page, browser }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);
    await fillDateField(page, "Începutul evenimentului", "2027-06-06");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Noua");
    await field("event.locationNameEn").fill("Parcul Noua");
    await field("translations.ro.title").fill(`Versiune ${suffix}`);
    await field("translations.ro.slug").fill(`versiune-${suffix}`);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Version ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`version-${suffix}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    const editor = new URL(page.url()).pathname;

    // The scriptless browser opens the editor first: its hidden version is the one just made.
    const { baseURL, viewport } = test.info().project.use;
    const scriptless = await browser.newContext({
      baseURL,
      viewport,
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    });
    const stale = await scriptless.newPage();
    await stale.goto(editor);

    // The colleague saves in the meantime.
    await page.goto(editor);
    await hydrated(page);
    await openEditorBox(page, "Locul");
    await field("event.locationName").fill("Colegul a scris asta");
    await page.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page).toHaveURL(/saved=event/);

    // The stale press is refused, and what was typed is still in its box.
    const box = stale.locator('[name="event.locationName"]');
    const save = stale.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true });
    // A `<details>` opens without JavaScript: the Locul box, the way a person opens it.
    await openFold(editorBox(stale, "Locul"));
    await box.fill("Eu am scris asta");
    let posted = stale.waitForResponse((response) => response.request().method() === "POST");
    await save.click();
    await posted;
    await expect(stale.getByTestId("form-refusal")).toContainText("Altcineva a salvat între timp");
    await expect(box).toHaveValue("Eu am scris asta");

    // And pressed again, it is refused again: the hidden version travelled with the boxes.
    posted = stale.waitForResponse((response) => response.request().method() === "POST");
    await save.click();
    await posted;
    await expect(stale.getByTestId("form-refusal")).toContainText("Altcineva a salvat între timp");
    expect(stale.url()).not.toContain("saved=");

    await page.reload();
    await expect(field("event.locationName")).toHaveValue("Colegul a scris asta");
    await scriptless.close();
  });
});

/*
  §315 and the editor's boxes (§350): a refusal whose field sits in a card three folds deep. An
  internal registration needs an approved declaration — a rule only the server can judge (the
  select has no `required`: the mode decides) — and the declaration is in "Regulamentul" ›
  "Declarația pe propria răspundere" since §NNN, both shut on arrival. The refusal must open both,
  name the card in its summary, and keep everything typed.
*/
test.describe("§315 a refusal inside a closed card opens it", () => {
  test("an internal registration with no declaration comes back with its card open and every box kept", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await page.getByRole("combobox", { name: /Tip eveniment/ }).click();
    await page.getByRole("option", { name: "Concurs" }).click();
    await fillDateField(page, "Începutul evenimentului", "2027-06-20");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Noua");
    await field("event.locationNameEn").fill("Parcul Noua");
    await field("translations.ro.title").fill(`Fără declarație ${suffix}`);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`No declaration ${suffix}`);
    // The addresses fill themselves from the titles (`SlugFromTitle`).
    await expect(field("translations.en.slug")).toHaveValue(`no-declaration-${suffix}`);

    const registration = await openEditorBox(page, "Participare și înscrieri");
    await page.getByRole("combobox", { name: "Modul de înscriere" }).click();
    await page.getByRole("option", { name: "Înscrieri pe site" }).click();
    await field("event.capacity").fill("40");
    // Folded again, so the refusal is what has to open it.
    await registration.locator(":scope > summary").press("Enter");
    await expect(registration).not.toHaveAttribute("open", "");

    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal.getByRole("link", { name: "Regulamentul › Declarația pe propria răspundere › Declarația pe care o semnează participantul" })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/events\/new$/);
    await expect(editorBox(page, "Regulamentul")).toHaveAttribute("open", "");
    await expect(editorBox(page, "Declarația pe propria răspundere")).toHaveAttribute("open", "");
    await expect(field("event.capacity")).toHaveValue("40");
    await expect(field("event.registrationMode")).toHaveValue("INTERNAL");
    await expect(field("translations.ro.title")).toHaveValue(`Fără declarație ${suffix}`);
    await expect(field("translations.ro.slug")).toHaveValue(`fara-declaratie-${suffix}`);
  });
});

/*
  §406: the course and the links are boxes of their own again (§358 had them inside "Ce fel de
  eveniment"), each where the page draws it; the status is a card inside the first box (§NNN). A link's label in one language only is a
  refusal only the server makes (§352, both or neither), and it names the empty box — inside
  "Linkuri și fișiere". The box is shut before the press, so the refusal is what has to open it,
  and every box keeps what was typed. On the way, the create page's status card: the editor's own
  select, at "Programat" (§NNN).
*/
test.describe("§406 a refusal inside the links box opens it", () => {
  // Built from parts: no hostname literal (`AGENTS.md` §8).
  const GPX_LINK = ["https:/", "drive.example.test", "file", "d", "e2e-half-label", "view"].join("/");

  test("a link label in Romanian only comes back with «Linkuri și fișiere» open", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    // The status card is on the create page too, inside the first box (§NNN), so the two pages
    // look the same — the same select, at "Programat", and no cancellation block until "Anulat".
    const status = await openEditorBox(page, "Starea evenimentului");
    await expect(editorBox(page, "Ce fel de eveniment")).toHaveAttribute("open", "");
    await expect(status.getByRole("combobox", { name: "Starea evenimentului" })).toHaveText("Programat");
    await expect(field("event.eventStatus")).toHaveValue("SCHEDULED");
    await expect(page.getByTestId("cancel-fields")).toHaveCount(0);
    await expect(status.getByTestId("status-on-create")).toContainText("Niciuna nu trimite emailuri: nimeni nu e încă înscris.");

    await fillDateField(page, "Începutul evenimentului", "2027-07-04");
    await fillTimeField(page, "Ora", "09:00");
    // The meeting point in both languages (§362): a blank English box is the browser's refusal,
    // and the one this test is about is the server's.
    await field("event.locationName").fill("Parcul Noua");
    await field("event.locationNameEn").fill("Parcul Noua");
    await field("translations.ro.title").fill(`Link pe jumătate ${suffix}`);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Half a link ${suffix}`);

    const links = await openEditorBox(page, "Linkuri și fișiere");
    // Exact: a partner's card on the same form has its own "Linkul 1 al partenerului 1" (§347).
    await page.getByRole("group", { name: "Linkul 1", exact: true }).getByRole("combobox").click();
    await page.getByRole("option", { name: "Traseul (GPX)" }).click();
    await field("event.links[0].url").fill(GPX_LINK);
    await field("event.links[0].labelRo").fill("Traseul oficial");
    // Folded again, so the refusal is what has to open it.
    await links.locator(":scope > summary").press("Enter");
    await expect(links).not.toHaveAttribute("open", "");

    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal.getByRole("link", { name: /^Linkul 1: eticheta în engleză/ })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/events\/new$/);
    await expect(links).toHaveAttribute("open", "");
    await expect(field("event.links[0].labelEn")).toBeVisible();
    await expect(field("event.links[0].labelRo")).toHaveValue("Traseul oficial");
    await expect(field("event.links[0].url")).toHaveValue(GPX_LINK);
    await expect(field("translations.ro.title")).toHaveValue(`Link pe jumătate ${suffix}`);
  });
});

/*
  §350, found by review: a box the chosen registration mode hides cannot stop the save.

  The boxes of the other modes stay in the document, hidden, so switching back finds them — and
  they keep their `pattern`. A link typed as "www.club.ro" under "Înscrieri la organizator" and
  then hidden by a switch to "Fără înscrieri" made the browser refuse the press and then fail to
  focus a box it could not show: "Creează evenimentul" did nothing and said nothing. Hidden boxes
  are read-only now, which the browser does not check, and the service ignores what the mode hides
  before its schema reads it.
*/
test.describe("§350 a wrong value in a hidden registration mode", () => {
  test("a link typed under 'la organizator', then 'Fără înscrieri', then create: the event is created", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await page.getByRole("combobox", { name: /Tip eveniment/ }).click();
    await page.getByRole("option", { name: "Concurs" }).click();
    await fillDateField(page, "Începutul evenimentului", "2027-06-27");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Noua");
    await field("event.locationNameEn").fill("Parcul Noua");
    await field("translations.ro.title").fill(`Mod ascuns ${suffix}`);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Hidden mode ${suffix}`);
    await expect(field("translations.en.slug")).toHaveValue(`hidden-mode-${suffix}`);

    await openEditorBox(page, "Participare și înscrieri");
    const mode = page.getByRole("combobox", { name: "Modul de înscriere" });
    await mode.click();
    await page.getByRole("option", { name: "Înscrieri la organizator" }).click();
    await field("event.externalRegistrationUrl").fill("www.club.ro");
    await mode.click();
    await page.getByRole("option", { name: "Fără înscrieri" }).click();
    await expect(field("event.externalRegistrationUrl")).toBeHidden();

    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("form-refusal")).toHaveCount(0);
  });
});
