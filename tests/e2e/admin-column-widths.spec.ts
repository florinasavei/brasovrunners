import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * §650, BR-REQ-041-01 — a backoffice table's columns can be resized: on the registrations list at
 * desktop width, a column's edge is dragged, the width survives a reload — drawn before the page
 * hydrates, by the inline script's `<style>` — «Lățimi și coloane implicite» puts the table back to its
 * automatic layout, and the edge is a named vertical separator, one per column but the row verbs',
 * whose `aria-valuenow` the arrow keys move by 16 and whose `aria-valuemin` is its heading's floor. At 320 px the phone layout has no columns, so no edge and no reset.
 *
 * §661 — and hidden: «Coloane» in the actions' heading unticks a column, which stays hidden after a
 * reload (drawn hidden before hydration too), keeps its width, has no edge to tab to, and comes back
 * by the menu or the reset; the name and the state have no checkbox.
 *
 * §943 — and the row verbs' column stays in view: on a frame narrower than the table it is pinned to the
 * frame's right edge, opaque, fading into the columns under it; a press the keyboard reaches beside it is
 * not left under it; and on the owner's 1858-px screen the whole table fits — since §960, once the Administrator's
 * «Emailuri» is unticked under «Coloane»: drawn, with somebody on the page emailed, the table scrolls under the pinned verbs.
 *
 * Everything here is the browser's own layout — `col` alignment under `table-layout: fixed` with
 * collapsed borders, pointer capture, the restore after a reload, `position: sticky` in a scrolling
 * frame — which no unit test can reach.
 *
 * One registration is written straight into the database so the list is not empty (the setup, not
 * the subject, as `promo-filter.spec.ts` argues), and removed afterwards — with the emails a confirmed
 * participant has had, so the Administrator's «Emailuri» column (§960) draws the cell of somebody
 * emailed, three lines and «și încă 2 emailuri» on its floor, as on the owner's own lists.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

type Seeded = { eventId: string; registrationId: string; participantId: string; tag: string };

/** What the seeded registration was emailed, oldest first: each left a minute after it was queued; the newest's delivery not reported. */
const EMAILS: readonly { type: string; ago: string; delivered: boolean }[] = [
  { type: "VERIFY_REGISTRATION_EMAIL", ago: "6 days", delivered: true },
  { type: "COMPLETE_DECLARATION", ago: "5 days 23 hours", delivered: true },
  { type: "DECLARATION_SIGNED", ago: "5 days", delivered: true },
  { type: "REGISTRATION_CONFIRMED", ago: "4 days 23 hours", delivered: true },
  { type: "EVENT_UPDATE_NOTICE", ago: "1 day", delivered: false },
];

async function seed(tag: string): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>(
      "SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1",
      [FEATURED.slug],
    );
    const eventId = eventRows[0].id;
    const email = `columns-${tag}@test.invalid`;
    const name = `Coloane ${tag}`;
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
       VALUES ($1, $1, $1, 1, $2) RETURNING id`,
      [email, name],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out,
         promo_consent, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED'::registration_status, 'ro', $3, $3, 'PUBLIC', 1, now(), false, 1, true, false, now())
       RETURNING id`,
      [eventId, participantRows[0].id, name],
    );
    // Left and settled, never waiting: nothing here is the outbox's to send. Removed with the registration (on delete cascade).
    for (const [index, mail] of EMAILS.entries()) {
      await client.query(
        `INSERT INTO email_outbox (participant_id, registration_id, message_type, locale, recipient_email, payload_json, idempotency_key,
           status, attempt_count, transport, recipient_count, created_at, sent_at, delivered_at)
         VALUES ($1, $2, $3, 'ro', $4, '{}'::jsonb, $5, 'SENT', 1, 'mailgun', 1, now() - $6::interval,
           now() - $6::interval + interval '1 minute', CASE WHEN $7::boolean THEN now() - $6::interval + interval '2 minutes' END)`,
        [participantRows[0].id, rows[0].id, mail.type, email, `e2e-column-widths-${tag}-${index}`, mail.ago, mail.delivered],
      );
    }
    return { eventId, registrationId: rows[0].id, participantId: participantRows[0].id, tag };
  } finally {
    await client.end();
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("DELETE FROM registrations WHERE id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
  } finally {
    await client.end();
  }
}

