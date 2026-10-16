import { expect, test } from "@playwright/test";
import { ensureRegistrationIsOpen, FEATURED, hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN — «Pagini» → «Membri» → «Cine e membru»: the sentence behind the «?» after «Sunt membru al grupului»
 * on the registration form is the club's own once it writes it, in both languages or neither, and the
 * platform's again once it clears it.
 *
 * The real production build, so what is proved includes the public cache: the register page reads the
 * sentence through it, and the save must expire it — a page still saying yesterday's words after the save
 * is the defect this is here for. The English side of the same read, the volunteers' form and the card's
 * markup are `tests/unit/volunteers/member-definition-help.test.ts`, `tests/unit/content/member-definition-card.test.ts`
 * and `tests/integration/cms/member-definition-action.test.ts`.
 */

const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;
const PLATFORM = "Am fost la cel puțin 3 alergări de grup în ultimele 6 luni.";
const CLUB_RO = "Ai fost la cel puțin 5 alergări de grup în ultimele 3 luni.";
const CLUB_EN = "You have joined at least 5 group runs in the last 3 months.";

test.describe.serial("§NNN «Cine e membru» on «Membri»", () => {
  test("the club's sentence replaces the platform's behind the «?» on the registration form; one language alone is refused; cleared, the platform's is back", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);

    /** The «?» in the member tick's own label: the button's accessible name is the sentence. */
    const sentenceOnTheForm = async () => {
      await page.goto(registerPath);
      await hydrated(page);
      return page.locator("label", { has: page.locator('[name="clubMemberDeclared"]') }).getByRole("button").getAttribute("aria-label");
    };
    expect(await sentenceOnTheForm()).toBe(PLATFORM);

    const openCard = async () => {
      await page.goto("/ro/admin/pages/members");
      await hydrated(page);
      const card = page.locator("#members-definition");
      await openFold(card);
      return card;
    };

    // The empty boxes show the platform's words as their placeholder; the card's state says so.
    let card = await openCard();
    let form = card.getByTestId("members-definition-form");
    await expect(card).toContainText("textul de bază");
    await expect(form.locator('[name="memberDefinitionRo"]')).toHaveAttribute("placeholder", PLATFORM);

    // Romanian alone: refused on the English box, named (§47), the English tab on top with it (§352).
    await form.locator('[name="memberDefinitionRo"]').fill(CLUB_RO);
    await form.getByRole("button", { name: "Salvează" }).click();
    await expect(page.getByTestId("form-refusal")).toContainText("Cine e membru (engleză)", { timeout: 20_000 });
    card = page.locator("#members-definition");
    form = card.getByTestId("members-definition-form");
    await expect(form.getByRole("tab", { name: /^EN/ })).toHaveAttribute("aria-selected", "true");
    // The Romanian box came back as typed (§315).
    await expect(form.locator('[name="memberDefinitionRo"]')).toHaveValue(CLUB_RO);

    // Both written: saved, and the register page says it at once — the public cache expired by the save.
    await form.locator('[name="memberDefinitionEn"]').fill(CLUB_EN);
    await form.getByRole("button", { name: "Salvează" }).click();
    await expect(page).toHaveURL(/saved=memberDefinitionSaved/, { timeout: 20_000 });
    expect(await sentenceOnTheForm()).toBe(CLUB_RO);

    // Both emptied: the platform's words are back on the form.
    card = await openCard();
    await expect(card).toContainText("textul clubului");
    form = card.getByTestId("members-definition-form");
    await expect(form.locator('[name="memberDefinitionRo"]')).toHaveValue(CLUB_RO);
    await form.locator('[name="memberDefinitionRo"]').fill("");
    await form.getByRole("tab", { name: /^EN/ }).click();
    await form.locator('[name="memberDefinitionEn"]').fill("");
    await form.getByRole("button", { name: "Salvează" }).click();
    await expect(page).toHaveURL(/saved=memberDefinitionSaved/, { timeout: 20_000 });
    expect(await sentenceOnTheForm()).toBe(PLATFORM);
  });
});
