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
const SKIPPED = new Set([TURNSTILE_FIELD, "honeypot", "renderedAt", "locale", "slug", "privacyAcknowledged"]);

export type FormDraft = Readonly<Record<string, string>>;

function key(secret: string | undefined): Buffer | null {
  return secret ? createHash("sha256").update(`form-draft:${secret}`).digest() : null;
}

/** The deployment's secret for the draft: the sign-in secret, or the job secret where there is no sign-in. */
const deploymentSecret = () => env.AUTH_SECRET ?? env.JOB_SECRET;

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
  if (!k) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
  return sealed.length > MAX_BYTES ? null : sealed;
}

export function openFormDraft(sealed: string, secret = deploymentSecret()): FormDraft | null {
  const k = key(secret);
  if (!k) return null;
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
  const sealed = sealFormDraft(draftValuesOf(form));
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
