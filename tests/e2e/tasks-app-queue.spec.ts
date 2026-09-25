import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-090-05 — `/admin/tasks`'s «Aplicația» / «The app» tab: `docs/QUEUE.md`, the
 * dispatcher's own work queue, rendered read-only (`DECISIONS.md` §368, §NNN).
 *
 * The owner, 2026-09-25: "în «De făcut» vreau un tab unde să randez efectiv MD file din repo cu
 * tasklisturi și ce mai e de făcut în aplicație." Unit-tested: the role gate
 * (`task-panels.test.ts`) and the task-list markup (`repo-doc-html.test.ts`). What a unit test
 * cannot see is here — that the tab is really on the page, that the document really renders
 * with its headings and a real checkbox, and that the door really is shut for a role with no
 * business behind it.
 */
test.describe("§NNN the app tab on /admin/tasks", () => {
  test("an Administrator sees the tab and the queue's headings and a checkbox item", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks");
    const main = page.locator("#main");

    // The tab sits after «Sistem» in the sub-navigation.
    const nav = main.getByRole("navigation", { name: "Ce mai este de făcut" });
    await expect(nav.getByRole("link", { name: "Aplicația" })).toBeVisible();

    await nav.getByRole("link", { name: "Aplicația" }).click();
    await expect(page).toHaveURL(/panel=app/);
    await expect(nav.getByRole("link", { name: "Aplicația" })).toHaveAttribute("aria-current", "page");

    // The document's own headings, rendered — English, as `docs/QUEUE.md` is written.
    await expect(main.getByRole("heading", { name: "The work queue" })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Building" })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Later" })).toBeVisible();

    // A real GFM task-list checkbox from the document, disabled — a reader, not an editor.
    const checkbox = main.locator("input[type=checkbox]").first();
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeDisabled();

    // The bilingual lead line above the document: both languages, regardless of the UI locale.
    await expect(main.getByText(/citită direct din/)).toBeVisible();
    await expect(main.getByText(/read straight from/)).toBeVisible();
  });

  test("a Voluntar gets no tab to see, because the whole route is closed to them", async ({ page }) => {
    await signIn(page, "Dev Contributor");
    const response = await page.goto("/ro/admin/tasks");
    expect(response?.status()).toBe(404);

    const appResponse = await page.goto("/ro/admin/tasks?panel=app");
    expect(appResponse?.status()).toBe(404);
  });

  test("a Tehnic opens straight to the app tab and cannot reach the club's ops panels", async ({ page }) => {
    await signIn(page, "Dev Technical");
    await page.goto("/ro/admin/tasks");
    const main = page.locator("#main");

    // No query at all, and Tehnic already lands on «Aplicația» — there is nothing else here.
    await expect(page).toHaveURL(/\/admin\/tasks$/);
    await expect(main.getByRole("heading", { name: "The work queue" })).toBeVisible();

    const nav = main.getByRole("navigation", { name: "Ce mai este de făcut" });
    await expect(nav.getByRole("link", { name: "De făcut" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Costuri" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Anti-robot" })).toHaveCount(0);

    // A typed address for a panel Tehnic may not see lands back on «Aplicația» rather than a
    // 404 — the same "an address nobody offered reads as nothing asked" the owner/kind filters
    // already use, and the only way to land a real status code from a page this deep under a
    // `loading.tsx` Suspense boundary (`layout.tsx`'s own comment).
    await page.goto("/ro/admin/tasks?panel=costs");
    await expect(page).toHaveURL(/panel=app/);
    await expect(main.getByRole("heading", { name: "The work queue" })).toBeVisible();
  });
});
