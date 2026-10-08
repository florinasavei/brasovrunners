import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";
import { redactProviderText } from "./redact";

/**
 * Mailgun, over its HTTP API (AGENTS.md §16; BR-REQ-080-01, BR-REQ-080-03).
 *
 * `fetch` and `FormData`, no SDK. AGENTS.md §1.5 ranks "prefer nothing, then the platform,
 * then what is already installed" above convenience, and what the official client would add
 * here is a dependency, a bundled HTTP stack and its own error shapes in exchange for four
 * form fields and a status code. Everything Mailgun-specific stays inside this file, which is
 * the promise `adapter.ts` makes: replacing the provider is a new file next to this one and
 * one line in `sender.ts`.
 *
 * ## The one thing that is not obvious: transient versus permanent
 *
 * `SendResult` distinguishes them because the outbox acts on the difference — a transient
 * failure is retried with backoff, a permanent one never is. Retrying a hard rejection six
 * times is how a sending domain's reputation is destroyed (§16.1, §16.5), so the mapping is
 * conservative in the safe direction: anything that is not clearly the caller's fault is
 * treated as transient and tried again.
 *
 * - **2xx** — queued. Mailgun's `id` becomes `providerMessageId`, which is what a later
 *   webhook is matched against.
 * - **401, 403** — permanent. Bad credentials or an unverified sending domain: every retry
 *   fails identically, and the deployment needs a person, not another attempt.
 * - **400** — permanent, *unless the body says the account is paused or its allowance spent*.
 *   See below; this is the one that was wrong, twice. A body that says "not allowed to send"
 *   together with the probation's words (`RATE_PAUSED`: temporarily, account disabled, probation, too fast,
 *   rate limit; a bare "domain disabled" stays permanent) is a **pause** — throttled, `paced`, tried again in fifteen minutes
 *   without spending an attempt (§605). A body with limit language (`ALLOWANCE_SPENT`) is the
 *   daily allowance — throttled, to the reset. Otherwise a malformed message, an unauthorized
 *   sandbox recipient («Sandbox subdomains are for test purposes only»), an unverified domain,
 *   an address Mailgun refuses — retrying an unchanged message already refused is pointless.
 * - **402, 420** — throttled, to the daily reset. Mailgun's own non-standard code for "Domain …
 *   is not allowed to send: recipient limit exceeded" is **420**, and a plan or payment refusal
 *   surfaces as 402. Neither is documented in Mailgun's status-code table, which lists only 400,
 *   401, 403, 404, 429 and 500 — so neither may be inferred from the documentation, and both are
 *   handled because they are observed.
 * - **429** — a **pause** (§605, amending §40's reading of it as transient): throttled,
 *   `paced`, due again when Mailgun's `Retry-After` says (seconds or an HTTP date), or in fifteen
 *   minutes without one, and the attempt given back. It was the ordinary backoff — one, two,
 *   four … minutes, six attempts in about an hour, then FAILED: on the morning the club took a
 *   paid plan and opened registrations, an account on Mailgun's probation (domains limited to a
 *   hundred messages an hour) would have lost every confirmation past the hour's hundredth, and kept knocking while
 *   Mailgun asked it to stop, which is what gets a probation account disabled.
 * - **5xx and any network error** — transient. Outages pass — and since §622 a transient refusal is
 *   never the end of a message: past the sixth attempt it is retried hourly, never FAILED.
 * - **Which permanent refusals are the address's** (§622): only a 400 that names the address or the
 *   recipient is BOUNCED; 401, 403 and every other permanent 400 carry `notTheAddress` and the outbox
 *   marks them FAILED — the club's to fix, then «Reîncearcă emailurile eșuate» sends them again.
 *
 * ## The 400 that is not the caller's fault, and why it mattered
 *
 * Mailgun refuses a send whose account allowance is spent with the *same* 400 it uses for a
 * malformed message: `Domain <domain> is not allowed to send: recipient limit exceeded`. Mapped
 * as a flat permanent failure, that marked every message queued after the cap BOUNCED —
 * terminal, never retried — on the one day of the year the club most needs them: a race opening
 * entries sends four messages per completed registration against a 100/day allowance, so it
 * crosses the cap before lunch (`docs/PLATFORM.md`, limit 1). The messages that would have gone
 * out at midnight were being thrown away instead.
 *
 * So a 400 is checked against `ALLOWANCE_SPENT` before it is called permanent. The pattern is
 * kept **narrow on purpose**: the sandbox's own refusals — "is not among the authorized
 * recipients", "Sandbox subdomains are for test purposes only" — must stay permanent, because
 * no amount of waiting authorizes a recipient, and retrying those daily forever is the
 * reputation cost this file exists to avoid. Limit language only.
 *
 * ## Every hostname here is configuration, never a literal
 *
 * §8 forbids a hostname anywhere under `src/` and exempts no provider. That covers all three
 * of them: the API base, the sending domain, and the sending address itself. They arrive from
 * the environment (`sender.ts`), which is also what lets one build run against a Mailgun
 * sandbox today and the club's own domain later with no code change at all.
 */

