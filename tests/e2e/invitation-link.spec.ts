import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { cancelRegistrationsByEmailPrefix, registrationByEmail } from "./support/action-link";
import { ensureRegistrationIsOpen, FEATURED, HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";
import { chooseSex } from "./support/sex-choice";

/**
 * §NNN — an invitation's link, in the browser: the page a person opens from `EVENT_INVITATION`, at
 * 320px as at the desktop width — the banner, the form with the invited name and the address said
 * back, the press, the done view — and the same link afterwards, which says it was used. What the
 * integration suite (`tests/integration/registrations/invitations.test.ts`) cannot stand in for: what
 * the page draws, and that nothing on it scrolls sideways on a phone.
 *
 * The invitation is seeded as the send writes it — the address's participant row, the invitation, and
 * the SHA-256 of a fresh secret as its one live `ACCEPT_INVITATION` token — because the captured
 * email's real link lives in the server's memory only (`support/action-link.ts`). The setup, not the
 * subject: the page reads it, the press spends it and seats the registration through the one allocator.
 */
const PREFIX = "e2e-invitation-";

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: the invitation spec needs the database the server uses");
  return url;
}

/** One invitation to the featured race for `email`, open for a week (never past its start), and the secret of its link. */
async function seedInvitation(email: string, name: string): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    const { rows: events } = await client.query<{ id: string; startsAt: Date }>(
      `SELECT e.id, e.starts_at AS "startsAt" FROM event_translations t JOIN events e ON e.id = t.event_id WHERE t.locale = 'ro' AND t.slug = $1 LIMIT 1`,
      [FEATURED.slug],
    );
    if (!events[0]) throw new Error("the featured event is missing: run yarn db:seed");
    const { rows: people } = await client.query<{ id: string }>(
      `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name, preferred_locale)
       VALUES ($1, $1, $1, 2, $2, 'ro') RETURNING id`,
      [email, name],
    );
    const { rows: invitations } = await client.query<{ id: string }>(
      `INSERT INTO event_invitations (event_id, participant_id, name, email, canonical_email, locale, sent_at, expires_at, last_sent_at)
       VALUES ($1, $2, $3, $4, $4, 'ro', now(), least(now() + interval '7 days', $5::timestamptz), now()) RETURNING id`,
      [events[0].id, people[0].id, name, email, events[0].startsAt],
    );
    const secret = randomBytes(32).toString("base64url");
    await client.query(
      `INSERT INTO email_action_tokens (participant_id, registration_id, invitation_id, purpose, token_hash, expires_at)
       VALUES ($1, NULL, $2, 'ACCEPT_INVITATION', $3, now() + interval '7 days')`,
      [people[0].id, invitations[0].id, createHash("sha256").update(secret, "utf8").digest("hex")],
    );
    await client.query("COMMIT");
    return secret;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

const fitsTheWidth = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth;

test.describe("§NNN an invitation's link: the form prefilled, the press, the done view", () => {
  test.describe.configure({ timeout: 120_000 });

  /*
    The places this spec's registrations hold go back, so the featured race is not filled for the specs
    after it — this project's alone: the two projects run at once, and a prefix both share would cancel
    the other's registration between its press and its check.
  */
  test.afterAll(async ({}, testInfo) => cancelRegistrationsByEmailPrefix(`${PREFIX}${testInfo.project.name}-`));

  test("opens prefilled, registers on the press with no address confirmation, and says used afterwards", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);

    const email = `${PREFIX}${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;
    const secret = await seedInvitation(email, "Ana Invitata");
    const path = `/ro/inregistrari/invitatie/${secret}`;

    await page.goto(path);
    await hydrated(page);
    await expect(page.getByTestId("invitation-banner")).toContainText("Ana Invitata");
    // The address is the invitation's, said back; never a box to type another one in.
    await expect(page.getByTestId("invitation-address")).toContainText(email);
    await expect(page.locator('[name="email"]:not([type="hidden"])')).toHaveCount(0);
    await expect(page.locator('[name="firstName"]')).toHaveValue("Ana");
    await expect(page.locator('[name="lastName"]')).toHaveValue("Invitata");
    // Nothing on the page scrolls sideways, at 320px as at the desktop width (BR-REQ-041-01).
    expect(await page.evaluate(fitsTheWidth)).toBe(true);

    const values: Record<string, string> = {
      // Day first, as the box reads it (§561).
      birthDate: "17.05.1990",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Ion Popescu",
      emergencyContactPhone: "+40722222222",
    };
    for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
    await chooseSex(page);
    await page.locator('[name="privacyAcknowledged"]').check();
    await page.locator('[name="rulesAcknowledged"]').check();
    await page.locator('[name="termsAccepted"]').check();
    await page.locator('[name="fitnessDeclared"]').check();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    await expect(page).toHaveURL(/done=1/, { timeout: 30_000 });
    await expect(page.getByTestId("invitation-accepted")).toBeVisible();
    expect(await page.evaluate(fitsTheWidth)).toBe(true);
    // The link proved the inbox: the registration waits for its declaration, never for its address.
    expect((await registrationByEmail(email)).status).toBe("PENDING_DECLARATION");

    // The same link again: spent, and the page says so, with no form.
    await page.goto(path);
    await expect(page.getByTestId("invitation-used")).toBeVisible();
    await expect(page.locator('[name="firstName"]')).toHaveCount(0);
  });

  test("a press refused because the event was called off draws the cancelled sentence, with no form", async ({ page }) => {
    /*
      The page's «cancelled» branch as the press's redirect reaches it (`refused=cancelled`): the same
      branch a read of a called-off event's link takes, which the integration suite asserts by kind. The
      featured race is shared by every spec, so it is never cancelled here; the marker draws the branch.
    */
    await page.goto(`/ro/inregistrari/invitatie/${randomBytes(32).toString("base64url")}?refused=cancelled`);
    await expect(page.getByTestId("invitation-cancelled")).toHaveText("Evenimentul a fost anulat, așa că invitația nu mai e valabilă.");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Invitația nu mai e valabilă");
    await expect(page.locator('[name="firstName"]')).toHaveCount(0);
    expect(await page.evaluate(fitsTheWidth)).toBe(true);
  });
});
