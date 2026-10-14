import { expect, test, type Locator } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";
import { chooseSex } from "./support/sex-choice";

/**
 * §754 — «Voluntari» (BR-REQ-050-02, BR-REQ-060-01, BR-REQ-031-01): an Administrator defines two roles on a
 * published event, takes volunteers on its page, and a visitor who is nobody offers through the public form —
 * behind the privacy notice the seed's sample text describes (`{{volunteers}}`).
 *
 * §761 — «Ce ești dispus(ă) să faci»: the visitor ticks two roles; the Administrator finds the offer under
 * «De repartizat», gives one role with one press and sees «1 din N» on it; a role with all the people it needs is
 * no longer offered; a repeated sign-up gets the same answer; once every role is given away the page offers no form.
 *
 * §NNN — the volunteer's own data and the role's description: «Primește voluntari pe pagină» is a real tick (role
 * checkbox, `aria-checked`, 44 pixels); a role's «Descrierea rolului» is typed in the rich-text editor in both
 * languages and read under its tick on the public form (folded «Detalii» when long); the form asks the age (17 is
 * refused, the tick «Am cel puțin 18 ani» is gone), the sex, the city, the two optional ticks, and the T-shirt's
 * size only while «Oferim tricouri voluntarilor» is ticked; the card's row, the CSV and the person's data carry them.
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

test.describe("§754 volunteers for a race", () => {
  test.describe.configure({ timeout: 180_000 });

  test("§761 a visitor ticks two roles; the Administrator finds the offer under «De repartizat», gives one role and sees «1 din N»; a full role is no longer offered", async ({
    page,
    browser,
  }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const event = await seedEvent(tag);
    // One address per run: the form's hourly throttle is per address, whatever the event, and the runs share a database.
    const maria = `maria.${tag}@example.test`;
    const ion = `ion.${tag}@example.test`;
    const dana = `dana.${tag}@example.test`;

    // --- The Administrator: two roles, then «Primește voluntari» ------------------------------
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${event.id}`);
    await hydrated(page);
    const card = page.getByTestId("event-volunteers");
    await expect(card).toBeVisible();
    await expect(card.locator("summary").first()).toContainText("Voluntari");
    // A role's group by its own heading — a person's chips and the role select name the other roles too — found by
    // its text, so a folded card (nobody waiting) still answers.
    const group = (name: string) => page.getByTestId("volunteer-group").filter({ has: page.locator("h3").getByText(name, { exact: true }) });

    /** «Descrierea rolului»: one paragraph per line, typed into the house's editor — Romanian and English (both or neither). */
    async function describeRole(scope: Locator, ro: readonly string[], en: readonly string[]) {
      for (const [name, lines] of [
        ["descriptionRoBody", ro],
        ["descriptionEnBody", en],
      ] as const) {
        const fold = scope.locator(`details[data-rich-text-fold="${name}"]`);
        await openFold(fold);
        const editor = fold.locator(".ProseMirror");
        await editor.click();
        for (const [index, line] of lines.entries()) {
          if (index > 0) await page.keyboard.press("Enter");
          await page.keyboard.type(line);
        }
      }
    }

    async function addRole(nameRo: string, nameEn: string, needed: string, description?: { ro: readonly string[]; en: readonly string[] }) {
      await openEditorBox(page, "Adaugă un rol");
      const add = page.getByTestId("volunteer-role-add");
      await add.getByLabel("Numele rolului (Română)").fill(nameRo);
      await add.getByLabel("Numele rolului (English)").fill(nameEn);
      await add.getByLabel("Câți oameni trebuie").fill(needed);
      if (description) await describeRole(add, description.ro, description.en);
      await add.getByRole("button", { name: "Adaugă rolul", exact: true }).click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
    }
    // «Punct de apă» has a long description (four lines: it folds behind «Detalii»); «Sosire» a one-line one.
    await addRole("Punct de apă", "Water point", "2", {
      ro: ["Stai la masa cu apă, la kilometrul 5.", "Umpli paharele înainte de primii alergători.", "Dai paharul în mână, nu pe masă.", "Strângi paharele goale la final."],
      en: ["You stand at the water table at kilometre 5.", "You fill the cups before the first runners.", "You hand over the cup, not leave it on the table.", "You collect the empty cups at the end."],
    });
    await addRole("Sosire", "Finish", "1", { ro: ["Stai la linia de sosire."], en: ["You stand at the finish line."] });
    // Open on arrival? The card keeps its closed line: «0 din 3».
    await expect(card.locator("summary").first()).toContainText("0 din 3");

    // Reorder: «Sosire» moves up, then back — the club's order is the page's.
    await openEditorBox(page, "Roluri");
    const roles = page.getByTestId("volunteer-role-name");
    await expect(roles).toHaveText(["Punct de apă", "Sosire"]);
    // The role's header: the first line of its description's plain words, the rest folded (§NNN).
    await expect(page.getByTestId("volunteer-role").nth(0).getByTestId("volunteer-role-description-first")).toHaveText("Stai la masa cu apă, la kilometrul 5.");
    await expect(page.getByTestId("volunteer-role").nth(1).getByTestId("volunteer-role-description-first")).toHaveText("Stai la linia de sosire.");
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
    // «Primește voluntari pe pagină» is a real tick (§NNN): a checkbox with its words, its state in `aria-checked`, a row a thumb can press.
    const acceptTick = page.getByRole("checkbox", { name: "Primește voluntari pe pagină", exact: true });
    await expect(acceptTick).toHaveAttribute("aria-checked", "false");
    expect((await acceptTick.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("button", { name: "Primește voluntari pe pagină", exact: true })).toHaveCount(0);
    await acceptTick.click();
    // The address already ends in the card's anchor, so the redirect is waited for by what it draws: the card's sentence, then the tick.
    // With the seed's sample notice describing volunteers, the form is on the page.
    await expect(page.getByTestId("volunteer-offer-state")).toContainText("e pe pagina evenimentului", { timeout: 30_000 });
    await hydrated(page);
    // The card may be shut after the redirect: its tick is still the same checkbox, with the state in `aria-checked`.
    await expect(page.getByRole("checkbox", { name: "Primește voluntari pe pagină", exact: true, includeHidden: true })).toHaveAttribute("aria-checked", "true");

    // --- A visitor, who is nobody: the form, behind the notice --------------------------------
    const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
    try {
      const guest = await visitor.newPage();
      const openBox = async () => {
        await guest.goto(`/ro/evenimente/${event.slug}`);
        await hydrated(guest);
        await guest.getByTestId("volunteer-box").getByRole("heading", { name: "Vreau să fiu voluntar" }).click();
      };
      await openBox();
      const box = guest.getByTestId("volunteer-box");
      // «Ce ești dispus(ă) să faci»: one box per role that still needs people, with what it still needs.
      const choices = guest.getByTestId("volunteer-roles");
      await expect(choices).toContainText("Ce ești dispus(ă) să faci");
      await expect(choices).toContainText("mai sunt necesare 2 persoane");
      const waterBox = choices.getByRole("checkbox", { name: "Punct de apă" });
      const finishBox = choices.getByRole("checkbox", { name: "Sosire" });
      await expect(waterBox).toBeVisible();
      await expect(finishBox).toBeVisible();
      // «Descrierea rolului» under each tick: the long one folded behind «Detalii», the one-line one simply there (§NNN).
      const waterDescription = choices.getByTestId("volunteer-role-option").filter({ hasText: "Punct de apă" }).getByTestId("volunteer-role-description");
      await expect(waterDescription).toHaveAttribute("data-folded", "true");
      await expect(waterDescription.locator("summary")).toHaveText("Detalii");
      await expect(waterDescription.getByTestId("volunteer-role-description-body")).toBeHidden();
      await waterDescription.locator("summary").click();
      await expect(waterDescription.getByTestId("volunteer-role-description-body")).toContainText("Umpli paharele înainte de primii alergători.");
      expect(await waterDescription.getByTestId("volunteer-role-description-body").locator("p").count()).toBe(4);
      const finishDescription = choices.getByTestId("volunteer-role-option").filter({ hasText: "Sosire" }).getByTestId("volunteer-role-description");
      await expect(finishDescription).not.toHaveAttribute("data-folded", "true");
      await expect(finishDescription).toContainText("Stai la linia de sosire.");
      // No T-shirt box while the event gives none; the club's group tick carries the club's name.
      await expect(guest.locator('[name="shirtSize"]')).toHaveCount(0);
      await expect(guest.getByTestId("volunteer-profile").getByRole("checkbox", { name: "Am mai fost voluntar în trecut la alte curse" })).toBeVisible();
      await expect(guest.getByTestId("volunteer-profile").getByRole("checkbox", { name: /^Fac parte din grupul .+/ })).toBeVisible();
      // The age answers «Am cel puțin 18 ani»: that tick is gone.
      await expect(guest.locator('input[name="adult"]')).toHaveCount(0);
      // A row a thumb can press; no horizontal scroll at the project's width.
      expect((await choices.locator("label").first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const submit = box.getByRole("button", { name: "Mă ofer voluntar", exact: true });
      expect((await submit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      async function offer(
        page2: typeof guest,
        name: string,
        email: string,
        ticked: readonly string[],
        about: { age: string; sex?: "FEMALE" | "MALE"; city: string; before?: boolean; club?: boolean; shirt?: string } = { age: "34", city: "Brașov" },
      ) {
        for (const role of ticked) await page2.getByTestId("volunteer-roles").getByRole("checkbox", { name: role }).check();
        await page2.getByLabel("Numele tău").fill(name);
        await page2.getByLabel("Adresa ta de email").fill(email);
        await page2.locator('[name="phone"]').fill("712345678");
        // What the person says about themselves (§NNN): the age, the sex, the city, two optional ticks and, while the event gives T-shirts, the size.
        await page2.locator('input[name="age"]').fill(about.age);
        await chooseSex(page2, about.sex ?? "FEMALE");
        await page2.locator('input[name="city"]').fill(about.city);
        if (about.before) await page2.locator('input[name="volunteeredBefore"]').check();
        if (about.club) await page2.locator('input[name="clubMember"]').check();
        if (about.shirt) await page2.locator('select[name="shirtSize"]').selectOption(about.shirt);
        await page2.getByLabel("Un mesaj pentru organizatori (opțional)").fill("Sunt liber toată ziua");
        await page2.locator('input[name="consent"]').check();
        // The volunteer agreement (§758): the person's own tick; the age they typed answers «Am cel puțin 18 ani».
        await page2.locator('input[name="agreement"]').check();
        // A person takes a moment: the form's timing check refuses a post within the second of its render.
        await page2.waitForTimeout(1_200);
        await page2.getByTestId("volunteer-box").getByRole("button", { name: "Mă ofer voluntar", exact: true }).click();
        await expect(page2.getByTestId("volunteer-done")).toBeVisible({ timeout: 30_000 });
        await expect(page2.getByTestId("volunteer-done")).toContainText("Am primit oferta ta");
      }

      // Refusal first: no role ticked and no tick of consent — each named, and what was typed comes back.
      await guest.getByLabel("Numele tău").fill("Maria Test");
      await guest.getByLabel("Adresa ta de email").fill(maria);
      await guest.locator('[name="phone"]').fill("712345678");
      // Seventeen, no sex and no city: each named (§NNN). The browser's own `required` is lifted so the server's refusal is what is read.
      await guest.locator('input[name="age"]').fill("17");
      await guest.locator('input[name="volunteeredBefore"]').check();
      for (const tick of ["consent", "agreement"]) {
        await guest.locator(`input[name="${tick}"]`).evaluate((input: HTMLInputElement) => input.removeAttribute("required"));
      }
      for (const box of ["age", "sex", "city"]) {
        await guest.locator(`[name="${box}"]`).evaluate((input) => input.removeAttribute("required"));
      }
      await guest.waitForTimeout(1_200);
      await submit.click();
      await expect(guest.getByTestId("volunteer-invalid")).toBeVisible({ timeout: 30_000 });
      // «Bifează cel puțin un rol», in the summary and at the group itself.
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("Bifează cel puțin un rol");
      await expect(guest.getByTestId("volunteer-roles-error")).toContainText("Bifează cel puțin un rol");
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("Bifează căsuța de acord");
      // The sentence is said at the box too (CheckboxField, §616), and the notice opens in a new tab (LegalLink, §197).
      await expect(guest.getByTestId("volunteer-consent").getByTestId("checkbox-error")).toContainText("Bifează căsuța de acord");
      await expect(guest.getByTestId("volunteer-consent").getByRole("link", { name: /nota de confidențialitate/ })).toHaveAttribute("target", "_blank");
      // The volunteer agreement and the age (§758): each refusal named in the summary and at its own box, and the
      // agreement in force one press away, in a new tab, so what was typed stays.
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("contractul de voluntariat");
      await expect(guest.getByTestId("volunteer-agreement").getByTestId("checkbox-error")).toContainText("Bifează că accepți contractul de voluntariat");
      // The age says «cel puțin 18 ani» for a number below it (the tick «Am cel puțin 18 ani» is gone), the other two their own sentence.
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("Voluntarii trebuie să aibă cel puțin 18 ani.");
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("Alege sexul din listă.");
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("Scrie orașul tău.");
      await expect(guest.getByTestId("volunteer-profile")).toContainText("Voluntarii trebuie să aibă cel puțin 18 ani.");
      await expect(guest.locator('input[name="age"]')).toHaveValue("17");
      await expect(guest.locator('input[name="volunteeredBefore"]')).toBeChecked();
      await expect(guest.locator('input[name="clubMember"]')).not.toBeChecked();
      const agreementLink = guest.getByTestId("volunteer-agreement").getByRole("link", { name: /contractul de voluntariat/ });
      await expect(agreementLink).toHaveAttribute("target", "_blank");
      await expect(agreementLink).toHaveAttribute("href", "/ro/contract-voluntariat");
      expect((await guest.request.get("/ro/contract-voluntariat")).status()).toBe(200);
      await expect(guest.getByLabel("Numele tău")).toHaveValue("Maria Test");
      await expect(guest.getByLabel("Adresa ta de email")).toHaveValue(maria);

      // She would do both.
      await offer(guest, "Maria Test", maria, ["Punct de apă", "Sosire"], { age: "34", sex: "FEMALE", city: "Brașov", before: true, club: true });

      // --- The Administrator: «De repartizat», one press, «1 din 1» ----------------------------
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      // Somebody waits for a role and an answer: the card opens by itself, and its closed line counts them.
      await expect(card.locator("xpath=self::details")).toHaveAttribute("open", "");
      await expect(card.locator("summary").first()).toContainText("0 din 3");
      await expect(card.locator("summary").first()).toContainText("1 de repartizat");
      await expect(card.locator("summary").first()).toContainText("1 de confirmat");
      const unassigned = page.getByTestId("volunteer-unassigned");
      await expect(unassigned).toContainText("De repartizat");
      const row = unassigned.getByTestId("volunteer-row");
      await expect(row.getByTestId("volunteer-name")).toHaveText("Maria Test");
      await expect(row.getByTestId("volunteer-state")).toHaveText("Înscris");
      // What she would do, as chips — words, never the colour alone.
      await expect(row.getByTestId("volunteer-choice")).toHaveText(["Punct de apă", "Sosire"]);
      // What she said about herself (§NNN): two small chips in words, and one line of the rest — no T-shirt while the event gives none.
      await expect(row.getByTestId("volunteer-before")).toHaveText("A mai fost voluntar");
      await expect(row.getByTestId("volunteer-club")).toContainText("Din grupul");
      await expect(row.getByTestId("volunteer-facts")).toHaveText(/^Vârsta: 34 · .+ · Oraș: Brașov$/);
      await expect(row.getByTestId("volunteer-facts")).not.toContainText("Tricou");
      await expect(row.getByTestId("volunteer-email")).toHaveText(maria);
      await expect(row.getByTestId("volunteer-phone")).toContainText("712 345 678");
      await expect(row).toContainText("Sunt liber toată ziua");
      await expect(row).toContainText("Din formular");
      // The agreement she accepted with the offer (§758): the version, the way, and her copy as a PDF.
      await expect(row.getByTestId("volunteer-agreement-state")).toHaveText("Contract acceptat");
      await expect(row.getByTestId("volunteer-agreement")).toContainText("în formularul de pe pagină");
      const accepted = await page.request.get(`/api/admin/events/${event.id}/volunteers/${await row.getAttribute("data-volunteer-id")}/agreement`);
      expect(accepted.status()).toBe(200);
      expect(accepted.headers()["content-type"]).toBe("application/pdf");
      // Nobody was given a role yet: each role still counts nobody.
      await expect(group("Sosire").getByTestId("volunteer-role-standing")).toHaveText("0 din 1");

      const give = row.getByRole("button", { name: /^Dă-i rolul Sosire/ });
      // The press says how the role stands before it fills it.
      await expect(give).toContainText("Sosire · 0 din 1");
      expect((await give.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      // She ticked both of the event's roles: each has its own button, and «Alt rol», which offers only the others, is not drawn.
      await expect(row.getByTestId("volunteer-assign-form")).toHaveCount(2);
      await expect(row.getByTestId("volunteer-assign-other")).toHaveCount(0);
      await give.click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      // «Sosire» has its one: «1 din 1», Maria in its group, nobody left to place.
      const finishGroup = group("Sosire");
      await expect(finishGroup.getByTestId("volunteer-role-standing")).toHaveText("1 din 1");
      await expect(finishGroup.getByTestId("volunteer-name")).toHaveText("Maria Test");
      await expect(page.getByTestId("volunteer-unassigned").getByTestId("volunteer-row")).toHaveCount(0);
      await expect(card.locator("summary").first()).toContainText("1 din 3");
      // Her choices stay what she offered.
      await expect(finishGroup.getByTestId("volunteer-choice")).toHaveText(["Punct de apă", "Sosire"]);
      // Placed: no press on her row moves her by mistake — a change of role is «Modifică» → «Rolul dat».
      await expect(finishGroup.getByTestId("volunteer-assign")).toHaveCount(0);
      // The one short email that names the role is queued for her.
      const client = new pg.Client({ connectionString: databaseUrl() });
      await client.connect();
      try {
        const queued = await client.query(`SELECT recipient_email FROM email_outbox WHERE message_type = 'VOLUNTEER_ROLE_ASSIGNED' AND payload_json->>'eventId' = $1`, [event.id]);
        expect(queued.rows).toEqual([{ recipient_email: maria }]);
      } finally {
        await client.end();
      }
      // A fresh load first: the address already ends in the card's anchor, so the press's own redirect is what is waited for.
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      await group("Sosire").getByRole("button", { name: /^Confirmă/ }).click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      await expect(group("Sosire").getByTestId("volunteer-state")).toHaveText("Confirmat");

      // The file: the whole list, for whoever may read it, with the role given and the roles offered.
      const csv = await page.request.get(`/api/admin/events/${event.id}/volunteers?lang=ro`);
      expect(csv.status()).toBe(200);
      expect(csv.headers()["content-type"]).toContain("text/csv");
      const file = await csv.text();
      expect(file).toContain("Rolul dat,S-a oferit pentru,Nume");
      expect(file).toContain(`Sosire,"Punct de apă, Sosire",Maria Test`);
      expect(file).toContain(maria);
      // Six columns after the moment (§NNN): the age, the sex (the registrations' own word), the city, the two ticks as «Da»/«Nu», the size (empty: no T-shirts).
      expect(file).toContain("Data,Vârsta,Sex,Orașul,A mai fost voluntar,Din grupul clubului,Mărime tricou");
      expect(file).toMatch(/,34,Female,Brașov,Da,Da,(\r?\n|$)/);

      // --- «Oferim tricouri voluntarilor»: a tick of the card's own, and the form asks the size from then on ---
      const shirtsForm = page.getByTestId("volunteer-shirts-form");
      const shirtsTick = shirtsForm.getByRole("checkbox", { name: "Oferim tricouri voluntarilor" });
      await expect(shirtsTick).not.toBeChecked();
      expect((await shirtsForm.locator("label").first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await shirtsTick.check();
      await shirtsForm.getByRole("button", { name: "Salvează", exact: true }).click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      await expect(page.getByTestId("volunteer-shirts-form").getByRole("checkbox", { name: "Oferim tricouri voluntarilor" })).toBeChecked();

      // --- A role with all its people is no longer offered; a repeat gets the same answer -------
      await openBox();
      await expect(guest.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Punct de apă" })).toBeVisible();
      await expect(guest.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Sosire" })).toHaveCount(0);
      // The size is asked now (the public page is cached for a moment: a fresh load until it is).
      await expect(async () => {
        await guest.reload();
        await expect(guest.locator('select[name="shirtSize"]')).toHaveCount(1, { timeout: 3_000 });
      }).toPass({ timeout: 60_000 });
      await guest.getByTestId("volunteer-box").getByRole("heading", { name: "Vreau să fiu voluntar" }).click();
      await expect(guest.getByLabel("Mărimea tricoului")).toBeVisible();
      await offer(guest, "Ion Test", ion, ["Punct de apă"], { age: "52", sex: "MALE", city: "Cluj-Napoca", shirt: "L" });
      // Maria again: the same «am primit», and one row still.
      await openBox();
      await offer(guest, "Maria Din Nou", maria.replace("maria", "Maria").replace("@example", "@Example"), ["Punct de apă"]);
      await openBox();
      await offer(guest, "Dana Test", dana, ["Punct de apă"]);
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      await expect(page.getByTestId("volunteer-row")).toHaveCount(3);
      await expect(page.getByTestId("volunteer-unassigned").getByTestId("volunteer-name")).toHaveText(["Ion Test", "Dana Test"]);
      // Ion ticked neither optional box and chose a size: no chips, and the T-shirt in the row's line (§NNN).
      const ionRow = page.getByTestId("volunteer-row").filter({ hasText: "Ion Test" });
      await expect(ionRow.getByTestId("volunteer-claims")).toHaveCount(0);
      await expect(ionRow.getByTestId("volunteer-facts")).toHaveText(/^Vârsta: 52 · .+ · Oraș: Cluj-Napoca · Tricou: L$/);
      const withShirts = await (await page.request.get(`/api/admin/events/${event.id}/volunteers?lang=ro`)).text();
      expect(withShirts).toMatch(/,52,Male,Cluj-Napoca,Nu,Nu,L(\r?\n|$)/);

      // The organizers give «Punct de apă» to both: «2 din 2», and the page offers no form any more.
      for (const name of ["Ion Test", "Dana Test"]) {
        await page.goto(`/ro/admin/events/${event.id}`);
        await hydrated(page);
        await page.locator('[data-testid="volunteer-unassigned"] [data-testid="volunteer-row"]', { hasText: name }).getByRole("button", { name: /^Dă-i rolul Punct de apă/ }).click();
        await page.waitForURL(/#box-volunteers$/);
        await hydrated(page);
      }
      await expect(group("Punct de apă").getByTestId("volunteer-role-standing")).toHaveText("2 din 2");
      await expect(card.locator("summary").first()).toContainText("3 din 3");
      await guest.goto(`/ro/evenimente/${event.slug}`);
      await hydrated(guest);
      await expect(guest.getByTestId("volunteer-box")).toHaveCount(0);
    } finally {
      await visitor.close();
    }
  });

  test("§758 a person entered by hand has «Contract neacceptat încă», accepts from the link's page once, and another signs on paper", async ({ page, browser }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}-agr`;
    const event = await seedEvent(tag);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${event.id}`);
    await hydrated(page);
    await openEditorBox(page, "Adaugă un rol");
    const addRole = page.getByTestId("volunteer-role-add");
    await addRole.getByLabel("Numele rolului (Română)").fill("Punct de apă");
    await addRole.getByLabel("Numele rolului (English)").fill("Water point");
    await addRole.getByLabel("Câți oameni trebuie").fill("3");
    await addRole.getByRole("button", { name: "Adaugă rolul", exact: true }).click();
    await page.waitForURL(/#box-volunteers$/);
    await hydrated(page);

    /** A person entered by hand (§761): the role ticked as what they would do and, when `give`, given too. */
    async function fillByHand(name: string, email: string, give: boolean, about: { age?: string; city?: string; before?: boolean } = {}) {
      // A fresh load each time: the card's folds as a person finds them after the previous press.
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      await openEditorBox(page, "Adaugă un voluntar de mână");
      const add = page.getByTestId("volunteer-add");
      await add.getByRole("checkbox", { name: "Punct de apă" }).check();
      if (give) await add.getByLabel("Rolul dat").selectOption({ label: "Punct de apă" });
      await add.getByRole("textbox", { name: "Nume", exact: true }).fill(name);
      await add.getByRole("textbox", { name: "Adresa de email", exact: true }).fill(email);
      await add.getByRole("textbox", { name: "Telefon", exact: true }).fill("0712 345 678");
      // What the person told the organizers (§NNN): every box optional here, no T-shirt box while the event gives none.
      await expect(add.getByLabel("Mărimea tricoului")).toHaveCount(0);
      if (about.age) await add.locator('input[name="age"]').fill(about.age);
      if (about.city) await add.locator('input[name="city"]').fill(about.city);
      if (about.before) await add.getByRole("checkbox", { name: "A mai fost voluntar în trecut la alte curse" }).check();
      await add.getByRole("button", { name: "Adaugă voluntarul", exact: true }).click();
      return add;
    }
    async function addByHand(name: string, email: string, give: boolean, about: { age?: string; city?: string; before?: boolean } = {}) {
      await fillByHand(name, email, give, about);
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
    }
    // Fifteen is below the platform's minimum: refused where it was typed, nothing added.
    const underage = await fillByHand("Prea Tanar", `tanar.${tag}@example.test`, false, { age: "15" });
    await expect(underage.getByTestId("form-refusal")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("volunteer-row")).toHaveCount(0);
    await addByHand("Ion Link", `ion.${tag}@example.test`, true, { age: "40", city: "Sibiu", before: true });
    await addByHand("Dana Hartie", `dana.${tag}@example.test`, false);
    const group = (name: string) => page.getByTestId("volunteer-group").filter({ has: page.locator("h3").getByText(name, { exact: true }) });
    const ionRow = page.locator('[data-testid="volunteer-row"]', { hasText: "Ion Link" });
    const danaRow = page.locator('[data-testid="volunteer-row"]', { hasText: "Dana Hartie" });
    await expect(ionRow.getByTestId("volunteer-before")).toHaveText("A mai fost voluntar");
    await expect(ionRow.getByTestId("volunteer-facts")).toHaveText("Vârsta: 40 · Oraș: Sibiu");
    await expect(danaRow.getByTestId("volunteer-claims")).toHaveCount(0);
    await expect(danaRow.getByTestId("volunteer-facts")).toHaveCount(0);
    await expect(ionRow.getByTestId("volunteer-agreement-state")).toHaveText("Contract neacceptat încă");
    await expect(danaRow.getByTestId("volunteer-agreement-state")).toHaveText("Contract neacceptat încă");
    // Ion was given the role; Dana only offered it, and waits under «De repartizat».
    await expect(group("Punct de apă").getByTestId("volunteer-name")).toHaveText(["Ion Link"]);
    await expect(page.getByTestId("volunteer-unassigned").getByTestId("volunteer-name")).toHaveText(["Dana Hartie"]);

    // «Trimite linkul contractului»: one email queued, the card says so, the row says a link was sent.
    const send = ionRow.getByRole("button", { name: /^Trimite linkul contractului/ });
    expect((await send.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await send.click();
    await page.waitForURL(/#box-volunteers$/);
    await hydrated(page);
    await expect(ionRow.getByTestId("volunteer-agreement")).toContainText("Ultimul link trimis");
    const client = new pg.Client({ connectionString: databaseUrl() });
    await client.connect();
    try {
      const ionId = await ionRow.getAttribute("data-volunteer-id");
      const queued = await client.query(`SELECT 1 FROM email_outbox WHERE message_type = 'VOLUNTEER_AGREEMENT_REQUEST' AND payload_json->>'volunteerId' = $1`, [ionId]);
      expect(queued.rowCount).toBe(1);
      /*
        The link as the send would mint it (the outbox may not have drained here): a secret only this test knows,
        its SHA-256 on the row — what `mintVolunteerAgreementLink` writes — so the page is reached as the person
        reaches it from the email.
      */
      const { createHash, randomBytes } = await import("node:crypto");
      const secret = randomBytes(32).toString("base64url");
      await client.query(
        `UPDATE event_volunteers SET agreement_token_hash = $1, agreement_token_expires_at = now() + interval '14 days' WHERE id = $2`,
        [createHash("sha256").update(secret, "utf8").digest("hex"), ionId],
      );

      // The link's page, as the person opens it: the agreement filled for them, two ticks, one button.
      const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
      try {
        const ion = await visitor.newPage();
        await ion.goto(`/ro/voluntari/contract/${secret}`);
        await hydrated(ion);
        await expect(ion.getByRole("heading", { level: 1 })).toHaveText("Contractul de voluntariat");
        await expect(ion.getByTestId("volunteer-agreement-text")).toContainText("Voluntarul este Ion Link.");
        await expect(ion.getByTestId("volunteer-agreement-text")).toContainText("Voluntarul are rolul Punct de apă.");
        // Opening the page wrote nothing: the link is still unspent.
        const unspent = await client.query(`SELECT agreement_accepted_at FROM event_volunteers WHERE id = $1`, [ionId]);
        expect(unspent.rows[0].agreement_accepted_at).toBeNull();
        expect(await ion.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await ion.getByLabel("Am citit și accept contractul de voluntariat.").check();
        await ion.getByLabel("Am cel puțin 18 ani.").check();
        const accept = ion.getByRole("button", { name: "Accept contractul", exact: true });
        expect((await accept.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await accept.click();
        await expect(ion.getByTestId("volunteer-agreement-accepted")).toBeVisible({ timeout: 30_000 });
        // Single use: the same link again finds nothing.
        await ion.goto(`/ro/voluntari/contract/${secret}`);
        await expect(ion.getByTestId("volunteer-agreement-invalid")).toBeVisible();
      } finally {
        await visitor.close();
      }
      const accepted = await client.query(`SELECT agreement_method, agreement_token_hash FROM event_volunteers WHERE id = $1`, [ionId]);
      expect(accepted.rows[0]).toEqual({ agreement_method: "LINK", agreement_token_hash: null });
    } finally {
      await client.end();
    }

    // The card: Ion accepted from the link; Dana's paper copy, then «Semnat pe hârtie» after the question.
    await page.goto(`/ro/admin/events/${event.id}`);
    await hydrated(page);
    await expect(ionRow.getByTestId("volunteer-agreement-state")).toHaveText("Contract acceptat");
    await expect(ionRow.getByTestId("volunteer-agreement")).toContainText("din linkul trimis pe email");
    const toSign = await page.request.get(`/api/admin/events/${event.id}/volunteers/${await danaRow.getAttribute("data-volunteer-id")}/agreement`);
    expect(toSign.status()).toBe(200);
    expect(toSign.headers()["content-type"]).toBe("application/pdf");
    await danaRow.getByRole("button", { name: "Semnat pe hârtie", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Semnat pe hârtie", exact: true }).click();
    await page.waitForURL(/#box-volunteers$/);
    await hydrated(page);
    await expect(danaRow.getByTestId("volunteer-agreement-state")).toHaveText("Contract acceptat");
    await expect(danaRow.getByTestId("volunteer-agreement")).toContainText("semnat pe hârtie");
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
