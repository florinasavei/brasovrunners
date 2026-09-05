/**
 * Send one message through the real Mailgun adapter, from a developer's machine.
 *
 * ```text
 * yarn email:probe you@example.com    send, and print what the provider answered
 * yarn email:probe --fail             send to an address the sandbox will refuse
 * ```
 *
 * ## Why this exists, and what it deliberately is not
 *
 * `EMAIL_DELIVERY_MODE` is `capture` on local and test, and the configuration refuses anything
 * else there (`AGENTS.md` §7.1, §16.4). That rule protects the *application*: a seeded database
 * full of invented addresses must never reach a real inbox because somebody started the dev
 * server.
 *
 * This is a different act. It transmits nothing the application enqueued — no outbox row, no
 * registration, no participant, no seeded address. It takes one address typed on the command
 * line by the person running it, and sends one message there, so that the provider half of
 * `AGENTS.md` §16 can be exercised before anybody depends on it: the key, the region, the
 * sending domain, the sender address, and — with `--fail` — the transient/permanent mapping
 * that decides whether a message is retried or abandoned.
 *
 * It calls `createMailgunAdapter` rather than `fetch`, so what it exercises is the code that
 * runs in production and not a hand-written imitation of it.
 *
 * Configuration comes from the environment like everything else (§8): put `MAILGUN_API_KEY`,
 * `MAILGUN_DOMAIN` and `MAILGUN_API_BASE_URL` in `.env.local`. Nothing here reads
 * `EMAIL_DELIVERY_MODE`, because nothing here goes near the outbox.
 */
import { createMailgunAdapter } from "../src/infrastructure/email/mailgun-adapter";

/** Refused by any sandbox domain, which is the point of `--fail`. */
const UNAUTHORIZED = "unauthorized-probe@example.com";

const EMAIL_SHAPED = /[^\s<>"']+@[^\s<>"']+\.[a-z]{2,}/i;

function fail(message: string): never {
  console.error(`${message}\n\nusage: yarn email:probe [--fail] <address>`);
  process.exit(1);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const wantFailure = args.includes("--fail");
  const recipient = args.find((arg) => !arg.startsWith("--"));

  if (!wantFailure && !recipient) fail("no address given");

  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const apiBaseUrl = process.env.MAILGUN_API_BASE_URL;

  if (!apiKey || !domain || !apiBaseUrl) {
    fail("MAILGUN_API_KEY, MAILGUN_DOMAIN and MAILGUN_API_BASE_URL must be set — put them in .env.local");
  }

  const fromAddress = process.env.EMAIL_FROM_ADDRESS ?? `noreply@${domain}`;
  const adapter = createMailgunAdapter({
    apiKey,
    domain,
    apiBaseUrl,
    from: `${process.env.EMAIL_FROM_NAME ?? "Brașov Runners"} <${fromAddress}>`,
    replyTo: process.env.EMAIL_REPLY_TO,
  });

  // `--fail` overrides the address on purpose: proving the permanent-failure path means sending
  // somewhere the provider will refuse, and the point is lost if it happens to be authorized.
  const to = wantFailure ? UNAUTHORIZED : recipient!;
  console.log(`sending as ${fromAddress} to ${to} via ${apiBaseUrl}/${domain}`);

  const result = await adapter.send({
    to,
    subject: "[QA] Mailgun probe — Brașov Runners",
    text: "Sent by yarn email:probe. Nothing in the application enqueued this message.",
    html: "<p>Sent by <code>yarn email:probe</code>. Nothing in the application enqueued this message.</p>",
    locale: "ro",
    idempotencyKey: "email-probe",
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.outcome === "sent") {
    /**
     * The angle brackets matter (`AGENTS.md` §16.5).
     *
     * Mailgun's send response wraps the id in `<...>`; its webhook reports the same message as
     * `message.headers.message-id` **without** them. `applyMailgunEvent` matches
     * `email_outbox.provider_message_id` exactly, so an id stored with brackets matches no
     * webhook that will ever arrive, and a bounce updates nothing at all — silently.
     */
    const id = result.providerMessageId ?? "";
    if (id.startsWith("<") && id.endsWith(">")) {
      console.log("\nnote: this id carries angle brackets; the webhook reports it without them.");
    }
    return 0;
  }

  /**
   * §14.5: what is printed here is what would be stored in `email_outbox.last_error` and read
   * by an organizer in the backoffice. Mailgun's commonest sandbox rejection names the
   * recipient, so an address surviving `sanitizeError` is a defect, and this is where it shows.
   */
  const leaked = typeof result.error === "string" && EMAIL_SHAPED.test(result.error);
  console.log(leaked ? "\nFAIL: an address survived sanitizeError" : "\nno address in the error, as §14.5 requires");
  return leaked ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
