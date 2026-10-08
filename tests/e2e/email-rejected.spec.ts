import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * §671 (amending §663, §650; the data decision „The runners' own emails tell the truth”) — «Email respins» drawn where the club looks, phone
 * first. The owner, 2026-10-07, on two «Confirmată» cards each with «Email respins»: «Cum e posibil să fie
 * email respins dar și confirmat? Am nevoie de mai multe info in app». A confirmed registration whose
 * race-number email the address refused: the filter «Doar cu un email respins (n)» keeps it, the card says
 * in one line under the name which email, why and when — a plain 44-pixel link, no tooltip island — and the
 * link opens the registration's «Emailuri», open by itself, with the whole story and the provider's small
 * print; under the address the place is said to stay. The line wraps only at « · »: the common line takes
 * one line at 400 pixels, the longest realistic ones («Adresa nu mai există», «Mailgun nu mai trimite» with
 * «Numărul de concurs» and a two-digit day) two at most at 400 and at 360. The rows are written straight
 * into the database and removed after.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

type Seeded = { eventId: string; registrationId: string; participantId: string; name: string };

/**
 * The refused email: its type, its instant (yesterday unless named), its cause (the address does not exist
 * unless named), and whether the address answered the person's own click before it (`verifiedAt`) — on a
 * public registration that is confirmed, the click came first, so a refusal of the address then reads
 * «Adresa nu mai există».
 */
type Refusal = {
  messageType: "BIB_ASSIGNED" | "REGISTRATION_CONFIRMED";
  at?: string;
  cause?: "no-such-address" | "suppressed";
  verifiedAt?: string;
};

const PROVIDER_WORDS = { "no-such-address": "550 5.1.1 mailbox unavailable", suppressed: "Not delivering to previously bounced address" } as const;

async function seed(tag: string, refusal: Refusal = { messageType: "BIB_ASSIGNED" }): Promise<Seeded> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows: eventRows } = await client.query<{ id: string }>("SELECT event_id AS id FROM event_translations WHERE slug = $1 LIMIT 1", [FEATURED.slug]);
    const eventId = eventRows[0].id;
    const email = `respins-${tag}@test.invalid`;
    const name = `Respins ${tag}`;
    const at = refusal.at ?? new Date(Date.now() - 86_400_000).toISOString();
    const cause = refusal.cause ?? "no-such-address";
    const { rows: participantRows } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name, email_verified_at)
       VALUES ($1, $1, $1, 1, $2, $3::timestamptz) RETURNING id`,
      [email, name, refusal.verifiedAt ?? null],
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name, source,
         privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version,
         email_confirmed_at, confirmed_at)
       VALUES ($1, $2, 'CONFIRMED', 'ro', $3, $3, 'PUBLIC', 1, now() - interval '3 days', false, 1,
         now() - interval '3 days', now() - interval '3 days')
       RETURNING id`,
      [eventId, participantRows[0].id, name],
    );
    await client.query(
      `INSERT INTO email_outbox (registration_id, participant_id, message_type, locale, recipient_email, payload_json,
         idempotency_key, status, last_error, provider_detail, rejection_cause, rejected_at, created_at, sent_at)
       VALUES ($1, $2, $5, 'ro', $3, '{}'::jsonb, $4, 'BOUNCED', $7, $7, $8, $6::timestamptz, $6::timestamptz, $6::timestamptz)`,
      [rows[0].id, participantRows[0].id, email, `e2e-respins-${tag}`, refusal.messageType, at, PROVIDER_WORDS[cause], cause],
    );
    return { eventId, registrationId: rows[0].id, participantId: participantRows[0].id, name };
  } finally {
    await client.end();
  }
}

/**
 * How many lines the line's words take: the words are a flex item (blockified), so their box is a whole
 * number of line boxes tall — its height over its computed line height.
 */
async function linesOf(line: Locator): Promise<number> {
  const { height, lineHeight } = await line.locator("span").first().evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
  }));
  const lines = height / lineHeight;
  // A whole number of lines, or the measure means nothing.
  expect(Math.abs(lines - Math.round(lines)), `${height}px over ${lineHeight}px`).toBeLessThan(0.1);
  return Math.round(lines);
}

