import { expect, test, type Locator, type Page } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-041-01 (§366) — the listing's cards, measured in a browser at 320 pixels (the mobile
 * project) and on a desktop, where they stand two to a row.
 *
 * The owner, 2026-09-24, with a screenshot of `/ro/evenimente`: "There is too much whitespace on
 * these cards, it needs to be better spaced"; then, of the one-off "Trail to Road cu Brașov Running
 * Festival" beside two series cards: "I do not see the google maps link for this event", "for the
 * time I would like a clock icon as well", "I am missing the blue link for this event, why?", and
 * of its facts line beside the event page's pills: "this is currently pretty ugly!". In it: the
 * one-off card one `<a>` around everything with a black title, a door pinned to the card's foot
 * with a hole above it; the place's pin alone on a line; the route as a line of middle dots with
 * the partner's sentence among the numbers; a registration address wrapped over two lines of a
 * summary. `listing-card.test.ts` asserts the markup; this measures what a reader sees.
 *
 * The seed publishes single-date events with no map link and no series (`pilot.ts`, CI's too). The
 * tap-target check makes its own series, with a map link, so the series card's title over its
 * rhythm, the map link and the dates in the fold are pressed on every run, and deletes it after;
 * the other checks run on whatever the listing has — that series while it stands, another spec's —
 * and the unit test carries the map link on both kinds of card.
 */

/** Every event card on the listing, the folds opened so a phone's folded list is measured too. */
async function cards(page: Page, locale: "ro" | "en" = "ro"): Promise<Locator> {
  await page.goto(locale === "ro" ? "/ro/evenimente" : "/en/events");
  const main = page.locator("#main");
  // The list streams in after the shell (§166): wait for a card before measuring any — in the
  // document first, since with more than four cards a phone folds them all (§78) and the first is
  // not visible until the fold is opened here.
  const first = main.locator("ul > li h2").first();
  await expect(first).toBeAttached();
  await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
  await expect(first).toBeVisible();
  return main.locator("ul > li").filter({ has: page.locator("h2") });
}

const DAY = 86_400_000;

/** A calendar day as the backoffice's date field takes it, "YYYY-MM-DD". */
const ymd = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The first calendar day from `from` (inclusive), walking `step` days at a time (+1 forward, -1
 * back), that falls on `weekday` (0 Sunday … 6 Saturday) and has a two-digit day of the month —
 * the widest date a card prints for that weekday: "Duminică, 27 sept.", "Wednesday, 30 Sept".
 * Calendar arithmetic at noon UTC, so no zone moves the day; the event's own zone reads it as the
 * same day.
 */
function widestDay(from: Date, weekday: number, step: 1 | -1): Date {
  let day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12));
  while (day.getUTCDay() !== weekday || day.getUTCDate() < 10) day = new Date(day.getTime() + step * DAY);
  return day;
}

/**
 * What a spec published, by its Romanian title and how many dates it has, so its `finally` removes
 * exactly that and nothing it did not get to make. Each publisher records its title the moment the
 * backoffice has saved the event, and a series its two further dates once they exist — so a failure
 * halfway still leaves nothing behind.
 */
type Created = Array<{ title: string; dates: number }>;

/**
 * A weekly series of three published dates, with a map link and a summary in both languages —
 * made in the backoffice, the way the club makes one, then signed out of, so the listing is read
 * as a visitor reads it. Returns the series' title in both languages. `first` is its first date:
 * eight days out unless a spec needs a particular weekday (the longest one, to measure the widest
 * row a card prints).
 *
 * Through the backoffice and not straight into the database (as `waitlist-length.spec.ts` seeds its
 * events), because the listing reads its rows through the public cache (§333), which only a write
 * through the application expires: rows inserted behind the server's back would never reach a
 * listing this server had already read, and the other specs read it first. Removed the same way
 * (`removeEvents`), for the same reason and one more: a phone folds the listing once it has more
 * than four cards (§78), and a series left behind would fold it for every spec after this one.
 */
