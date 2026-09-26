import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { editorBox, languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * §NNN, BR-REQ-037-07, BR-REQ-038-01 — spare bibs for on-the-spot entries, end to end.
 *
 * An organizer sets a race's spare numbers (900–902) on the create page; the editor's bib card
 * names them, the printing card offers the blank sheet and says how many are free, and the sheet
 * downloads. At the desk, the walk-in form suggests 900; the walk-in is confirmed wearing it, and
 * the next walk-in is offered 901.
 *
 * It creates its **own** race — a draft, never published, so no other spec sees it on the site —
 * as `confirmation-window-zero.spec.ts` does; each Playwright project makes its own, so their
 * spares never meet.
 */
test.describe("§NNN the desk's spare bibs", () => {
  test("the band is set on the event, printed blank, and handed to a walk-in at the desk", async ({ page }) => {
    test.setTimeout(150_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);
    // Inside the desk's month, so the desk lists it.
    const day = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10);

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    await page.getByRole("combobox", { name: "Tip eveniment" }).click();
    await page.getByRole("option", { name: "Concurs" }).click();
    await fillDateField(page, "Începutul evenimentului", day);
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill(`Parcul Noua ${suffix}`);
    await field("event.locationNameEn").fill(`Noua Park ${suffix}`);
    await openEditorBox(page, "Participare și înscrieri");
    await page.getByRole("combobox", { name: "Modul de înscriere" }).click();
    await page.getByRole("option", { name: "Înscrieri pe site" }).click();
    await field("event.capacity").fill("20");
    await openEditorBox(page, "Condiții de participare și declarația");
    await page.getByRole("combobox", { name: "Declarația pe care o semnează participantul" }).click();
    await page.getByRole("option").nth(1).click();

    // The spares, in the race numbers' card.
    const bibs = await openEditorBox(page, "Numere de concurs (BIB)");
    const from = bibs.getByRole("spinbutton", { name: "Numere de rezervă, la fața locului — de la" });
    const to = bibs.getByRole("spinbutton", { name: "Numere de rezervă — până la" });
    // A thumb's target (BR-REQ-041-01 criterion 6).
    expect((await from.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await from.fill("900");
    await to.fill("902");
    await expect(bibs.getByText(/Platforma nu le dă niciodată celor înscriși online/)).toBeVisible();

    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    await field("translations.ro.title").fill(`Crosul cu rezerve ${suffix}`);
    await field("translations.ro.slug").fill(`crosul-cu-rezerve-${suffix}`);
    await excerpt("ro", "Cursă cu numere de rezervă la masă.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Spares race ${suffix}`);
    await excerpt("en", "A race with spare numbers at the desk.");
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`spares-race-${suffix}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const eventId = (/\/admin\/events\/([0-9a-f-]{36})/.exec(page.url()) as RegExpExecArray)[1];
    await hydrated(page);

    // The card's closed line names the band; the printing card offers the blank sheet.
    await expect(editorBox(page, "Numere de concurs (BIB)").locator(":scope > summary")).toContainText("rezervă 900–902");
    const printing = await openEditorBox(page, "Alocare și tipărire");
    const spares = printing.getByTestId("bib-spares");
    await expect(spares).toContainText("Numere de rezervă 900–902: libere încă 3 din 3.");
    await expect(spares.getByRole("button", { name: "Numerele de rezervă, fără nume (PDF)" })).toBeVisible();
    const sheet = await page.request.get(`/api/admin/events/${eventId}/bibs?locale=ro&spares=1`);
    expect(sheet.status()).toBe(200);
    expect(sheet.headers()["content-type"]).toBe("application/pdf");
    expect(sheet.headers()["content-disposition"]).toContain("-spares");

    // The desk: a walk-in, with the next spare suggested.
    const walkIn = async (name: string, expected: string) => {
      await page.goto(`/ro/admin/registrations/new?eventId=${eventId}&back=desk`);
      await hydrated(page);
      const handed = page.getByRole("spinbutton", { name: "Numărul dat acum" });
      await expect(handed).toHaveValue(expected);
      await page.locator('[name="firstName"]').fill(name);
      await page.locator('[name="lastName"]').fill(suffix);
      await page.locator('[name="email"]').fill(`${name.toLowerCase()}-${suffix}@test.invalid`);
      await page.getByRole("checkbox", { name: /a cerut/ }).check();
      await page.getByRole("button", { name: "Adaugă înscrierea" }).click();
      await confirmDialog(page);
      await expect(page).toHaveURL(/\/ro\/admin\/checkin\?.*eventId=/);
      await expect(page.locator("#admin-alert")).toContainText("Persoana a fost adăugată", { timeout: 15_000 });
    };

    await walkIn("Ana", "900");
    await hydrated(page);
    await page.getByRole("textbox", { name: "Nume, număr sau cod" }).fill(`Ana ${suffix}`);
    await page.getByRole("button", { name: "Caută" }).click();
    await hydrated(page);
    const row = page.getByTestId("desk-row").filter({ hasText: suffix });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Confirmată", { exact: true })).toBeVisible();
    await expect(row.locator("span").filter({ hasText: /^900$/ })).toHaveCount(1);

    // The next walk-in is offered the next spare.
    await walkIn("Maria", "901");

    // And the printing card counts what is left.
    await page.goto(`/ro/admin/events/${eventId}`);
    await hydrated(page);
    const after = await openEditorBox(page, "Alocare și tipărire");
    await expect(after.getByTestId("bib-spares")).toContainText("libere încă 1 din 3");
  });
});
