import { expect, test } from "@playwright/test";
// One sign-in helper, in `support/`: this file kept a second copy, and the two drifted the day
// one of them needed a longer wait than the other.
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-051-01 — editorial workflow, over HTTP.
 * BR-REQ-051-02 — the preview is refused without staff authorization.
 * BR-REQ-060-01 criterion 3 — an unauthenticated request to /admin is refused.
 *
 * These run against the seeded database (`docker compose up -d db && yarn db:seed`) and sign
 * in through the development staff switcher, which is what AGENTS.md §20.4 means by "local
 * E2E uses mock staff auth".
 *
 * The publishing journey mutates real rows, so each Playwright project works on a different
 * event: the two projects run in parallel, and two browsers unpublishing the same event would
 * collide on the version guard — correctly, but as a flake rather than a finding.
 */

/**
 * One event per project, and neither is read by another spec.
 *
 * Publication is one state for the whole event now (`DECISIONS.md` §28), so unpublishing takes
 * both languages off the site at once — which is exactly why two projects must not share an
 * event.
 */
const EVENT_BY_PROJECT: Record<string, { title: string; slug: string; englishSlug: string }> = {
  mobile: {
    title: "Alergare de duminică",
    slug: "alergare-de-duminica-parcul-tractorul",
    englishSlug: "sunday-run-tractorul-park",
  },
  desktop: {
    title: "Antrenament de intervale",
    slug: "antrenament-de-intervale-olimpia",
    englishSlug: "interval-session-olimpia",
  },
};

test.describe("BR-REQ-060-01 the backoffice refuses an anonymous request", () => {
  test("sends a signed-out visitor to sign in rather than showing the backoffice", async ({
    page,
  }) => {
    const response = await page.goto("/ro/admin");

    // Locally there is a way in, so the answer is the sign-in page. What must never happen is
    // the backoffice rendering: the guard is on the server, not on the buttons.
    await expect(page).toHaveURL(/\/ro\/autentificare$/);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Administrare" })).toHaveCount(0);
  });

  /**
   * The URLs a person types. `/admin` and `/sign-in` already worked unprefixed because next-intl
   * resolves an internal route name to each locale's own path; `/login` answered 404, which
   * reads as "there is no backoffice here" rather than "that is not its name".
   */
  // A loop rather than `test.each`, which Playwright's runner does not have.
  //
  // The unprefixed forms negotiate the locale from the browser's own Accept-Language, so they
  // are allowed to land on either language's sign-in path — Playwright sends `en`. A path that
  // states its locale must honour it.
  for (const [path, expected] of [
    ["/admin", /\/(ro\/autentificare|en\/sign-in)$/],
    ["/login", /\/(ro\/autentificare|en\/sign-in)$/],
    ["/en/login", /\/en\/sign-in$/],
    ["/ro/login", /\/ro\/autentificare$/],
  ] as const) {
    test(`sends ${path} to the sign-in page`, async ({ page }) => {
      const response = await page.goto(path);
      await expect(page).toHaveURL(expected);
      expect(response?.status()).toBe(200);
    });
  }

  test("refuses a draft preview to a signed-out visitor", async ({ page }) => {
    // The id does not have to exist: authorization is asserted before anything is read, so an
    // anonymous request never learns whether it does.
    await page.goto("/ro/previzualizare/evenimente/11111111-1111-1111-1111-111111111111");
    await expect(page).toHaveURL(/\/ro\/autentificare$/);
  });

  test("tells crawlers not to index the backoffice or the preview", async ({ page }) => {
    const admin = await page.goto("/ro/admin");
    expect(admin?.headers()["x-robots-tag"]).toContain("noindex");
    expect(admin?.headers()["cache-control"]).toContain("no-store");
  });
});

