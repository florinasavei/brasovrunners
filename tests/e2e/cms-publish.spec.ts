import { expect, type Locator, type Page, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
// One sign-in helper, in `support/`: this file kept a second copy, and the two drifted the day
// one of them needed a longer wait than the other.
import { fillDateField, fillTimeField, hydrated, pickerGroup, programmeRow, signIn } from "./support/featured-event";
import { editorBox, languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

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

    // The words are theirs: the Romanian title is a field, not a sentence about permissions —
    // in the "Titlu și rezumat" box, shut on arrival like every box of the editor (§350).
    const titles = await openEditorBox(page, "Titlu și rezumat");
    const romanian = titles.getByRole("tabpanel", { name: /Română/ });
    await expect(romanian.getByRole("textbox", { name: "Titlu", exact: true })).toBeVisible();
    await expect(romanian.getByText(/Textele le scrie/)).toHaveCount(0);

    // A copywriter owns no settings, and each settings box says so rather than being missing.
    const kind = await openEditorBox(page, "Ce fel de eveniment");
    const readOnly = kind.getByText("Setările le schimbă un Organizator sau un Administrator.");
    await expect(readOnly).toBeVisible();
    await expect(readOnly).toHaveCount(1);
    // The status, the cost, the links and the public list are boxes of their own since §406, where
    // the page draws them — or apart, the status — and for this reader each is its heading and its
    // line, nothing to open, the sentence said once above (§358). The course keeps a fold: its route
    // description is words, and the words are theirs (§387).
    for (const card of ["Starea evenimentului", "Cost", "Linkuri și fișiere", "Lista publică a participanților"]) {
      const heading = page.getByRole("heading", { level: 2, name: new RegExp(`^(?:\\d+ · )?${card}`) });
      await expect(heading).toBeVisible();
      await expect(page.locator("section").filter({ has: heading })).toHaveCount(1);
    }
    await expect(kind.getByRole("combobox", { name: /Tip eveniment/ })).toHaveCount(0);
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
    // A date and a time, each on MUI's picker (`DECISIONS.md` §70, §345).
    await fillDateField(page, "Începutul evenimentului", "2027-05-01");
    await fillTimeField(page, "Ora", "09:00");
    // The meeting point is asked once per language, side by side in the Locul box (§362).
    await field("event.locationName").fill("Parcul Tractorul");
    await field("event.locationNameEn").fill("Parcul Tractorul");
    // The languages are the editor's own tabs on the create form too: the Romanian panel is
    // in view, the English one behind its tab, and a hidden box cannot be filled.
    await field("translations.ro.title").fill(`Cros de probă ${suffix}`);
    await field("translations.ro.slug").fill(`cros-de-proba-${suffix}`);
    // Every box with per-language text has its own Română | English tabs (§350).
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Trial cross ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`trial-cross-${suffix}`);

    await page.getByRole("button", { name: "Creează evenimentul" }).click();

    // Straight to the new event's own page, as a draft: nothing is published by being created.
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
    // The same boxes as the create page, each in its place, with the English tab behind Română.
    await openEditorBox(page, "Titlu și rezumat");
    await expect(languageTab(page, "title", "en")).toBeVisible();
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
    await field("event.locationNameEn").fill("Parcul Tractorul");
    await field("translations.ro.slug").fill(`fara-titlu-${suffix}`);
    const romanian = languagePanel(page, "title", "ro");
    await openFold(romanian.locator('[data-rich-text-fold="translations.ro.excerptBody"]'));
    await romanian.locator('[data-rich-text="translations.ro.excerptBody"] [data-field]').click();
    await page.keyboard.type("Zece kilometri prin parc.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Untitled ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`untitled-${suffix}`);

    // The three islands that rebuild themselves from the posted names after a refusal
    // (`ScheduleRowsEditor`, `CoHostRowsEditor`, `RepeatToggle`): a type that has a programme,
    // one programme row, one partner, and the repeat tick with a cadence that is not the default.
    await page.getByRole("combobox", { name: /Tip eveniment/ }).click();
    await page.getByRole("option", { name: "Alt eveniment" }).click();
    // "Ora" also labels the event's own time of day, already filled above: the row's boxes are
    // looked up inside the row, never by where they fall on the page. The programme and the
    // partners are boxes of their own, shut on the create page (§350).
    await openEditorBox(page, "Programul zilei și ce să aduci");
    const row = programmeRow(page, 0);
    await fillDateField(row, "Data", "2027-05-02");
    await fillTimeField(row, "Ora", "10:00");
    await field("event.schedule[0].ro").fill("Startul");
    await field("event.schedule[0].en").fill("The start");
    await openEditorBox(page, "Parteneri");
    await field("event.coHosts[0].name").fill("Clubul Prietenilor");
    await field("event.coHosts[0].links[0].url").fill("https://example.org/prieteni");
    await field("repeat.on").check();
    await field("repeat.cadence").selectOption("FORTNIGHTLY");

    // The button says why it waits, naming the language as well as the box.
    await expect(page.getByText("Completează mai întâi: Română: Titlu")).toBeVisible();
    // The refusal the browser will make, from inside a shut box: the title box is folded again,
    // and the press must open it to point at the title (`ActionForm`'s `onInvalidCapture`).
    await editorBox(page, "Titlu și rezumat").locator(":scope > summary").press("Enter");
    await expect(editorBox(page, "Titlu și rezumat")).not.toHaveAttribute("open", "");

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
    await expect(refusal.getByRole("link", { name: "Titlu și rezumat › Română › Titlu" })).toBeVisible();
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
    await expect(field("event.coHosts[0].links[0].url")).toHaveValue("https://example.org/prieteni");
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
    await field("event.locationNameEn").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(`Serie refuzată ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    const romanian = languagePanel(page, "title", "ro");
    await openFold(romanian.locator('[data-rich-text-fold="translations.ro.excerptBody"]'));
    await romanian.locator('[data-rich-text="translations.ro.excerptBody"] [data-field]').click();
    await page.keyboard.type("O serie care se termină înainte să înceapă.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Refused series ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`refused-series-${suffix}`);

    await field("repeat.on").check();
    await field("repeat.cadence").selectOption("FORTNIGHTLY");
    await fillDateField(page, "Până la (opțional)", "2027-05-01");
    await wednesday.check();

    await page.getByRole("button", { name: "Creează evenimentul" }).click();

    // The server's refusal names the end and links to it; the press opened nothing.
    const refusal = page.getByTestId("form-refusal");
    await expect(refusal).toBeVisible();
    await expect(refusal.getByRole("link", { name: "Recurență › Până la (opțional)" })).toHaveAttribute("href", "#field-repeat.until");
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
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };

    await fillDateField(page, "Începutul evenimentului", "2027-05-03");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("event.locationNameEn").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(`Dintr-un foc ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await summary("ro", "Creat și publicat într-o singură apăsare.");

    // The button is its full self whatever is missing (§406; it used to dim to 38%, which read as
    // no button at all). The English tab is empty, and the closed card and its tabs say so.
    const publish = page.getByRole("button", { name: "Creează și publică" });
    await expect(publish).toHaveCSS("opacity", "1");
    await expect(editorBox(page, "Titlu și rezumat").getByTestId("required-titleSummary")).toHaveText("lipsesc: Titlu (EN) · Rezumat (EN)");
    await expect(languageTab(page, "title", "ro")).toHaveText("Română · complet");
    await expect(languageTab(page, "title", "en")).toHaveText("English · 2 obligatorii lipsă");
    // Pressed now, it posts nothing: the §47 summary takes the focus and names each gap per
    // language, and the first card that lacks one is opened on the missing language.
    await publish.click();
    const gaps = page.getByTestId("publish-gaps");
    await expect(gaps).toBeFocused();
    await expect(gaps.getByRole("link", { name: "Titlu și rezumat › English › Titlu" })).toBeVisible();
    await expect(gaps.getByRole("link", { name: "Titlu și rezumat › English › Rezumat" })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/events\/new$/);
    await expect(editorBox(page, "Titlu și rezumat")).toHaveAttribute("open", "");
    await expect(field("translations.en.title")).toBeVisible();
    // The Publicare box lists every gap by box and tab, from the same check (§350).
    const publication = await openEditorBox(page, "Publicare");
    await expect(publication.getByTestId("missing-for-publish").getByRole("link", { name: "Titlu și rezumat › English › Titlu" })).toBeVisible();

    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`In one go ${suffix}`);
    // The English address fills itself from the title until it is typed (`SlugFromTitle`).
    await expect(field("translations.en.slug")).toHaveValue(`in-one-go-${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    await summary("en", "Created and published in a single press.");
    await expect(editorBox(page, "Titlu și rezumat").getByTestId("required-titleSummary")).toHaveText("complet");
    await expect(publication.getByText("Nu lipsește nimic: evenimentul poate fi publicat.")).toBeVisible();

    await page.getByRole("button", { name: "Creează și publică" }).click();
    await confirmDialog(page, "Creezi și publici evenimentul?");
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
    await confirmDialog(page);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();

    // The draft's own editor publishes in one press too (§423), as the create page did: «Publică»
    // beside "Trimite spre verificare", the review step walked by the service.
    await hydrated(page);
    await expect(page.getByRole("button", { name: "Trimite spre verificare" })).toBeVisible();
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await expect(page).toHaveURL(/saved=PUBLISHED/);
    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();
    expect((await page.goto(`/ro/evenimente/${slug}`))?.status()).toBe(200);

    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await confirmDialog(page);
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
    await confirmDialog(page);
    await expect(page.getByText("Modificările au fost salvate.")).toBeVisible();

    expect((await page.goto(`/ro/evenimente/${event.slug}`))?.status()).toBe(404);
    expect((await page.goto(`/en/events/${event.englishSlug}`))?.status()).toBe(404);

    // A staff preview still renders the draft, with a notice saying what it is.
    await page.goto(editorUrl);
    await hydrated(page);
    // The previews are in the Publicare box, one per language (§350).
    await page.locator("#box-publication").getByRole("link", { name: /^Română/ }).click();
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
    await confirmDialog(page);
    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();

    expect((await page.goto(`/ro/evenimente/${event.slug}`))?.status()).toBe(200);
    expect((await page.goto(`/en/events/${event.englishSlug}`))?.status()).toBe(200);
  });
});

/**
 * A full page load of the editor a save just landed on, and proof that it was one.
 *
 * The address a save lands on ends in `#admin-alert` (the saved notice), so `page.goto(page.url())`
 * from there is a jump to a fragment of the same document: nothing reloads, nothing hydrates, and
 * a spec about hydration passes whatever the code does — which is what the first version of the
 * two specs below did, against the build with the fix and the build without it alike. The bare
 * path is a new document; the marker set on the old window being gone is what says so.
 */
async function loadAfresh(page: Page) {
  const path = new URL(page.url()).pathname;
  await page.evaluate(() => {
    (window as Window & { sameDocument?: boolean }).sameDocument = true;
  });
  await page.goto(path);
  await hydrated(page);
  expect(await page.evaluate(() => (window as Window & { sameDocument?: boolean }).sameDocument)).toBeUndefined();
}

/*
  §117, §345, review finding 1. Client-side navigation from the events list never showed this:
  the picker there is already running by the time `ScheduleRowsEditorIsland` mounts, so its
  listener lands on the real box from the start. Only a full page load hits the gap —
  `useIslandRunning`'s `useSyncExternalStore` swaps the scriptless box for the picker in a
  passive effect that runs after this island's own, so a listener attached to the element
  `findStartDateInput` returns at that moment is attached to a node about to be unmounted.

  Both pages a person lands on that way are checked: the create page (the spec opens it with
  `page.goto`, a full load) and the editor (`loadAfresh`). Run against a build of
  `ScheduleRowsEditor.tsx` as it was before the fix, the row stays on its first date on each.
*/
test.describe("BR-REQ-050-02 the programme follows the start date after a full page load (§117, §345)", () => {
  test("moves the row's date when the picker replaces the scriptless box during hydration", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `program-dupa-reincarcare-${suffix}`;

    await signIn(page, "Dev Administrator");
    // A new document, not the client navigation a click on "Eveniment nou" would be.
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await fillDateField(page, "Începutul evenimentului", "2027-05-10");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("event.locationNameEn").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(`Program după reîncărcare ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Programme after reload ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`programme-after-reload-${suffix}`);

    // A type with a programme (§111), and one row on it — the same pattern the refused-create
    // spec above uses. The editor opens on one row, so there is exactly one "Data" on the page,
    // and "Ora" is also the event's own time of day: the row's boxes are looked up inside the
    // row (`programmeRow`), never by where they fall on the page (re-review, finding 1).
    await page.getByRole("combobox", { name: /Tip eveniment/ }).click();
    await page.getByRole("option", { name: "Alt eveniment" }).click();
    await openEditorBox(page, "Programul zilei și ce să aduci");
    const row = programmeRow(page, 0);
    // The spare line took the start date the moment it was typed (§405): its default day is the
    // event's, never an empty box whose calendar opens on today.
    await expect(field("event.schedule[0].date")).toHaveValue("2027-05-10");
    await fillDateField(row, "Data", "2027-05-10");
    await fillTimeField(row, "Ora", "10:00");
    await expect(field("event.schedule[0].date")).toHaveValue("2027-05-10");
    await expect(field("event.schedule[0].time")).toHaveValue("10:00");
    await field("event.schedule[0].ro").fill("Startul");
    await field("event.schedule[0].en").fill("The start");

    // The create page. The bug: without the fix the row stays on "2027-05-10", because the
    // listener died with the scriptless box before the picker's own change ever reached it.
    await fillDateField(page, "Începutul evenimentului", "2027-05-12");
    await expect(field("event.startsAtDate")).toHaveValue("2027-05-12");
    await expect(field("event.schedule[0].date")).toHaveValue("2027-05-12");

    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);

    // The editor, on the full load the finding names — never the client navigation that just
    // landed here, and never the fragment jump `page.goto(page.url())` would be.
    await loadAfresh(page);

    await expect(field("event.schedule[0].date")).toHaveValue("2027-05-12");
    // "Data și ora" is folded on the editor (§350).
    await openEditorBox(page, "Data și ora");
    await fillDateField(page, "Începutul evenimentului", "2027-05-13");
    await expect(field("event.startsAtDate")).toHaveValue("2027-05-13");
    await expect(field("event.schedule[0].date")).toHaveValue("2027-05-13");
  });
});

/*
  §405 — the programme card made consistent with the rest of the editor (the owner, 2026-09-25,
  of «Programul zilei și ce să aduci»: "This is super ugly and inconsistent."). Three things a
  server render cannot see, checked in the browser on both projects:

  - the layout is one grid per row, laid out by the list's own width: on the desktop project the
    first line is Data · Ora · Până la · Unde · the bin and the second the two «Ce» side by side
    (§362's pair), and a narrower list (the 960-pixel window, where the side column is pinned
    beside the boxes) keeps "Unde" readable on a line of its own rather than squeezing it; at
    320 pixels every box is stacked in reading order with the bin under them, and nothing
    overflows;
  - how the rows work is the compact «i» fold (§398), closed until pressed;
  - every row's default day is the event's start date: the spare line takes it when it is typed,
    a new row opens on it, and both follow it when it moves.

  Nothing is saved: the create page is left as it is, so no run leaves an event behind.
*/
test.describe("BR-REQ-050-02 the programme card: one grid per row, the help in the «i» fold, rows on the event's day (§405)", () => {
  test("lays the rows out by the list's width, folds the help, and opens every row on the start date", async ({ page }, testInfo) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await page.getByRole("combobox", { name: /Tip eveniment/ }).click();
    await page.getByRole("option", { name: "Alt eveniment" }).click();
    await openEditorBox(page, "Programul zilei și ce să aduci");

    // The help: one closed line with the «i», the paragraph inside it.
    const help = page.getByTestId("programme-help");
    const sentence = page.getByText(/^Ziua pe ore, câte un rând/);
    await expect(help).not.toHaveAttribute("open", "");
    await expect(sentence).toBeHidden();
    await openFold(help);
    await expect(sentence).toBeVisible();

    // The default day. No start date yet on the create page: the spare line has none either,
    // and takes the start the moment it is typed; a new row opens on it; both follow it.
    await expect(field("event.schedule[0].date")).toHaveValue("");
    await fillDateField(page, "Începutul evenimentului", "2027-06-05");
    await expect(field("event.schedule[0].date")).toHaveValue("2027-06-05");
    await page.getByRole("button", { name: "Adaugă un rând" }).click();
    await expect(field("event.schedule[1].date")).toHaveValue("2027-06-05");
    await fillDateField(page, "Începutul evenimentului", "2027-06-07");
    await expect(field("event.schedule[0].date")).toHaveValue("2027-06-07");
    await expect(field("event.schedule[1].date")).toHaveValue("2027-06-07");

    // The layout, read off where each box is drawn.
    const row = page.getByRole("group", { name: "Rândul 1", exact: true });
    const boxes = {
      date: pickerGroup(row, "Data"),
      time: row.getByRole("textbox", { name: "Ora", exact: true }),
      end: row.getByRole("textbox", { name: "Până la", exact: true }),
      place: row.getByRole("textbox", { name: "Unde", exact: true }),
      ro: row.getByRole("textbox", { name: "Ce (română)", exact: true }),
      en: row.getByRole("textbox", { name: "Ce (engleză)", exact: true }),
      bin: row.getByRole("button", { name: "Șterge rândul 1", exact: true }),
    };
    const measure = async () => {
      const out: Record<string, { x: number; y: number; width: number; height: number; middle: number; right: number }> = {};
      for (const [key, locator] of Object.entries(boxes)) {
        const rect = await locator.boundingBox();
        if (!rect) throw new Error(`${key} is not drawn`);
        out[key] = { ...rect, middle: rect.y + rect.height / 2, right: rect.x + rect.width };
      }
      return out;
    };
    const sameLine = (a: { middle: number }, b: { middle: number }) => expect(Math.abs(a.middle - b.middle)).toBeLessThan(6);

    let at = await measure();
    // The bin is a 44-pixel target at every width (BR-REQ-041-01 criterion 6).
    expect(at.bin.width).toBeGreaterThanOrEqual(44);
    expect(at.bin.height).toBeGreaterThanOrEqual(44);
    const rowRect = await row.boundingBox();
    if (!rowRect) throw new Error("the row is not drawn");
    const rowRight = rowRect.x + rowRect.width;
    // The page never scrolls sideways for a row.
    expect(rowRight).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);

    if (testInfo.project.name === "mobile") {
      // Stacked in reading order, the bin last.
      const order = [at.date, at.time, at.end, at.place, at.ro, at.en, at.bin].map((rect) => rect.middle);
      for (let index = 1; index < order.length; index += 1) expect(order[index]).toBeGreaterThan(order[index - 1] + 20);
      // No box overflows its row.
      for (const rect of Object.values(at)) expect(rect.right).toBeLessThanOrEqual(rowRight + 0.5);
    } else {
      // Line 1: when and where and the bin; line 2: what, in both languages, side by side.
      for (const key of ["time", "end", "place", "bin"] as const) sameLine(at.date, at[key]);
      sameLine(at.ro, at.en);
      expect(at.ro.middle).toBeGreaterThan(at.date.middle + 30);
      expect(at.en.x).toBeGreaterThan(at.ro.right);
      expect(at.place.width).toBeGreaterThanOrEqual(120);
      expect(at.date.x).toBeLessThan(at.time.x);
      expect(at.time.x).toBeLessThan(at.end.x);
      expect(at.end.x).toBeLessThan(at.place.x);
      expect(at.place.right).toBeLessThanOrEqual(at.bin.x);

      // A narrower list — the side column pinned beside the boxes from `md` — never squeezes
      // "Unde": the times and the bin keep the first line, the place takes a line of its own.
      await page.setViewportSize({ width: 960, height: 720 });
      at = await measure();
      for (const key of ["time", "end", "bin"] as const) sameLine(at.date, at[key]);
      expect(at.place.middle).toBeGreaterThan(at.date.middle + 30);
      expect(at.place.width).toBeGreaterThanOrEqual(200);
      sameLine(at.ro, at.en);
      expect(at.ro.middle).toBeGreaterThan(at.place.middle + 30);

      // Re-review finding 1: the band a viewport breakpoint never lands on but a real phone in
      // landscape or a split screen can — a list width of roughly 416 to 454 pixels, where the
      // four MEDIUM columns (428px of minimums and gaps) used to be asked to fit inside less
      // room than the row's own padding left. 500px keeps the side column off (it pins from
      // `md`, 900px) and puts the list itself inside that band once the page's own gutters are
      // taken off; nothing should stick out past the row's own border at any width.
      await page.setViewportSize({ width: 500, height: 720 });
      at = await measure();
      const bandRow = await row.boundingBox();
      if (!bandRow) throw new Error("the row is not drawn");
      const bandRight = bandRow.x + bandRow.width;
      for (const rect of Object.values(at)) expect(rect.right).toBeLessThanOrEqual(bandRight + 0.5);
      expect(bandRight).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    }

    // The bin removes its own row.
    await page.getByRole("button", { name: "Șterge rândul 2", exact: true }).click();
    await expect(field("event.schedule[1].date")).toHaveCount(0);
  });
});

/*
  Re-review finding 2 on §405's card: the two specs above build and read back the rows in the
  editor alone. Neither publishes, so nothing proved a saved row actually reaches a reader — the
  public page's programme list (`#schedule`, `EventProgramme.tsx`) or a VEVENT of its own in the
  `.ics` feed (`ical.ts`). This one row: add it, fill it in both languages, publish, then read it
  back from both public surfaces.
*/
test.describe("BR-REQ-050-02 a saved programme row reaches the public page and the .ics (§117, §405)", () => {
  test("the row's label and time are on the event page's programme list and in a VEVENT of its own", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `ziua-cursei-${suffix}`;
    const englishSlug = `race-day-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const summary = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };

    await fillDateField(page, "Începutul evenimentului", "2027-06-20");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Piața Sfatului");
    await field("event.locationNameEn").fill("Council Square");
    await field("translations.ro.title").fill(`Ziua cursei ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await summary("ro", "O cursă cu un program pe ore.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Race day ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(englishSlug);
    await summary("en", "A race with a timed programme.");

    // "Concurs" has a programme (§111); the create page defaults to a type that does not.
    await openEditorBox(page, "Ce fel de eveniment");
    await page.getByRole("combobox", { name: "Tip eveniment" }).click();
    await page.getByRole("option", { name: "Concurs" }).click();

    await openEditorBox(page, "Programul zilei și ce să aduci");
    const row = programmeRow(page, 0);
    await fillDateField(row, "Data", "2027-06-20");
    await fillTimeField(row, "Ora", "08:30");
    await field("event.schedule[0].place").fill("Cortul de start");
    await field("event.schedule[0].ro").fill("Predarea kitului de concurs");
    await field("event.schedule[0].en").fill("Race kit pickup");

    await page.getByRole("button", { name: "Creează și publică" }).click();
    await confirmDialog(page, "Creezi și publici evenimentul?");
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/);
    const editorUrl = page.url();

    // The Romanian page: the row's time and label under "#schedule".
    await page.goto(`/ro/evenimente/${slug}`);
    const scheduleRo = page.locator("#schedule");
    await expect(scheduleRo.getByText("08:30")).toBeVisible();
    await expect(scheduleRo).toContainText("Predarea kitului de concurs");
    await expect(scheduleRo).toContainText("Cortul de start");

    // The Romanian .ics: a VEVENT of its own, its SUMMARY carrying the event's title and the
    // row's own label (`ical.ts`) — unfolded first, RFC 5545 folds a long line at 75 octets.
    const icsRoResponse = await page.request.get(`/ro/events/${slug}/calendar.ics`);
    const icsRo = (await icsRoResponse.text()).replace(/\r\n /g, "");
    expect(icsRo).toContain(`SUMMARY:Ziua cursei ${suffix} — Predarea kitului de concurs`);

    // The English page and its own .ics read the same row in English.
    await page.goto(`/en/events/${englishSlug}`);
    const scheduleEn = page.locator("#schedule");
    await expect(scheduleEn.getByText("08:30")).toBeVisible();
    await expect(scheduleEn).toContainText("Race kit pickup");
    await expect(scheduleEn).toContainText("Cortul de start");

    const icsEnResponse = await page.request.get(`/en/events/${englishSlug}/calendar.ics`);
    const icsEn = (await icsEnResponse.text()).replace(/\r\n /g, "");
    expect(icsEn).toContain(`SUMMARY:Race day ${suffix} — Race kit pickup`);

    // Off the site again, so this run leaves no card behind for another spec to count.
    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await confirmDialog(page);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });
});

/*
  §345, review finding 2, and its 2026-09-25 amendment (the time half is now the platform's own
  `<input type="time">`). The date half is unchanged: every assertion on its picker's format
  reads the hidden posted input (`YYYY-MM-DD`), which says nothing about what the picker
  *shows* — this asserts what the picker box itself renders, before and after a save and a full
  reload.

  Not the date box's text: the element MUI names with the label is the whole outlined input, and
  its notch repeats the label inside it, so its `textContent` is "30.09.2027Începutul
  evenimentului" — never "30.09.2027". What a person reads is the sections, one `spinbutton`
  each, in the order the format puts them, and the separators between them, which MUI's own
  unnamed input carries as its value ("30.09.2027") beside the hidden one the form posts
  ("2027-09-30").

  The time box is a typed text box since §NNN (the browser's own time control of §400 drew
  "07:00 PM" on an English-language browser), so what it shows is its value: asserting the value
  "19:00" on a text box asserts the display and the post at once.
*/
async function expectPickerShows(group: Locator, sections: string[], shown: string) {
  await expect(group.getByRole("spinbutton")).toHaveText(sections);
  await expect(group.locator("input")).toHaveValue(shown);
}

test.describe("BR-REQ-050-02 the date reads as day-month-year, and the time always posts 24-hour (§303, §345)", () => {
  test("shows 30.09.2027 in day, month, year order, and posts 19:00 with no AM/PM — before and after saving", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `ceas-24h-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await fillDateField(page, "Începutul evenimentului", "2027-09-30");
    await fillTimeField(page, "Ora", "19:00");
    // Typed by hand, key by key, the box keeps every keystroke as typed — no colon of its own
    // (the review of §NNN: an auto-colon made «19:00» into «19::0») — and reads «1930» as 19:30
    // on leaving it.
    const timeBox = field("event.startsAtTime");
    await timeBox.fill("");
    await timeBox.pressSequentially("19:00");
    await expect(timeBox).toHaveValue("19:00");
    await timeBox.fill("");
    await timeBox.pressSequentially("1930");
    await expect(timeBox).toHaveValue("1930");
    await timeBox.blur();
    await expect(timeBox).toHaveValue("19:30");
    await timeBox.fill("");
    await timeBox.pressSequentially("19:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("event.locationNameEn").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(`Ceas 24h ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`24-hour clock ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`24-hour-clock-${suffix}`);

    // The event's own box: the first "Ora" on the page is the event's time of day, above any
    // programme row's.
    const dateGroup = pickerGroup(page, "Începutul evenimentului");
    const readsTheClubsWay = async () => {
      // Day, month, year — three sections in that order, never month first.
      await expectPickerShows(dateGroup, ["30", "09", "2027"], "30.09.2027");
      // What the form posts is still the service's shape, untouched by what either box shows.
      await expect(field("event.startsAtDate")).toHaveValue("2027-09-30");
      await expect(field("event.startsAtTime")).toHaveValue("19:00");
      // A text box shows exactly its value: 19:00, never the browser's "07:00 PM" (§NNN).
      await expect(field("event.startsAtTime")).toHaveAttribute("type", "text");
    };

    await readsTheClubsWay();

    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);

    // A full page load: the scriptless box's own hydration swap is where finding 1's bug lived,
    // and it is the same swap this display format has to survive.
    await loadAfresh(page);
    await openEditorBox(page, "Data și ora");

    await readsTheClubsWay();
  });
});

/*
  The editor's boxes (§350): the weekly group run in a minute — the type is already a group run,
  the addresses fill themselves from the titles, so it is the titles, the summaries, the date, the
  place, the repeat tick with Monday and Wednesday, and "Creează și publică". The date is far past
  the eight weeks a series is created into (§122), so this makes one event, not a series of them;
  the recurrence is stopped and the event taken off the site at the end.
*/
test.describe("BR-REQ-050-02 the weekly group run, created in one page (§350)", () => {
  test("type by default, titles, summaries, date, place, Monday and Wednesday, create and publish", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);
    const summary = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    // A Monday some twenty weeks away: outside the horizon, so the series makes nothing yet.
    const DAY = 86_400_000;
    const monday = new Date(Date.now() + 140 * DAY);
    while (monday.getUTCDay() !== 1) monday.setTime(monday.getTime() + DAY);
    const ymd = monday.toISOString().slice(0, 10);

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);

    // The type is a group run until somebody says otherwise, and a group run has no registration.
    await expect(page.getByRole("combobox", { name: /Tip eveniment/ })).toContainText("Alergare de grup");

    await field("translations.ro.title").fill(`Alergare de luni ${suffix}`);
    await expect(field("translations.ro.slug")).toHaveValue(`alergare-de-luni-${suffix}`);
    await summary("ro", "Tura de luni seara, prin parc.");
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Monday run ${suffix}`);
    await expect(field("translations.en.slug")).toHaveValue(`monday-run-${suffix}`);
    await summary("en", "The Monday evening run, through the park.");
    await fillDateField(page, "Începutul evenimentului", ymd);
    await fillTimeField(page, "Ora", "18:30");
    await field("event.locationName").fill("Parcul Titulescu");
    // "Parcul Titulescu" is its name in English too: one press copies it into the English box (§362).
    await expect(page.getByTestId("place-copy-to-english")).toBeEnabled();
    await page.getByTestId("place-copy-to-english").click();
    await expect(field("event.locationNameEn")).toHaveValue("Parcul Titulescu");
    await expect(page.getByTestId("place-copy-to-english")).toBeDisabled();
    // While the two agree, the English follows what is typed in Romanian (found by review).
    await field("event.locationName").fill("Parcul Nicolae Titulescu");
    await expect(field("event.locationNameEn")).toHaveValue("Parcul Nicolae Titulescu");

    // Recurrence, in the side column — first on a phone: the event's own day follows the date
    // typed above, ticked and locked; Wednesday is added.
    const recurrence = editorBox(page, "Recurență");
    await recurrence.getByRole("checkbox", { name: "Repetă evenimentul" }).check();
    await expect(recurrence.getByRole("checkbox", { name: "Lu" })).toBeChecked();
    await expect(recurrence.getByRole("checkbox", { name: "Lu" })).toBeDisabled();
    await recurrence.getByRole("checkbox", { name: "Mi" }).check();
    await expect(recurrence.getByTestId("repeat-rule-sentence")).toContainText("În fiecare luni și miercuri, la 18:30 — la nesfârșit.");
    await expect(page.getByTestId("create-draft-line")).toContainText("și datele seriei din următoarele 8 săptămâni");

    await expect(editorBox(page, "Titlu și rezumat").getByTestId("required-titleSummary")).toHaveText("complet");
    await expect(editorBox(page, "Locul").getByTestId("required-place")).toHaveText("complet");
    await page.getByRole("button", { name: "Creează și publică" }).click();
    await confirmDialog(page, "Creezi și publici evenimentul?");
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/);
    await hydrated(page);
    const editorUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Publicat", { exact: true })).toBeVisible();
    const series = page.getByTestId("recurrence-series");
    await expect(series).toContainText("În fiecare luni și miercuri, la 18:30 — la nesfârșit");
    await expect(series.getByTestId("repeat-publish")).toContainText("se publică automat");

    expect((await page.goto(`/ro/evenimente/alergare-de-luni-${suffix}`))?.status()).toBe(200);

    // Tidy: the rule stopped, then off the site.
    await page.goto(editorUrl);
    await hydrated(page);
    await page.getByTestId("recurrence-series").getByRole("button", { name: "Oprește recurența" }).click();
    await confirmDialog(page, "Oprește recurența");
    await expect(page.locator("#admin-alert")).toContainText("Seria e oprită", { timeout: 15_000 });
    await hydrated(page);
    await page.getByRole("button", { name: "Mută în ciornă" }).click();
    await confirmDialog(page);
    await expect(page.getByText("Ciornă", { exact: true })).toBeVisible();
  });
});
