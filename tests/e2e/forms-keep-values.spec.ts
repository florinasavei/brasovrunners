import { expect, test } from "@playwright/test";
import { hydrated, signIn } from "./support/featured-event";

/**
 * `DECISIONS.md` §306 on a small form — adding a colleague.
 *
 * The event form is the owner's report and `cms-publish.spec.ts` walks it; this is the same
 * promise on the smallest form that has it: a refusal the browser could not see coming keeps
 * every box, and names the one that was wrong. "amalia@club" is an address to the browser — the
 * HTML rule takes a domain without a dot — and not to the service, whose rule wants one; so the
 * browser lets the press through and the server refuses it, which is the path this is about.
 * Nothing is written by a refused add, so the spec can run as often as it likes.
 */
test.describe("§306 a refused form keeps what was typed", () => {
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