export type MailgunConfig = {
  apiKey: string;
  /** The verified sending domain — a sandbox while testing, the club's domain in production. */
  domain: string;
  /**
   * Mailgun's API base, from configuration.
   *
   * AGENTS.md §8 forbids a hostname literal anywhere under `src/` and exempts no provider —
   * the same rule that keeps the map service's URL out of the code. It is not ceremony here
   * either: Mailgun's EU region is a different host, and a club storing European participants'
   * data may well have to move to it.
   */
  apiBaseUrl: string;
  /** `Brașov Runners <noreply@…>`, assembled in `sender.ts` from configuration. */
  from: string;
  /**
   * Where a participant's reply goes, when the club has named a mailbox.
   *
   * Absent means a reply goes to `from`, which for a `noreply@` sender means it goes nowhere.
   * That is why this exists: the messages this application sends are the club's side of a
   * conversation with somebody who is about to run a race, and "do not reply" is a poor answer
   * to "can I still change my mind?".
   */
  replyTo?: string;
  /**
   * The environment the message leaves from (`APP_ENV`), sent as a tag (`env:<name>`, §NNN): QA and
   * production share the sending domain and its webhooks, and each deployment's webhook acts only on
   * the events of its own messages. Absent, no tag — and every event is acted on, as before.
   */
  environment?: string;
};

/** Longer than this and the message is stuck behind a provider that is not answering. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The account's own allowance, refused — not the message.
 *
 * Matched against the provider's body, and only ever to move a refusal from permanent to
 * throttled, so a false negative costs nothing new and a false positive is what has to be
 * avoided: it would retry a genuinely bad message once a day forever. Hence limit language and
 * nothing else. "not allowed to send" alone is not enough — Mailgun uses it for a disabled
 * domain too, which waiting does not fix.
 */
const ALLOWANCE_SPENT = /limit exceeded|exceeded your|sending limit|daily limit|quota/i;

/**
 * The account held back for its pace, not the message refused (§605): Mailgun's probation — domains
 * are limited to a hundred messages an hour, and sending faster "temporarily disables" the account
 * (the notice's words; the 400's body shape is anticipated, not yet observed). Both halves must match: "not allowed to send"
 * alone is also a sandbox's refusal and an unverified domain's, which waiting does not fix, and the
 * probation's words alone could be anything. Checked before `ALLOWANCE_SPENT`, because "rate limit
 * exceeded" is the hour's limit, not the day's.
 */
const NOT_ALLOWED_TO_SEND = /not allowed to send/i;
// A bare "domain disabled" is deliberately not here: Mailgun uses it for a domain it has closed for good,
// which waiting does not fix — it stays permanent and a person is told (§605 review).
const RATE_PAUSED = /temporarily|account (is )?disabled|probation|too fast|rate limit/i;

/**
 * A 400 about the recipient (§622): "'to' parameter is not a valid address", a sandbox's "… is not
 * among the authorized recipients". Only these stay BOUNCED; every other permanent 400 is the
 * account's or the message's, and FAILED.
 */
const ADDRESS_REFUSED = /address|recipient/i;
/** The sender's own parameter ("'from' parameter is not a valid address") is the club's configuration, not a bad recipient. */
const SENDER_REFUSED = /'?from'?\s+parameter|sender/i;

/** How long a pause lasts when Mailgun does not say: the outbox job's daytime cadence (§68). */
export const MAILGUN_PAUSE_MS = 15 * 60_000;

/** A `Retry-After` longer than a day is not believed: the row would vanish from view for weeks. */
const MAX_RETRY_AFTER_MS = 24 * 3_600_000;

/**
 * When Mailgun asks to be tried again: its `Retry-After` header, in seconds or as an HTTP date
 * (RFC 9110 §10.2.3 allows both), or fifteen minutes from now without a readable one. Never in the
 * past and never more than a day away.
 */
export function mailgunRetryAfter(headers: Headers | undefined, now: Date): Date {
  const fallback = new Date(now.getTime() + MAILGUN_PAUSE_MS);
  const raw = headers?.get("retry-after")?.trim();
  if (!raw) return fallback;
  let at: number;
  if (/^\d+$/.test(raw)) at = now.getTime() + Number(raw) * 1_000;
  else {
    at = Date.parse(raw);
    if (Number.isNaN(at)) return fallback;
  }
  return new Date(Math.min(Math.max(at, now.getTime()), now.getTime() + MAX_RETRY_AFTER_MS));
}

