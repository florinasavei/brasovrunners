import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";
import { openEditorBox } from "./support/fold";

/**
 * §NNN (amending §540) — «Retrimite declarația tuturor care nu au semnat»: on the event's page, beside
 * the queue, one press asks first with the live counts («N persoane așteaptă semnarea; M vor fi
 * sărite: …») and lands on a banner that says what was queued and what was skipped and why.
 *
 * The event and its two pending runners are written straight into the database — the setup, not the
 * subject (`resend-now.spec.ts`) — one event per run and project, so nothing is shared with another
 * spec, and the press's own hourly limit per event is never met.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
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

/** A race a month away with two runners waiting to sign, one of whose declaration email left minutes ago. */
async function seedEvent(tag: string): Promise<{ eventId: string; registrationIds: string[] }> {
  return withDatabase(async (client) => {
    const { rows: eventRows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, starts_at, registration_mode, capacity) VALUES ('RACE', now() + interval '30 days', 'INTERNAL', 50) RETURNING id`,
    );
    const eventId = eventRows[0].id;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES ($1, 'ro', $2, $3, 'x'), ($1, 'en', $4, $5, 'x')`,
      [eventId, `retrimite-${tag}`, `Retrimite ${tag}`, `resend-${tag}`, `Resend ${tag}`],
    );
    const registrationIds: string[] = [];
    for (const name of ["ana", "ion"]) {
      const email = `bulk-resend-${name}-${tag}@test.invalid`;
      const { rows: participantRows } = await client.query<{ id: string }>(
        `INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
         VALUES ($1, $1, $1, 1, $2) RETURNING id`,
        [email, `Bulk ${name}`],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO registrations (event_id, participant_id, status, locale, registered_name, display_name,
           privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, list_opt_out, hold_expires_at)
         VALUES ($1, $2, 'PENDING_DECLARATION', 'ro', $3, $3, 1, now(), false, 1, true, now() + interval '30 minutes')
         RETURNING id`,
        [eventId, participantRows[0].id, `Bulk ${name}`],
      );
      registrationIds.push(rows[0].id);
    }
    // Ion's declaration email left five minutes ago: the press skips him as recent. SENT, not PENDING,
    // so no other spec's drain can claim it and change the counts.
    await client.query(
      `INSERT INTO email_outbox (participant_id, registration_id, message_type, locale, recipient_email, payload_json, idempotency_key, status, sent_at)
       SELECT participant_id, id, 'COMPLETE_DECLARATION', 'ro', $2, '{}'::jsonb, $3, 'SENT', now() - interval '5 minutes' FROM registrations WHERE id = $1`,
      [registrationIds[1], `bulk-resend-ion-${tag}@test.invalid`, `bulk-resend-spec:${tag}`],
    );
    return { eventId, registrationIds };
  });
}

test.describe("§NNN the declaration resent to everyone who has not signed", () => {
  test("an Administrator presses it on the event page, reads the counts first, and lands on what was queued", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;
    const { eventId, registrationIds } = await seedEvent(tag);

    await signIn(page, "Dev Administrator");
    await page.goto(`/ro/admin/events/${eventId}`);
    const received = await openEditorBox(page, "Înscrierile primite");
    const form = received.getByTestId("bulk-resend-form");
    const button = form.getByRole("button", { name: "Retrimite declarația tuturor care nu au semnat" });
    await expect(button).toBeEnabled();
    // A thumb's press (BR-REQ-041-01 criterion 6).
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    await button.click();
    const dialog = page.getByRole("dialog", { name: "Retrimiți declarația tuturor celor care nu au semnat?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("2 persoane așteaptă semnarea; 1 va fi sărită: 1 cu email în ultima oră sau încă în coadă, 0 la limita de retrimiteri.");
    await expect(dialog).toContainText("Fiecare primește un link nou — cel vechi nu mai merge. Emailurile pleacă la ritmul drumului.");
    await confirmDialog(page, "Retrimiți declarația tuturor celor care nu au semnat?");

    await expect(page).toHaveURL(/saved=declarationResent/);
    await expect(page.getByTestId("declaration-resent")).toHaveText("La coadă: 1 · sărite: 1 — 1 cu email recent, 0 la limita de retrimiteri.");

    // Ana's fresh request, marked as a manual resend; nobody's state moved.
    const after = await withDatabase(async (client) => {
      const { rows: resends } = await client.query<{ registration_id: string }>(
        "SELECT registration_id FROM email_outbox WHERE is_manual_resend AND participant_id IS NOT NULL AND registration_id = ANY($1::uuid[])",
        [registrationIds],
      );
      const { rows: states } = await client.query<{ status: string }>("SELECT status FROM registrations WHERE event_id = $1", [eventId]);
      return { resends: resends.map((row) => row.registration_id), states: states.map((row) => row.status) };
    });
    expect(after.resends).toEqual([registrationIds[0]]);
    expect(after.states).toEqual(["PENDING_DECLARATION", "PENDING_DECLARATION"]);
  });
});
