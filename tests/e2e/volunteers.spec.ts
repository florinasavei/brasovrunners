import { expect, test, type Locator } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";
import { chooseSex } from "./support/sex-choice";
import { blankRoleRow, describeRole, fillRoleRow, roleGroup, roleRow, saveAllRoles } from "./support/volunteer-roles";

/**
 * §754 — «Voluntari» (BR-REQ-050-02, BR-REQ-060-01, BR-REQ-031-01): an Administrator defines two roles on a
 * published event, takes volunteers on its page, and a visitor who is nobody offers through the public form —
 * behind the privacy notice the seed's sample text describes (`{{volunteers}}`).
 *
 * §761 — «Ce ești dispus(ă) să faci»: the visitor ticks two roles; the Administrator finds the offer under
 * «De repartizat», gives one role with one press and sees «1 din N» on it; a role with all the people it needs is
 * no longer offered; a repeated sign-up gets the same answer; once every role is given away the page offers no form.
 *
 * §765 — the volunteer's own data and the role's description: «Primește voluntari pe pagină» is a real tick (role
 * checkbox, `aria-checked`, 44 pixels); a role's «Descrierea rolului» is typed in the rich-text editor in both
 * languages and read under its tick on the public form (folded «Detalii» when long); the form asks the age (17 is
 * refused, the tick «Am cel puțin 18 ani» is gone), the sex, the city, the two optional ticks, and the T-shirt's
 * size only while «Oferim tricouri voluntarilor» is ticked; the card's row, the CSV and the person's data carry them.
 *
 * §768 — the form is a page of its own, `/ro/evenimente/<slug>/voluntari` (the owner, 2026-10-14: «formularul trebuie să fie
 * pagină separată»): the event's page keeps one line and one button; the form, the thank-you and the 404 are the page's. The
 * floor is fourteen: thirteen is refused; fifteen needs a parent's or guardian's name and address and the tick that they agree,
 * shown from the age typed (always, without scripts); the parent accepts from a single-use link, the card says «Acordul
 * părintelui lipsește» and refuses «Confirmă» until then, and the organizers can take the consent on paper.
 *
 * §774 — categories and the contact person: an Administrator adds two categories, moves one, saves a contact person for it, defines «Direcționare» under each
 * (the same name in two categories) and «Foto/Video» under none; the volunteers' page groups the roles under level-3 headings in that order with the contact on one
 * line under its heading (links of 44 pixels); an offer for «Direcționare» is named «Direcționare (Traseu)» on the card; the CSV says so and holds no contact.
 *
 * §784 — a role «fără număr»: a role's row has the tick «Nelimitat» beside «Câte persoane» (the number box goes while it is ticked); the card says
 * «0 · fără număr» on that role and «0 din 1 + roluri fără număr» in its closed line; the event's page lists the role, the volunteers' page offers it however many
 * people it was given and never puts a number on it, even with the counts on.
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

/**
 * The birth dates the form asks (§773, «Data nașterii»): the seed puts the event thirty days ahead, and a volunteer's age is counted on
 * the event's day, so a person is `years` old when they turned it a hundred days before the event — never the boundary's own day, which
 * a run across midnight could cross (the boundaries are the unit and database tests'). Typed as a person types it: eight digits, the box
 * puts the dots in.
 */
