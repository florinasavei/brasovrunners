import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * A malformed id in an admin `/…/[id]` route used to reach PostgreSQL and come back as a 500,
 * because the id was handed straight to a `uuid` column's `WHERE` clause (found during the
 * dev-SSR investigation, §376, true on production too). `isUuid` (`shared/ids.ts`) now answers
 * the same 404 an id that is shaped right but names nothing already got.
 *
 * Desktop only: this is about the response the server gives, not the layout at a width.
 */
test.describe("a malformed admin id answers 404, not 500", () => {
  test("/admin/events/nope answers 404 as the signed-in Administrator", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "the response code does not depend on the viewport");
    await signIn(page, "Dev Administrator");
    const response = await page.goto("/ro/admin/events/nope");
    expect(response?.status()).toBe(404);
  });

  test("/admin/registrations/nope answers 404 as the signed-in Administrator", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "the response code does not depend on the viewport");
    await signIn(page, "Dev Administrator");
    const response = await page.goto("/ro/admin/registrations/nope");
    expect(response?.status()).toBe(404);
  });
});