/** The `<col>`'s laid-out width, as the browser gives it — the width every cell below it takes. */
async function columnWidth(page: Page, key: string): Promise<number> {
  return page
    .locator(`#main table[data-table-id="registrations"] th[data-column="${key}"]`)
    .evaluate((th) => Math.round(th.getBoundingClientRect().width));
}

async function inlineWidth(page: Page, key: string): Promise<string> {
  return page
    .locator(`#main table[data-table-id="registrations"] col[data-column="${key}"]`)
    .evaluate((col) => (col as HTMLElement).style.width);
}

async function drag(page: Page, handle: Locator, by: number) {
  // The mouse moves in the viewport's coordinates: the list sits below the filters and the counts.
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error("the column's edge has no box");
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + by / 2, y, { steps: 5 });
  await page.mouse.move(x + by, y, { steps: 5 });
  await page.mouse.up();
}

test.describe("§650 a backoffice table's columns can be resized", () => {
  test("drag, reload, reset and the keyboard on the registrations list", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the desktop project drives the pointer; the phone has its own test below");
    test.setTimeout(90_000);
    const seeded = await seed(`${testInfo.project.name}-${Date.now().toString(36)}`);
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await signIn(page, "Dev Administrator");
      const address = `/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.tag)}`;
      await page.goto(address);
      await hydrated(page);

      const main = page.locator("#main");
      const handle = main.locator('[data-column-resize="name"]');
      const reset = main.getByTestId("admin-table-reset-widths");
      await expect(handle).toBeVisible();
      await expect(handle).toHaveAttribute("role", "separator");
      await expect(handle).toHaveAttribute("aria-label", "Lățimea coloanei „Nume”");
      await expect(handle).toHaveAttribute("aria-orientation", "vertical");
      // One edge per visible column, none for the row verbs' column.
      const table = main.locator('table[data-table-id="registrations"]');
      const headings = await table.locator("th[data-column]").filter({ visible: true }).count();
      const verbs = await table.locator('th[data-column="__actions"]').filter({ visible: true }).count();
      await expect(table.locator("[data-column-resize]").filter({ visible: true })).toHaveCount(headings - verbs);
      await expect(reset).toHaveCount(0);
      // A focusable separator says its value from the start, not only after a drag.
      await expect(handle).toHaveAttribute("aria-valuenow", /^\d+$/);
      // Its floor is the heading's own, measured: «Nume», its arrow and padding, over the least 64.
      await expect.poll(async () => Number(await handle.getAttribute("aria-valuemin"))).toBeGreaterThan(64);
      const floor = await handle.getAttribute("aria-valuemin");

      const before = await columnWidth(page, "name");
      await drag(page, handle, 120);
      await expect.poll(() => columnWidth(page, "name")).toBeGreaterThanOrEqual(before + 100);
      const widened = await columnWidth(page, "name");
      await expect(main.locator('table[data-table-id="registrations"]')).toHaveAttribute("data-resized", "true");
      await expect(reset).toBeVisible();
      // Wider than the frame, the frame scrolls sideways; the page never does.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Before any island runs, the stored width is already drawn: the inline script after
      // </table> wrote it into one <style>. Holding the page's scripts back keeps it un-hydrated.
      await page.route("**/_next/static/chunks/**", (route) => route.abort());
      await page.reload();
      await expect(main.locator('table[data-table-id="registrations"]')).toBeVisible();
      expect(
        await page.evaluate(() => document.head.querySelectorAll('style[data-column-widths="registrations"]').length),
      ).toBe(1);
      expect(await columnWidth(page, "name")).toBe(widened);
      expect(await inlineWidth(page, "name")).toBe("");
      await page.unroute("**/_next/static/chunks/**");

      await page.reload();
      await hydrated(page);
      await expect.poll(() => columnWidth(page, "name")).toBe(widened);
      await expect(reset).toBeVisible();
      await expect(handle).toHaveAttribute("aria-valuenow", String(widened));
      // Hydrated, the islands own the widths: the pre-paint style is gone, the floor is the column's own.
      expect(
        await page.evaluate(() => document.head.querySelectorAll('style[data-column-widths="registrations"]').length),
      ).toBe(0);
      await expect(handle).toHaveAttribute("aria-valuemin", floor as string);

      // «Lățimi și coloane implicite»: the table is automatic again, and the focus lands on a column edge.
      await reset.click();
      await expect(reset).toHaveCount(0);
      await expect(main.locator('table[data-table-id="registrations"]')).not.toHaveAttribute("data-resized");
      expect(await inlineWidth(page, "name")).toBe("");
      await expect.poll(() => columnWidth(page, "name")).toBe(before);
      await expect(main.locator('[role="separator"]').first()).toBeFocused();

      // The keyboard: one press of the right arrow is 16 px more.
      await handle.focus();
      const now = Number(await handle.getAttribute("aria-valuenow"));
      await page.keyboard.press("ArrowRight");
      await expect(handle).toHaveAttribute("aria-valuenow", String(now + 16));
      await expect.poll(() => inlineWidth(page, "name")).toBe(`${now + 16}px`);

      // Home goes to the column's own floor: its heading «Nume» is never cut inside a word.
      await page.keyboard.press("Home");
      const heading = main.locator('table[data-table-id="registrations"] th[data-column="name"] [data-column-heading]');
      const fits = await heading.evaluate((span) => {
        const box = span.getBoundingClientRect();
        const th = span.closest("th") as HTMLElement;
        return box.right <= th.getBoundingClientRect().right && span.getClientRects().length >= 1;
      });
      expect(fits).toBe(true);
    } finally {
      await cleanup(seeded);
    }
  });

  test("§661 «Coloane» hides a column, before hydration too, and the menu or the reset brings it back", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the table is a desktop layout; the phone has its own test below");
    test.setTimeout(90_000);
    const seeded = await seed(`${testInfo.project.name}-${Date.now().toString(36)}`);
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.tag)}`);
      await hydrated(page);

      const main = page.locator("#main");
      const table = main.locator('table[data-table-id="registrations"]');
      const email = table.locator('th[data-column="email"]');
      const button = main.getByTestId("admin-table-columns");
      await expect(email).toBeVisible();
      await expect(button).toHaveAccessibleName("Coloane");
      // A width stored for the column first: hiding keeps it for when the column returns.
      await table.locator('[data-column-resize="email"]').focus();
      await page.keyboard.press("ArrowRight");
      const width = await inlineWidth(page, "email");
      expect(width).toMatch(/^\d+px$/);

      await button.click();
      const menu = page.getByRole("menu");
      // The name and the state are always shown: no checkbox for either.
      await expect(menu.locator('[data-column-toggle="name"]')).toHaveCount(0);
      await expect(menu.locator('[data-column-toggle="status"]')).toHaveCount(0);
      await expect(menu.getByText("Mereu afișate:")).toBeVisible();
      const toggle = menu.getByRole("menuitemcheckbox", { name: "Contact", exact: true });
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await page.keyboard.press("Escape");
      await expect(email).toBeHidden();
      await expect(table.locator('[data-column-resize="email"]')).toBeHidden();

      // Before any island runs, the column is already hidden by the pre-paint script's own <style>.
      await page.route("**/_next/static/chunks/**", (route) => route.abort());
      await page.reload();
      await expect(table).toBeVisible();
      expect(
        await page.evaluate(() => document.head.querySelectorAll('style[data-column-hidden="registrations"]').length),
      ).toBe(1);
      await expect(email).toBeHidden();
      await page.unroute("**/_next/static/chunks/**");

      // Hydrated, it stays hidden, and «Arată toate coloanele» brings it back at its stored width.
      await page.reload();
      await hydrated(page);
      await expect(email).toBeHidden();
      await button.click();
      await page.getByRole("menuitem", { name: "Arată toate coloanele" }).click();
      await page.keyboard.press("Escape");
      await expect(email).toBeVisible();
      await expect.poll(() => inlineWidth(page, "email")).toBe(width);

      // Hidden again, then the reset: every column back, every width automatic.
      await button.click();
      await page.getByRole("menuitemcheckbox", { name: "Contact", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(email).toBeHidden();
      await main.getByTestId("admin-table-reset-widths").click();
      await expect(email).toBeVisible();
      await expect(main.getByTestId("admin-table-reset-widths")).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("br.table.registrations.hidden"))).toBeNull();
    } finally {
      await cleanup(seeded);
    }
  });

  test("§943 the row verbs stay in view: pinned while the table scrolls, and on a wide screen the table fits", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the table is a desktop layout: the phone's blocks have no columns to scroll");
    test.setTimeout(90_000);
    const seeded = await seed(`${testInfo.project.name}-${Date.now().toString(36)}`);
    try {
      // A small laptop: the list's columns ask for more than this frame has.
      await page.setViewportSize({ width: 1000, height: 800 });
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.tag)}`);
      await hydrated(page);

      const main = page.locator("#main");
      const table = main.locator('table[data-table-id="registrations"]');
      const frame = table.locator("xpath=..");
      const verbs = table.locator("thead th[data-pinned]");
      const rowVerbs = table.locator("tbody td[data-pinned]").first();
      /** Where a cell stands against the frame's edges and against the verbs' column. */
      const place = (target: Locator) =>
        target.evaluate((element) => {
          const own = element.closest("table") as HTMLTableElement;
          const edge = (own.parentElement as HTMLElement).getBoundingClientRect();
          const pinned = (own.querySelector("thead th[data-pinned]") as HTMLElement).getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return {
            inFrame: box.left >= edge.left - 0.5 && box.right <= edge.right + 0.5,
            clearOfVerbs: box.right <= pinned.left + 0.5,
          };
        });
      const scrolls = () => frame.evaluate((element) => ({ wider: element.scrollWidth > element.clientWidth, left: element.scrollLeft }));

      // The table scrolls inside its frame, the page never does — and the verbs are wholly in the frame without scrolling:
      // the heading with «Coloane», and the row's own.
      expect(await scrolls()).toEqual({ wider: true, left: 0 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect((await place(verbs)).inFrame).toBe(true);
      expect((await place(rowVerbs)).inFrame).toBe(true);
      await expect(main.getByTestId("admin-table-columns")).toBeVisible();
      // «Eveniment» is not drawn with one event chosen: every row would say the filter's own choice.
      await expect(table.locator('th[data-column="event"]')).toHaveCount(0);

      // Columns lie under the verbs: the frame says so and the verbs' edge fades into them.
      await expect(frame).toHaveAttribute("data-more-end", "");
      const fade = () => rowVerbs.evaluate((cell) => getComputedStyle(cell, "::before").opacity);
      await expect.poll(fade).toBe("1");
      // The verbs' cell is opaque, so what passes under it is not read through it.
      expect(await rowVerbs.evaluate((cell) => getComputedStyle(cell).backgroundColor)).not.toMatch(/rgba\([^)]*,\s*0\)|transparent/);

      // A press reached with the keyboard in the last column is scrolled beside the verbs, not under them (WCAG 2.4.11).
      const partner = table.locator('th[data-column="partner"]');
      const press = table.locator("tbody tr").first().locator("td").nth(-2).getByRole("button");
      await expect(press).toHaveCount(1);
      await press.focus();
      await expect.poll(async () => (await place(press)).clearOfVerbs).toBe(true);
      expect(await place(press)).toEqual({ inFrame: true, clearOfVerbs: true });
      // At the frame's end the last column stands whole beside the verbs, and nothing more lies that way: no fade.
      await frame.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
      await expect(frame).not.toHaveAttribute("data-more-end");
      await expect.poll(fade).toBe("0");
      expect(await place(partner)).toEqual({ inFrame: true, clearOfVerbs: true });
      expect((await place(verbs)).inFrame).toBe(true);

      // The owner's screen, 1858 px (2026-11-12: «Aici mi se face crop!»). «Emailuri» (§960) is the Administrator's one column
      // that asks for more than this screen has left once somebody on the page was emailed: the row's three newest emails, a
      // line each, then the link to the rest, on a floor of sixteen rem — never squeezed to its heading, a word to a line. Drawn,
      // it leaves the table wider than this frame — by 63 px on this page of one confirmed registration when §960 measured it,
      // by 194 on a page of a race's usual states, where no floor fits: the table scrolls under the pinned verbs, which stay
      // whole in the frame, and the page itself never scrolls.
      await page.setViewportSize({ width: 1858, height: 900 });
      const emails = table.locator('th[data-column="emails"]');
      await expect(emails).toBeVisible();
      const cell = table.getByTestId("email-summary");
      await expect(cell.getByTestId("email-summary-line")).toHaveCount(3);
      await expect(cell.getByTestId("email-summary-more")).toHaveText("și încă 2 emailuri");
      expect(await cell.evaluate((box) => box.getBoundingClientRect().width)).toBeGreaterThanOrEqual(16 * 16 - 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect((await place(verbs)).inFrame).toBe(true);
      // «Coloane» gives the width back (§661), and remembers it: with «Emailuri» unticked the whole table fits its frame,
      // nothing scrolls sideways, no edge fades — as before the column. Any other column added to this list has to fit
      // here, or leave below a breakpoint.
      await main.getByTestId("admin-table-columns").click();
      const emailsToggle = page.getByRole("menuitemcheckbox", { name: "Emailuri", exact: true });
      await expect(emailsToggle).toHaveAttribute("aria-checked", "true");
      await emailsToggle.click();
      await expect(emailsToggle).toHaveAttribute("aria-checked", "false");
      await page.keyboard.press("Escape");
      await expect(emails).toBeHidden();
      await expect.poll(async () => (await scrolls()).wider).toBe(false);
      await expect(frame).not.toHaveAttribute("data-more-end");
      expect((await place(verbs)).inFrame).toBe(true);
      expect(await place(partner)).toEqual({ inFrame: true, clearOfVerbs: true });
      // An address reads on one line there, not a few characters to a line.
      const address = table.locator("tbody tr").first().locator("td").filter({ hasText: `columns-${seeded.tag}@test.invalid` });
      expect(await address.locator("span").first().evaluate((span) => span.getClientRects().length)).toBe(1);
      // The long heading is two lines, not the column's width.
      const bib = table.locator('th[data-column="bib"]');
      expect(await bib.locator("[data-column-heading]").evaluate((span) => Math.round(span.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(span).lineHeight)))).toBe(2);
    } finally {
      await cleanup(seeded);
    }
  });

  test.describe("§977 with Chromium's scrollbars drawn", () => {
    // Headless Chromium starts with `--hide-scrollbars`: the bar would be a pixel tall, with no track and no thumb to drag.
    // Drawn here, as on a person's screen; the config's own executable kept (§501). A worker of its own for this one test.
    test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, ignoreDefaultArgs: ["--hide-scrollbars"] } });

    test("§977 a scrollbar at the top too: it moves the frame, the frame moves it, and it goes when the table fits", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "the bar is the wide table's: the phone's blocks have no columns to scroll");
      test.setTimeout(120_000);
      const seeded = await seed(`${testInfo.project.name}-${Date.now().toString(36)}`);
      try {
        // The small laptop of §943: the list's columns ask for more than this frame has.
        await page.setViewportSize({ width: 1000, height: 800 });
        await signIn(page, "Dev Administrator");
        await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.tag)}`);
        await hydrated(page);
        const main = page.locator("#main");
        const frame = main.locator("#table-frame-registrations");
        const bar = main.locator('[data-top-scrollbar="table-frame-registrations"]');
        await expect(frame.locator('table[data-table-id="registrations"]')).toHaveCount(1);

        // Shown while the frame overflows, right above it, decoration only: no name, no tab stop.
        await expect(bar).toBeVisible();
        await expect(bar).toHaveAttribute("aria-hidden", "true");
        await expect(bar).toHaveAttribute("tabindex", "-1");
        const geometry = await bar.evaluate((element) => {
          const frameElement = document.getElementById("table-frame-registrations") as HTMLElement;
          return {
            barRoom: element.scrollWidth - element.clientWidth,
            frameRoom: frameElement.scrollWidth - frameElement.clientWidth,
            above: element.getBoundingClientRect().bottom <= frameElement.getBoundingClientRect().top + 0.5,
            position: getComputedStyle(element).position,
            top: Number.parseFloat(getComputedStyle(element).top),
            // The site header's own height: stuck at the window's top it ends there (the environment notice above it scrolls away).
            header: (document.querySelector("[data-sticky-header]") as HTMLElement | null)?.offsetHeight ?? 0,
          };
        });
        expect(geometry.frameRoom).toBeGreaterThan(1);
        // Both reach exactly as far, so one position means the same column in both.
        expect(Math.abs(geometry.barRoom - geometry.frameRoom)).toBeLessThanOrEqual(1);
        expect(geometry.above).toBe(true);
        // Sticky right under the site header: its real height, so no strip of rows between them and nothing behind it.
        expect(geometry.position).toBe("sticky");
        expect(geometry.header).toBeGreaterThan(0);
        expect(Math.abs(geometry.top - geometry.header)).toBeLessThanOrEqual(1);

        // The bar moves the frame…
        await bar.evaluate((element) => element.scrollTo({ left: 120 }));
        await expect.poll(() => frame.evaluate((element) => Math.round(element.scrollLeft))).toBe(120);
        // …a wheel over it too…
        await bar.hover();
        await page.mouse.wheel(60, 0);
        await expect.poll(() => frame.evaluate((element) => Math.round(element.scrollLeft))).toBeGreaterThan(120);
        // …and the frame moves the bar, which then rests: no answer back and forth.
        await frame.evaluate((element) => element.scrollTo({ left: 40 }));
        await expect.poll(() => bar.evaluate((element) => Math.round(element.scrollLeft))).toBe(40);
        expect(await frame.evaluate((element) => Math.round(element.scrollLeft))).toBe(40);
        // At the frame's end the bar is at its own end, and the pinned verbs' fade (§943, the same watcher) is gone.
        await frame.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
        await expect.poll(() => bar.evaluate((element) => Math.round(element.scrollWidth - element.clientWidth - element.scrollLeft))).toBe(0);
        await expect(frame).not.toHaveAttribute("data-more-end");

        // A hand on the bar's thumb: the frame follows, and the bar is never written — no late echo of the frame's «scroll»
        // pulls the thumb back under the pointer (the review's Chromium run: written 39 times, once 23 px back, mid-drag).
        await frame.evaluate((element) => element.scrollTo({ left: 0 }));
        await expect.poll(() => bar.evaluate((element) => Math.round(element.scrollLeft))).toBe(0);
        await bar.evaluate((element) => {
          const own = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft") as PropertyDescriptor;
          const record = { writes: 0, trail: [] as number[] };
          (window as unknown as { barRecord: typeof record }).barRecord = record;
          Object.defineProperty(element, "scrollLeft", {
            configurable: true,
            get: () => own.get?.call(element),
            set: (value: number) => {
              record.writes++;
              own.set?.call(element, value);
            },
          });
          element.addEventListener("scroll", () => record.trail.push(element.scrollLeft), { passive: true });
        });
        const track = await bar.boundingBox();
        if (!track) throw new Error("the bar has no box");
        // A track one can grab — the 12 px drawn — not the pixel `--hide-scrollbars` leaves.
        expect(track.height).toBeGreaterThanOrEqual(10);
        expect(track.height).toBeLessThanOrEqual(14);
        const y = track.y + track.height - 6;
        await page.mouse.move(track.x + 8, y);
        await page.mouse.down();
        for (let step = 1; step <= 40; step++) await page.mouse.move(track.x + 8 + step * 8, y);
        await page.mouse.up();
        const record = await page.evaluate(() => (window as unknown as { barRecord: { writes: number; trail: number[] } }).barRecord);
        expect(record.trail.length).toBeGreaterThan(1);
        expect(record.writes).toBe(0);
        for (let index = 1; index < record.trail.length; index++) expect(record.trail[index]).toBeGreaterThanOrEqual(record.trail[index - 1] - 0.5);
        const moved = await bar.evaluate((element) => element.scrollLeft);
        expect(moved).toBeGreaterThan(0);
        await expect.poll(() => frame.evaluate((element) => element.scrollLeft)).toBeCloseTo(moved, 0);

        // A screen where the table fits: no bar.
        await page.setViewportSize({ width: 3000, height: 900 });
        await expect.poll(() => frame.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
        await expect(bar).toBeHidden();
        // Back to the laptop: back again.
        await page.setViewportSize({ width: 1000, height: 800 });
        await expect(bar).toBeVisible();

        // A long list — the one row drawn forty times over, the browser's layout being the subject, not the rows — read
        // halfway down: the bar has stayed at the window's top, right under the site header — no strip, no overlap.
        await frame.evaluate((element) => {
          const body = element.querySelector("tbody") as HTMLTableSectionElement;
          const row = body.querySelector("tr") as HTMLTableRowElement;
          for (let copy = 0; copy < 40; copy++) body.append(row.cloneNode(true));
        });
        // Scrolled 400 px past the bar's own place on the page — wherever the «Sumar», the filters and the notices above
        // the table end — so the bar is past its natural position while the forty rows keep the table on screen.
        await bar.evaluate(() => window.scrollTo({ top: 0 }));
        const target = await bar.evaluate((element) => {
          const top = Math.round(element.getBoundingClientRect().top + window.scrollY + 400);
          window.scrollTo({ top });
          return top;
        });
        const stuck = await bar.evaluate((element) => ({
          top: element.getBoundingClientRect().top,
          sticky: Number.parseFloat(getComputedStyle(element).top),
          frameBottom: (document.getElementById("table-frame-registrations") as HTMLElement).getBoundingClientRect().bottom,
          headerBottom: (document.querySelector("[data-sticky-header]") as HTMLElement).getBoundingClientRect().bottom,
          scrolled: window.scrollY,
        }));
        expect(stuck.scrolled).toBeGreaterThanOrEqual(target - 1);
        expect(stuck.frameBottom).toBeGreaterThan(stuck.top);
        expect(Math.abs(stuck.top - stuck.sticky)).toBeLessThanOrEqual(1);
        expect(Math.abs(stuck.top - stuck.headerBottom)).toBeLessThanOrEqual(1);
        // …and scrolling it there still moves the frame.
        await bar.evaluate((element) => element.scrollTo({ left: 90 }));
        await expect.poll(() => frame.evaluate((element) => Math.round(element.scrollLeft))).toBe(90);
      } finally {
        await cleanup(seeded);
      }
    });
  });

  test("the phone layout has no column edge and no reset", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the 320-px phone");
    test.setTimeout(60_000);
    const seeded = await seed(`${testInfo.project.name}-${Date.now().toString(36)}`);
    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&q=${encodeURIComponent(seeded.tag)}`);
      await hydrated(page);
      const main = page.locator("#main");
      await expect(main.getByRole("link", { name: `Deschide înscrierea lui Coloane ${seeded.tag}`, exact: true })).toBeVisible();
      // «Emailuri» (§960) is a line of the card, as every column is: the three newest and the link to the rest, read at 320 px
      // without the page scrolling sideways.
      const emails = main.getByTestId("email-summary").filter({ visible: true });
      await expect(emails.getByTestId("email-summary-line")).toHaveCount(3);
      await expect(emails.getByTestId("email-summary-more")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(main.locator("[data-column-resize]").filter({ visible: true })).toHaveCount(0);
      await expect(main.getByTestId("admin-table-reset-widths").filter({ visible: true })).toHaveCount(0);
      // Nor a «Coloane» menu (§661): the phone's blocks show every field.
      await expect(main.getByTestId("admin-table-columns").filter({ visible: true })).toHaveCount(0);
      // Nor the scrollbar at the top (§977): a finger swipes the blocks' page, which never scrolls sideways.
      await expect(main.locator("[data-top-scrollbar]").filter({ visible: true })).toHaveCount(0);

      // «și încă 2 emailuri» lands on the registration's own «Emailuri», open: the card is a closed fold on that page (nothing
      // here asks for attention), and the backoffice opens the fold its address names on arrival (`OpenFoldFromHash`, §336) —
      // one tap, not two.
      await emails.getByTestId("email-summary-more").click();
      await expect(page).toHaveURL(new RegExp(`/ro/admin/registrations/${seeded.registrationId}#emailuri$`));
      await hydrated(page);
      await expect(page.locator("details#emailuri")).toHaveAttribute("open", "");
    } finally {
      await cleanup(seeded);
    }
  });
});
