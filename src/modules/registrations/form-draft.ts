import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/shared/config/env";
import { TURNSTILE_FIELD } from "./turnstile";

/**
 * What the participant typed, kept across a rejected submit (`DECISIONS.md` §142; the owner:
 * "the fields are cleared after submit! super annoying!").
 *
 * The form is a Server Component and a rejection is a redirect back to it (§47), so the
 * browser arrives with nothing typed. Nothing a participant typed may go into a URL (§14.5),
 * and MUI's selects cannot be refilled from the DOM after the fact. So the action puts the
 * values in a cookie for ten minutes — encrypted (AES-256-GCM, a key derived from the
 * deployment's secret), `httpOnly`, `sameSite=lax`, on the form's own path — and the page
 * reads it once to prefill every box. Health notes ride in it too, which is why it is
 * encrypted and short-lived rather than plain; a draft over the cookie's size is simply not
 * kept, and the person retypes, as before. The bot fields, the address of the form and the
 * consents that must be re-read are left out.
 */

const COOKIE = "br_form_draft";
const MAX_AGE_SECONDS = 600;
/** Browsers keep a cookie to about 4 KB; past this the draft is dropped rather than truncated. */
const MAX_BYTES = 3_800;
/*
  What is never carried across a rejected submission.

  `privacyAcknowledged` used to be here, on the reasoning that a consent must be given
  deliberately every time (§142). The owner, 2026-09-22, watching somebody meet the anti-bot
  refusal: "vreau sa persist inclusiv bifele, sa nu se enerveze Dani." He is right, and the
  reasoning was thinner than it looked: the tick that counts is the one on the submission that
  **succeeds**, and that is the one recorded, with its version and its timestamp, by the row
  itself. Re-ticking three boxes to recover from a refusal that was about none of them is
  friction charged to the wrong person.

  The three that stay: the token (single use), the trap (its whole point is to be empty), and
  the render time (it is the clock for the next attempt, not the last one).
*/
const SKIPPED = new Set([TURNSTILE_FIELD, "honeypot", "renderedAt", "locale", "slug"]);

export type FormDraft = Readonly<Record<string, string>>;

function key(secret: string): Buffer {
  return createHash("sha256").update(`form-draft:${secret}`).digest();
}

/**
 * The deployment's secret for the draft: the sign-in secret, or the job secret where there is
 * no sign-in — every deployment has one of the two. A laptop with neither gets a key drawn
 * once per process: the draft works for as long as the server runs, which is what a laptop
 * needs, and nothing sealed there is readable anywhere else.
 */
const PROCESS_SECRET = randomBytes(32).toString("base64url");
const deploymentSecret = () => env.AUTH_SECRET ?? env.JOB_SECRET ?? PROCESS_SECRET;

/** The values the cookie keeps: every posted string but the bot fields, the address and the consent to re-read. */
export function draftValuesOf(form: FormData): FormDraft {
  const values: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === "string" && !SKIPPED.has(name) && !name.startsWith("$")) values[name] = value;
  }
  return values;
}

export function sealFormDraft(values: FormDraft, secret = deploymentSecret()): string | null {
  const k = key(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
  return sealed.length > MAX_BYTES ? null : sealed;
}

export function openFormDraft(sealed: string, secret = deploymentSecret()): FormDraft | null {
  const k = key(secret);
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string")) as FormDraft;
  } catch {
    return null;
  }
}

/** Keep the typed values for the page the action sends the browser back to. */
export async function stashFormDraft(form: FormData, path: string): Promise<void> {
  await stashDraftValues(draftValuesOf(form), path);
}

/**
 * Keep exactly these values, sealed the same way, for a form whose fields are not all worth
 * keeping — the declaration (§314) carries its action link's secret in a hidden field, and a
 * secret is never copied anywhere it does not have to be, sealed or not.
 */
export async function stashDraftValues(values: FormDraft, path: string): Promise<void> {
  const sealed = sealFormDraft(values);
  const jar = await cookies();
  if (!sealed) {
    jar.delete(COOKIE);
    return;
  }
  jar.set(COOKIE, sealed, { httpOnly: true, sameSite: "lax", secure: env.APP_BASE_URL.startsWith("https://"), path, maxAge: MAX_AGE_SECONDS });
}

/** Forget it — the submission went through. */
export async function clearFormDraft(path: string): Promise<void> {
  (await cookies()).set(COOKIE, "", { httpOnly: true, sameSite: "lax", path, maxAge: 0 });
}

/** The draft, when the browser brought one back; only worth reading on a rejected submit. */
export async function readFormDraft(): Promise<FormDraft | null> {
  const sealed = (await cookies()).get(COOKIE)?.value;
  return sealed ? openFormDraft(sealed) : null;
}

/**
 * The address a submission was sent to, for the screen that says to go and read it
 * (`DECISIONS.md` §224; the owner: "on this page I should show the email again").
 *
 * It is the one fact that screen is missing. "Check your email" is useless to somebody who
 * typed `@gmail.con` — they check the inbox they meant, find nothing, and conclude the site
 * is broken. Three BOUNCED messages in QA's outbox went to that exact misspelling, and one
 * of the owner's own registrations went to a domain with a typo in it. Showing the address
 * back is the cheapest possible catch: they read it, see it is wrong, and register again.
 *
 * **Its own cookie, not the draft's, and not the URL.** Nothing a participant typed goes into
 * a URL (§14.5), which rules out the redirect's query string. The draft cookie is cleared on
 * a successful submit and carries twenty fields including health notes; this carries one
 * field, is written only on success, and is sealed with the same key and the same ten minutes
 * because an address is still personal data sitting in a browser.
 */
const SUBMITTED_COOKIE = "br_submitted_to";

/**
 * The two facts that screen greets somebody with: the inbox to open, and — since the owner
 * asked for the screen to be "more fun" — their first name, so it can say "Aproape gata, Ana!"
 * rather than read like a receipt. The name is the first word of what they typed in the
 * first-name box (`firstNameOf`), sealed with the address, and forgotten with it.
 */
export type SubmittedFacts = Readonly<{ email: string | null; firstName: string | null }>;

/**
 * The one word a greeting uses: the first token of the first-name box, or null when there is
 * none to use. "Ana Maria" greets Ana; a box of spaces greets nobody by name and the screen
 * falls back to the plain heading rather than "Aproape gata, !".
 */
export function firstNameOf(typedFirstName: string | null | undefined): string | null {
  const first = (typedFirstName ?? "").trim().split(/\s+/)[0] ?? "";
  return first === "" ? null : first;
}

export async function stashSubmittedFacts(facts: { email: string; firstName: string }, path: string): Promise<void> {
  const sealed = sealFormDraft({ email: facts.email, firstName: firstNameOf(facts.firstName) ?? "" });
  if (!sealed) return;
  const jar = await cookies();
  jar.set(SUBMITTED_COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_BASE_URL.startsWith("https://"),
    path,
    maxAge: MAX_AGE_SECONDS,
  });
}

/** The address and first name the confirmation screen uses, or null when the cookie has gone. */
export async function readSubmittedFacts(): Promise<SubmittedFacts | null> {
  const sealed = (await cookies()).get(SUBMITTED_COOKIE)?.value;
  if (!sealed) return null;
  const opened = openFormDraft(sealed);
  if (!opened) return null;
  const email = typeof opened.email === "string" && opened.email !== "" ? opened.email : null;
  const firstName = firstNameOf(opened.firstName);
  return { email, firstName };
}