async function publishSeries(page: Page, created: Created, first?: Date): Promise<{ ro: string; en: string }> {
  const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
  const title = `Tură de probă ${suffix}`;
  const titleEn = `Trial run ${suffix}`;
  const field = (name: string) => page.locator(`[name="${name}"]`);
  const summary = async (locale: "ro" | "en", words: string) => {
    const panel = languagePanel(page, "title", locale);
    // A fold opened in one language stays open in the other (§363): open it only if it is closed.
    await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
    await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
    await page.keyboard.type(words);
  };
  // Inside the eight weeks a series creates into at once (§122), as `series-drafts.spec.ts` does.
  const today = new Date();
  const start = first ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 8, 9));

  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/events/new");
  await hydrated(page);
  await fillDateField(page, "Începutul evenimentului", ymd(start));
  // Two digits either side of the colon, like every time: Roboto's figures are one width, so
  // any time is as wide as the widest.
  await fillTimeField(page, "Ora", "18:30");
  await field("event.locationName").fill("Parcul Tractorul");
  // The place in both languages since §362.
  await field("event.locationNameEn").fill("Tractorul Park");
  await field("event.mapUrl").fill("https://maps.example.test/parcul-tractorul");
  await field("translations.ro.title").fill(title);
  await field("translations.ro.slug").fill(`tura-de-proba-${suffix}`);
  await summary("ro", "O tură de probă, pentru cardul seriei.");
  await languageTab(page, "title", "en").click();
  await field("translations.en.title").fill(titleEn);
  await languageTab(page, "address", "en").click();
  await field("translations.en.slug").fill(`trial-run-${suffix}`);
  await summary("en", "A trial run, for the series card.");
  await page.getByRole("button", { name: "Creează și publică" }).click();
  await confirmDialog(page, "Creezi și publici evenimentul?");
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/, { timeout: 30_000 });
  const record = { title, dates: 1 };
  created.push(record);
  await hydrated(page);

  // Weekly, until two weeks on: two more dates, published with the source (the tick's default, §350).
  const recurrence = await openEditorBox(page, "Recurență");
  await recurrence.getByRole("checkbox", { name: "Repetă evenimentul" }).check();
  await fillDateField(page, "Până la (opțional)", ymd(new Date(start.getTime() + 14 * DAY)));
  await expect(recurrence.getByRole("checkbox", { name: "Publică datele noi automat" })).toBeChecked();
  await recurrence.getByRole("button", { name: "Creează datele" }).click();
  await confirmDialog(page, "Creezi datele?");
  await expect(page.locator("#admin-alert")).toContainText("2 date create acum", { timeout: 15_000 });
  record.dates = 3;

  await page.context().clearCookies();
  return { ro: title, en: titleEn };
}

/**
 * A one-off event, not featured, published through the backoffice the way an organizer makes one,
 * then signed out of. Returns its title in both languages. Three kinds, each a width the card's
 * "when" row must survive at a phone's width:
 *
 * - `race` — a race with two named times, a meeting time and its own gun time (`raceStartsAt`),
 *   the case BR-REQ-041-01's amendment named: at 320 pixels the row cannot fit both without
 *   wrapping between them, and must not clip the start time. The seed publishes no such card (its
 *   only race with `raceStartsAt` is `featured: true`, the hero, not a card);
 * - `yearOut` — a run more than a year ahead, whose card keeps the year on a phone ("Duminică,
 *   27 sept. 2027 · 18:30", 227 pixels against the 226 a 320-pixel card leaves the row);
 * - `past` — a run already held, on the listing's "past events" fold (§267), whose card keeps its
 *   year too. The seed's own past run moves with the week and another spec unpublishes it, so
 *   this one is made here, where the spec can name it.
 */
