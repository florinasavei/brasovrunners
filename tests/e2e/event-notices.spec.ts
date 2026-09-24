import { expect, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languageTab, openEditorBox } from "./support/fold";

/**
 * `DECISIONS.md` §331 — "Anunță participanții despre schimbare", end to end. An organizer makes a
 * race of their own (the featured one is shared by every spec, and its place is read by others),
 * a walk-in is entered at the desk so somebody is registered, and then:
 *
 *   - the box beside the save button says how many people it would reach, before the press;
 *   - ticked, a new meeting point and a note are saved, and the banner says how many emails
 *     were queued;
 *   - choosing "Anulat" asks for the reason and "tell them" (ticked), and the banner says the
 *     event is cancelled and how many were told.
 *
 * Bilingual everywhere (§NNN): the note and the reason are two boxes, Română and English; a note in
 * one language only is refused on the English box with everything else kept, and the same words
 * typed in both boxes get the amber "is it translated?" line.
 *
 * Each Playwright project makes its own event, named by the project, so the two never share a
 * count.
 */
test.describe("§331 the participants hear about a change when the organizer asks", () => {
  test("the box shows the count, the save reports what it queued, and a cancellation asks why", async ({ page }) => {
    test.setTimeout(150_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

    await signIn(page, "Dev Administrator");

    // A race that takes registrations here, ten days off.
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    await page.getByRole("combobox", { name: "Tip eveniment" }).click();
    await page.getByRole("option", { name: "Concurs" }).click();
    await fillDateField(page, "Începutul evenimentului", day);
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill(`Parcul Tractorul ${suffix}`);
    // Everything about registration is one box, and the declaration is in its own card (§350).
    await openEditorBox(page, "Participare și înscrieri");
    await page.getByRole("combobox", { name: "Modul de înscriere" }).click();
    await page.getByRole("option", { name: "Înscrieri pe site" }).click();
    await field("event.capacity").fill("10");
    await openEditorBox(page, "Condiții de participare și declarația");
    await page.getByRole("combobox", { name: "Declarația pe care o semnează participantul" }).click();
    await page.getByRole("option").nth(1).click();
    await field("translations.ro.title").fill(`Cursa anunțată ${suffix}`);
    await field("translations.ro.slug").fill(`cursa-anuntata-${suffix}`);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Announced race ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`announced-race-${suffix}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const editor = new URL(page.url()).pathname;
    const eventId = editor.split("/").at(-1) as string;
    await hydrated(page);

    // Nobody registered yet: the box says it would send nothing.
    await expect(page.getByTestId("notice-count")).toContainText("Nu e nimeni înscris acum");

    // A walk-in at the desk: confirmed on the spot, a real registration.
    await page.goto(`/ro/admin/registrations/new?eventId=${eventId}&back=desk`);
    await hydrated(page);
    await expect(page.getByRole("checkbox", { name: /Persoana este la masă/ })).toBeChecked();
    await field("firstName").fill("Anunțat");
    await field("lastName").fill(suffix);
    await field("email").fill(`notice-${suffix}@test.invalid`);
    await page.getByRole("checkbox", { name: /a cerut/ }).check();
    await page.getByRole("button", { name: "Adaugă înscrierea" }).click();
    await expect(page.locator("#admin-alert")).toContainText("Persoana a fost adăugată", { timeout: 30_000 });

    // Back in the editor: one participant, said before the press, with the allowance.
    await page.goto(editor);
    await hydrated(page);
    const count = page.getByTestId("notice-count");
    await expect(count).toContainText("Participanți care ar primi emailul „Detalii actualizate”: 1");
    await expect(count).toContainText("cota Mailgun");

    // The box is unticked on every load, and the note appears only once it is ticked.
    const notify = page.getByRole("checkbox", { name: "Anunță participanții despre schimbare" });
    await expect(notify).not.toBeChecked();
    // A thumb's target (BR-REQ-041-01 criterion 6): MUI's input covers the whole padded box.
    const box = await notify.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(field("notice.noteRo")).toBeHidden();
    await notify.check();
    await expect(field("notice.noteRo")).toBeVisible();
    await expect(field("notice.noteEn")).toBeVisible();

    // A new meeting point, in the Locul box — amber now, with the one registration on its chip.
    const place = await openEditorBox(page, "Locul");
    await expect(place.getByTestId("risk-line")).toContainText("Înscrieri: 1");
    await field("event.locationName").fill(`Poiana Brașov ${suffix}`);
    // The same words in both boxes: the amber line, before anything is saved.
    await field("notice.noteRo").fill("Ne mutăm la Poiana: drumul spre Tractorul e închis.");
    await field("notice.noteEn").fill("Ne mutăm la Poiana: drumul spre Tractorul e închis.");
    await expect(page.getByTestId("notice-note-identical")).toBeVisible();
    // Romanian only: refused on the English box, the rest of the form kept (§315).
    await field("notice.noteEn").fill("");
    await expect(page.getByTestId("notice-note-identical")).toHaveCount(0);
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toContainText("Ce s-a schimbat (English)", { timeout: 30_000 });
    await expect(field("event.locationName")).toHaveValue(`Poiana Brașov ${suffix}`);
    await expect(field("notice.noteRo")).toHaveValue("Ne mutăm la Poiana: drumul spre Tractorul e închis.");
    await field("notice.noteEn").fill("We move to Poiana: the road to Tractorul is closed.");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.getByTestId("notice-outcome")).toContainText("Emailuri „Detalii actualizate” puse la coadă: 1", { timeout: 30_000 });
    await hydrated(page);
    // And the box is unticked again: the next save emails nobody unless asked.
    await expect(page.getByRole("checkbox", { name: "Anunță participanții despre schimbare" })).not.toBeChecked();

    // Cancelling: the reason and "tell them", ticked, appear with the status, in its box.
    await openEditorBox(page, "Starea evenimentului");
    await page.getByRole("combobox", { name: "Starea evenimentului" }).click();
    await page.getByRole("option", { name: "Anulat" }).click();
    const cancel = page.getByTestId("cancel-fields");
    await expect(cancel).toBeVisible();
    await expect(cancel.getByRole("checkbox", { name: "Anunță participanții că evenimentul a fost anulat" })).toBeChecked();
    await expect(page.getByTestId("cancel-count")).toContainText("„Eveniment anulat”: 1");
    // The update box is gone while the status says "Anulat".
    await expect(page.getByTestId("notice-fields")).toHaveCount(0);
    // Why, in both languages: each registrant reads it in theirs (§NNN).
    await field("cancel.reasonRo").fill("Avertizare meteo de cod portocaliu: traseul nu este sigur.");
    await field("cancel.reasonEn").fill("An orange weather warning: the route is not safe.");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.getByTestId("notice-outcome")).toContainText("Evenimentul a fost anulat. Emailuri „Eveniment anulat” puse la coadă: 1.", {
      timeout: 30_000,
    });
    await hydrated(page);
    // Cancelled already: no reason asked again, and no box.
    await expect(page.getByTestId("cancel-fields")).toHaveCount(0);
    await expect(page.getByTestId("notice-fields")).toHaveCount(0);
  });
});
