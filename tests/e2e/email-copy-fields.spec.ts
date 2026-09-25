import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

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

const STALE_KEY = "REGISTRATION_CANCELLED:ro";

/**
 * `DECISIONS.md` §373 (email follow-up; the owner, 2026-09-24: "I like how the placeholders are
 * listed here on the documents — need to have the same on emails") — the legend under a message's
 * words, on a phone and a desktop. It reads nothing but the page, so both projects run it.
 */
test.describe("the fields of an email's words, as a legend", () => {
  test("a closed card that lists every field, this message's first, the ones it never carries dimmed", async ({ page }) => {
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/admin/emails?lang=ro");
    const main = page.locator("#main");
    const card = main.locator("#email-REGISTRATION_CONFIRMED");
    await openFold(card);

    const legend = main.getByTestId("email-fields-REGISTRATION_CONFIRMED");
    await expect(legend).not.toHaveAttribute("open", "");
    const summary = legend.locator(":scope > summary");
    await expect(summary).toContainText("Câmpurile pe care le poți folosi");
    await expect(summary).toContainText("16 câmpuri · 4 câmpuri folosite aici");
    // A thumb opens it (BR-REQ-041-01 criterion 6).
    expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await openFold(legend);

    const terms = legend.locator("dt");
    await expect(terms).toHaveCount(16);
    await expect(terms.nth(0)).toContainText("{eventTitle}");
    await expect(terms.nth(0)).toContainText("folosit în textul platformei");
    // The example is the preview's: the sample's title, in italics beside what the field is.
    await expect(legend.locator("dd").nth(0)).toContainText("Titlul evenimentului, în limba acestui text — Crosul de toamnă");
    // The invitation's two fields, last and dimmed — by colour, never by opacity (AGENTS.md §18.2).
    const role = legend.locator("dt", { hasText: "{staffRole}" });
    await expect(role.locator("xpath=..")).toHaveAttribute("data-muted", "true");
    await expect(role).not.toHaveCSS("opacity", "0.6");
    await expect(legend.locator("dd").nth(14)).toContainText("nu se completează în acest mesaj");
    await expect(terms.nth(15)).toContainText("{inviterName}");

    // The old sentence is gone, and the phone keeps its width with the card open (criterion 1).
    await expect(main.getByTestId("email-copy-placeholders")).toHaveCount(0);
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });

  test("the preview's second half reads the other language's sample", async ({ page }) => {
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/admin/emails?lang=ro");
    const card = page.locator("#main").locator("#email-EVENT_UPDATE_NOTICE");
    await openFold(card);
    // Each half its own title, in the subject too (§373, email follow-up).
    await expect(card).toContainText("Detalii actualizate pentru Crosul de toamnă / Updated details for The autumn cross");
    await expect(card.locator("iframe")).toHaveAttribute("srcdoc", /The meeting point is now: Tâmpa cable-car station\./);
  });
});

/**
 * BR-REQ-080-01, `DECISIONS.md` §359 — the words of a message start from the platform's text with
 * the fields in it, and a sample value is refused at the save.
 *
 * The owner, 2026-09-24, with a screenshot of "Confirmă adresa de email": the box read "Ai început
 * înscrierea la Crosul de toamnă" — the page's sample event — where it should read "{eventTitle}".
 *
 * Desktop only: `platform_settings.emailCopy` is one row for the whole deployment, and nothing here
 * is viewport-shaped. Nothing is saved — the one save pressed is refused — so the row is left as
 * the run found it.
 */