/** What a refusal means to the outbox: the outcome, and for a pause, that it is one and until when. */
export type MailgunFailure =
  | { outcome: "permanent_failure"; notTheAddress?: true }
  | { outcome: "transient_failure" }
  | { outcome: "throttled"; paced?: true; rateRefused?: true; retryAfter?: Date };

/** A pause (§605): throttled, the attempt given back, due again at `retryAfter`. */
function paused(retryAfter: Date): MailgunFailure {
  return { outcome: "throttled", paced: true, rateRefused: true, retryAfter };
}

/**
 * Which refusals are final, which are the allowance, which are a pause, and which are worth
 * another minute.
 *
 * Split out of `send` so the mapping can be read as a table and asserted directly — it is the
 * part of this adapter with real consequences, and it was wrong twice. `headers` are the
 * response's (`Retry-After`); `now` is a parameter so the pause's end can be asserted.
 */
export function classifyMailgunFailure(
  status: number,
  body: string,
  headers?: Headers,
  now: Date = new Date(),
): MailgunFailure {
  // Credentials, or a sending domain that is not verified. Every retry fails identically — and it is
  // the account, not the runner's address: FAILED, kept for «Reîncearcă emailurile eșuate» (§622).
  if (status === 401 || status === 403) return { outcome: "permanent_failure", notTheAddress: true };

  // Mailgun's own code for a refused send against a spent allowance, and the payment/plan
  // refusal. Neither appears in the documented status table; both are observed. To the reset.
  if (status === 402 || status === 420) return { outcome: "throttled" };

  // The rate limit (§605): a pause, for as long as Mailgun says, never an attempt spent.
  if (status === 429) return paused(mailgunRetryAfter(headers, now));

  if (status === 400) {
    // The probation's "temporarily disabled": a pause of fifteen minutes, never a bounce.
    if (NOT_ALLOWED_TO_SEND.test(body) && RATE_PAUSED.test(body)) return paused(new Date(now.getTime() + MAILGUN_PAUSE_MS));
    if (ALLOWANCE_SPENT.test(body)) return { outcome: "throttled" };
    // The address itself — not a valid address, a sandbox's unauthorized recipient — is the bounce it
    // always was; anything else (an unverified or closed domain, a malformed message) is the club's to
    // fix, FAILED and retried by a person once fixed (§622), never thrown away as a bad address.
    return ADDRESS_REFUSED.test(body) && !SENDER_REFUSED.test(body) ? { outcome: "permanent_failure" } : { outcome: "permanent_failure", notTheAddress: true };
  }

  // 404, 5xx, anything unrecognised. Conservative in the safe direction, which is the
  // principle this whole mapping follows: what is not clearly the caller's fault is retried.
  return { outcome: "transient_failure" };
}

type MailgunAccepted = { id?: string; message?: string };

/**
 * Mailgun's two spellings of one message id, reduced to one (AGENTS.md §16.5).
 *
 * The send response returns the id in RFC 5322 form, angle brackets included. The delivery
 * webhook reports the same message as `message.headers.message-id`, *without* them.
 * `applyMailgunEvent` finds the outbox row by an exact match on this value, so storing the
 * response's spelling means no webhook ever matches: a bounce updates zero rows and reports
 * success, and the row sits at SENT for a message that was rejected.
 *
 * Verified against the live provider before this was written, not inferred from the docs.
 */
function normalizeProviderMessageId(id: string | undefined): string | undefined {
  const trimmed = id?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;
}

/**
 * Trim a provider message down to something safe to store in `email_outbox.last_error`.
 *
 * §14.5: never a body, an address, or a token — and this redacts rather than merely truncates,
 * because Mailgun's most common rejection on a sandbox domain is literally *"…is not among the
 * authorized recipients"* with the participant's address in it. That string is read by an
 * organizer in the backoffice and shipped into logs, so the address comes out here, at the one
 * boundary that sees it, rather than being trusted not to appear. The redactor is the one the
 * delivery webhook uses too (`redact.ts`, §NNN): the key, any address, the recipient's local part
 * quoted alone, an IP literal, a token-length run.
 */
function sanitizeError(status: number, body: string, apiKey: string, recipient: string): string {
  return `mailgun ${status}: ${redactProviderText(body, { secrets: [apiKey], recipient })}`;
}