async function publishOneOff(page: Page, created: Created, kind: "race" | "yearOut" | "past", day: Date): Promise<{ ro: string; en: string }> {
  const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
  const words = {
    race: { ro: "Cursă de probă", en: "Trial race", slugRo: "cursa-de-proba", slugEn: "trial-race" },
    yearOut: { ro: "Tură de peste un an", en: "Run a year out", slugRo: "tura-peste-un-an", slugEn: "run-a-year-out" },
    past: { ro: "Tură trecută", en: "Past run", slugRo: "tura-trecuta", slugEn: "past-run" },
  }[kind];
  const title = `${words.ro} ${suffix}`;
  const titleEn = `${words.en} ${suffix}`;
  const field = (name: string) => page.locator(`[name="${name}"]`);
  const summary = async (locale: "ro" | "en", text: string) => {
    const panel = languagePanel(page, "title", locale);
    await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
    await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
    await page.keyboard.type(text);
  };

  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/events/new");
  await hydrated(page);
  if (kind === "race") {
    await page.getByRole("combobox", { name: "Tip eveniment" }).click();
    await page.getByRole("option", { name: "Concurs" }).click();
  }
  await fillDateField(page, "Începutul evenimentului", ymd(day));
  await fillTimeField(page, "Ora", kind === "race" ? "08:00" : "18:30");
  if (kind === "race") {
    // `raceStartsAt`'s own date and time (`WhenBox`, only for a race): the date's label is
    // unique on the page, but its time shares "Ora" with `startsAt`'s — the second one, in
    // source order.
    await fillDateField(page, "Startul cursei", ymd(day));
    await page.getByRole("textbox", { name: "Ora", exact: true }).nth(1).fill("09:00");
  }
  await field("event.locationName").fill("Stadionul Tineretului");
  await field("event.locationNameEn").fill("Youth Stadium");
  await field("translations.ro.title").fill(title);
  await field("translations.ro.slug").fill(`${words.slugRo}-${suffix}`);
  await summary("ro", "Un eveniment de probă, pentru rândul datei de pe card.");
  await languageTab(page, "title", "en").click();
  await field("translations.en.title").fill(titleEn);
  await languageTab(page, "address", "en").click();
  await field("translations.en.slug").fill(`${words.slugEn}-${suffix}`);
  await summary("en", "A trial event, for the card's date row.");
  await page.getByRole("button", { name: "Creează și publică" }).click();
  await confirmDialog(page, "Creezi și publici evenimentul?");
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/, { timeout: 30_000 });
  created.push({ title, dates: 1 });
  await hydrated(page);

  await page.context().clearCookies();
  return { ro: title, en: titleEn };
}

/**
 * A race that takes registrations here, open now with twelve places, not featured — so it stands
 * on the listing as a card, not as the hero — published through the backoffice and signed out of
 * (§NNN). Nobody registers: an event with registrations cannot be deleted, and the spec must leave
 * the listing as it found it. The waiting-list and full states are the integration test's
 * (`card-registration.test.ts`), on a real database.
 */
async function publishOpenRace(page: Page, created: Created): Promise<{ ro: string; en: string }> {
  const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
  const title = `Cursă cu locuri ${suffix}`;
  const titleEn = `Race with places ${suffix}`;
  const field = (name: string) => page.locator(`[name="${name}"]`);
  const today = new Date();
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 10, 9));

  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/events/new");
  await hydrated(page);
  await page.getByRole("combobox", { name: "Tip eveniment" }).click();
  await page.getByRole("option", { name: "Concurs" }).click();
  await fillDateField(page, "Începutul evenimentului", ymd(day));
  await fillTimeField(page, "Ora", "09:00");
  await field("event.locationName").fill("Stadionul Tineretului");
  await field("event.locationNameEn").fill("Youth Stadium");
  // Everything about registration is one box, and the declaration is in its own card (§350).
  await openEditorBox(page, "Participare și înscrieri");
  await page.getByRole("combobox", { name: "Modul de înscriere" }).click();
  await page.getByRole("option", { name: "Înscrieri pe site" }).click();
  await field("event.capacity").fill("12");
  await openEditorBox(page, "Condiții de participare și declarația");
  await page.getByRole("combobox", { name: "Declarația pe care o semnează participantul" }).click();
  await page.getByRole("option").nth(1).click();
  await field("translations.ro.title").fill(title);
  await field("translations.ro.slug").fill(`cursa-cu-locuri-${suffix}`);
  await languageTab(page, "title", "en").click();
  await field("translations.en.title").fill(titleEn);
  await languageTab(page, "address", "en").click();
  await field("translations.en.slug").fill(`race-with-places-${suffix}`);
  await page.getByRole("button", { name: "Creează și publică" }).click();
  await confirmDialog(page, "Creezi și publici evenimentul?");
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}.*saved=createdPublished/, { timeout: 30_000 });
  created.push({ title, dates: 1 });
  await hydrated(page);

  await page.context().clearCookies();
  return { ro: title, en: titleEn };
}

/**
 * An event a spec published, deleted from the backoffice's list — one row, whether it is a series'
 * dates (§113, §114) or a single one; `dates` is how many the alert must say were deleted.
 */
async function removeEvents(page: Page, title: string, dates: number): Promise<void> {
  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin");
  // The row's checkbox is MUI's: a tick before hydration is reverted when React takes over.
  await hydrated(page);
  const main = page.locator("#main");
  const row = main.locator("tr, li").filter({ visible: true }).filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await row.getByRole("checkbox", { name: `Selectează „${title}”` }).check();
  await main.getByRole("button", { name: "Șterge cele bifate" }).click();
  await confirmDialog(page, "Ștergi evenimentele bifate?");
  await expect(page.locator("#admin-alert")).toContainText(dates === 1 ? "1 eveniment șters" : `${dates} evenimente șterse`, { timeout: 15_000 });
  await page.context().clearCookies();
}

