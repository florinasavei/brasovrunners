import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import { cancelRegistrationsByEmailPrefix } from "./support/action-link";
import { ensureRegistrationIsOpen, FEATURED, HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";
import { chooseSex } from "./support/sex-choice";

/**
 * §NNN — «Invită pe email» on the registrations page, pressed in a real browser: on a list about one
 * event it opens «Invitații» and brings it into view, however many times it is pressed; on «toate
 * evenimentele» it leads to the event's panel; an invitation sent to a made-up person is seen with its
 * state in the panel and in the list after a reload, and the state changes once the link is accepted.
 *
 * The send is the real press (the form, the confirmation, the Server Action). The accepted link is
 * seeded as `invitation-link.spec.ts` seeds it: the invitation's one live token, whose secret only the
 * setup can know. Never a real person: the name and the address are made up.
 */
const PREFIX = "e2e-invitestatus-";

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: the invitation spec needs the database the server uses");
  return url;
}

async function withDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function featuredEventId(): Promise<string> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT e.id FROM event_translations t JOIN events e ON e.id = t.event_id WHERE t.locale = 'ro' AND t.slug = $1 LIMIT 1`,
      [FEATURED.slug],
    );
    if (!rows[0]) throw new Error("the featured event is missing: run yarn db:seed");
    return rows[0].id;
  });
}

/** A fresh live token for the invitation sent to `email`, and its secret: the link the email would have carried. */
async function linkSecretFor(email: string): Promise<string> {
  return withDatabase(async (client) => {
    const { rows } = await client.query<{ id: string; participantId: string }>(
      `SELECT id, participant_id AS "participantId" FROM event_invitations WHERE canonical_email = $1 ORDER BY sent_at DESC LIMIT 1`,
      [email],
    );
    if (!rows[0]) throw new Error("the invitation was not written");
    const secret = randomBytes(32).toString("base64url");
    await client.query(`DELETE FROM email_action_tokens WHERE invitation_id = $1 AND purpose = 'ACCEPT_INVITATION'`, [rows[0].id]);
    await client.query(
      `INSERT INTO email_action_tokens (participant_id, registration_id, invitation_id, purpose, token_hash, expires_at)
       VALUES ($1, NULL, $2, 'ACCEPT_INVITATION', $3, now() + interval '7 days')`,
      [rows[0].participantId, rows[0].id, createHash("sha256").update(secret, "utf8").digest("hex")],
    );
    return secret;
  });
}

/** Whether the element's box is inside the viewport at least in part, below the sticky header. */
async function inView(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  });
}

const fitsTheWidth = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth;

async function openList(page: Page, eventId: string) {
  await page.goto(`/ro/admin/registrations?eventId=${eventId}`);
  await hydrated(page);
}

test.describe("§NNN «Invită pe email»: the button, and every invited person with their state", () => {
  test.describe.configure({ timeout: 180_000 });

  test.afterAll(async ({}, testInfo) => {
    const prefix = `${PREFIX}${testInfo.project.name}-`;
    // A live counted invitation would hold a place on the featured race across runs: withdraw ours.
    await withDatabase((client) =>
      client.query(`UPDATE event_invitations SET withdrawn_at = now() WHERE canonical_email LIKE $1 AND accepted_at IS NULL AND withdrawn_at IS NULL`, [`${prefix}%`]),
    );
    await cancelRegistrationsByEmailPrefix(prefix);
  });

  test("opens «Invitații» on one event's list, again and again, and leads there from all events", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    const eventId = await featuredEventId();
    await openList(page, eventId);

    const panel = page.getByTestId("registrations-invitations");
    const button = page.getByTestId("registrations-invite-link");
    // Anything above the panel may be open or not; the press is what brings it up.
    await button.click();
    await expect(panel).toHaveAttribute("open", "");
    await expect.poll(() => inView(panel)).toBe(true);

    // Closed by hand, scrolled away, pressed again on the very same address: it opens again.
    await panel.locator("summary").first().click();
    await expect(panel).not.toHaveAttribute("open", "");
    await page.evaluate(() => window.scrollTo(0, 0));
    await button.click();
    await expect(panel).toHaveAttribute("open", "");
    await expect.poll(() => inView(panel)).toBe(true);

    // «Toate evenimentele»: the press leads to the event's panel, open and in view.
    await page.goto("/ro/admin/registrations?eventId=all");
    await hydrated(page);
    const lead = page.getByTestId("registrations-invite-link");
    await expect(lead).toBeVisible();
    await lead.click();
    // One event takes invitations: the press went straight there. Several: the menu is open, press the featured event's entry.
    const choice = page.locator(`[data-testid="registrations-invite-event"][href*="eventId=${eventId}"]`);
    if (await choice.count()) await choice.click();
    await expect(page).toHaveURL(new RegExp(`eventId=${eventId}.*#registrations-invitations`));
    // A page transition may hold the page left behind and the new one for a moment: the open panel is the new one, and one.
    const opened = page.locator('[data-testid="registrations-invitations"][open]');
    await expect(opened).toHaveCount(1);
    await expect.poll(() => inView(opened)).toBe(true);
    expect(await page.evaluate(fitsTheWidth)).toBe(true);
  });

  test("an invitation is seen with its state after a reload — in the panel and the list — and again once accepted", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    const eventId = await featuredEventId();
    const email = `${PREFIX}${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;
    await openList(page, eventId);

    await page.getByTestId("registrations-invite-link").click();
    const panel = page.getByTestId("registrations-invitations");
    await expect(panel).toHaveAttribute("open", "");
    const form = panel.getByTestId("invite-form");
    await form.locator('[name="inviteeName"]').fill("Ana Invitata");
    await form.locator('[name="inviteeEmail"]').fill(email);
    await form.getByTestId("invite-submit").click();
    await page.getByRole("dialog").getByRole("button", { name: /Trimite invitațiile|Adaugă .* și trimite/ }).click();
    await expect(page).toHaveURL(/saved=invitationsSent/, { timeout: 30_000 });

    // A fresh load of the list, nothing opened by hand: the person and the state are on the page.
    await openList(page, eventId);
    const invited = page.getByTestId("invitation-row").filter({ hasText: email });
    await expect(invited).toBeVisible();
    await expect(invited).toContainText("Trimisă");
    await expect(invited).toContainText("Ana Invitata");
    const inList = page.getByTestId("registrations-invitation-row").filter({ hasText: email }).filter({ visible: true });
    await expect(inList).toBeVisible();
    await expect(inList).toContainText("Invitație trimisă");
    // The same on «toate evenimentele»: the invitation is named, never nowhere.
    await page.goto("/ro/admin/registrations?eventId=all");
    await hydrated(page);
    await expect(page.getByTestId("registrations-invitations-open")).toBeVisible();
    await expect(page.locator(`[data-testid="registrations-invitations-open-link"][href*="eventId=${eventId}"]`)).toBeVisible();
    expect(await page.evaluate(fitsTheWidth)).toBe(true);

    // Accepted through its link: the registration wears «Invitat», the invitation says accepted.
    const secret = await linkSecretFor(email);
    await page.goto(`/ro/inregistrari/invitatie/${secret}`);
    await hydrated(page);
    const values: Record<string, string> = {
      birthDate: "17.05.1990",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Ion Popescu",
      emergencyContactPhone: "+40722222222",
    };
    for (const [name, value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
    await chooseSex(page);
    for (const name of ["privacyAcknowledged", "rulesAcknowledged", "termsAccepted", "fitnessDeclared"]) await page.locator(`[name="${name}"]`).check();
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();
    await expect(page).toHaveURL(/done=1/, { timeout: 30_000 });

    await openList(page, eventId);
    await expect(page.getByTestId("invitation-row").filter({ hasText: email })).toContainText("Acceptată");
    await expect(page.getByTestId("registrations-invitation-row").filter({ hasText: email }).filter({ visible: true })).toHaveCount(0);
    // The chip is on the registration of the invited person, found by the made-up address, not just anywhere.
    const registered = page.locator("tr, li").filter({ hasText: email }).filter({ has: page.getByTestId("invited-chip") }).filter({ visible: true });
    await expect(registered.first()).toBeVisible();
  });
});
