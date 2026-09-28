import { expect, type Locator, test } from "@playwright/test";
import { mintActionLink, registrationByEmail, registrationStatus } from "./support/action-link";
import { chooseSex } from "./support/sex-choice";
import {
  ensureRegistrationIsOpen,
  FEATURED,
  HUMAN_PAUSE_MS,
  signIn,
} from "./support/featured-event";

/** The number in "50 de locuri libere" / "3 locuri libere" / "1 loc liber", inside `scope`. */
async function freePlaces(scope: Locator): Promise<number> {
  const text = await scope.getByText(/\d+ (de )?loc(uri)? liber/).first().textContent();
  const places = Number(/(\d+)/.exec(text ?? "")?.[1]);
  expect(Number.isInteger(places), `a number of free places, got "${text}"`).toBe(true);
  return places;
}

/**
 * BR-REQ-030-01, BR-REQ-031-01 — a visitor can actually reach the registration form.
 * BR-REQ-034-01 — the free-place count is on the page.
 * BR-REQ-041-01 — the whole journey works at 320px as well as on a desktop.
 * §346 — how full the event is, read from the same numbers as the free-place count.
 *
 * The registration lifecycle was built, tested and unreachable: `/events/[slug]/register`
 * existed and nothing on the site linked to it. This walks the door that was missing — the
 * featured event on the landing page, through to a submitted form.
 *
 * Runs against the seeded database (`docker compose up -d db && yarn db:seed`), and signs in
 * through the development staff switcher like `cms-publish.spec.ts`. The setup it shares with
 * `registration-form.spec.ts` lives in `support/featured-event.ts`.
 */

