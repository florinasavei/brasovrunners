/**
 * Send one message through the real Mailgun adapter, from a developer's machine.
 *
 * ```text
 * yarn email:probe you@example.com    send, and print what the provider answered
 * yarn email:probe --fail             send to an address the sandbox will refuse
 * ```
 *
 * The `capture`-only rule on local (`AGENTS.md` §7.1, §16.4) protects the application's outbox;
 * this sends nothing the application enqueued, only one message to an address typed here, to
 * exercise the provider half of §16 through the production adapter — with `--fail`, the
 * permanent-failure mapping. Reads `MAILGUN_*` from the environment (§8), never the outbox.
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

  // `--fail` overrides the address: it must be one the provider refuses.
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
     * The angle brackets matter (`AGENTS.md` §16.5): the webhook reports the id without them and
     * `applyMailgunEvent` matches exactly, so a bracketed id silently matches no bounce.
     */
    const id = result.providerMessageId ?? "";
    if (id.startsWith("<") && id.endsWith(">")) {
      console.log("\nnote: this id carries angle brackets; the webhook reports it without them.");
    }
    return 0;
  }

  /**
   * §14.5: this error is what `email_outbox.last_error` would show staff; an address surviving
   * `sanitizeError` is a defect.
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
