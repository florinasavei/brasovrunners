import { expect, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * §986 — «Cronometrare», the finish line of «Ziua cursei» (BR-REQ-050-02, BR-REQ-060-01, BR-REQ-041-01, BR-REQ-037-08), walked at
 * 320 pixels and on a desk against a production build: an Organizer, whose row holds the five tabs of a race with a raffle — wider
 * than the phone, so the row scrolls inside itself, «Cronometrare» in view and every tab one swipe away —, taps «Start» twice — one
 * «Start» —; the desk Volunteer — the lowest role, four tabs that fit, «Tombolă» among them since §NNN — types a number and presses an elite's button, sees each
 * saved at once with «introdus de» and its own name, types the same number again and reads the duplicate's line — its own line now
 * saying «Clasament» corrects it, no «Anulează» —, undoes the elite's press — the phone's line of it then saying «anulat» —, and is
 * told of a press of theirs waiting under another race on the phone. And an Organizer's page drawn before another organizer's «Start»
 * says that gun at its clock's next answer, and its own «Start» moves nothing. Nothing scrolls sideways.
 *
 * The race, its two runners and its elite line are written straight into the database — the setup, not the subject — one per project
 * and run, so the two projects never meet.
 */
function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

/**
 * A race whose planned gun was a few minutes ago, with runners 101 and 102 and an elite line «Andrei <tag>» wearing 7 — and a raffle
 * («Avem tombolă»), so the organizers' row of «Ziua cursei» holds all five tabs.
 */
async function seedRace(tag: string): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, location_name, has_raffle) VALUES ('RACE', now() - interval '3 minutes', 'INTERNAL', 'Parcul Tractorul', true) RETURNING id`,
    );
    const eventId = rows[0].id;
    await client.query(`INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'O cursă.'), ($1, 'en', $4, $5, 'A race.')`, [
      eventId,
      `cronometrare-${tag}`,
      `Cursa cronometrată ${tag}`,
      `timing-${tag}`,
      `The timed race ${tag}`,
    ]);
    for (const runner of [
      { bib: 101, name: `Ana Popescu ${tag}` },
      { bib: 102, name: `Bia Marin ${tag}` },
    ]) {
      const email = `timing-${runner.bib}-${tag}@test.invalid`;
      const { rows: person } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, runner.name],
      );
      await client.query(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
           email_confirmed_at, confirmed_at, bib_number, sex, birth_date)
         VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now() - interval '5 days', false, 1,
           now() - interval '5 days', now() - interval '5 days', $4, 'FEMALE', '1990-01-01')`,
        [eventId, person[0].id, runner.name, runner.bib],
      );
    }
    await client.query(`INSERT INTO event_elite_entries (event_id, name, bib_number) VALUES ($1, $2, 7)`, [eventId, `Andrei ${tag}`]);
    return eventId;
  } finally {
    await client.end();
  }
}

