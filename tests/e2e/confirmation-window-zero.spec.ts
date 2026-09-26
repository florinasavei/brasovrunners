import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { editorBox, languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-050-02 (`DECISIONS.md` §407, amending §104) — the confirmation window's deadline may be
 * zero, "until the start", and the card says when a runner can confirm. The owner, 2026-09-25:
 * "fereastra de confirmare trebuie să fie 0 la final, să nu expire — nu e clar când pot confirma".
 *
 * It creates its **own** race, as `event-notices.spec.ts` does — a draft, never published, so no
 * other spec sees it — with the deadline typed as 0 on the create page, and reads the card's
 * closed line, its dates line and its help on the editor; then switches the window off (the first
 * number 0) and reads the sentence for that.
 */
test.describe("BR-REQ-050-02 a confirmation deadline of zero is «la start»", () => {
  test("the card says «termen la start», when the runner can confirm, and «fără fereastră» at 0 and 0", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);
    // Forty days off: the window (seven days before) is still ahead.
    const day = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);

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
    // The declaration is chosen under «Regulamentul» since §448.
    await openEditorBox(page, "Declarația pe propria răspundere");
    await page.getByRole("combobox", { name: "Declarația pe care o semnează participantul" }).click();
    await page.getByRole("option").nth(1).click();

    // The card on the create page: the label says what 0 means, the help when a runner confirms.
    const card = await openEditorBox(page, "Fereastra de confirmare");
    const due = card.getByRole("spinbutton", { name: /cu câte zile înainte expiră \(0 = la start\)/ });
    await expect(due).toBeVisible();
    // A thumb's target (BR-REQ-041-01 criterion 6).
    expect((await due.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await due.fill("0");
    const help = card.getByText(/^Alergătorul confirmă semnând declarația, oricând după ce și-a confirmat emailul/);
    await expect(help).toBeVisible();
    await expect(help).toContainText("după termen, locul trece la următorul doar dacă așteaptă cineva");
    await expect(help).toContainText("Cu 0 la termen, locul nu expiră înainte de start");
    await expect(help).toContainText("are 30 de minute să semneze");

    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };

    await field("translations.ro.title").fill(`Crosul la start ${suffix}`);
    await field("translations.ro.slug").fill(`crosul-la-start-${suffix}`);
    await excerpt("ro", "Cursă gratuită, cu fereastra de confirmare la start.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Cross until the start ${suffix}`);
    await excerpt("en", "A free race, with the confirmation window at the start.");
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`cross-until-the-start-${suffix}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const editorUrl = page.url();
    await hydrated(page);

    // The editor: the closed line and the dates line both say «la start», never «cu 0 zile».
    await expect(editorBox(page, "Fereastra de confirmare").locator(":scope > summary")).toContainText("Cerută cu 7 zile înainte, termen la start");
    const saved = await openEditorBox(page, "Fereastra de confirmare");
    await expect(saved.getByRole("spinbutton", { name: /cu câte zile înainte expiră/ })).toHaveValue("0");
    const dates = saved.getByTestId("confirmation-dates");
    await expect(dates).toContainText(/cerută din .+, termen la start — locul nu expiră înainte de start\.$/);
    await expect(dates).not.toContainText("0 zile");

    // Published, the folded steps on the public page must answer «când pot confirma» without
    // reading like the reminder email is the deadline: «până la start», never «până atunci».
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await expect(page.getByText("În verificare", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();

    const roSlug = `crosul-la-start-${suffix}`;
    const enSlug = `cross-until-the-start-${suffix}`;
    await page.goto(`/ro/evenimente/${roSlug}`);
    await page.locator("summary").filter({ hasText: "Cum funcționează înscrierea" }).click();
    const roSteps = page.getByText(/poți semna declarația pe proprie răspundere de acum/);
    await expect(roSteps).toBeVisible();
    await expect(roSteps).toContainText("oricând până la start");
    await expect(roSteps).not.toContainText("până atunci");

    await page.goto(`/en/events/${enSlug}`);
    await page.locator("summary").filter({ hasText: "How registration works" }).click();
    const enSteps = page.getByText(/you can sign the declaration of own responsibility from now/);
    await expect(enSteps).toBeVisible();
    await expect(enSteps).toContainText("any time until the start");
    await expect(enSteps).not.toContainText("until then");

    // Back to the editor for the last case: 0 and 0 is the weekly run's rule, no window.
    await page.goto(editorUrl);
    await hydrated(page);
    await openEditorBox(page, "Fereastra de confirmare");
    const reopened = editorBox(page, "Fereastra de confirmare");

    // 0 and 0 is the weekly run's rule: no window, and the card says so rather than two dates.
    await reopened.getByRole("spinbutton", { name: /cu câte zile înainte se cere/ }).fill("0");
    // Live now (published above): saving a change to published content asks for the
    // acknowledgement checkbox first.
    await page.getByRole("checkbox", { name: "Am înțeles că modific conținut publicat." }).check();
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
    await hydrated(page);
    await expect(editorBox(page, "Fereastra de confirmare").locator(":scope > summary")).toContainText("Fără fereastră — semnătura se cere la înscriere");
    const off = await openEditorBox(page, "Fereastra de confirmare");
    await expect(off.getByTestId("confirmation-dates")).toHaveText("Fără fereastră: semnătura se cere la înscriere (30 de minute), ca la antrenamentele săptămânale.");
  });
});
