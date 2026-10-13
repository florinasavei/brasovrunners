import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox } from "./support/fold";

/**
 * §NNN — «Voluntari» (BR-REQ-050-02, BR-REQ-060-01, BR-REQ-031-01): an Administrator defines two roles on a
 * published event, takes volunteers on its page, and a visitor who is nobody signs up for one through the
 * public form — behind the privacy notice the seed's sample text describes (`{{volunteers}}`). The Administrator
 * then sees «1 din 2» on the role, confirms the person, and downloads the list; a role that has all the people
 * it needs is no longer offered; a repeated sign-up gets the same answer.
 *
 * The event is written straight into the database — the setup, not the subject — one per project and run, so
 * the two projects never share a row.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

/** A published group run in both languages, a month ahead, taking no registrations: a page to volunteer for. */
async function seedEvent(tag: string): Promise<{ id: string; slug: string }> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, location_name, editorial_status, published_at)
       VALUES ('GROUP_RUN', now() + interval '30 days', 'NONE', 'Parcul Tractorul', 'PUBLISHED', now() - interval '1 day') RETURNING id`,
    );
    const slug = `voluntari-${tag}`;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O oră ușoară.'), ($1, 'en', $4, $5, 'An easy hour.')`,
      [rows[0].id, slug, `Alergarea cu voluntari ${tag}`, `volunteers-${tag}`, `The run with volunteers ${tag}`],
    );
    return { id: rows[0].id, slug };
  } finally {
    await client.end();
  }
}