/** One query on the server's database: the setup and the trail read, not the subject. */
async function query<T extends Record<string, unknown>>(text: string, values: unknown[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Ieși din cont" }).click();
  await expect(page).not.toHaveURL(/\/admin/, { timeout: 30_000 });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/**
 * «Ziua cursei»'s row (§984, §986): the current entry wholly inside the row as the scroller left it, the row scrolling inside itself, and
 * every entry reachable by a sideways swipe — scrolled to, each lies wholly inside the row — while the page never scrolls sideways.
 */
async function everyTabReachable(page: Page) {
  const nav = page.getByTestId("race-day-tabs").locator("nav");
  await expect
    .poll(() =>
      nav.evaluate((row) => {
        const entry = row.querySelector('[aria-current="page"]');
        if (!entry) return "no current entry";
        const bar = row.getBoundingClientRect();
        const box = entry.getBoundingClientRect();
        return box.left >= bar.left - 1 && box.right <= bar.right + 1 ? "in view" : `${Math.round(box.left - bar.left)}–${Math.round(box.right - bar.left)} px of a ${Math.round(bar.width)} px row`;
      }),
    )
    .toBe("in view");
  const reach = await nav.evaluate((row) => {
    const scrolls = ["auto", "scroll"].includes(getComputedStyle(row).overflowX);
    const start = row.scrollLeft;
    const missed: string[] = [];
    for (const link of Array.from(row.querySelectorAll("a"))) {
      link.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
      const bar = row.getBoundingClientRect();
      const box = link.getBoundingClientRect();
      if (box.left < bar.left - 1 || box.right > bar.right + 1) missed.push(link.textContent ?? "");
    }
    row.scrollLeft = start;
    return { scrolls, missed };
  });
  expect(reach).toEqual({ scrolls: true, missed: [] });
  await noHorizontalScroll(page);
}

test.describe("§986 «Cronometrare»", () => {
  test.describe.configure({ timeout: 180_000 });

  test("an Organizer taps «Start» twice and gets one; the desk Volunteer records a number and an elite, sees who entered them, meets a duplicate, undoes a press and is told of one waiting elsewhere", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    const timingUrl = `/ro/admin/checkin/cronometrare?eventId=${eventId}`;

    // The Organizer, at the gun — whose row of «Ziua cursei» holds all six tabs, «Jurnal» last (§996): wider than a phone, so it scrolls inside itself.
    await signIn(page, "Dev Moderator");
    await page.goto(timingUrl);
    await hydrated(page);
    await expect(page.getByTestId("race-day-tabs").getByRole("link")).toHaveText([/Prezența/, /Clasament/, /Cronometrare|Sosiri/, /Tombolă/, /Lucruri/, /Jurnal/], { useInnerText: true });
    await expect(page.getByTestId("race-day-tabs").locator('[aria-current="page"]')).toContainText(/Cronometrare|Sosiri/);
    await everyTabReachable(page);
    await expect(page.getByTestId("race-gun-line")).toContainText("Startul planificat:");
    // Tapped twice, the second tap while the first is on its way: one «Start», and the page says it was given — not that it stayed.
    await page.getByTestId("race-gun-start").dblclick();
    await expect(page.getByTestId("timing-banner")).toContainText("Startul a fost dat", { timeout: 15_000 });
    await expect(page.getByTestId("race-gun-line")).toContainText(/Startul: \d\d:\d\d:\d\d · apăsat de Dev Moderator/);
    const starts = await query<{ count: string }>(`SELECT count(*) FROM audit_logs WHERE entity_id = $1 AND action = 'event.race_gun_set'`, [eventId]);
    expect(Number(starts[0].count)).toBe(1);
    await signOut(page);

    // The desk Volunteer, at the line.
    await signIn(page, "Dev Contributor");
    await page.goto(timingUrl);
    await hydrated(page);
    // «Ziua cursei»'s tabs, «Cronometrare» current; the volunteer has no «Clasament» and no «Start» — and, the race holding a raffle,
    // «Tombolă» since §NNN: four that fit.
    const tabs = page.getByTestId("race-day-tabs").getByRole("link");
    await expect(tabs).toHaveText([/Prezența/, /Cronometrare|Sosiri/, /Tombolă/, /Lucruri/], { useInnerText: true });
    await expect(page.getByTestId("race-day-tabs").locator('[aria-current="page"]')).toContainText(/Cronometrare|Sosiri/);
    await expect(page.getByTestId("race-gun-start")).toHaveCount(0);
    const fits = await page.getByTestId("race-day-tabs").locator("nav").evaluate((nav) => nav.scrollWidth <= nav.clientWidth + 1);
    expect(fits).toBe(true);
    await expect(page.getByTestId("finish-clock")).toContainText(/De la start: 0:0\d:\d\d/);

    // A number, typed: saved at once, the box empty and still the focus.
    const box = page.getByTestId("finish-bib");
    await box.fill("101");
    await box.press("Enter");
    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();
    const entry101 = page.locator('[data-testid="finish-entry"][data-bib="101"]').first();
    await expect(entry101).toHaveAttribute("data-state", "saved", { timeout: 15_000 });
    const recent101 = page.locator('[data-testid="finish-recent-row"][data-bib="101"]');
    await expect(recent101).toContainText(`#101 Ana Popescu ${tag}`);
    await expect(recent101).toContainText("introdus de Dev Contributor");

    // The elite, by the button: the label large, the name under it.
    const elite = page.locator('[data-testid="finish-elite"][data-bib="7"]').getByTestId("finish-elite-button");
    await expect(elite).toContainText(`Andrei ${tag}`);
    const height = await elite.evaluate((button) => button.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(56);
    await elite.click();
    const recent7 = page.locator('[data-testid="finish-recent-row"][data-bib="7"]');
    await expect(recent7).toContainText(`Andrei (#7) Andrei ${tag}`, { timeout: 15_000 });
    await expect(recent7).toContainText("introdus de Dev Contributor");
    await expect(elite).toBeDisabled();
    await expect(elite).toContainText("✓");

    // The same number again, a second later: the first time stays, and the line says who had it and when.
    await page.waitForTimeout(1_500);
    await box.fill("101");
    await page.getByTestId("finish-record").click();
    const duplicate = page.locator('[data-testid="finish-entry"][data-bib="101"][data-state="duplicate"]');
    await expect(duplicate).toContainText(/#101 era deja trecut de Dev Contributor la 0:\d\d:\d\d/, { timeout: 15_000 });
    await expect(page.locator('[data-testid="finish-recent-row"][data-bib="101"]')).toHaveCount(1);
    // Pressed twice, 101 can no longer be undone here: which press was right is «Clasament»'s to say.
    await expect(recent101.getByTestId("finish-undo")).toHaveCount(0);
    await expect(recent101.getByTestId("finish-undo-closed")).toContainText("l-ai mai trecut o dată");

    // Undo the elite's press: the line leaves «Ultimii sosiți», the button is pressable again — and the phone's own line of the press
    // says «anulat», no longer «salvat».
    await recent7.getByTestId("finish-undo").click();
    await expect(page.locator('[data-testid="finish-recent-row"][data-bib="7"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(elite).toBeEnabled();
    const entry7 = page.locator('[data-testid="finish-entry"][data-bib="7"]').first();
    await expect(entry7).toHaveAttribute("data-state", "undone");
    await expect(entry7).toContainText(/Andrei \(#7\) · 0:\d\d:\d\d · anulat/);
    await expect(entry7).not.toContainText("salvat");

    // A press of this account left waiting under another race on this phone: named above the box, with a link to that race's page.
    const [volunteer] = await query<{ id: string }>(`SELECT id FROM staff_users WHERE email = 'dev-contributor@dev.test'`, []);
    const elsewhereId = randomUUID();
    const waiting = { entries: [{ id: randomUUID(), staffId: volunteer.id, bibNumber: 55, label: null, pressedAtMs: Date.now(), outcome: null }], kept: {}, title: `Crosul ${tag}` };
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [`finish-line:${elsewhereId}`, JSON.stringify(waiting)] as const);
    await page.reload();
    await hydrated(page);
    const elsewhere = page.getByTestId("finish-elsewhere");
    await expect(elsewhere).toContainText(`1 apăsare așteaptă la Crosul ${tag}: se trimite doar de pe pagina lui.`);
    await expect(elsewhere.getByRole("link")).toHaveAttribute("href", `?eventId=${elsewhereId}`);

    await noHorizontalScroll(page);
  });

  /**
   * §990 — the owner, 2026-11-19, of «Ingrid» drawn grey with «Fără număr: …»: «vreau să apară la fel! și să o pot cronometra». An
   * elite line written before every line drew its own number: an Administrator presses «Dă-i un număr» in the grey button's place,
   * the page comes back saying the number, the line's button is the same blue button as every other elite's, and a press records
   * its «Sosit» under the line's name.
   */
  test("an Administrator gives a numberless elite line its number in one press: its button turns blue like the others and a press records its «Sosit»", async ({ page }) => {
    const tag = `${test.info().project.name}-number-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    await query(`INSERT INTO event_elite_entries (event_id, name, bib_number) VALUES ($1, $2, NULL)`, [eventId, `Ingrid ${tag}`]);
    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/checkin/cronometrare?eventId=${eventId}`);
    await hydrated(page);

    // In the grey button's place: «Dă-i un număr», naming the line, as tall as every elite's button.
    const give = page.getByTestId("finish-elite-give-number");
    await expect(give).toHaveCount(1);
    await expect(give).toContainText("Ingrid");
    await expect(give).toContainText(`Dă-i un număr · Ingrid ${tag}`);
    expect(await give.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56);
    await expect(page.getByTestId("finish-elite-no-number")).toHaveCount(0);
    await give.click();

    // Back on the page: the number said, and the line's button the same blue button as Andrei's — pressable.
    await expect(page.getByTestId("timing-banner")).toContainText(/Ingrid \(#\d+\) are acum număr: se cronometrează ca celelalte elite\./, { timeout: 15_000 });
    await expect(page.getByTestId("finish-elite-give-number")).toHaveCount(0);
    const [{ number }] = await query<{ number: number }>(`SELECT bib_number AS number FROM event_elite_entries WHERE event_id = $1 AND name = $2`, [eventId, `Ingrid ${tag}`]);
    expect(number).toBeGreaterThan(0);
    const ingrid = page.locator(`[data-testid="finish-elite"][data-bib="${number}"]`).getByTestId("finish-elite-button");
    const andrei = page.locator('[data-testid="finish-elite"][data-bib="7"]').getByTestId("finish-elite-button");
    await expect(ingrid).toBeEnabled();
    await expect(ingrid).toContainText(`Ingrid ${tag}`);
    const look = (button: typeof ingrid) =>
      button.evaluate((element) => ({ colour: getComputedStyle(element).backgroundColor, blue: element.classList.contains("MuiButton-contained") && element.classList.contains("MuiButton-colorPrimary") }));
    // The pointer off the buttons — it was over «Dă-i un număr», now her button — and the colour's transition let finish.
    await page.mouse.move(0, 0);
    const andreiLook = await look(andrei);
    expect(andreiLook.blue).toBe(true);
    await expect.poll(() => look(ingrid)).toEqual(andreiLook);
    expect(await ingrid.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56);

    // Pressed as she crosses the line: «Sosit», under her name, entered by the Administrator — the button then says ✓.
    await ingrid.click();
    const recent = page.locator(`[data-testid="finish-recent-row"][data-bib="${number}"]`);
    await expect(recent).toContainText(`Ingrid (#${number}) Ingrid ${tag}`, { timeout: 15_000 });
    await expect(recent).toContainText("introdus de Dev Administrator");
    await expect(ingrid).toBeDisabled();
    await expect(ingrid).toContainText("✓");
    const rows = await query<{ name: string; status: string }>(`SELECT display_name AS name, status FROM event_results WHERE event_id = $1 AND bib_number = $2`, [eventId, number]);
    expect(rows).toEqual([{ name: `Ingrid ${tag}`, status: "FINISHED" }]);
    await noHorizontalScroll(page);
  });

  test("a page drawn before another organizer's «Start» says that gun at the clock's next answer, and its own «Start» moves nothing", async ({ page }) => {
    const tag = `${test.info().project.name}-gun-${Date.now().toString(36)}`;
    const eventId = await seedRace(tag);
    await signIn(page, "Dev Moderator");
    await page.goto(`/ro/admin/checkin/cronometrare?eventId=${eventId}`);
    await hydrated(page);
    const line = page.getByTestId("race-gun-line");
    await expect(line).toContainText("Până la «Start», sosirile se numără de la el.");
    // Another organizer gives the start on their own phone — written here as their press writes it: the setup, not the subject.
    const [other] = await query<{ id: string }>(`INSERT INTO staff_users (email, display_name, role) VALUES ($1, $2, 'MODERATOR') RETURNING id`, [`timing-other-${tag}@test.invalid`, `Alt Organizator ${tag}`]);
    await query(`UPDATE events SET race_gun_at = now() - interval '2 seconds', race_gun_by_staff_user_id = $2 WHERE id = $1`, [eventId, other.id]);
    // The clock's next answer — asked when the phone finds its signal again — brings it: the sentence is that gun's, with who gave it.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(line).toContainText(new RegExp(`Startul: \\d\\d:\\d\\d:\\d\\d · apăsat de Alt Organizator ${tag}`), { timeout: 15_000 });
    await expect(line).not.toContainText("Până la «Start»");
    // This page's button still says «Start»: pressed, it moves nothing, and the page, drawn again, says who gave the start and when.
    await page.getByTestId("race-gun-start").click();
    await expect(page.getByTestId("timing-banner")).toContainText(new RegExp(`Startul a fost dat deja de Alt Organizator ${tag} la \\d\\d:\\d\\d:\\d\\d: apăsarea ta nu l-a mutat\\.`), { timeout: 15_000 });
    const [gun] = await query<{ by: string }>(`SELECT race_gun_by_staff_user_id AS by FROM events WHERE id = $1`, [eventId]);
    expect(gun.by).toBe(other.id);
    const starts = await query<{ count: string }>(`SELECT count(*) FROM audit_logs WHERE entity_id = $1 AND action = 'event.race_gun_set'`, [eventId]);
    expect(Number(starts[0].count)).toBe(0);
    // Drawn again under the gun as it stands, the button is «Mută startul acum».
    await expect(page.getByTestId("race-gun-start")).toContainText("Mută startul acum");
    await noHorizontalScroll(page);
  });
});