test.describe("BR-REQ-080-01 the email words start from the fields", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("a Redactor is handed {eventTitle}, not the sample's title, and a sample value is refused", async ({ page }) => {
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/admin/emails?lang=ro");
    await hydrated(page);
    const main = page.locator("#main");

    const card = main.locator("#email-VERIFY_REGISTRATION_EMAIL");
    await openFold(card);
    // The preview above keeps rendering the made-up event (§91)…
    await expect(card.locator("iframe")).toHaveAttribute("srcdoc", /Crosul de toamnă/);
    // …and the words under it are the platform's, with the field.
    const editor = main.getByTestId("email-copy-VERIFY_REGISTRATION_EMAIL");
    const words = editor.locator(".ProseMirror");
    await expect(words).toContainText("Am primit o înscriere la {eventTitle} pe numele {participantName}, trimisă cu această adresă de email.");
    await expect(words).toContainText("Linkul este valabil {confirmationHours}");
    await expect(words).not.toContainText("Crosul de toamnă");
    // The fields are a legend under the box now (§373, email follow-up), the ones this text uses first (§419).
    const legend = editor.getByTestId("email-fields-VERIFY_REGISTRATION_EMAIL");
    await expect(legend).toContainText("16 câmpuri · 3 câmpuri folosite aici");
    await openFold(legend);
    await expect(legend.locator("dt").first()).toContainText("{participantName}");
    await expect(legend.locator("dt").first()).toContainText("folosit în textul platformei");

    const subject = editor.getByLabel("Subiect");
    await hydrated(page);
    await subject.fill("Confirmă adresa pentru Crosul de toamnă");
    await editor.getByRole("button", { name: "Salvează textul" }).click();

    const refusal = editor.getByTestId("form-refusal");
    await expect(refusal).toContainText("Textul conține valoarea de exemplu „Crosul de toamnă” — folosește {eventTitle}.");
    // Named by its box, and what was typed is still in it (§315).
    await expect(refusal.getByRole("link", { name: "Subiect" })).toBeVisible();
    await expect(subject).toHaveValue("Confirmă adresa pentru Crosul de toamnă");
  });

  test("a text saved with the sample's values is flagged, and one press puts the fields in their place", async ({ page }) => {
    // What the old editor let a Redactor save: the sample's title as words. Written straight into
    // the setting — the save refuses it now — and taken out again whatever the test does.
    const stale = { subject: "Anulat: Crosul de toamnă", paragraphs: ["Înscrierea ta la Crosul de toamnă a fost anulată."] };
    await withDatabase((client) =>
      client.query(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('emailCopy', jsonb_build_object($1::text, $2::jsonb), now())
         ON CONFLICT (key) DO UPDATE SET value = platform_settings.value || jsonb_build_object($1::text, $2::jsonb), updated_at = now()`,
        [STALE_KEY, JSON.stringify(stale)],
      ),
    );
    try {
      await signIn(page, "Dev Copywriter");
      await page.goto("/ro/admin/emails?lang=ro");
      // Every assertion before the press below already holds on the server's HTML, so without this
      // the press can land mid-hydration and be dropped — no refusal, no banner, nothing saved.
      await hydrated(page);
      const main = page.locator("#main");

      // The card of cards and the message's own card open by themselves, and the closed line says why.
      const card = main.locator("#email-REGISTRATION_CANCELLED");
      await expect(main.getByTestId("participant-emails")).toHaveAttribute("open", "");
      await expect(card).toHaveAttribute("open", "");
      await expect(card.getByTestId("participant-email-sample-values")).toHaveText("textul salvat (RO) are valori de exemplu");

      const editor = main.getByTestId("email-copy-REGISTRATION_CANCELLED");
      const warning = editor.getByTestId("email-copy-samples");
      await expect(warning).toContainText("Textul salvat conține valori de exemplu, nu câmpuri");
      await expect(warning).toContainText("„Crosul de toamnă” — în subiect și în text; în locul ei: {eventTitle}");

      // A form pressed before React has taken the page over is lost (`hydrated`), and the page
      // grew twenty legends in the email follow-up (§373): the press waits for the client.
      await hydrated(page);
      await editor.getByRole("button", { name: "Înlocuiește cu câmpurile" }).click();
      await expect(main.getByText("Am pus câmpurile în locul valorilor de exemplu și am salvat textul.")).toBeVisible();
      await expect(editor.getByTestId("email-copy-samples")).toHaveCount(0);
      await expect(editor.getByLabel("Subiect")).toHaveValue("Anulat: {eventTitle}");
      await expect(editor.locator(".ProseMirror")).toContainText("Înscrierea ta la {eventTitle} a fost anulată.");
      // The preview fills the field with the sample again — which is what a participant's own event does.
      await expect(card.locator("iframe")).toHaveAttribute("srcdoc", /Înscrierea ta la Crosul de toamnă a fost anulată\./);
      await expect(card).toContainText("Subiect: Anulat: Crosul de toamnă /");
    } finally {
      await withDatabase((client) =>
        client.query(`UPDATE platform_settings SET value = value - $1::text WHERE key = 'emailCopy'`, [STALE_KEY]),
      );
    }
  });

  test("an English text with the sample's values is flagged on the Romanian tab too, naming the language", async ({ page }) => {
    // Every message goes out in both languages (§96): the English half of every Romanian message
    // would carry the sample's title, so the Romanian tab says so rather than waiting for a switch.
    const key = "WAITLIST_OFFER_EXPIRED:en";
    const stale = { subject: "Expired: The autumn cross", paragraphs: ["The time to confirm your place at The autumn cross has run out."] };
    await withDatabase((client) =>
      client.query(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('emailCopy', jsonb_build_object($1::text, $2::jsonb), now())
         ON CONFLICT (key) DO UPDATE SET value = platform_settings.value || jsonb_build_object($1::text, $2::jsonb), updated_at = now()`,
        [key, JSON.stringify(stale)],
      ),
    );
    try {
      await signIn(page, "Dev Copywriter");
      await page.goto("/ro/admin/emails?lang=ro");
      const main = page.locator("#main");

      const card = main.locator("#email-WAITLIST_OFFER_EXPIRED");
      await expect(main.getByTestId("participant-emails")).toHaveAttribute("open", "");
      await expect(card).toHaveAttribute("open", "");
      await expect(card.getByTestId("participant-email-sample-values")).toHaveText("textul salvat (EN) are valori de exemplu");
      // The warning and its button belong to the language being edited, which here is clean.
      await expect(main.getByTestId("email-copy-WAITLIST_OFFER_EXPIRED").getByTestId("email-copy-samples")).toHaveCount(0);
    } finally {
      await withDatabase((client) => client.query(`UPDATE platform_settings SET value = value - $1::text WHERE key = 'emailCopy'`, [key]));
    }
  });
});
