import { expect, type Page, test } from "@playwright/test";
import { cancelDialog, confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languageTab, openEditorBox } from "./support/fold";

/**
 * `DECISIONS.md` §NNN — feedback and safety across the backoffice: a toast after every action
 * that worked, and a question before every one that is hard to undo or faces the site.
 *
 * On an event of this spec's own (each project makes one, named after itself, and deletes it at
 * the end, through the dialog that asks): the create lands with its toast, which goes by itself;
 * a draft save toasts and asks nothing; "send for review" toasts and asks nothing; "publish"
 * asks — the safe button has the focus, Escape leaves the event as it was, Enter confirms
 * because publishing is not destructive — and toasts; "take off the site" is destructive: Enter
 * on the focused cancel closes it and changes nothing, the backdrop cancels too, and only its red
 * button goes through. The toast never covers the primary button (measured at 320 px), has a
 * close button a thumb can hit, is not repeated by a refresh, and paints only after the action
 * answered — nothing of it runs inside the press.
 */
test.describe("§NNN toasts and confirmations", () => {
  test("a save toasts, publishing asks first, a destructive question is safe by default, a refresh repeats nothing", async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const day = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const toast = () => page.getByTestId("toast");

    await signIn(page, "Dev Administrator");

    // An event of this spec's own: a group run, nothing outward about it yet.
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    await fillDateField(page, "Începutul evenimentului", day);
    await fillTimeField(page, "Ora", "18:30");
    await field("event.locationName").fill(`Parcul Tractorul ${suffix}`);
    await field("event.locationNameEn").fill(`Tractorul Park ${suffix}`);
    await field("translations.ro.title").fill(`Alergare cu toast ${suffix}`);
    await field("translations.ro.slug").fill(`alergare-cu-toast-${suffix}`);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Toast run ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`toast-run-${suffix}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const editorUrl = page.url().split("?")[0];
    await hydrated(page);

    // The create landed with its flash: a polite status, a close button a thumb can hit, and
    // gone by itself within the six seconds the brief allows.
    await expect(toast()).toContainText("Evenimentul a fost creat, ca ciornă.");
    await expect(toast().locator('[role="status"]')).toBeVisible();
    expect((await toast().getByRole("button").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(toast()).toBeHidden({ timeout: 7_000 });

    // A draft save: no question, a toast — and it never sits over the button that produced it.
    await field("event.locationName").fill(`Poiana Brașov ${suffix}`);
    await field("event.locationNameEn").fill(`Poiana Brașov ${suffix}`);
    await page.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toast()).toContainText("Evenimentul a fost salvat.", { timeout: 30_000 });
    await hydrated(page);
    const toastBox = await toast().locator('[role="status"]').boundingBox();
    const saveBox = await page.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true }).boundingBox();
    expect(toastBox).not.toBeNull();
    expect(saveBox).not.toBeNull();
    const apart =
      (toastBox?.y ?? 0) + (toastBox?.height ?? 0) <= (saveBox?.y ?? 0) ||
      (toastBox?.y ?? 0) >= (saveBox?.y ?? 0) + (saveBox?.height ?? 0) ||
      (toastBox?.x ?? 0) + (toastBox?.width ?? 0) <= (saveBox?.x ?? 0) ||
      (toastBox?.x ?? 0) >= (saveBox?.x ?? 0) + (saveBox?.width ?? 0);
    expect(apart, "the toast covers the primary button").toBe(true);
    await toast().getByRole("button").click();
    await expect(toast()).toBeHidden();

    // A refresh repeats nothing: the flash was one cookie, cleared once shown.
    await page.reload();
    await hydrated(page);
    await expect(page.getByText("Modificările au fost salvate.")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(toast()).toHaveCount(0);

    // "Send for review" changes nothing anybody sees: no question — and the toast paints only
    // after the action answered. The POST is held; while it is pending, there is no toast.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const editorPath = new URL(editorUrl).pathname;
    await page.route(
      (url) => url.pathname === editorPath,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await held;
        return route.continue();
      },
    );
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.waitForTimeout(400);
    await expect(toast()).toHaveCount(0);
    release();
    await page.unroute((url) => url.pathname === editorPath);
    await expect(toast()).toContainText("Trimis spre verificare.", { timeout: 30_000 });
    await expect(page.getByText("În verificare", { exact: true })).toBeVisible();
    await hydrated(page);

    // Publish asks. The safe button has the focus; Escape leaves the event in review.
    await page.getByRole("button", { name: "Publică" }).click();
    const publish = page.getByRole("dialog", { name: `Publici „Alergare cu toast ${suffix}”?` });
    await expect(publish).toBeVisible();
    await expect(publish.getByTestId("confirm-dialog-cancel")).toBeFocused();
    // Nothing about email: this event writes to nobody.
    await expect(publish.getByTestId("confirm-email")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(publish).toBeHidden();
    await expect(page.getByText("În verificare", { exact: true })).toBeVisible();
    await expect(page.getByText("Publicat", { exact: true })).toHaveCount(0);

    // Asked again, Enter confirms: publishing is not destructive.
    await page.getByRole("button", { name: "Publică" }).click();
    await expect(publish).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(publish).toBeHidden();
    await expect(toast()).toContainText("Publicat. Este pe site în ambele limbi.", { timeout: 30_000 });
    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();
    await hydrated(page);

    // Taking it off the site is destructive: Enter on the focused cancel only cancels; the
    // backdrop cancels; the cancel button cancels; nothing changed any of the three times.
    const unpublish = page.getByRole("dialog", { name: `Scoți „Alergare cu toast ${suffix}” de pe site?` });
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await expect(unpublish).toBeVisible();
    await expect(unpublish.getByTestId("confirm-dialog-cancel")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(unpublish).toBeHidden();
    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await expect(unpublish).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(unpublish).toBeHidden();
    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await cancelDialog(page, `Scoți „Alergare cu toast ${suffix}” de pe site?`);
    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();
    // And through its own button, off the site — with its toast.
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await confirmDialog(page, `Scoți „Alergare cu toast ${suffix}” de pe site?`);
    await expect(toast()).toContainText("Mutat în ciornă: nu mai apare pe site.", { timeout: 30_000 });
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
    await hydrated(page);

    // Tidy, through the question that deleting asks: the event goes, the list says so.
    await deleteFromEditor(page);
    await expect(page).toHaveURL(/\/ro\/admin\?saved=deleted/, { timeout: 30_000 });
    await expect(toast()).toContainText("A fost șters definitiv.");
  });
});

/** "Șterge" from the editor's own copy/delete card, through its question. */
async function deleteFromEditor(page: Page) {
  await openEditorBox(page, "Duplică sau șterge evenimentul");
  const remove = page.getByTestId("delete-event-form").getByRole("button", { name: "Șterge", exact: true });
  await remove.scrollIntoViewIfNeeded();
  await remove.click();
  await confirmDialog(page, "Ștergi evenimentul?");
}