/** The flagged row's line on the list, filtered to it, at `width` pixels. */
async function lineAt(page: Page, seeded: Seeded, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&bounced=1&q=${encodeURIComponent(seeded.name)}`);
  await hydrated(page);
  const line = page.locator('#main [data-testid="email-state-line"]:visible');
  await expect(line).toHaveCount(1);
  return line;
}

/** The link stays a 44-pixel target and never wider than the screen. */
async function fitsTheScreen(line: Locator, width: number): Promise<void> {
  const link = await line.boundingBox();
  expect(link?.height ?? 0, `${width}px link`).toBeGreaterThanOrEqual(44);
  expect((link?.x ?? 0) + (link?.width ?? 0), `${width}px right edge`).toBeLessThanOrEqual(width);
}

async function cleanup(seeded: Seeded): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    // The outbox row goes with the registration (ON DELETE CASCADE).
    await client.query("DELETE FROM registrations WHERE id = $1", [seeded.registrationId]);
    await client.query("DELETE FROM participants WHERE id = $1", [seeded.participantId]);
  } finally {
    await client.end();
  }
}

test.describe("§671 «Email respins» says which email, why and what to do, where the club looks", () => {
  test("a confirmed row whose race-number email was refused: one line under the name, a link to «Emailuri»", async ({ page }) => {
    test.setTimeout(90_000);
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) hydrationWarnings.push(message.text());
    });
    // A public registration confirmed: the person clicked the link three days ago, the race number was refused yesterday.
    const seeded = await seed(`${test.info().project.name}-${Date.now().toString(36)}`, {
      messageType: "BIB_ASSIGNED",
      verifiedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/admin/registrations?eventId=${seeded.eventId}&bounced=1&q=${encodeURIComponent(seeded.name)}`);
      await hydrated(page);
      const main = page.locator("#main");
      // The tick says how many it keeps.
      await expect(main.getByTestId("registrations-filter-bounced").getByRole("checkbox", { name: /^Doar cu un email respins \(\d+\)$/ })).toBeChecked();
      await expect(main.getByRole("link", { name: `Deschide înscrierea lui ${seeded.name}`, exact: true })).toBeVisible();

      // One line under the name: the cause, the email's short name, the day — a link, never a chip with a tooltip.
      const line = main.locator('[data-testid="email-state-line"]:visible');
      await expect(line).toHaveCount(1);
      // Each part unbreakable (non-breaking spaces inside it): `\s` reads both.
      await expect(line).toHaveText(/^Adresa\snu\smai\sexistă\s·\sNumărul\sde\sconcurs\s·\s/);
      await expect(line).toHaveAttribute("href", /#emailuri$/);
      await expect(main.locator('[data-testid="email-rejected"]')).toHaveCount(0);
      // No list carries the provider's words.
      await expect(line).not.toContainText("550");
      const box = await line.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await line.focus();
      await expect(page.getByRole("tooltip")).toHaveCount(0);

      // The link opens the registration's «Emailuri», open by itself while somebody must act.
      await line.click();
      await expect(page).toHaveURL(new RegExp(`/ro/admin/registrations/${seeded.registrationId}#emailuri$`));
      await hydrated(page);
      const section = page.locator("details#emailuri");
      await expect(section).toHaveAttribute("open", "");
      await expect(section).toContainText("Respins: „Numărul de concurs dat de mână”");
      // It answered the person's click before: the mailbox may have been closed since.
      await expect(section).toContainText("acum serverul spune că nu există — poate și-a închis căsuța.");
      await expect(section).toContainText("Motivul dat de furnizor: 550 5.1.1 mailbox unavailable");
      await expect(section).toContainText("Numărul de concurs · către participant");
      await expect(section).toContainText("Trimis = predat furnizorului de email.");
      // Under the address: the same line, and the place stays — never «a new registration» on a confirmed one.
      const todo = page.getByTestId("email-state-todo");
      await expect(todo).toContainText("Locul rămâne confirmat; la masă îl găsiți după nume.");
      await expect(todo).not.toContainText("înscriere nouă");
      expect(hydrationWarnings).toEqual([]);
    } finally {
      await cleanup(seeded);
    }
  });

  test("the common line: one line at 400 pixels, two at most at 360, wrapping between parts", async ({ page }) => {
    test.setTimeout(90_000);
    // «Confirmarea cu QR» refused on the 3rd of October, an address never clicked: the line the club meets most.
    const seeded = await seed(`${test.info().project.name}-common-${Date.now().toString(36)}`, { messageType: "REGISTRATION_CONFIRMED", at: "2026-10-03T09:00:00.000Z" });
    try {
      await signIn(page, "Dev Administrator");
      for (const [width, most] of [
        [400, 1],
        [360, 2],
      ] as const) {
        const line = await lineAt(page, seeded, width);
        await expect(line).toHaveText(/^Adresa\snu\sexistă\s·\sConfirmarea\scu\sQR\s·\s3\soct\.$/);
        const lines = await linesOf(line);
        if (width === 400) expect(lines, `${width}px`).toBe(1);
        else expect(lines, `${width}px`).toBeLessThanOrEqual(most);
        await fitsTheScreen(line, width);
      }
    } finally {
      await cleanup(seeded);
    }
  });

  test("the longest lines: two at most at 400 and at 360 pixels, never breaking inside a part", async ({ page }) => {
    test.setTimeout(120_000);
    const run = `${test.info().project.name}-${Date.now().toString(36)}`;
    // The longest label of a confirmed public registration (its address clicked, then refused), and Mailgun's
    // suppression after a «Retrimite QR» to a hard-bounced address — each with the longest short name and a
    // two-digit October day.
    const cases = [
      {
        seeded: await seed(`${run}-nolonger`, { messageType: "BIB_ASSIGNED", at: "2025-10-26T09:00:00.000Z", verifiedAt: "2025-10-20T09:00:00.000Z" }),
        text: /^Adresa\snu\smai\sexistă\s·\sNumărul\sde\sconcurs\s·\s26\soct\.$/,
        parts: ["Adresa nu mai există", "Numărul de concurs", "26 oct."],
      },
      {
        seeded: await seed(`${run}-suppressed`, { messageType: "BIB_ASSIGNED", at: "2025-10-28T09:00:00.000Z", cause: "suppressed" }),
        text: /^Mailgun\snu\smai\strimite\s·\sNumărul\sde\sconcurs\s·\s28\soct\.$/,
        parts: ["Mailgun nu mai trimite", "Numărul de concurs", "28 oct."],
      },
    ];
    try {
      await signIn(page, "Dev Administrator");
      for (const { seeded, text, parts } of cases) {
        for (const width of [400, 360]) {
          const line = await lineAt(page, seeded, width);
          await expect(line).toHaveText(text);
          // Each part is unbreakable: non-breaking spaces inside it, ordinary ones only around « · ».
          const words = (await line.textContent()) ?? "";
          expect(words.split(" · ").map((part) => part.replace(/\u00a0/g, " ")), `${width}px`).toEqual(parts);
          expect(await linesOf(line), `${width}px ${parts[0]}`).toBeLessThanOrEqual(2);
          await fitsTheScreen(line, width);
        }
      }
    } finally {
      for (const { seeded } of cases) await cleanup(seeded);
    }
  });
});