test.describe("BR-REQ-030-01 the featured event leads to the registration form", () => {
  test("walks hero → register → submitted, and shows the free places on the way", async ({
    page,
  }) => {
    // A registration, its email link and two reads of the count afterwards, under load.
    test.setTimeout(90_000);
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);

    // The event page's count, read first — and so cached (§333): what follows proves the hold
    // taken below expires it, rather than a cold read that would have been right anyway.
    await page.goto(`/ro/evenimente/${FEATURED.slug}`);
    const placesOnPage = await freePlaces(page.locator("#main"));

    await page.goto("/ro/evenimente");

    // The featured event is the first card of the grid since §470, still a region named by its title.
    const hero = page.getByRole("region", { name: new RegExp(FEATURED.title) });
    await expect(hero).toBeVisible();
    // BR-REQ-034-01: the count is a number of places, stated in words next to the button.
    await expect(hero.getByText(/locuri libere/)).toBeVisible();
    const placesOnListing = await freePlaces(hero);
    // §409: the card's bold line says the free places out of the event's fifty — the allocator's
    // number, from the same cached read as the page (§333). Loosely matched: other Playwright
    // projects register real people against this same shared event. Romanian puts "de" before the
    // noun from twenty on ("20 de locuri libere"), so both forms are accepted (`count-form.ts`).
    await expect(hero.getByTestId("card-places")).toHaveText(/^\d+ (de )?(locuri libere|loc liber) din 50$/);
    expect(placesOnListing).toBeLessThanOrEqual(50);

    const enter = hero.getByRole("link", { name: "Înscrie-te la eveniment" });
    // BR-REQ-041-01 criterion 6: a 44px tap target, on the page whose whole purpose is to be
    // tapped on a phone.
    const box = await enter.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await enter.click();
    await expect(page).toHaveURL(new RegExp(`/ro/evenimente/${FEATURED.slug}/inscriere$`));

    // Criterion 1: the document never wider than the viewport, on the new page too.
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);

    // BR-REQ-080-03: the test run captures every email (AGENTS.md §16.4), and the form says so
    // before anybody types an address they will then watch an inbox for. Two testers on QA
    // waited for a message that was never coming; this is the sentence they did not have.
    const captureNotice = /emailurile nu se trimit deloc de aici/;
    await expect(page.getByText(captureNotice)).toBeVisible();

    // Unique per project and per run: a second registration for the same address on the same
    // event is a duplicate, and would be answered with the same generic success — which would
    // make this assertion pass while proving nothing.
    const address = `e2e-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;
    // BR-REQ-031-04: every field the public form insists on. Filled through the rendered
    // page rather than posted directly, so a field added to the schema without being added
    // to the form fails here instead of on a race morning.
    await page.locator('[name="firstName"]').fill("Ana");
    await page.locator('[name="lastName"]').fill("Popescu");
    await page.locator('[name="email"]').fill(address);
    // The same address again (§206): the form asks for it twice and the action refuses a mismatch.
    await page.locator('[name="emailConfirm"]').fill(address);
    await page.locator('[name="birthDate"]').fill("1990-05-17");
    await page.locator('[name="city"]').fill("Brașov");

    // The country, the citizenship and the t-shirt size carry a default the schema accepts
    // (§432, §510) and are left untouched on purpose: somebody who fills in only the text
    // fields and answers «Sex» is accepted. «Sex» alone starts empty (§510) — an answer
    // nobody gave is not one — so it is chosen.
    await chooseSex(page);
    await page.locator('[name="phone"]').fill("+40711111111");
    await page.locator('[name="emergencyContactName"]').fill("Ion Popescu");
    await page.locator('[name="emergencyContactPhone"]').fill("+40722222222");
    await page.locator('[name="privacyAcknowledged"]').check();
    // The race conditions (§195): the seeded events carry none of their own, so this is the
    // plain-checkbox branch rather than the panel.
    await page.locator('[name="rulesAcknowledged"]').check();
    // The club's terms, accepted expressly (§421).
    await page.locator('[name="termsAccepted"]').check();
    // Required since §171, beside the privacy acknowledgment.
    await page.locator('[name="fitnessDeclared"]').check();

    // BR-REQ-039-02: the display name is behind a collapsed <details>, closed by default,
    // and left alone here — a submission that never opens it must still be accepted, and the
    // stored display name is then the legal name. The t-shirt, club and health questions are
    // collapsed for the same reason; `registration-form.spec.ts` is where that is asserted.

    // The submission timing check answers a too-fast form with the same generic success it
    // gives a real one, so a test that submitted immediately would pass without ever creating
    // a registration.
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    // The screen after the form greets by first name, from the form just posted (§224); the
    // same sentence for a first and a repeat registration, because nothing on it is read from
    // the registrations table (AGENTS.md §19.4).
    await expect(page.getByRole("heading", { name: "Aproape gata!", exact: true })).toBeVisible();
    // The same capture notice here, where somebody would otherwise stand with an inbox open.
    await expect(page.getByText(captureNotice)).toBeVisible();
    /*
      After the first form, the short screen (§536, amending §519; the owner, 2026-09-28): the heading,
      then exactly three lines and one button — whose form is in, when its email leaves (the e2e server
      sends on the request, so «acum»), and one question with one answer — and one true sentence under
      it. No «Gata», no steps, no wait box.
    */
    await expect(page.getByTestId("check-email-form-in")).toHaveText("Formularul pentru Ana a ajuns.");
    await expect(page.getByTestId("check-email-leaves")).toHaveText(`Emailul către ${address} pleacă acum.`);
    // §NNN: no bold question and no primary button — one quiet line after the email's, «Înscriu încă o persoană cu această adresă».
    await expect(page.getByRole("heading", { name: "Mai înscrii pe cineva cu aceeași adresă?" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Da, încă o persoană" })).toHaveCount(0);
    await expect(page.getByTestId("family-sitting-offer-hint")).toHaveText(/^Dacă înscrii încă o persoană, următorul email așteaptă cel mult .+ după ultimul formular și îi cuprinde pe toți\.$/);
    await expect(page.getByRole("button", { name: "Nu, gata — trimite-mi emailul" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Ce urmează" })).toHaveCount(0);
    // BR-REQ-041-01 criterion 6: the quiet line is still a real target on a phone.
    const yesBox = await page.getByRole("button", { name: "Înscriu încă o persoană cu această adresă" }).boundingBox();
    expect(yesBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    /*
      BR-REQ-034-01 with the public cache in front of it (§333): the count both pages showed
      came from the cache, and the email link below takes a place (the hold). The next visitor
      must see one place fewer — which is the allocator's number, not the cached one, only if the
      hold expired the cache. "Fewer", not "one fewer": the other viewport's run registers against
      the same event at the same time.
    */
    const registration = await registrationByEmail(address);
    await page.goto(`/ro/inregistrari/confirmare/${await mintActionLink(registration, "VERIFY_REGISTRATION_EMAIL")}`);
    await expect(page).toHaveURL(/done=1/, { timeout: 30_000 });
    expect(await registrationStatus(registration.id)).toBe("PENDING_DECLARATION");

    await page.goto(`/ro/evenimente/${FEATURED.slug}`);
    expect(await freePlaces(page.locator("#main"))).toBeLessThan(placesOnPage);
    await page.goto("/ro/evenimente");
    expect(await freePlaces(page.getByRole("region", { name: new RegExp(FEATURED.title) }))).toBeLessThan(placesOnListing);
  });

  test("offers the same door on the event's own page", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);

    await page.goto(`/ro/evenimente/${FEATURED.slug}`);

    const enter = page.getByRole("link", { name: "Înscrie-te la eveniment" });
    await expect(enter).toBeVisible();
    await enter.click();
    await expect(page).toHaveURL(new RegExp(`/inscriere$`));
    await expect(page.getByRole("heading", { name: new RegExp(FEATURED.title) })).toBeVisible();
  });
});

test.describe("BR-REQ-030-01 criterion 1 an event that takes no registration", () => {
  test("offers no registration control at all", async ({ page }) => {
    // The three other seeded events are `NONE` group runs: no button that cannot work, and —
    // since §111 — not a word about registration either, because a group run is simply turned
    // up to ("group runs don't have registrations!").
    await page.goto("/ro/evenimente/tura-pe-tampa");

    await expect(page.getByRole("link", { name: "Înscrie-te la eveniment" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Intră pe lista de așteptare" })).toHaveCount(0);
    await expect(page.locator("#main").getByText(/înscriere/i)).toHaveCount(0);
  });
});
