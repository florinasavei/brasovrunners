import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-050-03 — an organizer writes "About Brașov Runners" and a visitor can read it.
 *
 * Walked through the rendered editor, so a field added to the schema without being added to the
 * form fails here. Creates its own page rather than borrowing a seeded one — there are none, and
 * a page created by an earlier run is left published on purpose: the nav assertion below is
 * stronger for having more than one.
 */

let slug = "";
let englishSlug = "";
let editorUrl = "";
let title = "";

/**
 * Write a body the way an organizer does: click into the editor, optionally turn the first line
 * into a heading with the toolbar, then type. Scoped by `data-rich-text` because the form holds
 * one editor per language and their controls are otherwise identical.
 */
async function writeBody(
  page: import("@playwright/test").Page,
  locale: "ro" | "en",
  heading: string | null,
  paragraph: string,
) {
  const editor = page.locator(`[data-rich-text="translations.${locale}.body"]`);
  await editor.locator("[data-field]").click();

  if (heading !== null) {
    // `## ` at the start of a line becomes a heading as it is typed — the editor's own input
    // rule, and the shortcut a writer reaches for. Typing it also proves the toolbar reads the
    // document correctly, which is asserted below.
    await page.keyboard.type(`## ${heading}`);
    await expect(editor.getByRole("button", { name: /^(Titlu|Heading)$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Enter leaves a heading for a paragraph, which is what a writer expects.
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type(paragraph);
}

/**
 * A stand-in for YouTube's embedded player, served at the embed's own address by `page.route` —
 * this suite never reaches YouTube — and faithful to the one rule of the IFrame API's
 * `postMessage` protocol the volume bar depends on (`DECISIONS.md` §403): the player posts
 * nothing to its parent, not `onReady`, not `infoDelivery`, until the parent has sent it
 * `listening`. It then answers every command with its state, as the real player does.
 */
const STUB_PLAYER = `<!doctype html><html><body style="margin:0;background:#000"><script>
let heard = false, muted = false, volume = 100, id = null;
const send = (message) => parent.postMessage(JSON.stringify({ ...message, id, channel: "widget" }), "*");
addEventListener("message", (event) => {
  let data;
  try { data = JSON.parse(event.data); } catch { return; }
  if (data.event === "listening") {
    if (heard) return;
    heard = true;
    id = data.id ?? null;
    send({ event: "onReady", info: null });
    send({ event: "infoDelivery", info: { muted, volume } });
    return;
  }
  if (!heard || data.event !== "command") return;
  if (data.func === "mute") muted = true;
  if (data.func === "unMute") muted = false;
  if (data.func === "setVolume") volume = data.args[0];
  send({ event: "infoDelivery", info: { muted, volume } });
});
</script></body></html>`;

type PlayerWindow = { playerMessages?: string[] };

/* Serial: every test acts on the one page the first creates. */
test.describe.serial("BR-REQ-050-03 standing pages", () => {
  test("is created, published, and reachable in both languages", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    slug = `despre-${suffix}`;
    englishSlug = `about-${suffix}`;
    title = `Despre clubul ${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/pages/new");

    const field = (name: string) => page.locator(`[name="${name}"]`);
    /* The two languages are tabs since §259: the English panel is `hidden` until its tab is
       pressed, which is also how an organizer reaches it. */
    const language = (name: RegExp) => page.getByRole("tab", { name });
    await field("translations.ro.title").fill(title);
    await field("translations.ro.slug").fill(slug);

    // The body is written in the editor, so the test writes it the way an organizer does:
    // press the heading control, type, press Enter, type the paragraph (BR-REQ-050-03, §11.3).
    await writeBody(page, "ro", "Cine suntem", "Un club de alergare din Brașov.");

    await language(/English/).click();
    await field("translations.en.title").fill(`About the club ${suffix}`);
    await field("translations.en.slug").fill(englishSlug);
    await writeBody(page, "en", "Who we are", "A running club in Brașov.");
    await language(/Română/).click();

    // A YouTube film in the Romanian body (§110): an address that is not YouTube's is refused
    // under the field; a real one becomes a block, and the page shows it behind one press.
    const roEditor = page.locator('[data-rich-text="translations.ro.body"]');
    await roEditor.getByRole("button", { name: "Adaugă un film de pe YouTube" }).click();
    const address = roEditor.getByLabel("Adresa filmului (YouTube)");
    await address.fill("https://example.com/watch?v=dQw4w9WgXcQ");
    await roEditor.getByRole("button", { name: "Adaugă filmul" }).click();
    await expect(roEditor.getByText(/Nu e o adresă de YouTube/)).toBeVisible();
    await address.fill("https://youtu.be/dQw4w9WgXcQ");
    await roEditor.getByRole("button", { name: "Adaugă filmul" }).click();
    await expect(roEditor.locator('[data-youtube="dQw4w9WgXcQ"]')).toBeVisible();

    await page.getByRole("button", { name: "Pagină nouă" }).click();
    await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}/);
    editorUrl = page.url();

    // A draft is not on the public site, whatever its address.
    expect((await page.goto(`/ro/pagini/${slug}`))?.status()).toBe(404);

    await page.goto(editorUrl);
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);

    // The player is the stand-in above, and every message it posts to this page is kept, so the
    // bar's effect is read from the player's own answer, not from the bar's own button.
    let playerRequests = 0;
    await page.route(/^https:\/\/www\.youtube-nocookie\.com\/embed\//, (route) => {
      playerRequests += 1;
      return route.fulfill({ status: 200, contentType: "text/html", body: STUB_PLAYER });
    });
    await page.addInitScript(() => {
      const target = window as unknown as PlayerWindow;
      target.playerMessages = [];
      window.addEventListener("message", (event) => {
        if (event.origin === "https://www.youtube-nocookie.com") target.playerMessages?.push(String(event.data));
      });
    });

    // Both languages go live together (`AGENTS.md` §11.2), each at its own address.
    await page.goto(`/ro/pagini/${slug}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    // What the organizer marked as a heading is a heading on the page, and the paragraph
    // beneath it is text — the editor's output rendered through the §11.3 allowlist.
    await expect(page.getByRole("heading", { name: "Cine suntem" })).toBeVisible();
    await expect(page.getByText("Un club de alergare din Brașov.")).toBeVisible();
    // The film: a poster facade, nothing fetched from YouTube on load (§69, §110, §403) — a
    // native `<details>`/`<summary>` disclosure (found by re-review): the iframe is already in
    // the page's HTML, but a closed `<details>` hides its contents exactly like `display: none`,
    // so it is not visible and — in every evergreen browser — nothing inside it is fetched
    // until the summary is opened, with no script required. The poster itself is the club's own
    // stored copy: fetched once, at the save above (stubbed for this suite,
    // `E2E_STUB_YOUTUBE_POSTER`), served from this site as a real `<img>`, never a request to
    // YouTube's image host.
    const iframe = page.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]');
    await expect(iframe).not.toBeVisible();
    const playButton = page.getByRole("button", { name: "Redă filmul" });
    await expect(playButton).toBeVisible();
    const posterSrc = await playButton.locator("img").getAttribute("src");
    expect(posterSrc).not.toBeNull();
    expect(posterSrc).not.toContain("i.ytimg.com");
    expect(playerRequests).toBe(0);
    await playButton.click();
    await expect(iframe).toBeVisible();
    // Open, the film takes the poster's place: the summary is gone, not stacked above the player.
    await expect(playButton).toBeHidden();

    // The bar: mute toggles `aria-pressed` (`DECISIONS.md` §403), and — found by re-review — it
    // never overlaps the player's own controls, which is exactly where an earlier version laid
    // it: a normal-flow row under the 16∶9 box, not a strip absolutely positioned over its bottom.
    const muteButton = page.getByRole("button", { name: "Fără sunet" });
    const [iframeBox, barBox] = await Promise.all([iframe.boundingBox(), muteButton.boundingBox()]);
    expect(iframeBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    if (iframeBox && barBox) {
      expect(barBox.y).toBeGreaterThanOrEqual(iframeBox.y + iframeBox.height - 1);
    }
    await expect(muteButton).toHaveAttribute("aria-pressed", "false");
    await muteButton.click();
    await expect(page.getByRole("button", { name: "Cu sunet" })).toHaveAttribute("aria-pressed", "true");
    // And the player heard it: the bar's handshake got an answer, its queued `mute` was sent, and
    // the player's own `infoDelivery` says muted — which no press reaches without `listening`.
    await expect
      .poll(() =>
        page.evaluate(() =>
          ((window as unknown as PlayerWindow).playerMessages ?? []).some((raw) => {
            const message = JSON.parse(raw) as { event?: string; info?: { muted?: boolean } | null };
            return message.event === "infoDelivery" && message.info?.muted === true;
          }),
        ),
      )
      .toBe(true);
    await page.unroute(/^https:\/\/www\.youtube-nocookie\.com\/embed\//);

    expect((await page.goto(`/en/pages/${englishSlug}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Who we are" })).toBeVisible();

    // BR-REQ-040-02: the other locale's address is a 404, never a fallback to this text.
    expect((await page.goto(`/en/pages/${slug}`))?.status()).toBe(404);
  });

  test("appears in the site menu, and the language switcher follows it", async ({ page }) => {
    // Network idle, so the navigation has hydrated and measured: the server render shows every
    // entry on the row, and the fold happens in the first layout effect after it.
    await page.goto(`/ro/pagini/${slug}`, { waitUntil: "networkidle" });

    // The row shows what fits and folds the rest into "Meniu" — on a phone, or once the
    // club has a few pages, this one is in the menu. Either way it is reachable, and that is
    // the assertion.
    const nav = page.getByRole("navigation", { name: "Navigare principală" });
    const more = nav.getByRole("button", { name: "Meniu" });
    // `.first()`: on a wide screen with a few standing pages both can be visible at once —
    // this page on the row and a later one behind the button — so the row is checked first.
    const link = nav.getByRole("link", { name: title });
    await expect(link.or(more).first()).toBeVisible();
    if (await link.isVisible()) {
      await expect(link).toBeVisible();
    } else {
      await more.click();
      await expect(page.getByRole("menuitem", { name: title })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    }

    // Criterion 4: the switcher lands on the same page's English address, not on a 404 and not
    // on the listing.
    await page.getByRole("link", { name: /English/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/en/pages/${englishSlug}$`));
  });

  test("takes its place in «Ordinea meniului», first in the menu when moved there, and back to the end", async ({ page }) => {
    // §571: one order for every entry of the menu, the Administrator's, on «Pagini» → «Paginile clubului».
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/pages");
    const card = page.getByTestId("menu-order");
    await card.locator("summary").first().click();
    const entry = card.getByTestId("menu-order-list").locator("li").filter({ hasText: title });
    await expect(entry).toBeVisible();

    // «Sus» until it is first: the button goes disabled at the top.
    const up = entry.getByRole("button", { name: `Mută „${title}” mai sus` });
    for (let presses = 0; presses < 60 && (await up.isEnabled()); presses += 1) await up.click();
    await expect(up).toBeDisabled();
    await expect(card.getByTestId("menu-order-unsaved")).toBeVisible();
    await card.getByRole("button", { name: "Salvează ordinea" }).click();
    await confirmDialog(page, "Schimbi ordinea meniului?");
    await expect(page).toHaveURL(/saved=menuOrder/);

    // The public menu's first entry is the page now, before «Evenimente»; no rule between the groups.
    await page.goto(`/ro/pagini/${slug}`, { waitUntil: "networkidle" });
    const nav = page.getByRole("navigation", { name: "Navigare principală" });
    // On a phone the row may fold every entry into «Meniu» (a long title first does not fit at 320 px),
    // so the first entry is read from the row when it has one, otherwise from the menu.
    const firstOnRow = nav.getByRole("link").first();
    if ((await firstOnRow.count()) > 0 && (await firstOnRow.isVisible())) {
      await expect(firstOnRow).toHaveText(title);
    } else {
      await nav.getByRole("button", { name: "Meniu" }).click();
      await expect(page.getByRole("menuitem").first()).toHaveText(title);
      await page.keyboard.press("Escape");
    }

    // Back to the end, so the other specs meet the menu they expect.
    await page.goto("/ro/admin/pages");
    await card.locator("summary").first().click();
    const down = entry.getByRole("button", { name: `Mută „${title}” mai jos` });
    for (let presses = 0; presses < 60 && (await down.isEnabled()); presses += 1) await down.click();
    await expect(down).toBeDisabled();
    await card.getByRole("button", { name: "Salvează ordinea" }).click();
    await confirmDialog(page, "Schimbi ordinea meniului?");
    await expect(page).toHaveURL(/saved=menuOrder/);
  });

  test("refuses to publish a page whose other language is empty", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/pages/new");

    const field = (name: string) => page.locator(`[name="${name}"]`);
    await field("translations.ro.title").fill(`Pe jumătate ${suffix}`);
    await field("translations.ro.slug").fill(`pe-jumatate-${suffix}`);
    await writeBody(page, "ro", null, "Un paragraf.");
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`Half done ${suffix}`);
    await field("translations.en.slug").fill(`half-done-${suffix}`);
    // The English body is left empty on purpose.

    await page.getByRole("button", { name: "Pagină nouă" }).click();
    await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}/);

    // Said before the button is pressed, naming the language and the field.
    await expect(page.getByText(/EN: body/)).toBeVisible();

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/error=VALIDATION_ERROR/);
  });

  test("fits a 320px screen with no sideways scroll", async ({ page }) => {
    await page.goto(`/ro/pagini/${slug}`);

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });

  /**
   * §565 — a standing page is the club talking about itself, so it ends with the club's legal name
   * and CIF: «<legal name> (<site name>) · CIF <CIF>», composed from the environment. The suite's
   * server sets no legal fact (CI) — a developer's `.env.local` may — so the line is checked when it
   * is drawn and its absence when it is not; its words are never compared with a value.
   */
  test("ends with the club's legal identity line when the facts are set, and with nothing otherwise", async ({ page }) => {
    await page.goto(`/ro/pagini/${slug}`);
    const main = page.locator("main");
    const line = main.getByTestId("club-identity-line");
    const lines = await line.count();
    expect(lines).toBeLessThanOrEqual(1);
    if (lines === 0) {
      await expect(main).not.toContainText("· CIF");
      return;
    }
    await expect(line).toContainText("(");
    // Under the page's own words, and never wider than the screen.
    const heading = await main.getByRole("heading", { level: 1 }).boundingBox();
    const box = await line.boundingBox();
    expect(box!.y).toBeGreaterThan(heading!.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
});