function bornOn(years: number): Date {
  const eventDay = new Date(Date.now() + 30 * 86_400_000);
  return new Date(Date.UTC(eventDay.getUTCFullYear() - years, eventDay.getUTCMonth(), eventDay.getUTCDate() - 100));
}
const two = (value: number) => String(value).padStart(2, "0");
/** «12031992»: the digits a person types. */
const typedBirth = (years: number) => {
  const born = bornOn(years);
  return `${two(born.getUTCDate())}${two(born.getUTCMonth() + 1)}${born.getUTCFullYear()}`;
};
/** «12.03.1992»: what the box shows once the mask has put the dots in. */
const shownBirth = (years: number) => {
  const born = bornOn(years);
  return `${two(born.getUTCDate())}.${two(born.getUTCMonth() + 1)}.${born.getUTCFullYear()}`;
};
/** «1992-03-12»: what the database keeps. */
const keptBirth = (years: number) => bornOn(years).toISOString().slice(0, 10);
/** Clears a date box and types digits into it, the way a person does (the mask is Maskito's). */
async function typeBirth(box: Locator, digits: string) {
  await box.fill("");
  await box.pressSequentially(digits);
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

    /** One role through the «Roluri» card's blank row and its one «Salvează toate rolurile» (§791), the description typed in the row's «Mai multe». */
    async function addRole(nameRo: string, nameEn: string, needed: string, description?: { ro: readonly string[]; en: readonly string[] }) {
      await openEditorBox(page, "Roluri");
      const blank = blankRoleRow(page);
      await fillRoleRow(blank, { nameRo, nameEn, needed });
      if (description) await describeRole(blank, description.ro, description.en);
      await saveAllRoles(page);
    }
    // «Punct de apă» has a long description (four lines: it folds behind «Detalii»); «Sosire» a one-line one.
    await addRole("Punct de apă", "Water point", "2", {
      ro: ["Stai la masa cu apă, la kilometrul 5.", "Umpli paharele înainte de primii alergători.", "Dai paharul în mână, nu pe masă.", "Strângi paharele goale la final."],
      en: ["You stand at the water table at kilometre 5.", "You fill the cups before the first runners.", "You hand over the cup, not leave it on the table.", "You collect the empty cups at the end."],
    });
    await addRole("Sosire", "Finish", "1", { ro: ["Stai la linia de sosire."], en: ["You stand at the finish line."] });
    // Open on arrival? The card keeps its closed line: «0 din 3».
    await expect(card.locator("summary").first()).toContainText("0 din 3");

    // Reorder and change two roles, saved by ONE press (§791): «Sosire» takes the first place by its position box and «Punct de apă» needs three people.
    await openEditorBox(page, "Roluri");
    const roleNames = () => page.locator('[data-testid="volunteer-role"] input[name$=".nameRo"]').evaluateAll((boxes) => boxes.map((box) => (box as HTMLInputElement).value));
    expect(await roleNames()).toEqual(["Punct de apă", "Sosire"]);
    // The role's fold line: the first line of its description's plain words beside «Mai multe» (§765).
    const moreLine = (name: string) => roleRow(page, name).getByTestId("volunteer-role-more").locator(":scope > summary");
    await expect(moreLine("Punct de apă")).toContainText("Stai la masa cu apă, la kilometrul 5.");
    await expect(moreLine("Sosire")).toContainText("Stai la linia de sosire.");
    // The description is one strip of two tabs (§572) in the fold, and the card's «Tradu cardul» is greyed with its reason where there is no translation key (§482).
    await openFold(roleRow(page, "Punct de apă").getByTestId("volunteer-role-more"));
    await expect(roleRow(page, "Punct de apă").getByRole("tab")).toHaveText([/Română/, /English/]);
    await expect(page.getByTestId("volunteer-roles-form").getByTestId("translate-card-off")).toBeVisible();
    // The position box and the number are boxes a thumb can use: 44 pixels tall.
    expect((await roleRow(page, "Sosire").getByLabel("Poziția").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
    await fillRoleRow(roleRow(page, "Sosire"), { position: "1" });
    await fillRoleRow(roleRow(page, "Punct de apă"), { needed: "3" });
    await saveAllRoles(page, "Am salvat 2 roluri.");
    await openEditorBox(page, "Roluri");
    expect(await roleNames()).toEqual(["Sosire", "Punct de apă"]);
    await expect(roleRow(page, "Punct de apă").getByLabel("Câte persoane", { exact: true })).toHaveValue("3");
    await expect(roleRow(page, "Punct de apă").getByLabel("Poziția")).toHaveValue("2");
    // Back as they were, again by one press: the first place to «Punct de apă», two people.
    await fillRoleRow(roleRow(page, "Punct de apă"), { position: "1", needed: "2" });
    await saveAllRoles(page);
    await openEditorBox(page, "Roluri");
    expect(await roleNames()).toEqual(["Punct de apă", "Sosire"]);
    // A press that changes nothing says so, and writes nothing.
    await saveAllRoles(page, "Nimic de schimbat la roluri.");
    await openEditorBox(page, "Roluri");

    // The form is off until the event takes volunteers: the card says why.
    await expect(page.getByTestId("volunteer-offer-state")).toContainText("Formularul public e oprit");
    // «Primește voluntari pe pagină» is a real tick (§765): a checkbox with its words, its state in `aria-checked`, a row a thumb can press.
    const acceptTick = page.getByRole("checkbox", { name: "Primește voluntari pe pagină", exact: true });
    await expect(acceptTick).toHaveAttribute("aria-checked", "false");
    expect((await acceptTick.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("button", { name: "Primește voluntari pe pagină", exact: true })).toHaveCount(0);
    await acceptTick.click();
    // The address already ends in the card's anchor, so the redirect is waited for by what it draws: the card's sentence, then the tick.
    // With the seed's sample notice describing volunteers, the form is on the page.
    await expect(page.getByTestId("volunteer-offer-state")).toContainText("pagina evenimentului trimite la ea", { timeout: 30_000 });
    await hydrated(page);
    // The card may be shut after the redirect: its tick is still the same checkbox, with the state in `aria-checked`.
    await expect(page.getByRole("checkbox", { name: "Primește voluntari pe pagină", exact: true, includeHidden: true })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });

    // «Arată public câți voluntari mai sunt necesari» (§773): the card's third tick, a real checkbox, off until the club ticks it.
    await openFold(card);
    const countsTick = page.getByTestId("volunteer-counts-form").getByRole("checkbox", { name: "Arată public câți voluntari mai sunt necesari" });
    await expect(countsTick).toHaveAttribute("aria-checked", "false");
    expect((await countsTick.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("volunteer-counts-form").getByRole("button", { name: "Salvează", exact: true })).toHaveCount(0);

    // --- A visitor, who is nobody: the form, behind the notice --------------------------------
    const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
    try {
      const guest = await visitor.newPage();
      const openBox = async () => {
        await guest.goto(`/ro/evenimente/${event.slug}/voluntari`);
        await hydrated(guest);
        await expect(guest.getByRole("heading", { level: 1 })).toContainText("Vreau să fiu voluntar la");
      };
      // The event's own page: one line and one button to the volunteers' page, and no form on it (§768).
      await guest.goto(`/ro/evenimente/${event.slug}`);
      await hydrated(guest);
      const callout = guest.getByTestId("volunteer-callout");
      await expect(callout.getByTestId("volunteer-callout-line")).toHaveText("Căutăm voluntari: Punct de apă, Sosire");
      const callButton = callout.getByRole("link", { name: "Vreau să fiu voluntar" });
      expect((await callButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(callButton).toHaveAttribute("href", `/ro/evenimente/${event.slug}/voluntari`);
      // §773: the button opens the volunteers' page in a new tab — target and rel, the new-tab mark, and words that say so.
      await expect(callButton).toHaveAttribute("target", "_blank");
      await expect(callButton).toHaveAttribute("rel", "noopener");
      await expect(callButton).toHaveAttribute("aria-label", "Vreau să fiu voluntar — se deschide într-o filă nouă");
      await expect(callout.getByTestId("volunteer-callout-new-tab")).toBeVisible();
      await expect(guest.getByTestId("volunteer-form")).toHaveCount(0);
      await expect(guest.locator('input[name="consent"]')).toHaveCount(0);
      // Pressed for real: a second page opens on the volunteers' page, and the event's own page stays where it was.
      const [popup] = await Promise.all([visitor.waitForEvent("page"), callButton.click()]);
      await popup.waitForURL(new RegExp(`/ro/evenimente/${event.slug}/voluntari$`));
      await hydrated(popup);
      await expect(popup.getByRole("heading", { level: 1 })).toContainText("Vreau să fiu voluntar la");
      await expect(popup.getByTestId("volunteer-form")).toBeVisible();
      // No window.opener: `noopener` cut it.
      expect(await popup.evaluate(() => window.opener === null)).toBe(true);
      await expect(guest).toHaveURL(new RegExp(`/ro/evenimente/${event.slug}$`));
      await popup.close();
      // The page's own back link stays in the same tab; the rest of the visit is on the volunteers' page.
      await openBox();
      // The page: the title, the event's date and place, the roles with how many each still needs, the form.
      await expect(guest.getByRole("heading", { level: 1 })).toHaveText(`Vreau să fiu voluntar la Alergarea cu voluntari ${tag}`);
      await expect(guest.getByTestId("volunteers-when-where")).toContainText("Parcul Tractorul");
      await expect(guest.getByTestId("volunteers-back")).toHaveAttribute("href", `/ro/evenimente/${event.slug}`);
      // The house's back link: a left arrow before the words, a thumb's height.
      await expect(guest.getByTestId("volunteers-back-arrow")).toBeVisible();
      expect((await guest.getByTestId("volunteers-back").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const box = guest.getByTestId("volunteer-box");
      await expect(box).toBeVisible();
      // «Ce ești dispus(ă) să faci»: one chip per role that still needs people.
      const choices = guest.getByTestId("volunteer-roles");
      await expect(choices).toContainText("Ce ești dispus(ă) să faci");
      // §773: the club has not ticked «Arată public câți voluntari mai sunt necesari», so the page says nothing of how many — no number, and no
      // «mai sunt locuri» either: a role shown has places by construction (§780, amended).
      await expect(choices).not.toContainText("mai sunt locuri");
      await expect(choices).not.toContainText("mai sunt necesare");
      await expect(choices.getByTestId("volunteer-role-needs")).toHaveCount(0);
      await expect(choices.getByTestId("volunteer-role-option").first()).not.toContainText(/\d+ persoane/);
      const waterBox = choices.getByRole("checkbox", { name: "Punct de apă" });
      const finishBox = choices.getByRole("checkbox", { name: "Sosire" });
      await expect(waterBox).toBeVisible();
      await expect(finishBox).toBeVisible();
      // «Descrierea rolului» behind a round «?» on the chip, closed by default (§765, amended by §780): a press on it opens the words under the name
      // and never ticks the role; a second press closes it; the chip takes the whole row while it is open.
      const waterChip = choices.getByTestId("volunteer-role-option").filter({ hasText: "Punct de apă" });
      const waterDescription = waterChip.getByTestId("volunteer-role-description");
      const helpButton = waterChip.getByTestId("volunteer-role-help");
      await expect(helpButton).toHaveAttribute("aria-label", "Ce presupune rolul Punct de apă");
      expect((await helpButton.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect((await helpButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(waterDescription).not.toHaveAttribute("open", "");
      await expect(waterDescription.getByTestId("volunteer-role-description-body")).toBeHidden();
      const closedWidth = (await waterChip.boundingBox())!.width;
      await helpButton.click();
      await expect(waterDescription.getByTestId("volunteer-role-description-body")).toContainText("Umpli paharele înainte de primii alergători.");
      expect(await waterDescription.getByTestId("volunteer-role-description-body").locator("p").count()).toBe(4);
      // The press on the «?» did not tick the role.
      await expect(choices.getByRole("checkbox", { name: "Punct de apă" })).not.toBeChecked();
      // Open, the chip stretches to the whole row (wider than it was, and as wide as the group).
      expect((await waterChip.boundingBox())!.width).toBeGreaterThan(closedWidth);
      const rowWidth = (await choices.getByTestId("volunteer-role-chips").first().boundingBox())!.width;
      expect((await waterChip.boundingBox())!.width).toBeGreaterThanOrEqual(rowWidth - 2);
      await helpButton.click();
      await expect(waterDescription.getByTestId("volunteer-role-description-body")).toBeHidden();
      expect(Math.abs((await waterChip.boundingBox())!.width - closedWidth)).toBeLessThan(2);
      // The one-line description is behind a «?» as well: never open on its own.
      const finishChip = choices.getByTestId("volunteer-role-option").filter({ hasText: "Sosire" });
      await expect(finishChip.getByTestId("volunteer-role-description-body")).toBeHidden();
      await finishChip.getByTestId("volunteer-role-help").click();
      await expect(finishChip.getByTestId("volunteer-role-description-body")).toContainText("Stai la linia de sosire.");
      await expect(choices.getByRole("checkbox", { name: "Sosire" })).not.toBeChecked();
      await finishChip.getByTestId("volunteer-role-help").click();
      // The owner's note, right under the roles' list (§773), and the short instruction above it.
      await expect(choices.getByTestId("volunteer-roles-note")).toHaveText("În funcție de numărul de doritori, există posibilitatea să fie nevoie să acoperi o altă responsabilitate. Mulțumim pentru dorința de a ajuta. Te vom contacta curând.");
      await expect(choices).toContainText("Bifează tot ce ai face, cel puțin un rol.");
      // A banner (§797): the information Alert, static text — `note`, never MUI's live `alert` — and the fieldset names it.
      await expect(choices.getByTestId("volunteer-roles-note")).toHaveAttribute("role", "note");
      await expect(choices.getByTestId("volunteer-roles-note").locator(".MuiAlert-icon svg")).toBeVisible();
      // The date of birth, instead of the age: the registration form's own box (§773) — digits typed, the box puts the dots in.
      const birthBox = guest.locator('input[name="birthDate"]');
      await expect(guest.locator('input[name="age"]')).toHaveCount(0);
      await expect(birthBox).toHaveAttribute("placeholder", "ZZ.LL.AAAA");
      await birthBox.click();
      await birthBox.pressSequentially("1203");
      await expect(birthBox).toHaveValue("12.03.");
      await birthBox.fill("");
      // The calendar button beside it (§773): a thumb's size, after the digits and never over them, with the browser's own date input behind it —
      // bounded as the box is, posting nothing. The day chosen there is written into the typed box, and the line under it follows.
      const pickerButton = guest.getByRole("button", { name: "Alege data din calendar" });
      await expect(pickerButton).toBeVisible();
      await expect(pickerButton).toHaveAttribute("type", "button");
      const buttonBox = (await pickerButton.boundingBox())!;
      expect(buttonBox.width).toBeGreaterThanOrEqual(44);
      expect(buttonBox.height).toBeGreaterThanOrEqual(44);
      const typedBox = (await birthBox.boundingBox())!;
      expect(typedBox.x + typedBox.width).toBeLessThanOrEqual(buttonBox.x + 1);
      // The text box keeps room for «ZZ.LL.AAAA» at the narrowest width (320 px).
      expect(typedBox.width).toBeGreaterThanOrEqual(110);
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const nativeDate = guest.locator('input[type="date"][data-testid$="-native"]');
      await expect(nativeDate).toHaveAttribute("type", "date");
      await expect(nativeDate).not.toHaveAttribute("name", /.+/);
      expect(await nativeDate.getAttribute("min")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(await nativeDate.getAttribute("max")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(await birthBox.getAttribute("data-min")).toBe(await nativeDate.getAttribute("min"));
      expect(await birthBox.getAttribute("data-max")).toBe(await nativeDate.getAttribute("max"));
      // A press reaches the browser's picker: `showPicker` is stubbed to record the call, and focus comes back to the button, never stays on the hidden handle.
      await guest.evaluate(() => {
        const w = window as unknown as { __showPicker: number };
        w.__showPicker = 0;
        HTMLInputElement.prototype.showPicker = function () {
          w.__showPicker += 1;
        };
      });
      await pickerButton.click();
      expect(await guest.evaluate(() => (window as unknown as { __showPicker: number }).__showPicker)).toBe(1);
      await nativeDate.fill("1990-05-11");
      await expect(pickerButton).toBeFocused();
      await expect(birthBox).toHaveValue("11.05.1990");
      await expect(guest.getByTestId("volunteer-profile")).toContainText(/Vineri, 11 mai 1990 · \d+ de ani în ziua evenimentului/);
      // Typing still works after a pick: the box is the one source of truth.
      await birthBox.fill("");
      await expect(nativeDate).toHaveValue("");
      await birthBox.pressSequentially("1203");
      await expect(birthBox).toHaveValue("12.03.");
      await birthBox.fill("");
      // The club ticks the count: the page says the number as it always did, and unticks it again: the number goes.
      await countsTick.click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      await expect(page.getByTestId("volunteer-counts-form").getByRole("checkbox", { name: "Arată public câți voluntari mai sunt necesari", includeHidden: true })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
      await expect(async () => {
        await guest.reload();
        await expect(guest.getByTestId("volunteer-roles")).toContainText("mai sunt necesare 2 persoane", { timeout: 3_000 });
      }).toPass({ timeout: 60_000 });
      await expect(guest.getByTestId("volunteer-roles")).not.toContainText("mai sunt locuri");
      await openFold(card);
      await page.getByTestId("volunteer-counts-form").getByRole("checkbox", { name: "Arată public câți voluntari mai sunt necesari", includeHidden: true }).click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      await expect(page.getByTestId("volunteer-counts-form").getByRole("checkbox", { name: "Arată public câți voluntari mai sunt necesari", includeHidden: true })).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
      await expect(async () => {
        await guest.reload();
        await expect(guest.getByTestId("volunteer-roles").getByTestId("volunteer-role-chips").first()).toBeVisible({ timeout: 3_000 });
        await expect(guest.getByTestId("volunteer-roles").getByTestId("volunteer-role-needs")).toHaveCount(0, { timeout: 3_000 });
      }).toPass({ timeout: 60_000 });
      await expect(guest.getByTestId("volunteer-roles")).not.toContainText("mai sunt necesare");
      await expect(guest.getByTestId("volunteer-roles")).not.toContainText("mai sunt locuri");
      // The card's own numbers are there whichever way the tick is.
      await expect(group("Punct de apă").getByTestId("volunteer-role-standing")).toHaveText("0 din 2");

      // No T-shirt box while the event gives none; the club's group tick carries the club's name.
      await expect(guest.locator('[name="shirtSize"]')).toHaveCount(0);
      await expect(guest.getByTestId("volunteer-profile").getByRole("checkbox", { name: "Am mai fost voluntar în trecut la alte curse" })).toBeVisible();
      await expect(guest.getByTestId("volunteer-profile").getByRole("checkbox", { name: /^Fac parte din grupul .+/ })).toBeVisible();
      // The age answers «Am cel puțin 18 ani»: that tick is gone.
      await expect(guest.locator('input[name="adult"]')).toHaveCount(0);
      // A row a thumb can press; no horizontal scroll at the project's width.
      expect((await choices.locator("label").first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // §780: a role is a chip — the whole pill is the checkbox's label, so a press on its name (not the box) ticks it, and again unticks it;
      // the ticked chip's border changes; each chip is a thumb's height; the chips wrap in a row and never leave the page sideways.
      const waterTile = choices.getByTestId("volunteer-role-option").filter({ hasText: "Punct de apă" });
      const finishTile = choices.getByTestId("volunteer-role-option").filter({ hasText: "Sosire" });
      // The pointer is parked away from the tile first: a hovered tile has the primary border too.
      const tileBorder = async () => {
        await guest.mouse.move(0, 0);
        return waterTile.evaluate((tile) => getComputedStyle(tile).borderTopColor);
      };
      const borderBefore = await tileBorder();
      await waterTile.getByTestId("volunteer-role-name").click();
      await expect(waterBox).toBeChecked();
      // The border moves over 120 ms: read it until it has settled.
      await expect.poll(tileBorder).not.toBe(borderBefore);
      await waterTile.getByTestId("volunteer-role-name").click();
      await expect(waterBox).not.toBeChecked();
      await expect.poll(tileBorder).toBe(borderBefore);
      expect((await waterTile.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      const viewportWidth = await guest.evaluate(() => window.innerWidth);
      const water = (await waterTile.boundingBox())!;
      const finish = (await finishTile.boundingBox())!;
      // Neither chip leaves the page sideways, whatever the width.
      for (const chip of [water, finish]) {
        expect(chip.x).toBeGreaterThanOrEqual(0);
        expect(chip.x + chip.width).toBeLessThanOrEqual(viewportWidth + 1);
      }
      if (viewportWidth >= 600) {
        // Room for both on a line: the two chips of one group stand side by side, each as wide as its name — not half the row each.
        expect(Math.abs(water.y - finish.y)).toBeLessThan(4);
        expect(Math.abs(water.x - finish.x)).toBeGreaterThan(60);
        expect(water.width).toBeLessThan(400);
      }
      // The pill's box is visible inside it, at its left edge (the tick is the state, never the colour alone).
      const waterBoxShape = (await waterBox.boundingBox())!;
      expect(waterBoxShape.width).toBeGreaterThan(14);
      expect(waterBoxShape.x).toBeGreaterThanOrEqual(water.x);
      expect(waterBoxShape.x - water.x).toBeLessThan(24);
      // A long name wraps inside its own pill (never sideways, never under the «?»): «Sosire» has a description, so it has its «?»; its name is
      // swapped in the page for one of sixty characters, and the pill must stay inside the row, grow taller than one line, and hold the «?».
      await finishTile.getByTestId("volunteer-role-name").evaluate((el) => {
        el.textContent = "coordonator al punctului de sosire și al zonei de refacere a alergătorilor";
      });
      const longChip = (await finishTile.boundingBox())!;
      const longRow = (await finishTile.locator('xpath=ancestor::*[@data-testid="volunteer-role-chips"]').boundingBox())!;
      const longHelp = (await finishTile.getByTestId("volunteer-role-help").boundingBox())!;
      expect(longChip.x).toBeGreaterThanOrEqual(longRow.x - 1);
      expect(longChip.x + longChip.width).toBeLessThanOrEqual(longRow.x + longRow.width + 1);
      expect(longChip.height).toBeGreaterThan(44);
      expect(longHelp.x).toBeGreaterThanOrEqual(longChip.x);
      expect(longHelp.x + longHelp.width).toBeLessThanOrEqual(longChip.x + longChip.width + 1);
      expect(longHelp.y).toBeGreaterThanOrEqual(longChip.y - 1);
      expect(longHelp.y + longHelp.height).toBeLessThanOrEqual(longChip.y + longChip.height + 1);
      // Closed, the «?» sits at the pill's middle, clear of the curved end beside the first line.
      expect(Math.abs(longHelp.y + longHelp.height / 2 - (longChip.y + longChip.height / 2))).toBeLessThan(3);
      // The capital is the stylesheet's: the stored text stays as typed, the first letter is drawn upper-case.
      expect(await finishTile.getByTestId("volunteer-role-name").evaluate((el) => getComputedStyle(el, "::first-letter").textTransform)).toBe("uppercase");
      await finishTile.getByTestId("volunteer-role-name").evaluate((el) => {
        el.textContent = "Sosire";
      });
      // Scripts off: the «?» still opens its description (a native details), a press on a name still ticks (a native label), and a refused post
      // comes back with the tick it had (§142).
      const bareContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined, javaScriptEnabled: false });
      try {
        const bare = await bareContext.newPage();
        await bare.goto(`/ro/evenimente/${event.slug}/voluntari`);
        const bareChips = bare.getByTestId("volunteer-roles");
        const bareWater = bareChips.getByTestId("volunteer-role-option").filter({ hasText: "Punct de apă" });
        await expect(bareWater.getByTestId("volunteer-role-description-body")).toBeHidden();
        await bareWater.getByTestId("volunteer-role-help").click();
        await expect(bareWater.getByTestId("volunteer-role-description-body")).toContainText("Umpli paharele înainte de primii alergători.");
        await expect(bareChips.getByRole("checkbox", { name: "Punct de apă" })).not.toBeChecked();
        await bareChips.getByTestId("volunteer-role-option").filter({ hasText: "Sosire" }).getByTestId("volunteer-role-name").click();
        await expect(bareChips.getByRole("checkbox", { name: "Sosire" })).toBeChecked();
        // Sent with a date of birth under the floor (the browser's own checks pass, the server's refuse): the page comes back with «Sosire» ticked.
        await bare.getByLabel("Numele tău").fill("Fără Script");
        await bare.getByLabel("Adresa ta de email").fill("fara-script@example.test");
        await bare.locator('[name="phone"]').fill("712345678");
        await bare.locator('input[name="birthDate"]').fill("01.01.2020");
        await bare.locator('select[name="sex"]').selectOption("FEMALE");
        await bare.locator('input[name="city"]').fill("Brașov");
        await bare.locator('input[name="consent"]').check();
        await bare.locator('input[name="agreement"]').check();
        await bare.waitForTimeout(1_200);
        await bare.getByTestId("volunteer-box").getByRole("button", { name: "Mă ofer voluntar", exact: true }).click();
        await expect(bare.getByTestId("volunteer-invalid")).toBeVisible({ timeout: 30_000 });
        await expect(bare.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Sosire" })).toBeChecked();
        await expect(bare.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Punct de apă" })).not.toBeChecked();
      } finally {
        await bareContext.close();
      }
      const submit = box.getByRole("button", { name: "Mă ofer voluntar", exact: true });
      expect((await submit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      async function offer(
        page2: typeof guest,
        name: string,
        email: string,
        ticked: readonly string[],
        about: { years: number; sex?: "FEMALE" | "MALE"; city: string; before?: boolean; club?: boolean; shirt?: string; picked?: boolean } = { years: 34, city: "Brașov" },
      ) {
        for (const role of ticked) await page2.getByTestId("volunteer-roles").getByRole("checkbox", { name: role }).check();
        await page2.getByLabel("Numele tău").fill(name);
        await page2.getByLabel("Adresa ta de email").fill(email);
        await page2.locator('[name="phone"]').fill("712345678");
        // What the person says about themselves (§765): the date of birth — digits typed, the dots put in by the box (§773) — the sex, the city, two optional ticks and, while the event gives T-shirts, the size.
        if (about.picked) {
          // The calendar button's hidden date input (§773, the owner, 2026-10-16): the day chosen in the browser's picker is written into the typed box.
          await expect(page2.getByRole("button", { name: "Alege data din calendar" })).toBeVisible();
          await page2.locator('input[type="date"][data-testid$="-native"]').fill(keptBirth(about.years));
        } else {
          await typeBirth(page2.locator('input[name="birthDate"]'), typedBirth(about.years));
        }
        await expect(page2.locator('input[name="birthDate"]')).toHaveValue(shownBirth(about.years));
        // The line under the box says the age on the event's day, in words.
        await expect(page2.getByTestId("volunteer-profile")).toContainText("în ziua evenimentului");
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
        // The thank-you is on the volunteers' own page (the house's redirect-with-flash, §427), never the event's.
        await expect(page2).toHaveURL(/\/voluntari\?volunteer=1/);
      }

      // Refusal first: no role ticked and no tick of consent — each named, and what was typed comes back.
      await guest.getByLabel("Numele tău").fill("Maria Test");
      await guest.getByLabel("Adresa ta de email").fill(maria);
      await guest.locator('[name="phone"]').fill("712345678");
      // Thirteen on the event's day — under the floor of fourteen (§768) — no sex and no city: each named (§765). The browser's own checks are lifted so the server's refusal is what is read.
      await typeBirth(guest.locator('input[name="birthDate"]'), typedBirth(13));
      await expect(guest.locator('input[name="birthDate"]')).toHaveValue(shownBirth(13));
      // The box says it as it is typed, in red, before any press: the rule's own sentence.
      await expect(guest.getByTestId("volunteer-profile")).toContainText("Voluntarii trebuie să aibă cel puțin 14 ani în ziua evenimentului.");
      await guest.getByTestId("volunteer-form").evaluate((form: HTMLFormElement) => {
        form.noValidate = true;
      });
      await guest.locator('input[name="volunteeredBefore"]').check();
      for (const tick of ["consent", "agreement"]) {
        await guest.locator(`input[name="${tick}"]`).evaluate((input: HTMLInputElement) => input.removeAttribute("required"));
      }
      for (const box of ["birthDate", "sex", "city"]) {
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
      // The date says «cel puțin 14 ani» for a date below the floor on the event's day (the tick «Am cel puțin 18 ani» is gone), the other two their own sentence.
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("Voluntarii trebuie să aibă cel puțin 14 ani în ziua evenimentului.");
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("Alege sexul din listă.");
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("Scrie orașul tău.");
      await expect(guest.getByTestId("volunteer-profile")).toContainText("Voluntarii trebuie să aibă cel puțin 14 ani în ziua evenimentului.");
      // What was typed comes back, shown day first.
      await expect(guest.locator('input[name="birthDate"]')).toHaveValue(shownBirth(13));
      await expect(guest.locator('input[name="volunteeredBefore"]')).toBeChecked();
      await expect(guest.locator('input[name="clubMember"]')).not.toBeChecked();
      const agreementLink = guest.getByTestId("volunteer-agreement").getByRole("link", { name: /contractul de voluntariat/ });
      await expect(agreementLink).toHaveAttribute("target", "_blank");
      await expect(agreementLink).toHaveAttribute("href", "/ro/contract-voluntariat");
      expect((await guest.request.get("/ro/contract-voluntariat")).status()).toBe(200);
      await expect(guest.getByLabel("Numele tău")).toHaveValue("Maria Test");
      await expect(guest.getByLabel("Adresa ta de email")).toHaveValue(maria);

      // §780: a ticked role chip survives a refused post. One chip is ticked by a press on its name, the post is refused again (the
      // consent and the age are still wrong), and the page comes back with that box checked and the chip's border the ticked one.
      await guest.getByTestId("volunteer-roles").getByTestId("volunteer-role-option").filter({ hasText: "Sosire" }).getByTestId("volunteer-role-name").click();
      await expect(guest.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Sosire" })).toBeChecked();
      await guest.getByTestId("volunteer-form").evaluate((form: HTMLFormElement) => {
        form.noValidate = true;
      });
      await guest.waitForTimeout(1_200);
      await submit.click();
      // The first refusal's summary says «Bifează cel puțin un rol»: the new page is the one that no longer does.
      await expect(guest.getByTestId("volunteer-invalid")).not.toContainText("Bifează cel puțin un rol", { timeout: 30_000 });
      await expect(guest.getByTestId("volunteer-invalid")).toContainText("Bifează căsuța de acord");
      await expect(guest.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Sosire" })).toBeChecked();
      await expect(guest.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Punct de apă" })).not.toBeChecked();
      await guest.mouse.move(0, 0);
      const recalledBorder = await guest
        .getByTestId("volunteer-roles")
        .getByTestId("volunteer-role-option")
        .filter({ hasText: "Sosire" })
        .evaluate((tile) => getComputedStyle(tile).borderTopColor);
      expect(recalledBorder).not.toBe(borderBefore);

      // She would do both.
      await offer(guest, "Maria Test", maria, ["Punct de apă", "Sosire"], { years: 34, sex: "FEMALE", city: "Brașov", before: true, club: true });

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
      // What she said about herself (§765): two small chips in words, and one line of the rest — no T-shirt while the event gives none.
      await expect(row.getByTestId("volunteer-before")).toHaveText("A mai fost voluntar");
      await expect(row.getByTestId("volunteer-club")).toContainText("Din grupul");
      // «34 de ani (12.03.1992)»: the age on the event's day and the date it came from (§773).
      await expect(row.getByTestId("volunteer-facts")).toHaveText(new RegExp(`^34 de ani \\(${shownBirth(34).replace(/\./g, "\\.")}\\) · .+ · Oraș: Brașov$`));
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
      // Seven columns after the moment (§765, §773): the age and the date of birth beside it, the sex (the registrations' own word), the city, the two ticks as «Da»/«Nu», the size (empty: no T-shirts).
      expect(file).toContain("Data,Vârsta,Data nașterii,Sex,Orașul,A mai fost voluntar,Din grupul clubului,Mărime tricou");
      // …then the parent's three (§768), empty for an adult.
      expect(file).toContain(`,34,${keptBirth(34)},Female,Brașov,Da,Da,,,,`);

      // --- «Oferim tricouri voluntarilor»: a tick of the card's own, and the form asks the size from then on ---
      // Nobody waits any more, so the card is shut: open it, as a person does.
      await openFold(card);
      const shirtsForm = page.getByTestId("volunteer-shirts-form");
      const shirtsTick = shirtsForm.getByRole("checkbox", { name: "Oferim tricouri voluntarilor" });
      await expect(shirtsTick).toHaveAttribute("aria-checked", "false");
      expect((await shirtsTick.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      // One press, like the tick above: no «Salvează» beside it.
      await expect(shirtsForm.getByRole("button", { name: "Salvează", exact: true })).toHaveCount(0);
      await shirtsTick.click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      await expect(page.getByTestId("volunteer-shirts-form").getByRole("checkbox", { name: "Oferim tricouri voluntarilor", includeHidden: true })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });

      // --- A role with all its people is no longer offered; a repeat gets the same answer -------
      await openBox();
      await expect(guest.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Punct de apă" })).toBeVisible();
      await expect(guest.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Sosire" })).toHaveCount(0);
      // The size is asked now (the public page is cached for a moment: a fresh load until it is).
      await expect(async () => {
        await guest.reload();
        await expect(guest.locator('select[name="shirtSize"]')).toHaveCount(1, { timeout: 3_000 });
      }).toPass({ timeout: 60_000 });
      await expect(guest.getByLabel("Mărimea tricoului")).toBeVisible();
      await offer(guest, "Ion Test", ion, ["Punct de apă"], { years: 52, sex: "MALE", city: "Cluj-Napoca", shirt: "L", picked: true });
      // Maria again: the same «am primit», and one row still.
      await openBox();
      await offer(guest, "Maria Din Nou", maria.replace("maria", "Maria").replace("@example", "@Example"), ["Punct de apă"]);
      await openBox();
      await offer(guest, "Dana Test", dana, ["Punct de apă"]);
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      await expect(page.getByTestId("volunteer-row")).toHaveCount(3);
      await expect(page.getByTestId("volunteer-unassigned").getByTestId("volunteer-name")).toHaveText(["Ion Test", "Dana Test"]);
      // Ion ticked neither optional box and chose a size: no chips, and the T-shirt in the row's line (§765).
      const ionRow = page.getByTestId("volunteer-row").filter({ hasText: "Ion Test" });
      await expect(ionRow.getByTestId("volunteer-claims")).toHaveCount(0);
      await expect(ionRow.getByTestId("volunteer-facts")).toHaveText(new RegExp(`^52 de ani \\(${shownBirth(52).replace(/\./g, "\\.")}\\) · .+ · Oraș: Cluj-Napoca · Tricou: L$`));
      const withShirts = await (await page.request.get(`/api/admin/events/${event.id}/volunteers?lang=ro`)).text();
      expect(withShirts).toContain(`,52,${keptBirth(52)},Male,Cluj-Napoca,Nu,Nu,L,,,`);

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
      await expect(guest.getByTestId("volunteer-callout")).toHaveCount(0);
      // …and the volunteers' page answers 404, never a form that cannot be sent (§768).
      await expect(async () => {
        const answered = await guest.request.get(`/ro/evenimente/${event.slug}/voluntari`);
        expect(answered.status()).toBe(404);
      }).toPass({ timeout: 60_000 });
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
    await openEditorBox(page, "Roluri");
    await fillRoleRow(blankRoleRow(page), { nameRo: "Punct de apă", nameEn: "Water point", needed: "3" });
    await saveAllRoles(page);

    /** A person entered by hand (§761): the role ticked as what they would do and, when `give`, given too. */
    async function fillByHand(name: string, email: string, give: boolean, about: { years?: number; city?: string; before?: boolean } = {}) {
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
      // What the person told the organizers (§765): every box optional here, no T-shirt box while the event gives none.
      await expect(add.getByLabel("Mărimea tricoului")).toHaveCount(0);
      // §773: the date of birth, the registration form's own box — digits typed, the dots put in.
      await expect(add.locator('input[name="age"]')).toHaveCount(0);
      if (about.years) {
        await typeBirth(add.locator('input[name="birthDate"]'), typedBirth(about.years));
        await expect(add.locator('input[name="birthDate"]')).toHaveValue(shownBirth(about.years));
      }
      // The calendar button is in the organizers' entry too (§773), one per box.
      await expect(add.getByRole("button", { name: "Alege data din calendar" })).toBeVisible();
      if (about.city) await add.locator('input[name="city"]').fill(about.city);
      if (about.before) await add.getByRole("checkbox", { name: "A mai fost voluntar în trecut la alte curse" }).check();
      // The box says «cel puțin 14 ani» itself and the browser would stop a press on a date under the floor: lifted, so what is read is the server's refusal.
      await add.locator("form").evaluate((form: HTMLFormElement) => {
        form.noValidate = true;
      });
      await add.getByRole("button", { name: "Adaugă voluntarul", exact: true }).click();
      return add;
    }
    async function addByHand(name: string, email: string, give: boolean, about: { years?: number; city?: string; before?: boolean } = {}) {
      await fillByHand(name, email, give, about);
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
    }
    // Thirteen is below the platform's floor of fourteen (§768): refused where it was typed, nothing added.
    const underage = await fillByHand("Prea Tanar", `tanar.${tag}@example.test`, false, { years: 13 });
    await expect(underage.getByTestId("form-refusal")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("volunteer-row")).toHaveCount(0);
    await addByHand("Ion Link", `ion.${tag}@example.test`, true, { years: 40, city: "Sibiu", before: true });
    await addByHand("Dana Hartie", `dana.${tag}@example.test`, false);
    const group = (name: string) => page.getByTestId("volunteer-group").filter({ has: page.locator("h3").getByText(name, { exact: true }) });
    const ionRow = page.locator('[data-testid="volunteer-row"]', { hasText: "Ion Link" });
    const danaRow = page.locator('[data-testid="volunteer-row"]', { hasText: "Dana Hartie" });
    await expect(ionRow.getByTestId("volunteer-before")).toHaveText("A mai fost voluntar");
    await expect(ionRow.getByTestId("volunteer-facts")).toHaveText(new RegExp(`^40 de ani \\(${shownBirth(40).replace(/\./g, "\\.")}\\) · Oraș: Sibiu$`));
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

  test("§768 a volunteer of fifteen offers with a parent: the boxes follow the age, the parent accepts from the link, the card says «Acordul părintelui lipsește» and refuses «Confirmă» until then, and the consent can be taken on paper", async ({
    page,
    browser,
  }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}-min`;
    const event = await seedEvent(tag);
    const dan = `dan.${tag}@example.test`;
    const parent = `parinte.${tag}@example.test`;
    const client = new pg.Client({ connectionString: databaseUrl() });
    await client.connect();
    let danId = "";
    try {
      // The setup, not the subject: the event takes volunteers and has one role needing three people.
      await client.query(`UPDATE events SET accepts_volunteers = true WHERE id = $1`, [event.id]);
      await client.query(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed) VALUES ($1, 'Punct de apă', 'Water point', 3)`, [event.id]);

      const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
      try {
        const guest = await visitor.newPage();
        await guest.goto(`/ro/evenimente/${event.slug}/voluntari`);
        await hydrated(guest);
        // The parent's boxes follow the date typed (§773, counted on the event's day): shown for a date that gives under eighteen, hidden for the others and before any is typed.
        const block = guest.getByTestId("volunteer-guardian-block");
        const birth = guest.locator('input[name="birthDate"]');
        await expect(block).toBeHidden();
        // Scripts off: nothing can decide from the date, so the parent's boxes are open — the server drops what an adult typed, and the date box is a plain text box.
        const bareContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, javaScriptEnabled: false });
        try {
          const bare = await bareContext.newPage();
          await bare.goto(`/ro/evenimente/${event.slug}/voluntari`);
          await expect(bare.getByTestId("volunteer-guardian-block")).toBeVisible();
          await expect(bare.locator('input[name="birthDate"]')).toHaveAttribute("type", "text");
        } finally {
          await bareContext.close();
        }
        // Under the floor of fourteen: told the floor, not asked for a parent.
        await typeBirth(birth, typedBirth(13));
        await expect(block).toBeHidden();
        await typeBirth(birth, typedBirth(15));
        await expect(block).toBeVisible();
        expect((await block.getByLabel("Părintele sau tutorele meu știe și e de acord").boundingBox())?.height ?? 0).toBeGreaterThan(0);
        await typeBirth(birth, typedBirth(30));
        await expect(block).toBeHidden();
        await typeBirth(birth, typedBirth(15));
        await expect(block).toBeVisible();
        // Required while it is shown: the browser asks the three of a minor only.
        for (const name of ["guardianName", "guardianEmail", "guardianAware"]) await expect(guest.locator(`input[name="${name}"]`)).toHaveAttribute("required", "");
        expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        const fillTheRest = async () => {
          await guest.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Punct de apă" }).check();
          await guest.getByLabel("Numele tău").fill("Dan Tânărul");
          await guest.getByLabel("Adresa ta de email").fill(dan);
          await guest.locator('[name="phone"]').fill("712345678");
          await chooseSex(guest, "MALE");
          await guest.locator('input[name="city"]').fill("Brașov");
          await guest.locator('input[name="consent"]').check();
          await guest.locator('input[name="agreement"]').check();
        };
        await fillTheRest();
        // Sent without the parent's boxes (their `required` lifted): the server names each — nothing was kept, nothing was mailed.
        for (const name of ["guardianName", "guardianEmail", "guardianAware"]) await guest.locator(`input[name="${name}"]`).evaluate((input: HTMLInputElement) => input.removeAttribute("required"));
        await guest.waitForTimeout(1_200);
        await guest.getByTestId("volunteer-box").getByRole("button", { name: "Mă ofer voluntar", exact: true }).click();
        await expect(guest.getByTestId("volunteer-invalid")).toBeVisible({ timeout: 30_000 });
        await expect(guest.getByTestId("volunteer-invalid")).toContainText("Scrie numele părintelui sau tutorelui.");
        await expect(guest.getByTestId("volunteer-invalid")).toContainText("Adresa de email a părintelui sau tutorelui nu pare validă.");
        await expect(guest.getByTestId("volunteer-invalid")).toContainText("Bifează că părintele sau tutorele tău știe și e de acord.");
        // The date is kept, shown day first, so the block is there to mend.
        await expect(guest.locator('input[name="birthDate"]')).toHaveValue(shownBirth(15));
        await expect(block).toBeVisible();
        expect((await client.query(`SELECT 1 FROM event_volunteers WHERE event_id = $1`, [event.id])).rowCount).toBe(0);

        // Mended: the parent's name, address and the person's tick.
        await guest.locator('input[name="guardianName"]').fill("Maria Popescu");
        await guest.locator('input[name="guardianEmail"]').fill(parent);
        await guest.locator('input[name="guardianAware"]').check();
        await guest.locator('input[name="consent"]').check();
        await guest.locator('input[name="agreement"]').check();
        await guest.getByLabel("Numele tău").fill("Dan Tânărul");
        await guest.getByLabel("Adresa ta de email").fill(dan);
        await guest.locator('[name="phone"]').fill("712345678");
        await guest.getByTestId("volunteer-roles").getByRole("checkbox", { name: "Punct de apă" }).check();
        await chooseSex(guest, "MALE");
        await guest.locator('input[name="city"]').fill("Brașov");
        await guest.waitForTimeout(1_200);
        await guest.getByTestId("volunteer-box").getByRole("button", { name: "Mă ofer voluntar", exact: true }).click();
        await expect(guest.getByTestId("volunteer-done")).toBeVisible({ timeout: 30_000 });
        await expect(guest.getByTestId("volunteer-done-guardian")).toContainText("părintele sau tutorele tău primește un email");
        await expect(guest).toHaveURL(/\/voluntari\?volunteer=1/);
      } finally {
        await visitor.close();
      }

      // What was kept: the parent on the minor's row, the asking email queued with no secret in it.
      const kept = await client.query(`SELECT id, age, date_of_birth::text AS date_of_birth, guardian_name, guardian_email, guardian_accepted_at, guardian_token_hash, declared_adult FROM event_volunteers WHERE event_id = $1`, [event.id]);
      expect(kept.rows).toHaveLength(1);
      expect(kept.rows[0]).toMatchObject({ age: 15, date_of_birth: keptBirth(15), guardian_name: "Maria Popescu", guardian_email: parent, guardian_accepted_at: null, guardian_token_hash: null, declared_adult: false });
      danId = kept.rows[0].id;
      const queued = await client.query(`SELECT recipient_email FROM email_outbox WHERE message_type = 'VOLUNTEER_GUARDIAN_REQUEST' AND payload_json->>'volunteerId' = $1`, [danId]);
      expect(queued.rows).toEqual([{ recipient_email: parent }]);

      // --- The Administrator: «Acordul părintelui lipsește», and «Confirmă» refused until the parent accepts ---
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      const row = page.locator('[data-testid="volunteer-row"]', { hasText: "Dan Tânărul" });
      await expect(row.getByTestId("volunteer-guardian-state")).toContainText("Acordul părintelui lipsește");
      await expect(row.getByTestId("volunteer-guardian-line")).toContainText("Părinte sau tutore: Maria Popescu");
      await expect(row.getByTestId("volunteer-guardian-email")).toHaveText(parent);
      await expect(row.getByTestId("volunteer-facts")).toContainText(`15 ani (${shownBirth(15)})`);
      // The row's own chips: the volunteer accepted on the form; the parent's is the one that is missing.
      await expect(row.getByTestId("volunteer-agreement-state")).toHaveText("Contract acceptat");
      const confirm = row.getByRole("button", { name: /^Confirmă/ });
      expect((await confirm.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await confirm.click();
      await page.waitForURL(/volunteerError=VOLUNTEER_GUARDIAN_MISSING/);
      await hydrated(page);
      await expect(page.getByRole("alert").filter({ hasText: "Acordul părintelui lipsește" })).toBeVisible();
      await expect(row.getByTestId("volunteer-state")).toHaveText("Înscris");
      // «Trimite linkul părintelui»: one more email, a press never a secret.
      await row.getByRole("button", { name: /^Trimite (din nou )?linkul părintelui/ }).click();
      // The address already ends in the card's anchor after the refusal, so the press is waited for by what it wrote: a second queued email.
      await expect
        .poll(async () => (await client.query(`SELECT 1 FROM email_outbox WHERE message_type = 'VOLUNTEER_GUARDIAN_REQUEST' AND payload_json->>'volunteerId' = $1`, [danId])).rowCount, { timeout: 30_000 })
        .toBe(2);
      await hydrated(page);

      // --- The parent: the link's page reads and never writes; one press accepts; the link is spent ----------
      const { createHash, randomBytes } = await import("node:crypto");
      const secret = randomBytes(32).toString("base64url");
      // The real outbox drains after each response and mints a newer link when it sends (newest wins): let it finish and park what is left, so only this test's link is live.
      await expect
        .poll(async () => (await client.query(`SELECT 1 FROM email_outbox WHERE message_type = 'VOLUNTEER_GUARDIAN_REQUEST' AND payload_json->>'volunteerId' = $1 AND status = 'PROCESSING'`, [danId])).rowCount, { timeout: 30_000 })
        .toBe(0);
      await client.query(`UPDATE email_outbox SET status = 'FAILED' WHERE message_type = 'VOLUNTEER_GUARDIAN_REQUEST' AND payload_json->>'volunteerId' = $1 AND status = 'PENDING'`, [danId]);
      await client.query(`UPDATE event_volunteers SET guardian_token_hash = $1, guardian_token_expires_at = now() + interval '14 days' WHERE id = $2`, [
        createHash("sha256").update(secret, "utf8").digest("hex"),
        danId,
      ]);
      const guardianContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
      try {
        const maria = await guardianContext.newPage();
        await maria.goto(`/ro/voluntari/parinte/${secret}`);
        await hydrated(maria);
        await expect(maria.getByRole("heading", { level: 1 })).toHaveText("Acordul părintelui sau tutorelui");
        // The agreement filled for the volunteer, the parent's name in the minors' clause.
        await expect(maria.getByTestId("volunteer-guardian-text")).toContainText("Voluntarul este Dan Tânărul.");
        await expect(maria.getByTestId("volunteer-guardian-text")).toContainText("Voluntarul fiind minor, părintele sau tutorele său, Maria Popescu");
        // Opening the page wrote nothing: the link is still unspent.
        expect((await client.query(`SELECT guardian_accepted_at FROM event_volunteers WHERE id = $1`, [danId])).rows[0].guardian_accepted_at).toBeNull();
        expect(await maria.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await maria.getByLabel(/Am citit contractul de voluntariat și sunt de acord ca Dan Tânărul/).check();
        await maria.getByLabel("Numele tău întreg").fill("Maria Popescu");
        const accept = maria.getByRole("button", { name: "Îmi dau acordul", exact: true });
        expect((await accept.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await accept.click();
        await expect(maria.getByTestId("volunteer-guardian-accepted")).toBeVisible({ timeout: 30_000 });
        // Single use: the same link again finds nothing.
        await maria.goto(`/ro/voluntari/parinte/${secret}`);
        await expect(maria.getByTestId("volunteer-guardian-invalid")).toBeVisible();
      } finally {
        await guardianContext.close();
      }
      const accepted = await client.query(`SELECT guardian_method, guardian_typed_name, guardian_token_hash FROM event_volunteers WHERE id = $1`, [danId]);
      expect(accepted.rows[0]).toEqual({ guardian_method: "LINK", guardian_typed_name: "Maria Popescu", guardian_token_hash: null });

      // --- The card: «primit», «Confirmă» now goes through ---------------------------------------------------
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      await expect(row.getByTestId("volunteer-guardian-state")).toContainText("Acordul părintelui primit");
      await expect(row.getByTestId("volunteer-guardian")).toContainText("din linkul trimis pe email");
      await row.getByRole("button", { name: /^Confirmă/ }).click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      await expect(row.getByTestId("volunteer-state")).toHaveText("Confirmat");
      // The CSV carries the parent and the consent.
      const csv = await (await page.request.get(`/api/admin/events/${event.id}/volunteers?lang=ro`)).text();
      expect(csv).toContain("Părinte sau tutore,Email părinte sau tutore,Acordul părintelui");
      expect(csv).toContain(`Maria Popescu,${parent},Da`);

      // --- On paper: a person of sixteen entered by hand, the consent signed at the desk ------------------------
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      await openEditorBox(page, "Adaugă un voluntar de mână");
      const add = page.getByTestId("volunteer-add");
      await add.getByRole("checkbox", { name: "Punct de apă" }).check();
      await add.getByRole("textbox", { name: "Nume", exact: true }).fill("Radu Tânărul");
      await add.getByRole("textbox", { name: "Adresa de email", exact: true }).fill(`radu.${tag}@example.test`);
      await add.getByRole("textbox", { name: "Telefon", exact: true }).fill("0712 345 678");
      await typeBirth(add.locator('input[name="birthDate"]'), typedBirth(16));
      // The parent's card, open for a minor only: a name, no address — the consent is taken on paper.
      await openFold(add.getByTestId("volunteer-guardian-field"));
      await add.locator('input[name="guardianName"]').fill("Elena Tânăru");
      await add.getByRole("button", { name: "Adaugă voluntarul", exact: true }).click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      const radu = page.locator('[data-testid="volunteer-row"]', { hasText: "Radu Tânărul" });
      await expect(radu.getByTestId("volunteer-guardian-state")).toContainText("Acordul părintelui lipsește");
      await expect(radu.getByTestId("volunteer-guardian-no-email")).toBeVisible();
      await expect(radu.getByTestId("volunteer-guardian-send-form")).toHaveCount(0);
      // The sheet to sign: a PDF, the volunteer's line and the parent's.
      const sheet = await page.request.get(`/api/admin/events/${event.id}/volunteers/${await radu.getAttribute("data-volunteer-id")}/agreement?for=guardian`);
      expect(sheet.status()).toBe(200);
      expect(sheet.headers()["content-type"]).toBe("application/pdf");
      await radu.getByRole("button", { name: "Acordul părintelui pe hârtie", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Acordul părintelui pe hârtie", exact: true }).click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      await expect(radu.getByTestId("volunteer-guardian-state")).toContainText("Acordul părintelui primit");
      await expect(radu.getByTestId("volunteer-guardian")).toContainText("semnat pe hârtie");
      const paper = await client.query(`SELECT guardian_method, guardian_recorded_by_staff_user_id IS NOT NULL AS recorded FROM event_volunteers WHERE email = $1`, [`radu.${tag}@example.test`]);
      expect(paper.rows[0]).toEqual({ guardian_method: "PAPER", recorded: true });
    } finally {
      await client.end();
    }
  });

  test("§774 a category with its contact person: the card's «Categorii» and «Categoria», the roles grouped under their headings on the volunteers' page with the contact line, an offer for a role named «Direcționare (Traseu)», and no contact in the CSV", async ({
    page,
    browser,
  }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}-cat`;
    const event = await seedEvent(tag);
    const ana = `ana.${tag}@example.test`;

    // --- The Administrator: two categories, the second moved first, a contact for it --------------
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${event.id}`);
    await hydrated(page);
    const card = page.getByTestId("event-volunteers");
    await expect(card).toBeVisible();
    await openFold(card);
    // The fold is there and empty: «Nicio categorie încă», and the roles' form draws no «Categoria» yet.
    await openEditorBox(page, "Categorii");
    await expect(page.getByTestId("volunteer-categories-empty")).toContainText("Nicio categorie încă");
    await expect(page.locator('select[name="categoryId"]')).toHaveCount(0);

    async function addCategory(nameRo: string, nameEn: string, expected: number) {
      await openEditorBox(page, "Adaugă o categorie");
      const add = page.getByTestId("volunteer-category-add");
      await add.getByLabel("Numele categoriei (Română)").fill(nameRo);
      await add.getByLabel("Numele categoriei (English)").fill(nameEn);
      await add.getByRole("button", { name: "Adaugă categoria", exact: true }).click();
      await expect(page.getByTestId("volunteer-category")).toHaveCount(expected, { timeout: 30_000 });
      await hydrated(page);
    }
    await addCategory("Start / Sosire", "Start / Finish", 1);
    await addCategory("Traseu", "Route", 2);
    await openEditorBox(page, "Categorii");
    const categoryRows = page.getByTestId("volunteer-category-name");
    await expect(categoryRows).toHaveText(["Start / Sosire", "Traseu"]);
    // The first has no contact; the arrows are drawn only where a step is possible (the first has no «up», the last no «down»).
    await expect(page.getByTestId("volunteer-category").nth(0).getByTestId("volunteer-category-contact-line")).toHaveText("Nicio persoană de contact încă.");
    await expect(page.getByTestId("volunteer-category").nth(0).getByRole("button", { name: /Mută mai sus/ })).toHaveCount(0);
    await expect(page.getByTestId("volunteer-category").nth(1).getByRole("button", { name: /Mută mai jos/ })).toHaveCount(0);
    const moveUp = page.getByTestId("volunteer-category").nth(1).getByRole("button", { name: /Mută mai sus/ });
    expect((await moveUp.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await moveUp.click();
    await expect(categoryRows).toHaveText(["Traseu", "Start / Sosire"], { timeout: 30_000 });
    await hydrated(page);

    // «Persoana de contact»: three optional boxes with a «Salvează» of their own; the telephone is read as a Romanian number.
    await openEditorBox(page, "Categorii");
    const route = page.getByTestId("volunteer-category").nth(0);
    const contact = route.getByTestId("volunteer-category-contact");
    await openFold(contact);
    await contact.getByLabel("Numele persoanei de contact").fill("Ana Popescu");
    await contact.getByLabel("Telefon", { exact: true }).fill("0712 345 678");
    await contact.getByLabel("Adresa de email").fill("coordonator@club.test");
    await contact.getByRole("button", { name: "Salvează", exact: true }).click();
    await expect(page.getByTestId("volunteer-category").nth(0).getByTestId("volunteer-category-contact-line")).toHaveText(
      "Persoana de contact: Ana Popescu · +40 712 345 678 · coordonator@club.test",
      { timeout: 30_000 },
    );
    await hydrated(page);

    // --- Roles under them: «Categoria» is a choice, the same name stands in two categories ----------
    async function addRole(nameRo: string, nameEn: string, needed: string, category: string | null) {
      const before = await page.getByTestId("volunteer-role").count();
      await openEditorBox(page, "Roluri");
      // The blank row at the end of the category's sub-card (§791); a role under none is typed in the first card's and filed by «Categoria».
      await fillRoleRow(blankRoleRow(page, category ?? "Traseu"), { nameRo, nameEn, needed, ...(category === null ? { category: "Alte roluri" } : {}) });
      await saveAllRoles(page);
      await expect(page.getByTestId("volunteer-role")).toHaveCount(before + 1, { timeout: 30_000 });
    }
    await openEditorBox(page, "Roluri");
    await addRole("Direcționare", "Guidance", "2", "Traseu");
    await addRole("Direcționare", "Guidance", "1", "Start / Sosire");
    await addRole("Foto/Video", "Photo/Video", "1", null);
    await addRole("Punct de hidratare", "Water point", "3", "Traseu");
    // The same name twice under one category is refused, naming the role and its category, and nothing is saved — what was typed stays in the row.
    await openEditorBox(page, "Roluri");
    const again = blankRoleRow(page, "Traseu");
    await fillRoleRow(again, { nameRo: "direcționare", nameEn: "Marshal", needed: "1" });
    await page.getByRole("button", { name: "Salvează toate rolurile", exact: true }).click();
    await expect(page.getByText(/„direcționare” din „Traseu”: în categoria aleasă există deja un rol cu acest nume/)).toBeVisible({ timeout: 30_000 });
    await expect(blankRoleRow(page, "Traseu").getByLabel("Nume (RO)")).toHaveValue("direcționare");
    await expect(page.getByTestId("volunteer-role")).toHaveCount(4);
    // The card lists the roles in a sub-card per category, in the category's order, «Alte roluri» last.
    await openEditorBox(page, "Roluri");
    await expect(page.getByTestId("volunteer-role-group").locator("h4")).toContainText(["Traseu", "Start / Sosire", "Alte roluri"]);
    await expect(roleGroup(page, "Traseu").locator("h4")).toContainText("2 roluri");
    await expect(roleGroup(page, "Traseu")).toContainText("Persoana de contact: Ana Popescu · +40 712 345 678 · coordonator@club.test");
    // A category with roles under it is not deleted: the sentence says why, and the category stays.
    await openEditorBox(page, "Categorii");
    const routeRow = page.getByTestId("volunteer-category").nth(0);
    await openFold(routeRow.locator("details").filter({ hasText: /^Modifică/ }));
    await routeRow.getByRole("button", { name: "Șterge categoria", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Șterge categoria", exact: true }).click();
    await page.waitForURL(/volunteerError=VOLUNTEER_CATEGORY_HAS_ROLES/);
    await hydrated(page);
    // The card is shut after the redirect: its banner says why, once it is opened.
    await openFold(card);
    await expect(page.getByText("Categoria nu s-a șters")).toBeVisible();
    await openEditorBox(page, "Categorii");
    await expect(page.getByTestId("volunteer-category")).toHaveCount(2);

    // The event takes volunteers on its page.
    await page.getByRole("checkbox", { name: "Primește voluntari pe pagină", exact: true, includeHidden: true }).click();
    await expect(page.getByTestId("volunteer-offer-state")).toContainText("pagina evenimentului trimite la ea", { timeout: 30_000 });
    await hydrated(page);

    // --- A visitor: the roles under their headings, the contact under the heading that has one ------
    const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
    try {
      const guest = await visitor.newPage();
      await expect(async () => {
        await guest.goto(`/ro/evenimente/${event.slug}/voluntari`);
        await expect(guest.getByTestId("volunteer-category-heading").first()).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 60_000 });
      await hydrated(guest);
      await expect(guest.getByTestId("volunteer-category-heading")).toHaveText(["Traseu", "Start / Sosire", "Alte activități"]);
      // Each heading is a level-3 heading, and each role stands under its own.
      await expect(guest.getByRole("heading", { level: 3, name: "Traseu" })).toBeVisible();
      const under = (heading: string) => guest.getByTestId("volunteer-category").filter({ has: guest.getByRole("heading", { level: 3, name: heading, exact: true }) });
      await expect(under("Traseu").getByTestId("volunteer-role-option")).toHaveCount(2);
      await expect(under("Start / Sosire").getByTestId("volunteer-role-option")).toHaveCount(1);
      await expect(under("Alte activități").getByRole("checkbox", { name: "Foto/Video" })).toBeVisible();
      await expect(under("Traseu").getByRole("checkbox", { name: "Direcționare" })).toBeVisible();
      // The contact: one line under the heading of the category that has one, nowhere else; links a thumb can press.
      await expect(guest.getByTestId("volunteer-contact")).toHaveCount(1);
      const line = under("Traseu").getByTestId("volunteer-contact");
      await expect(line).toContainText("Întrebări?");
      await expect(line).toContainText("Ana Popescu");
      const phone = line.getByTestId("volunteer-contact-phone");
      const mail = line.getByTestId("volunteer-contact-email");
      await expect(phone).toHaveAttribute("href", "tel:+40712345678");
      await expect(phone).toHaveText("+40 712 345 678");
      await expect(mail).toHaveAttribute("href", "mailto:coordonator@club.test");
      expect((await phone.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect((await mail.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(under("Start / Sosire").getByTestId("volunteer-contact")).toHaveCount(0);
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // §780: each category is a card of its own — its header names it and counts its roles (no filled band), its chips are inside it, and a clear space stands between two cards.
      await expect(guest.getByTestId("volunteer-category")).toHaveCount(3);
      await expect(guest.getByTestId("volunteer-category-count")).toHaveText(["2 roluri", "1 rol", "1 rol"]);
      const cards = guest.getByTestId("volunteer-category");
      const cardBoxes = [];
      for (let index = 0; index < 3; index++) cardBoxes.push((await cards.nth(index).boundingBox())!);
      for (let index = 0; index < 3; index++) {
        const card = cardBoxes[index];
        const band = (await cards.nth(index).getByTestId("volunteer-category-header").boundingBox())!;
        const tile = (await cards.nth(index).getByTestId("volunteer-role-option").first().boundingBox())!;
        // The header is the card's top; the chip is inside the card, under the header; nothing leaves the card sideways.
        expect(band.y).toBeLessThanOrEqual(card.y + 2);
        expect(tile.y).toBeGreaterThanOrEqual(band.y + band.height);
        expect(tile.x).toBeGreaterThanOrEqual(card.x);
        expect(tile.x + tile.width).toBeLessThanOrEqual(card.x + card.width + 1);
        expect(tile.y + tile.height).toBeLessThanOrEqual(card.y + card.height + 1);
        // At least sixteen pixels of empty space between this card and the next one.
        if (index < 2) expect(cardBoxes[index + 1].y - (card.y + card.height)).toBeGreaterThanOrEqual(16);
      }
      // The route's two chips, inside one card, in one wrap row: neither leaves the card, whatever the width.
      const [first, second] = await Promise.all([0, 1].map(async (index) => (await cards.nth(0).getByTestId("volunteer-role-option").nth(index).boundingBox())!));
      for (const chip of [first, second]) {
        expect(chip.x).toBeGreaterThanOrEqual(cardBoxes[0].x);
        expect(chip.x + chip.width).toBeLessThanOrEqual(cardBoxes[0].x + cardBoxes[0].width + 1);
        expect(chip.height).toBeGreaterThanOrEqual(44);
      }
      // The heading is the card's loudest line: the name at 18 px or more, bold, on the card's own surface (no filled band behind it).
      expect(await cards.first().getByTestId("volunteer-category-heading").evaluate((heading) => parseFloat(getComputedStyle(heading).fontSize))).toBeGreaterThanOrEqual(18);
      expect(await cards.first().getByTestId("volunteer-category-header").evaluate((header) => getComputedStyle(header).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

      // She offers for «Direcționare» on the route: a press on the chip's name (not on the box) ticks it (§780).
      await under("Traseu").getByTestId("volunteer-role-option").filter({ hasText: "Direcționare" }).getByTestId("volunteer-role-name").click();
      await expect(under("Traseu").getByRole("checkbox", { name: "Direcționare" })).toBeChecked();
      await guest.getByLabel("Numele tău").fill("Ana Test");
      await guest.getByLabel("Adresa ta de email").fill(ana);
      // Not the contact person's number: the CSV below must hold the volunteer's own and nobody else's.
      await guest.locator('[name="phone"]').fill("722000111");
      await typeBirth(guest.locator('input[name="birthDate"]'), typedBirth(34));
      await chooseSex(guest, "FEMALE");
      await guest.locator('input[name="city"]').fill("Brașov");
      await guest.locator('input[name="consent"]').check();
      await guest.locator('input[name="agreement"]').check();
      await guest.waitForTimeout(1_200);
      await guest.getByTestId("volunteer-box").getByRole("button", { name: "Mă ofer voluntar", exact: true }).click();
      await expect(guest.getByTestId("volunteer-done")).toBeVisible({ timeout: 30_000 });
    } finally {
      await visitor.close();
    }

    // --- The Administrator: the offer names the role with its category; the CSV names it so and holds no contact ----
    await page.goto(`/ro/admin/events/${event.id}`);
    await hydrated(page);
    const row = page.getByTestId("volunteer-unassigned").getByTestId("volunteer-row");
    await expect(row.getByTestId("volunteer-choice")).toHaveText(["Direcționare (Traseu)"]);
    const assign = row.getByRole("button", { name: /^Dă-i rolul Direcționare \(Traseu\)/ });
    expect((await assign.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await assign.click();
    await expect(page.getByTestId("volunteer-group").filter({ has: page.locator("h3").getByText("Direcționare (Traseu)", { exact: true }) }).getByTestId("volunteer-role-standing")).toHaveText("1 din 2", {
      timeout: 30_000,
    });
    const csv = await page.request.get(`/api/admin/events/${event.id}/volunteers?lang=ro`);
    expect(csv.status()).toBe(200);
    const text = await csv.text();
    expect(text).toContain("Direcționare (Traseu)");
    expect(text).not.toMatch(/Ana Popescu|coordonator@club\.test|0712 345 678|\+40 ?712 ?345 ?678/);
  });

  test("§784 a role «fără număr»: the tick «Nelimitat» on the role's row, «0 · fără număr» on the card, offered on the page whoever it was given to, and never a number on it", async ({ page, browser }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}-nonum`;
    const event = await seedEvent(tag);
    const emails = ["maria", "ion", "dana"].map((name) => `${name}.${tag}@example.test`);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${event.id}`);
    await hydrated(page);
    const card = page.getByTestId("event-volunteers");
    await expect(card).toBeVisible();
    const group = (name: string) => page.getByTestId("volunteer-group").filter({ has: page.locator("h3").getByText(name, { exact: true }) });

    // --- The blank row: a number, then the tick ---------------------------------------------------
    await openEditorBox(page, "Roluri");
    await fillRoleRow(blankRoleRow(page), { nameRo: "Sosire", nameEn: "Finish", needed: "1" });
    await saveAllRoles(page);
    await expect(roleRow(page, "Sosire")).toBeAttached({ timeout: 30_000 });

    await openEditorBox(page, "Roluri");
    let blank = blankRoleRow(page);
    await fillRoleRow(blank, { nameRo: "Ajutor", nameEn: "Helper" });
    const numberBox = blank.getByLabel("Câte persoane", { exact: true });
    const noNumber = blank.getByRole("checkbox", { name: "Nelimitat" });
    // The tick is a real checkbox a thumb can press; the number box is shown until it is ticked, never `required`.
    await expect(noNumber).not.toBeChecked();
    expect((await noNumber.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(numberBox).toBeVisible();
    await expect(numberBox).not.toHaveAttribute("required", "");
    // Neither a number nor the tick: refused, the sentence naming the role, and what was typed comes back.
    await numberBox.fill("");
    await page.getByRole("button", { name: "Salvează toate rolurile", exact: true }).click();
    await expect(page.getByText(/„Ajutor” din „Alte roluri”: scrie câte persoane trebuie/)).toBeVisible({ timeout: 30_000 });
    await hydrated(page);
    blank = blankRoleRow(page);
    await expect(blank.getByLabel("Nume (RO)")).toHaveValue("Ajutor");
    await expect(blank.getByLabel("Câte persoane", { exact: true })).toHaveAttribute("aria-invalid", "true");
    // Ticked: the number box goes (the stylesheet alone), and the role is saved without one.
    await blank.getByRole("checkbox", { name: "Nelimitat" }).check();
    await expect(blank.getByLabel("Câte persoane", { exact: true })).toBeHidden();
    await saveAllRoles(page);
    await expect(roleRow(page, "Ajutor")).toBeAttached({ timeout: 30_000 });

    // --- The card: «0 · fără număr», and the closed line counts only the numbered role -----------
    await openEditorBox(page, "Roluri");
    await expect(group("Sosire").getByTestId("volunteer-role-standing")).toHaveText("0 din 1");
    await expect(group("Ajutor").getByTestId("volunteer-role-standing")).toHaveText("0 · fără număr");
    await expect(card.locator("summary").first()).toContainText("0 din 1 + roluri fără număr");
    // The role's row: the tick is on, so the box that would say a number is not shown.
    const ajutor = roleRow(page, "Ajutor");
    await expect(ajutor.getByRole("checkbox", { name: "Nelimitat" })).toBeChecked();
    await expect(ajutor.getByLabel("Câte persoane", { exact: true })).toBeHidden();

    // --- The event takes volunteers: its page lists both roles, the volunteers' page offers both -------
    await page.goto(`/ro/admin/events/${event.id}`);
    await hydrated(page);
    await openFold(card);
    await page.getByRole("checkbox", { name: "Primește voluntari pe pagină", exact: true, includeHidden: true }).click();
    await expect(page.getByTestId("volunteer-offer-state")).toContainText("pagina evenimentului trimite la ea", { timeout: 30_000 });
    await hydrated(page);

    const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
    try {
      const guest = await visitor.newPage();
      await expect(async () => {
        await guest.goto(`/ro/evenimente/${event.slug}`);
        await expect(guest.getByTestId("volunteer-callout-line")).toHaveText("Căutăm voluntari: Sosire, Ajutor", { timeout: 3_000 });
      }).toPass({ timeout: 60_000 });

      async function offer(name: string, email: string, role: string) {
        await guest.goto(`/ro/evenimente/${event.slug}/voluntari`);
        await hydrated(guest);
        await guest.getByTestId("volunteer-roles").getByRole("checkbox", { name: role }).check();
        await guest.getByLabel("Numele tău").fill(name);
        await guest.getByLabel("Adresa ta de email").fill(email);
        await guest.locator('[name="phone"]').fill("712345678");
        await typeBirth(guest.locator('input[name="birthDate"]'), typedBirth(34));
        await chooseSex(guest, "FEMALE");
        await guest.locator('input[name="city"]').fill("Brașov");
        await guest.locator('input[name="consent"]').check();
        await guest.locator('input[name="agreement"]').check();
        // A person takes a moment: the form's timing check refuses a post within the second of its render.
        await guest.waitForTimeout(1_200);
        await guest.getByTestId("volunteer-box").getByRole("button", { name: "Mă ofer voluntar", exact: true }).click();
        await expect(guest.getByTestId("volunteer-done")).toContainText("Am primit oferta ta", { timeout: 30_000 });
      }
      const give = async (name: string) => {
        await page.goto(`/ro/admin/events/${event.id}`);
        await hydrated(page);
        await page.locator('[data-testid="volunteer-unassigned"] [data-testid="volunteer-row"]', { hasText: name }).getByRole("button", { name: /^Dă-i rolul Ajutor/ }).click();
        await page.waitForURL(/#box-volunteers$/);
        await hydrated(page);
      };

      await offer("Maria Test", emails[0], "Ajutor");
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      // The press says how the role stands before it gives it: no «din».
      await expect(page.locator('[data-testid="volunteer-unassigned"] [data-testid="volunteer-row"]', { hasText: "Maria Test" }).getByRole("button", { name: /^Dă-i rolul Ajutor/ })).toContainText("Ajutor · 0 · fără număr");
      await give("Maria Test");
      await offer("Ion Test", emails[1], "Ajutor");
      await give("Ion Test");
      await expect(group("Ajutor").getByTestId("volunteer-role-standing")).toHaveText("2 · fără număr");
      await expect(card.locator("summary").first()).toContainText("0 din 1 + roluri fără număr");

      // Two people on it, and the page still offers it — and the numbered role beside it, still empty.
      await guest.goto(`/ro/evenimente/${event.slug}/voluntari`);
      await hydrated(guest);
      const choices = guest.getByTestId("volunteer-roles");
      await expect(choices.getByRole("checkbox", { name: "Ajutor" })).toBeVisible();
      await expect(choices.getByRole("checkbox", { name: "Sosire" })).toBeVisible();
      // Counts off: neither says a word about how many. Counts on (the club's tick): «Sosire» says its number, «Ajutor» still says no number.
      await expect(choices.getByTestId("volunteer-role-needs")).toHaveCount(0);
      await page.goto(`/ro/admin/events/${event.id}`);
      await hydrated(page);
      await openFold(card);
      await page.getByTestId("volunteer-counts-form").getByRole("checkbox", { name: "Arată public câți voluntari mai sunt necesari", includeHidden: true }).click();
      await page.waitForURL(/#box-volunteers$/);
      await hydrated(page);
      await expect(async () => {
        await guest.reload();
        await expect(guest.getByTestId("volunteer-roles").getByTestId("volunteer-role-option").filter({ hasText: "Sosire" }).getByTestId("volunteer-role-needs")).toHaveText("mai e nevoie de 1 persoană", { timeout: 3_000 });
      }).toPass({ timeout: 60_000 });
      const ajutorTile = guest.getByTestId("volunteer-roles").getByTestId("volunteer-role-option").filter({ hasText: "Ajutor" });
      await expect(ajutorTile.getByTestId("volunteer-role-needs")).toHaveCount(0);
      await expect(ajutorTile).not.toContainText(/\d+ persoan/);
      // A third person signs up for it too: never «full».
      await offer("Dana Test", emails[2], "Ajutor");
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
    await expect(page.getByTestId("volunteer-callout")).toHaveCount(0);
    // The volunteers' own page answers 404 while the event takes none: never a form that cannot be sent (§768).
    const answered = await page.request.get(`/ro/evenimente/voluntari-${tag}/voluntari`);
    expect(answered.status()).toBe(404);
    expect((await page.request.get(`/en/events/volunteers-${tag}/volunteers`)).status()).toBe(404);
  });
});