/**
 * Removes everything `created` names — each one on its own, so one refusal does not leave the
 * rest behind — and throws the first failure only after trying them all. Called from `finally`:
 * when the test itself failed, its own error is the one worth reading, so `quiet` swallows these.
 */
async function removeCreated(page: Page, created: Created, quiet: boolean): Promise<void> {
  const failures: unknown[] = [];
  for (const { title, dates } of created) {
    try {
      await removeEvents(page, title, dates);
    } catch (error) {
      failures.push(error);
    }
  }
  created.length = 0;
  if (failures.length > 0 && !quiet) throw failures[0];
}

test.describe("BR-REQ-041-01 the listing's cards (§366)", () => {
  test("are no whole-card link: the title is the card's link, the heading holds it, nothing is a link inside a link", async ({ page }) => {
    const list = await cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const card = list.nth(i);
      // No anchor wraps the heading or any other anchor.
      await expect(card.locator("a h2")).toHaveCount(0);
      await expect(card.locator("a a")).toHaveCount(0);
      // The title is the first link, to the event's page, and the door goes to the same page.
      const title = card.locator("h2 a");
      await expect(title).toHaveCount(1);
      const href = await title.getAttribute("href");
      expect(href).toMatch(/^\/ro\/evenimente\/[^/]+$/);
      expect(await card.getByRole("link").first().getAttribute("href")).toBe(href);
      expect(await card.getByRole("link", { name: "Descrierea completă a evenimentului" }).getAttribute("href")).toBe(href);
    }
  });

  test("give every title one style: the club's blue, no underline, one size and weight", async ({ page }) => {
    const list = await cards(page);
    const styles = await list.locator("h2 a").evaluateAll((links) =>
      links.map((link) => {
        const style = getComputedStyle(link);
        return `${style.color}|${style.textDecorationLine}|${style.fontSize}|${style.fontWeight}`;
      }),
    );
    expect(styles.length).toBeGreaterThan(0);
    expect(new Set(styles).size).toBe(1);
    // The primary colour — the door wears it too (§319) — never the page's ink or a visited purple.
    const door = list.first().getByRole("link", { name: "Descrierea completă a evenimentului" });
    const primary = await door.evaluate((link) => getComputedStyle(link).color);
    const ink = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(primary).not.toBe(ink);
    expect(styles[0]).toBe(`${primary}|none|20px|500`);
  });

  test("put the place's pin on the place's first line, never alone, and the place's map as its link wherever the club gave one", async ({ page }) => {
    const list = await cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const where = list.nth(i).locator('[data-fact="where"]');
      if ((await where.count()) === 0) continue;
      const offset = await where.evaluate((line) => {
        const icon = line.querySelector("svg")!.getBoundingClientRect();
        const words = line.querySelector("svg + div")!;
        // The first line box of the words themselves — not a link's padded box around them, and
        // not the text of a style tag the renderer may have put beside them.
        const walker = document.createTreeWalker(words, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => (node.textContent?.trim() && !node.parentElement?.closest("style, script") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
        });
        const range = document.createRange();
        range.selectNodeContents(walker.nextNode()!);
        const first = range.getClientRects()[0]!;
        // The glyph's centre against the first line of words' centre.
        return Math.abs(icon.top + icon.height / 2 - (first.top + first.height / 2));
      });
      expect.soft(offset, `card ${i}: the pin sits on the place's first line`).toBeLessThanOrEqual(6);
      const map = where.locator("a");
      if ((await map.count()) > 0) {
        await expect(map).toHaveAttribute("target", "_blank");
        // To a tenth of a pixel, as the tap-target check below: layout counts in sixty-fourths, and
        // a 44-pixel link at a fractional offset measures 43.99994.
        expect(Math.round(((await map.boundingBox())?.height ?? 0) * 10) / 10).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("leave every link and fold on a card its whole target: a press two pixels inside any edge lands on it", async ({ page }) => {
    /*
      A box 44 pixels tall is not a 44-pixel target when something later on the card sits on part
      of it: what comes later paints over it and takes the press there. The series card's rhythm
      line once sat six pixels up inside its title link's box (§366) while a measure of the box
      still said 44, and a series' dates were 24-pixel pills under a comment that said 44 — so this
      presses the edges of every link and fold on every card and asks which element answers. With
      a series of its own first: the seed has none, and a series card is the one whose title has a
      line right under it and whose dates are links.
    */
    test.setTimeout(150_000);
    const created: Created = [];
    let passed = false;
    try {
      const title = await publishSeries(page, created);
      const list = await cards(page);
      // One card for the three dates: the title, the map, the fold with the three dates, the door.
      const series = list.filter({ has: page.getByRole("link", { name: title.ro, exact: true }) });
      await expect(series).toHaveCount(1);
      await expect(series.locator('[data-fact="where"] a')).toHaveCount(1);
      await expect(series.locator("details a")).toHaveCount(3);
      // «Următoarea:» leads the next date's own line (§113) — asserted here too, where a series always stands.
      await expect(series.locator('[data-fact="when"]')).toContainText(/^Următoarea:\s*(Luni|Marți|Miercuri|Joi|Vineri|Sâmbătă|Duminică), \d{1,2} /);

      const targets = list.locator("a, summary");
      const count = await targets.count();
      expect(count).toBeGreaterThan(0);
      let pressed = 0;
      for (let i = 0; i < count; i += 1) {
        const result = await targets.nth(i).evaluate((target) => {
          target.scrollIntoView({ block: "center", behavior: "instant" });
          const box = target.getBoundingClientRect();
          const press = (x: number, y: number) => {
            const hit = document.elementFromPoint(x, y);
            // The sticky header or footer over the point says nothing about the card: not counted.
            if (!hit || !hit.closest("#main")) return "chrome";
            return target.contains(hit) ? "itself" : `${hit.tagName.toLowerCase()} "${(hit.textContent ?? "").trim().slice(0, 40)}"`;
          };
          const [middleX, middleY] = [box.left + box.width / 2, box.top + box.height / 2];
          return {
            name: (target.textContent ?? "").trim().slice(0, 40),
            height: box.height,
            width: box.width,
            top: press(middleX, box.top + 2),
            bottom: press(middleX, box.bottom - 2),
            left: press(box.left + 2, middleY),
            right: press(box.right - 2, middleY),
          };
        });
        // To a tenth of a pixel: layout counts in sixty-fourths, and a 44-pixel fold at a fractional
        // offset measures 43.99997.
        expect.soft(Math.round(result.height * 10) / 10, `${i} «${result.name}»: 44 pixels tall`).toBeGreaterThanOrEqual(44);
        expect.soft(Math.round(result.width * 10) / 10, `${i} «${result.name}»: 44 pixels wide`).toBeGreaterThanOrEqual(44);
        for (const edge of ["top", "bottom", "left", "right"] as const) {
          if (result[edge] === "chrome") continue;
          pressed += 1;
          expect.soft(result[edge], `${i} «${result.name}»: a press at its ${edge} edge`).toBe("itself");
        }
      }
      expect(pressed).toBeGreaterThan(0);
      passed = true;
    } finally {
      await removeCreated(page, created, !passed);
    }
  });

  test("put a clock beside the time on every card's date line", async ({ page }) => {
    /*
      By place, not by name: MUI names its icons (`data-testid="ScheduleIcon"`) only outside a
      production build, and this suite runs one — `listing-card.test.ts` checks the names. The
      line's own glyph, the calendar, leads it; the one glyph among its words is the clock, in the
      same piece as the time it stands before.
    */
    const list = await cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const when = list.nth(i).locator('[data-fact="when"]');
      await expect(when.locator(":scope > svg")).toHaveCount(1);
      const clock = when.locator(":scope > div svg");
      await expect(clock).toHaveCount(1);
      expect(Math.round((await clock.boundingBox())?.width ?? 0)).toBe(20);
      expect(await clock.evaluate((svg) => svg.parentElement?.textContent ?? "")).toMatch(/\d{1,2}:\d{2}/);
    }
  });

  test("keep a title's line as tall as its words: what follows starts one of the card's gaps under them, not under the link's reach", async ({ page }) => {
    /*
      The title's link is 44 pixels of target around 26 pixels of words, the rest given back as
      margin (§366) — given back only if the padding is inside the 44. Inside the listing's
      "other events" fold everything is content-box (a `<details>` slots its content where MUI's
      `box-sizing: inherit` does not reach), and until the link said border-box its heading stood
      44 tall and the line under it began 27 pixels below the title's words instead of 9: nothing
      overlapped, so no press showed it, and no box's own height did either.
    */
    const list = await cards(page);
    const count = await list.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const gap = await list.nth(i).locator("h2").evaluate((h2) => {
        // The words' own line boxes: the link is the range's container, so its padded box is not one of them.
        const range = document.createRange();
        range.selectNodeContents(h2.querySelector("a")!);
        const words = range.getClientRects();
        return h2.nextElementSibling!.getBoundingClientRect().top - words[words.length - 1]!.bottom;
      });
      // A line's gap (8) or a group's (12), and the line's half-leading (1).
      expect.soft(gap, `card ${i}: under the title's words`).toBeGreaterThanOrEqual(6);
      expect.soft(gap, `card ${i}: under the title's words`).toBeLessThanOrEqual(14);
    }
  });

  test("draw the route and the cost as pills, in order — surface, difficulty, distance, elevation, cost — with no middle dots and no partner among them", async ({ page }) => {
    const list = await cards(page);
    // The seeded Tâmpa run: 14 km, 600 m of climb, moderate, on trail, free.
    const tampa = list.filter({ hasText: "Tură pe Tâmpa" }).first();
    const pills = tampa.locator('[data-fact="pills"] .MuiChip-root');
    // The owner, 2026-09-24, of "8 km · 250 m D+ · Mediu · Trail": "The order of this should be:
    // terrain type, difficulty, distance, elevation" (§366, amended §375); the cost pill follows.
    // The difficulty pill's visible word carries a screen-reader-only "— Dificultate" suffix
    // (`route-pills.ts` `srSuffix`, `DECISIONS.md` §394), so its element's own text is not just
    // "Mediu" — the regex anchors on the visible word and still counts and orders every pill.
    await expect(pills).toHaveText(["Trail", /^Mediu(?: — .+)?$/, "14 km", "600 m D+", "Gratuit"]);
    await expect(tampa.locator('[data-fact="pills"]')).not.toContainText("·");
    // The surface is said once on the card: as a pill, not also as a chip at the top.
    await expect(tampa.locator(".MuiChip-root", { hasText: /^Trail$/ })).toHaveCount(1);
    // The long "diferență de nivel" of the old line is the pill's "D+" now, on every card.
    await expect(page.locator("#main ul > li", { hasText: "diferență de nivel" })).toHaveCount(0);
    // "Împreună cu …" is not among any card's facts.
    await expect(page.locator('#main [data-testid="card-facts"]', { hasText: "Împreună cu" })).toHaveCount(0);
  });

  test("keep the door to the page right under the facts — no hole above it", async ({ page }) => {
    const list = await cards(page);
    const count = await list.count();
    for (let i = 0; i < count; i += 1) {
      const card = list.nth(i);
      const gap = await card.evaluate((li) => {
        const door = [...li.querySelectorAll("a")].find((a) => /Descrierea completă/.test(a.textContent ?? ""))!;
        // The last thing above the door: the fold of a series card, or the facts.
        const above = li.querySelector("details") ?? li.querySelector('[data-testid="card-facts"]')!;
        return door.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
      });
      // The door's own margin, four pixels, and no more: what a row leaves over is below it.
      expect.soft(gap, `card ${i}: the door follows the facts`).toBeLessThanOrEqual(8);
      expect.soft(gap, `card ${i}: the door does not overlap the facts`).toBeGreaterThanOrEqual(0);
    }
  });

  test("clamp the summary to three lines and print no web address", async ({ page }) => {
    const list = await cards(page);
    const summaries = list.locator('[data-testid="card-excerpt"]');
    const count = await summaries.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const lines = await summaries.nth(i).evaluate((box) => {
        const paragraph = box.querySelector("p");
        const lineHeight = parseFloat(getComputedStyle(paragraph ?? box).lineHeight);
        // A picture is not a line; the seed's summaries have none.
        return box.querySelector("figure") ? 0 : Math.round(box.getBoundingClientRect().height / lineHeight);
      });
      expect.soft(lines, `summary ${i}`).toBeLessThanOrEqual(3);
    }
    await expect(page.locator("#main ul > li", { hasText: /https?:\/\// })).toHaveCount(0);
  });

  test("write a series card's next date on its own line with «Următoarea:», when the listing has a series", async ({ page }) => {
    const list = await cards(page);
    const series = list.filter({ has: page.locator("summary", { hasText: /^Următoarele date/ }) });
    const count = await series.count();
    test.skip(count === 0, "no series on the listing: CI's seed publishes none");
    for (let i = 0; i < count; i += 1) {
      const when = series.nth(i).locator('[data-fact="when"]');
      await expect(when).toContainText(/^Următoarea:\s*(Luni|Marți|Miercuri|Joi|Vineri|Sâmbătă|Duminică), \d{1,2} /);
      // The word is not a line of its own above the facts any more: nowhere outside the date's line.
      const elsewhere = await series.nth(i).evaluate(
        (li) =>
          [...li.querySelectorAll("*")].filter(
            (element) => element.children.length === 0 && /^Următoarea:?$/.test(element.textContent?.trim() ?? "") && !element.closest('[data-fact="when"]'),
          ).length,
      );
      expect(elsewhere).toBe(0);
    }
  });

  test("fit a 320-pixel phone: nothing wider than the page", async ({ page }) => {
    await cards(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  /**
   * BR-REQ-041-01, amended §375 — the owner, 2026-09-24, of the row "Următoarea: Luni, 28 sept.
   * 2026 · 18:30" whose clock and time had wrapped to a second line: "This should be on a single
   * line on a phone." Within the coming twelve months a phone reads the date with no year (§349
   * keeps the weekday), and the row stays whole between pieces — never breaking a piece's own
   * words — and never runs past the card, whose own `overflow: hidden` would cut the time off
   * without a word.
   *
   * Measured on fixtures the seed cannot give, made through the backoffice the way an organizer
   * would and removed after (`removeCreated`, whatever of them was made):
   *
   * - two series on the longest weekdays with a two-digit day — a Sunday ("Următoarea: Duminică,
   *   27 sept.", the widest row in Romanian) and a Wednesday ("Next: Wednesday, 30 Sept", the
   *   widest in English). Their lead gives way, never the time: clipped to a pixel below
   *   `EventFacts.tsx`'s `WHEN_LEAD_HIDDEN_BELOW_376`, shown from it up, and the row one line at
   *   every width. The breakpoint was 345 once, from one Monday; a review, 2026-09-24, found a
   *   Sunday's row clipped between 345 and 368;
   * - a race with its own two named times, whose row may wrap between them;
   * - a run more than a year out and a run already past, whose cards keep the year on a phone
   *   ("Duminică, 27 sept. 2026 · 18:30" is 227 pixels against the 226 a 320-pixel card leaves the
   *   row): they may wrap between whole pieces, and must not overflow.
   *
   * At 320 (the mobile project's width), 360, 390 and 412 pixels, in both languages; every other
   * card on the listing is measured too.
   */
  test("keeps the «when» row whole at 320, 360, 390 and 412 pixels: one line with the series lead only where it fits, and a wrap between whole pieces — never a clipped time — for a race's two times or a date that keeps its year", async ({
    page,
  }) => {
    test.skip(test.info().project.name !== "mobile", "the widths below are only meaningful under the mobile project's phone viewport");
    test.setTimeout(480_000);
    const created: Created = [];
    let passed = false;
    const today = new Date();
    try {
      const sunday = await publishSeries(page, created, widestDay(new Date(today.getTime() + DAY), 0, 1));
      const wednesday = await publishSeries(page, created, widestDay(new Date(today.getTime() + DAY), 3, 1));
      // On the widest Romanian weekday with a two-digit day, so the date stands alone on the first
      // line and the two bold times share the second — the case that measured 226.83 pixels
      // against 226 at 320 before the race row's tighter gap (§381), every run rather than one
      // week in seven.
      const race = await publishOneOff(page, created, "race", widestDay(new Date(today.getTime() + 9 * DAY), 0, 1));
      const yearOutDay = widestDay(new Date(today.getTime() + 380 * DAY), 0, 1);
      const yearOut = await publishOneOff(page, created, "yearOut", yearOutDay);
      const pastDay = widestDay(new Date(today.getTime() - 2 * DAY), 0, -1);
      const past = await publishOneOff(page, created, "past", pastDay);
      const LEAD_BREAKPOINT = 376;
      // Half a pixel, no more: a fitting row measures 0, and the defect this guards measured 1.2 at
      // its smallest (the seed's past Sunday under the old `nowrap`, at 320 pixels).
      const TOLERANCE = 0.5;

      for (const width of [320, 360, 390, 412] as const) {
        await page.setViewportSize({ width, height: 720 });
        for (const locale of ["ro", "en"] as const) {
          const list = await cards(page, locale);
          const count = await list.count();
          expect(count).toBeGreaterThan(0);
          const byTitle = (title: { ro: string; en: string }) => list.filter({ has: page.getByRole("link", { name: title[locale], exact: true }) });

          /** The row as a reader sees it: its height in lines, how far its pieces run past it, its visible words. */
          const measure = (card: Locator) =>
            card.locator('[data-fact="when"]').evaluate((line) => {
              const style = getComputedStyle(line);
              const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
              const box = line.getBoundingClientRect();
              // `flow`'s own row, inside `cardLine`'s wrapper: every piece that shows — the lead is
              // left out where it is clipped to a pixel, since its words run past its box by design.
              const row = line.querySelector(":scope > div > div")!;
              const pieces = [...row.children].filter((piece) => getComputedStyle(piece).position !== "absolute");
              const right = Math.max(...pieces.map((piece) => piece.getBoundingClientRect().right));
              return {
                lines: box.height / lineHeight,
                overflow: Math.max(line.scrollWidth - line.clientWidth, right - box.right),
                // `innerText` leaves out the rendering `display: none` hides: the date as shown.
                shown: (line as HTMLElement).innerText,
              };
            });
          const at = `${width}px, ${locale}`;

          // The two series: one line, the lead clipped below the breakpoint and shown from it up.
          const leadWord = locale === "ro" ? "Următoarea:" : "Next:";
          for (const [name, title] of [["Sunday series", sunday], ["Wednesday series", wednesday]] as const) {
            const card = byTitle(title);
            await expect(card, `${name} present (${at})`).toHaveCount(1);
            const leadBox = await card.locator('[data-fact="when"]').getByText(leadWord, { exact: true }).boundingBox();
            expect(leadBox, `${name}: lead in the markup (${at})`).not.toBeNull();
            if (width < LEAD_BREAKPOINT) expect.soft(leadBox!.width, `${name}: lead clipped (${at})`).toBeLessThanOrEqual(1);
            else expect.soft(leadBox!.width, `${name}: lead shown (${at})`).toBeGreaterThan(1);
            const row = await measure(card);
            expect.soft(row.shown, `${name}: no year on a phone (${at})`).not.toMatch(/\b20\d{2}\b/);
            expect.soft(row.shown, `${name}: the time (${at})`).toContain("18:30");
            expect.soft(row.lines, `${name}: one line (${at})`).toBeLessThanOrEqual(1.5);
            expect.soft(row.overflow, `${name}: nothing past the card (${at})`).toBeLessThanOrEqual(TOLERANCE);
          }

          // The race: both times whole, on two lines at most.
          const raceCard = byTitle(race);
          await expect(raceCard, `race present (${at})`).toHaveCount(1);
          const raceRow = await measure(raceCard);
          expect.soft(raceRow.shown, `race: its gathering time (${at})`).toContain("08:00");
          expect.soft(raceRow.shown, `race: its start time (${at})`).toContain("09:00");
          expect.soft(raceRow.lines, `race: two lines at most (${at})`).toBeLessThanOrEqual(2.5);
          expect.soft(raceRow.overflow, `race: nothing past the card (${at})`).toBeLessThanOrEqual(TOLERANCE);

          // A year out and a past date: the year kept, a wrap allowed, nothing past the card.
          for (const [name, title, day] of [["a year out", yearOut, yearOutDay], ["past", past, pastDay]] as const) {
            const card = byTitle(title);
            await expect(card, `${name} present (${at})`).toHaveCount(1);
            const row = await measure(card);
            expect.soft(row.shown, `${name}: keeps its year (${at})`).toContain(String(day.getUTCFullYear()));
            expect.soft(row.shown, `${name}: the time (${at})`).toContain("18:30");
            expect.soft(row.lines, `${name}: two lines at most (${at})`).toBeLessThanOrEqual(2.5);
            expect.soft(row.overflow, `${name}: nothing past the card (${at})`).toBeLessThanOrEqual(TOLERANCE);
          }

          // Every card on the listing: one line — two for a race's times or a date that keeps its
          // year — and nothing past the card.
          for (let i = 0; i < count; i += 1) {
            const card = list.nth(i);
            const row = await measure(card);
            const twoTimes = /\d{2}:\d{2}[\s\S]*\d{2}:\d{2}/.test(row.shown);
            const withYear = /\b20\d{2}\b/.test(row.shown);
            expect.soft(row.lines, `card ${i} «${row.shown}» (${at}): lines`).toBeLessThanOrEqual(twoTimes || withYear ? 2.5 : 1.5);
            expect.soft(row.overflow, `card ${i} «${row.shown}» (${at}): nothing past the card`).toBeLessThanOrEqual(TOLERANCE);
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow).toBeLessThanOrEqual(0);
        }
      }
      passed = true;
    } finally {
      await removeCreated(page, created, !passed);
    }
  });
});