/**
 * Whether a refusal stored at the send was the club's **account** rather than the address (§NNN): the
 * exact opposite of the one case `classifyMailgunFailure` calls the address's — a 400 that names the
 * address or the recipient and not the sender — read back from `last_error` as `sanitizeError` wrote it.
 * Since §622 such a refusal is FAILED; before it, every permanent refusal was stored BOUNCED, and the
 * rows Mailgun's refusals of the account left on 2026-10-01 and 02 (credentials, the probation's pause,
 * the spent allowance's «recipient limit exceeded») still read as the runners' bounces. They never left,
 * and say nothing about the address.
 *
 * The placeholder `sanitizeError` put where an address was is taken out first: it says «address» itself.
 * A Gmail refusal (`gmail: …`), a webhook's reason and anything that is not a stored Mailgun answer is
 * never the account's.
 */
export function isAccountRefusalError(stored: string | null | undefined): boolean {
  if (typeof stored !== "string") return false;
  const match = /^mailgun (\d{3}):\s?([\s\S]*)$/.exec(stored.trim());
  if (!match) return false;
  const failure = classifyMailgunFailure(Number(match[1]), match[2].replaceAll("<address>", " "));
  return !(failure.outcome === "permanent_failure" && !failure.notTheAddress);
}

/** The tag that names the environment a message left from (§NNN): the webhook acts only on its own. */
export const ENVIRONMENT_TAG_PREFIX = "env:";

export function createMailgunAdapter(config: MailgunConfig): EmailAdapter {
  // Basic auth, username `api`, password the key — Mailgun's documented scheme. Built once,
  // never logged, and never attached to an object anything else can read.
  const authorization = `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}`;
  const endpoint = `${config.apiBaseUrl.replace(/\/+$/, "")}/${config.domain}/messages`;

  return {
    name: "mailgun",

    async send(message: OutgoingEmail): Promise<SendResult> {
      const form = new FormData();
      form.set("from", config.from);
      form.set("to", message.to);
      // Repeated fields, which is how Mailgun takes several recipients of the same kind. A
      // `cc` is on the message everybody can read; a `bcc` reaches its mailbox and appears
      // nowhere (§244, where the club is warned of exactly that).
      for (const address of message.cc ?? []) form.append("cc", address);
      for (const address of message.bcc ?? []) form.append("bcc", address);
      form.set("subject", message.subject);
      form.set("text", message.text);
      form.set("html", message.html);
      /*
        No open or click tracking, on every message, whatever the domain's own setting says
        (§320). Click tracking rewrites every link through Mailgun's redirect host — the
        single-use action links included, so a participant's token would pass through a third
        party's log — and open tracking is a pixel that reports when and where somebody read
        their mail, where the privacy notice says "fără … urmărire". The per-message options win over
        the domain's (Mailgun's API reference, "o:tracking-clicks … overrides the domain-level
        click tracking setting"), so a switch flipped in Mailgun's dashboard cannot undo this.
      */
      form.set("o:tracking", "no");
      form.set("o:tracking-clicks", "no");
      form.set("o:tracking-opens", "no");
      if (config.replyTo) form.set("h:Reply-To", config.replyTo);
      // Mailgun takes files as repeated `attachment` parts of the same multipart form.
      for (const attachment of message.attachments ?? []) {
        form.append("attachment", new Blob([new Uint8Array(attachment.data)], { type: attachment.contentType }), attachment.filename);
      }

      /**
       * The outbox row's key, carried through the provider and back.
       *
       * Mailgun returns `v:` variables in webhook payloads as `user-variables`, so §16.5's
       * "trace a webhook back to the outbox row" does not depend on the provider's own id
       * having been stored successfully. It identifies the trigger, never the participant.
       */
      form.set("v:idempotency_key", message.idempotencyKey);
      // Three tags at most: delivery statistics per locale is the only question the club would ever
      // ask of them, and the second says which deployment the message is from (§NNN), so the
      // webhook QA's and production's events both reach acts on its own deployment's alone.
      form.set("o:tag", `locale:${message.locale}`);
      if (config.environment) form.append("o:tag", `${ENVIRONMENT_TAG_PREFIX}${config.environment}`);

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: authorization },
          body: form,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        // DNS, TLS, a timeout, a dropped connection. None of them says the message is bad.
        return {
          outcome: "transient_failure",
          error: `mailgun unreachable: ${error instanceof Error ? error.name : "unknown"}`,
        };
      }

      if (response.ok) {
        const accepted = (await response.json().catch(() => ({}))) as MailgunAccepted;
        return {
          outcome: "sent",
          // Mailgun always returns an id for an accepted message; the fallback exists so a
          // surprising response shape is still a send that happened rather than an exception.
          providerMessageId:
            normalizeProviderMessageId(accepted.id) ?? `mailgun:${message.idempotencyKey}`,
        };
      }

      const body = await response.text().catch(() => "");
      // The response's headers go with it: a 429's `Retry-After` is when Mailgun wants us back (§605).
      const failure = classifyMailgunFailure(response.status, body, response.headers);
      return { ...failure, error: sanitizeError(response.status, body, config.apiKey, message.to) };
    },
  };
}