test.describe("BR-REQ-051-01 a copywriter writes and may not publish; a volunteer has the desk (§103)", () => {
  test("shows a copywriter the text and no publish control, and says the settings are not theirs", async ({ page }) => {
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/admin");

    const event = EVENT_BY_PROJECT[test.info().project.name];
    await page.getByRole("link", { name: event.title }).first().click();
    await expect(page).toHaveURL(/\/admin\/events\//);

    // Publication is the event's, so the control a copywriter must not see is the event's too.
    await expect(page.getByRole("button", { name: "Publică" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mută în ciornă" })).toHaveCount(0);

    // The words are theirs: the Romanian title is a field, not a sentence about permissions.
    const romanian = page.getByRole("tabpanel", { name: /Română/ });
    await expect(romanian.getByRole("textbox", { name: "Titlu", exact: true })).toBeVisible();
    await expect(romanian.getByText(/Nu poți edita acest text/)).toHaveCount(0);

    // A copywriter owns no settings, and the panel says so rather than being missing.
    await expect(page.getByText(/Doar un editor sau un administrator/)).toBeVisible();
  });

  test("takes a volunteer to the desk and offers only the desk and the guide", async ({ page }) => {
    await signIn(page, "Dev Contributor");
    await expect(page).toHaveURL(/\/ro\/admin\/checkin$/);
    await expect(page.getByRole("tab", { name: "Ziua cursei" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Evenimente" })).toHaveCount(0);
  });

  test.describe.configure({ mode: "parallel" });
  for (const identity of ["Dev Copywriter", "Dev Contributor"] as const) {
    test(`refuses ${identity} the staff page and the new-event form`, async ({ page }) => {
      await signIn(page, identity);
      // 404, the same answer a route that does not exist gives: nobody is told the page is
      // there and refused (BR-REQ-060-01).
      expect((await page.goto("/ro/admin/staff"))?.status()).toBe(404);
      expect((await page.goto("/ro/admin/events/new"))?.status()).toBe(404);
    });
  }
});

test.describe("BR-REQ-050-02 an Administrator creates an event without a developer (§204)", () => {
  test("creates it in both languages, as a draft", async ({ page }) => {
    // Unique per project *and* per run: the two projects run in parallel against one database,
    // and `UNIQUE(locale, slug)` would otherwise make the second run of the suite fail on rows
    // the first one created. A spec that only passes against a freshly seeded database is a
    // spec people stop running.
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);

    // By field name rather than by label: MUI marks a required label with an asterisk, and the
    // names are the contract the Server Action actually reads.
    const field = (name: string) => page.locator(`[name="${name}"]`);

    // The names are namespaced now: the editor is one form carrying the event row and both
    // languages, so `event.*` and `translations.<locale>.*` say which half each field belongs to.
    // A date and a time, each on MUI's picker (`DECISIONS.md` §70, §NNN).
    await fillDateField(page, "Începutul evenimentului", "2027-05-01");
    await fillTimeField(page, "Ora", "09:00");
    // The meeting point is asked once, in Settings: it is the same place whichever language the
    // page is read in (`DECISIONS.md` §36).
    await field("event.locationName").fill("Parcul Tractorul");
    // The languages are the editor's own tabs on the create form too: the Romanian panel is
    // in view, the English one behind its tab, and a hidden box cannot be filled.
    await field("translations.ro.title").fill(`Cros de probă ${suffix}`);
    await field("translations.ro.slug").fill(`cros-de-proba-${suffix}`);
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`Trial cross ${suffix}`);
    await field("translations.en.slug").fill(`trial-cross-${suffix}`);

    await page.getByRole("button", { name: "Creează evenimentul" }).click();

    // Straight to the new event's own page, as a draft: nothing is published by being created.
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
    // The content panels are tabs now, one per language, Romanian first.
    await expect(page.getByRole("tab", { name: /English/ })).toBeVisible();
  });

  /*
    §315. The owner: "if I submit an invalid form (eg: event creation) the entire page gets
    cleared" — and an hour later: "nu ar trebui sa pot crea evenimentul daca am campuri invalide!"
    Two refusals, and neither may cost a single box: the browser's own, before anything leaves
    (the title is `required` because the schema requires it), and the server's, for whatever the
    browser cannot know — simulated here by switching the browser's check off, which is exactly
    what a browser that does not validate would post.
  */
  test("refuses a missing title in the browser, and a refusal from the server keeps every box", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await fillDateField(page, "Începutul evenimentului", "2027-05-02");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("translations.ro.slug").fill(`fara-titlu-${suffix}`);
    const romanian = page.locator("#locale-panel-ro");
    await romanian.locator("summary").filter({ hasText: "Rezumat" }).click();
    await romanian.locator('[data-rich-text="translations.ro.excerptBody"] [data-field]').click();
    await page.keyboard.type("Zece kilometri prin parc.");
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`Untitled ${suffix}`);
    await field("translations.en.slug").fill(`untitled-${suffix}`);

    // The three islands that rebuild themselves from the posted names after a refusal
    // (`ScheduleRowsEditor`, `CoHostRowsEditor`, `RepeatToggle`): a type that has a programme,
    // one programme row, one partner, and the repeat tick with a cadence that is not the default.
    await page.getByRole("combobox", { name: /Tip eveniment/ }).click();
    await page.getByRole("option", { name: "Alt eveniment" }).click();
    // "Ora" also labels the event's own time-of-day, already filled above — the second one in
    // the accessibility tree is the programme row's.
    await fillDateField(page, "Data", "2027-05-02");
    await fillTimeField(page, "Ora", "10:00", 1);
    await field("event.schedule[0].ro").fill("Startul");
    await field("event.schedule[0].en").fill("The start");
    await field("event.coHosts[0].name").fill("Clubul Prietenilor");
    await field("event.coHosts[0].url").fill("https://example.org/prieteni");
    await field("repeat.on").check();
    await field("repeat.cadence").selectOption("FORTNIGHTLY");

    // The button says why it waits, naming the language as well as the box.
    await expect(page.getByText("Completează mai întâi: Română: Titlu")).toBeVisible();

    // The browser's own refusal: nothing leaves, the Romanian tab comes forward on its title.
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/new$/);
    await expect(field("translations.ro.title")).toBeVisible();
    expect(await field("translations.ro.title").evaluate((input) => (input as HTMLInputElement).validity.valueMissing)).toBe(true);

    // The server's refusal, with the browser's check off: the summary names the title, and every
    // box is as it was typed — the rich summary too — with nothing of it in the address bar.
    await page.locator('form[data-testid="event-create-form"]').evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal.getByRole("link", { name: "Română: Titlu" })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/events\/new$/);
    await expect(field("event.locationName")).toHaveValue("Parcul Tractorul");
    await expect(field("event.startsAtDate")).toHaveValue("2027-05-02");
    await expect(field("translations.ro.slug")).toHaveValue(`fara-titlu-${suffix}`);
    await expect(field("translations.ro.excerptBody")).toHaveValue(/Zece kilometri prin parc\./);
    await expect(field("translations.en.title")).toHaveValue(`Untitled ${suffix}`);
    // The islands, re-mounted from the posted names: the type, the programme row, the partner,
    // the repeat tick and its cadence — each as it was chosen, none back at its default.
    await expect(field("event.type")).toHaveValue("MEETUP");
    await expect(page.getByRole("combobox", { name: /Tip eveniment/ })).toContainText("Alt eveniment");
    await expect(field("event.schedule[0].date")).toHaveValue("2027-05-02");
    await expect(field("event.schedule[0].time")).toHaveValue("10:00");
    await expect(field("event.schedule[0].ro")).toHaveValue("Startul");
    await expect(field("event.schedule[0].en")).toHaveValue("The start");
    await expect(field("event.coHosts[0].name")).toHaveValue("Clubul Prietenilor");
    await expect(field("event.coHosts[0].url")).toHaveValue("https://example.org/prieteni");
    await expect(field("repeat.on")).toBeChecked();
    await expect(field("repeat.cadence")).toBeVisible();
    await expect(field("repeat.cadence")).toHaveValue("FORTNIGHTLY");

    // Unticked before the create that goes through, so each run leaves one draft behind and
    // not a fortnightly series of them.
    await field("repeat.on").uncheck();

    // And the kept form is a form: the title typed, the same press creates the event.
    await field("translations.ro.title").fill(`Fără titlu ${suffix}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });

  /*
    §315, the review: a series whose end falls before the event is a rule only the server can
    judge — the browser does not know the start when it reads the end — and it used to be judged
    after the event was written, so the press opened a new event and the repeat settings were
    gone. The create, the publication and the series are one transaction now: nothing is written,
    and the form comes back whole.
  */
  test("a series that ends before the event is refused with the title, the summary and the repeat rule kept", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `serie-refuzata-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const wednesday = page.locator('[name="weekday"][value="3"]');

    await fillDateField(page, "Începutul evenimentului", "2027-05-04");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(`Serie refuzată ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    const romanian = page.locator("#locale-panel-ro");
    await romanian.locator("summary").filter({ hasText: "Rezumat" }).click();
    await romanian.locator('[data-rich-text="translations.ro.excerptBody"] [data-field]').click();
    await page.keyboard.type("O serie care se termină înainte să înceapă.");
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`Refused series ${suffix}`);
    await field("translations.en.slug").fill(`refused-series-${suffix}`);

    await field("repeat.on").check();
    await field("repeat.cadence").selectOption("FORTNIGHTLY");
    await fillDateField(page, "Până la (opțional)", "2027-05-01");
    await wednesday.check();

    await page.getByRole("button", { name: "Creează evenimentul" }).click();

    // The server's refusal names the end and links to it; the press opened nothing.
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal.getByRole("link", { name: "Până la (opțional)" })).toHaveAttribute("href", "#field-repeat.until");
    await expect(page).toHaveURL(/\/admin\/events\/new$/);

    // Every box as it was typed: the words, the rich summary, and the whole repeat rule.
    await expect(field("translations.ro.title")).toHaveValue(`Serie refuzată ${suffix}`);
    await expect(field("translations.ro.slug")).toHaveValue(slug);
    await expect(field("translations.ro.excerptBody")).toHaveValue(/O serie care se termină înainte să înceapă\./);
    await expect(field("translations.en.title")).toHaveValue(`Refused series ${suffix}`);
    await expect(field("event.startsAtDate")).toHaveValue("2027-05-04");
    await expect(field("repeat.on")).toBeChecked();
    await expect(field("repeat.cadence")).toHaveValue("FORTNIGHTLY");
    await expect(field("repeat.until")).toHaveValue("2027-05-01");
    await expect(wednesday).toBeChecked();

    // Nothing was written: the same addresses are free for the create that goes through. (Without
    // the series, so each run leaves one draft and not a fortnightly row of them.)
    await field("repeat.on").uncheck();
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=created/);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });

  // §315. The owner: "ar trebui sa pot crea si publica dintr-un foc!"
  test("creates and publishes in one press, both languages live at once", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `dintr-un-foc-${suffix}`;
    const englishSlug = `in-one-go-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const summary = async (locale: "ro" | "en", text: string) => {
      const panel = page.locator(`#locale-panel-${locale}`);
      await panel.locator("summary").filter({ hasText: "Rezumat" }).click();
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };

    await fillDateField(page, "Începutul evenimentului", "2027-05-03");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(`Dintr-un foc ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await summary("ro", "Creat și publicat într-o singură apăsare.");

    // The publish button says what publication still needs; the English tab is empty.
    await expect(page.getByText(/Nu se poate publica încă — lipsește: English: Titlu/)).toBeVisible();

    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`In one go ${suffix}`);
    await field("translations.en.slug").fill(englishSlug);
    await summary("en", "Created and published in a single press.");
    await expect(page.getByText(/Nu se poate publica încă/)).toHaveCount(0);

    await page.getByRole("button", { name: "Creează și publică" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/);
    const editorUrl = page.url();
    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();
    await expect(page.getByText(/Evenimentul a fost creat și publicat/)).toBeVisible();

    expect((await page.goto(`/ro/evenimente/${slug}`))?.status()).toBe(200);
    expect((await page.goto(`/en/events/${englishSlug}`))?.status()).toBe(200);

    // Off the site again, so every run of this spec does not leave one more card on the public
    // listing that other specs count.
    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });
});

test.describe("BR-REQ-051-01 an Administrator publishes and unpublishes an event (§201)", () => {
  test("takes an event off the public site in both languages and puts it back", async ({ page }) => {
    const event = EVENT_BY_PROJECT[test.info().project.name];

    await signIn(page, "Dev Administrator");
    await page.getByRole("link", { name: event.title }).first().click();
    // Wait for the navigation before reading the URL: taken too early, this is still the list,
    // and every later `goto` in the test would quietly reload the wrong page.
    await expect(page).toHaveURL(/\/admin\/events\//);
    const editorUrl = page.url();

    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();

    // Unpublish: the public page must stop existing, in both languages together.
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await expect(page.getByText("Modificările au fost salvate.")).toBeVisible();

    expect((await page.goto(`/ro/evenimente/${event.slug}`))?.status()).toBe(404);
    expect((await page.goto(`/en/events/${event.englishSlug}`))?.status()).toBe(404);

    // A staff preview still renders the draft, with a notice saying what it is.
    await page.goto(editorUrl);
    await hydrated(page);
    const romanian = page.getByRole("tabpanel", { name: /Română/ });
    await romanian.getByRole("link", { name: "Previzualizare" }).click();
    // Wait for the navigation itself before reading the document: what follows inspects the
    // page's head, and mid-transition that head belongs to two routes at once.
    await expect(page).toHaveURL(/\/previzualizare\/evenimente\//);
    await expect(page.getByText(/Previzualizare pentru echipă/)).toBeVisible();

    /*
      Every robots directive on the page, not "the" one.

      This is a client-side navigation, so React leaves the editor's own `<meta name="robots">`
      in the document for a moment after the preview's has been inserted — two elements, with
      different content, and a locator expecting one fails in strict mode. Both say `noindex`,
      which is the thing BR-REQ-051-02 criterion 2 actually asks: this page is never indexed,
      whichever directive a crawler reads.
    */
    const robots = await page
      .locator('meta[name="robots"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("content") ?? ""));
    expect(robots.length).toBeGreaterThan(0);
    for (const content of robots) expect(content).toContain("noindex");

    // Back through review to published, and both public pages return. Each step waits for the
    // status to change before the next: a transition carries the version it was rendered with,
    // so clicking twice against one render is exactly the stale save the guard refuses.
    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await expect(page.getByText("În verificare", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Publică" }).click();
    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();

    expect((await page.goto(`/ro/evenimente/${event.slug}`))?.status()).toBe(200);
    expect((await page.goto(`/en/events/${event.englishSlug}`))?.status()).toBe(200);
  });
});