test.describe("§NNN volunteers for a race", () => {
  test.describe.configure({ timeout: 180_000 });

  test("an Administrator defines roles and takes volunteers; a visitor signs up; the Administrator sees «1 din 2», confirms and downloads", async ({ page, browser }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const event = await seedEvent(tag);
    // One address per run: the form's hourly throttle is per address, whatever the event, and the runs share a database.
    const maria = `maria.${tag}@example.test`;
    const ion = `ion.${tag}@example.test`;

    // --- The Administrator: two roles, then «Primește voluntari» ------------------------------
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${event.id}`);
    await hydrated(page);
    const card = page.getByTestId("event-volunteers");
    await expect(card).toBeVisible();
    await expect(card.locator("summary").first()).toContainText("Voluntari");

    async function addRole(nameRo: string, nameEn: string, needed: string) {
      await openEditorBox(page, "Adaugă un rol");
      const add = page.getByTestId("volunteer-role-add");
      await add.getByLabel("Numele rolului (Română)").fill(nameRo);
      await add.getByLabel("Numele rolului (English)").fill(nameEn);
      await add.getByLabel("Câți oameni trebuie").fill(needed);
      await add.getByRole("button", { name: "Adaugă rolul", exact: true }).click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
    }
    await addRole("Punct de apă", "Water point", "2");
    await addRole("Sosire", "Finish", "1");
    // Open on arrival? The card keeps its closed line: «0 din 3».
    await expect(card.locator("summary").first()).toContainText("0 din 3");

    // Reorder: «Sosire» moves up, then back — the club's order is the page's.
    await openEditorBox(page, "Roluri");
    const roles = page.getByTestId("volunteer-role-name");
    await expect(roles).toHaveText(["Punct de apă", "Sosire"]);
    const moveUp = page.getByTestId("volunteer-role").nth(1).getByRole("button", { name: /Mută mai sus/ });
    expect((await moveUp.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await moveUp.click();
    await page.waitForURL(/#box-volunteers$/);
    await hydrated(page);
    await openEditorBox(page, "Roluri");
    await expect(page.getByTestId("volunteer-role-name")).toHaveText(["Sosire", "Punct de apă"]);
    await page.getByTestId("volunteer-role").nth(1).getByRole("button", { name: /Mută mai sus/ }).click();
    await page.waitForURL(/#box-volunteers$/);
    await hydrated(page);
    await openEditorBox(page, "Roluri");
    await expect(page.getByTestId("volunteer-role-name")).toHaveText(["Punct de apă", "Sosire"]);

    // The form is off until the event takes volunteers: the card says why.
    await expect(page.getByTestId("volunteer-offer-state")).toContainText("Formularul public e oprit");
    await page.getByRole("button", { name: "Primește voluntari pe pagină", exact: true }).click();
    await page.waitForURL(/#box-volunteers$/);
    await hydrated(page);
    // With the seed's sample notice describing volunteers, the form is on the page.
    await expect(page.getByTestId("volunteer-offer-state")).toContainText("e pe pagina evenimentului");

    // --- A visitor, who is nobody: the form, behind the notice --------------------------------
    const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
    try {
      const guest = await visitor.newPage();
      await guest.goto(`/ro/evenimente/${event.slug}`);
      await hydrated(guest);
      const box = guest.getByTestId("volunteer-box");
      await expect(box).toBeVisible();
      await box.getByRole("heading", { name: "Vreau să fiu voluntar" }).click();
      // The roles that still need people, with how many.
      await expect(guest.getByTestId("volunteer-roles")).toContainText("Punct de apă");
      await expect(guest.getByTestId("volunteer-roles")).toContainText("mai sunt necesare 2 persoane");
      await expect(guest.getByTestId("volunteer-roles")).toContainText("Sosire");
      // No horizontal scroll at the project's width; the submit is a thumb's target.
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const submit = box.getByRole("button", { name: "Mă ofer voluntar", exact: true });
      expect((await submit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      async function offer(page2: typeof guest, name: string, email: string, role: string) {
        await page2.getByLabel("Rolul pe care îl poți prelua").selectOption({ label: role });
        await page2.getByLabel("Numele tău").fill(name);
        await page2.getByLabel("Adresa ta de email").fill(email);
        await page2.locator('[name="phone"]').fill("712345678");
        await page2.getByLabel("Un mesaj pentru organizatori (opțional)").fill("Sunt liber toată ziua");
        await page2.locator('input[name="consent"]').check();
        // A person takes a moment: the form's timing check refuses a post within the second of its render.
        await page2.waitForTimeout(1_200);
        await page2.getByTestId("volunteer-box").getByRole("button", { name: "Mă ofer voluntar", exact: true }).click();
        await expect(page2.getByTestId("volunteer-done")).toBeVisible({ timeout: 30_000 });
        await expect(page2.getByTestId("volunteer-done")).toContainText("Am primit oferta ta");
      }

      // Refusal first: the consent tick is the person's own act, and what was typed comes back.
      await guest.getByLabel("Numele tău").fill("Maria Test");
      await guest.getByLabel("Adresa ta de email").fill(maria);
      await guest.locator('[name="phone"]').fill("712345678");
      await guest.locator('input[name="consent"]').evaluate((input: HTMLInputElement) => input.removeAttribute("required"));
      await guest.waitForTimeout(1_200);
      await submit.click();
      await expect(guest.getByTestId("volunteer-invalid")).toBeVisible({ timeout: 30_000 });
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("Bifează căsuța de acord");
      await expect(guest.getByLabel("Numele tău")).toHaveValue("Maria Test");
      await expect(guest.getByLabel("Adresa ta de email")).toHaveValue(maria);

      await offer(guest, "Maria Test", maria, "Punct de apă");

      // --- The Administrator: «1 din 2», the person, confirm, the file ------------------------
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      // Somebody is waiting for an answer: the card opens by itself, and its closed line counts them.
      await expect(card.locator("xpath=self::details")).toHaveAttribute("open", "");
      await expect(card.locator("summary").first()).toContainText("1 din 3");
      await expect(card.locator("summary").first()).toContainText("1 de confirmat");
      const group = page.locator('[data-testid="volunteer-group"]', { hasText: "Punct de apă" });
      await expect(group.getByTestId("volunteer-role-standing")).toHaveText("1 din 2");
      const row = group.getByTestId("volunteer-row");
      await expect(row.getByTestId("volunteer-name")).toHaveText("Maria Test");
      await expect(row.getByTestId("volunteer-state")).toHaveText("Înscris");
      await expect(row.getByTestId("volunteer-email")).toHaveText(maria);
      await expect(row.getByTestId("volunteer-phone")).toContainText("712 345 678");
      await expect(row).toContainText("Sunt liber toată ziua");
      await expect(row).toContainText("Din formular");
      await row.getByRole("button", { name: /^Confirmă/ }).click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      await expect(page.locator('[data-testid="volunteer-group"]', { hasText: "Punct de apă" }).getByTestId("volunteer-state")).toHaveText("Confirmat");
      await expect(page.locator('[data-testid="volunteer-group"]', { hasText: "Punct de apă" }).getByTestId("volunteer-role-standing")).toHaveText("1 din 2");

      // The file: the whole list, for whoever may read it, with the address in it.
      const csv = await page.request.get(`/api/admin/events/${event.id}/volunteers?lang=ro`);
      expect(csv.status()).toBe(200);
      expect(csv.headers()["content-type"]).toContain("text/csv");
      expect(await csv.text()).toContain(maria);

      // --- A role with all its people is no longer offered; a repeat gets the same answer -------
      await guest.goto(`/ro/evenimente/${event.slug}`);
      await hydrated(guest);
      await guest.getByTestId("volunteer-box").getByRole("heading", { name: "Vreau să fiu voluntar" }).click();
      await guest.getByTestId("volunteer-box").getByLabel("Rolul pe care îl poți prelua").selectOption({ label: "Sosire" });
      await offer(guest, "Ion Test", ion, "Sosire");
      await guest.goto(`/ro/evenimente/${event.slug}`);
      await hydrated(guest);
      await guest.getByTestId("volunteer-box").getByRole("heading", { name: "Vreau să fiu voluntar" }).click();
      await expect(guest.getByTestId("volunteer-roles")).toContainText("Punct de apă");
      await expect(guest.getByTestId("volunteer-roles")).not.toContainText("Sosire");
      // Maria again, for the role that still needs people: the same «am primit», and one row still.
      await offer(guest, "Maria Din Nou", maria.replace("maria", "Maria").replace("@example", "@Example"), "Punct de apă");
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      await expect(page.getByTestId("volunteer-row")).toHaveCount(2);
      await expect(page.getByTestId("volunteer-name")).toHaveText(["Maria Test", "Ion Test"]);
    } finally {
      await visitor.close();
    }
  });

  test("the event's page shows no form while the event does not take volunteers", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}-off`;
    const event = await seedEvent(tag);
    await page.goto(`/ro/evenimente/${event.slug}`);
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Alergarea cu voluntari");
    await expect(page.getByTestId("volunteer-box")).toHaveCount(0);
  });
});
