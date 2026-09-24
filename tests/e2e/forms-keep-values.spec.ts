import { expect, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";

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
    await panel.getByLabel(/Adresă de email/).fill("amalia@club");
    await panel.getByLabel(/^Nume/).fill("Amalia Probă");
    await panel.getByRole("button", { name: "Adaugă" }).click();

    const refusal = panel.getByTestId("form-refusal");
    await expect(refusal).toBeVisible();
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
    await field("translations.ro.title").fill(`Versiune ${suffix}`);
    await field("translations.ro.slug").fill(`versiune-${suffix}`);
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`Version ${suffix}`);
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
    await field("event.locationName").fill("Colegul a scris asta");
    await page.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page).toHaveURL(/saved=event/);

    // The stale press is refused, and what was typed is still in its box.
    const box = stale.locator('[name="event.locationName"]');
    const save = stale.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true });
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
