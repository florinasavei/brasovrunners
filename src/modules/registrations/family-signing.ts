import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { readSpentActionTokenScope } from "@/modules/action-tokens/repository";
import { env } from "@/shared/config/env";
import { FAMILY_PASS_MINUTES, type FamilySigningRow } from "./domain/family-signing";
import { openFormDraft, purposeSecret, sealFormDraft } from "./form-draft";

/**
 * The pass that carries the family's declarations from one person to the next (§NNN).
 *
 * AGENTS.md §13.2, step 4: the server "consumes the token or exchanges it for a short-lived,
 * purpose-limited HTTP-only action session". The first signature spends the opened link exactly as
 * before — single use, in the transaction that records the acceptance — and, when the address holds
 * another declaration to sign at the same event, the browser that pressed it receives this pass:
 *
 * - **sealed** (AES-256-GCM under the deployment's secret bound to this purpose, the form draft's
 *   sealing, `purposeSecret`), `httpOnly`, `sameSite=lax`, and sent only to the spent link's own
 *   page, in either language;
 * - **short-lived**: {@link FAMILY_PASS_MINUTES} after the last signature, renewed by each one;
 * - **purpose-limited**: it names one participant, one event and the link it came from, and all it
 *   lets anybody do is sign the declaration of another registration of that participant at that
 *   event — the same `signDeclaration`, under the same lock, against the same approved text and the
 *   same names. It reads no address, cancels nothing, and never opens a staff page;
 * - **bound to the link**: it is honoured only beside the secret it was exchanged for, which must
 *   still be that link's spent secret (`familyPassHolds`) — a pass copied out of the browser is
 *   nothing without the email, and the email's link, once spent, signs nothing without the pass.
 *
 * Nothing about a person goes in the URL (§14.5): the pass is the only memory of which people were
 * signed on this device, and the page reads the rest from the rows.
 */

const COOKIE = "br_family_sign";
const PURPOSE = "family-signing";

export type FamilySigningPass = {
  participantId: string;
  eventId: string;
  /** The registration whose emailed link was opened and spent first. */
  originId: string;
  /** Everybody signed through this pass, in the order they signed — the origin included. */
  signedIds: string[];
  expiresAt: Date;
};

export function sealFamilyPass(pass: FamilySigningPass, secret = purposeSecret(PURPOSE)): string | null {
  return sealFormDraft(
    {
      p: pass.participantId,
      e: pass.eventId,
      o: pass.originId,
      s: pass.signedIds.join(","),
      x: String(pass.expiresAt.getTime()),
    },
    secret,
  );
}

/** The pass, when it opens under this deployment's key and has not lapsed; null otherwise. */
export function openFamilyPass(sealed: string, now: Date, secret = purposeSecret(PURPOSE)): FamilySigningPass | null {
  const opened = openFormDraft(sealed, secret);
  if (!opened?.p || !opened.e || !opened.o || !opened.x) return null;
  const expiresAt = new Date(Number(opened.x));
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) return null;
  return {
    participantId: opened.p,
    eventId: opened.e,
    originId: opened.o,
    signedIds: (opened.s ?? "").split(",").filter(Boolean),
    expiresAt,
  };
}

/** The spent link's own page, in every language: where the pass travels, and nowhere else. */
function passPaths(token: string): string[] {
  return routing.locales.map((locale) =>
    getPathname({ locale, href: { pathname: "/registrations/declare/[token]", params: { token } } }),
  );
}

export async function readFamilySigningPass(now: Date): Promise<FamilySigningPass | null> {
  const sealed = (await cookies()).get(COOKIE)?.value;
  return sealed ? openFamilyPass(sealed, now) : null;
}

/** Give the browser the pass, or renew it after another signature. */
export async function writeFamilySigningPass(
  pass: Omit<FamilySigningPass, "expiresAt">,
  token: string,
  now: Date,
): Promise<void> {
  const sealed = sealFamilyPass({ ...pass, expiresAt: new Date(now.getTime() + FAMILY_PASS_MINUTES * 60_000) });
  if (!sealed) return;
  const jar = await cookies();
  for (const path of passPaths(token)) {
    jar.set(COOKIE, sealed, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.APP_BASE_URL.startsWith("https://"),
      path,
      maxAge: FAMILY_PASS_MINUTES * 60,
    });
  }
}

/**
 * Whether this pass is honoured beside this secret: the secret is a spent declaration or offer
 * link (the only door that spends one is a signature), issued for the pass's own participant and
 * its origin registration, at the pass's event. Reads only — a GET may call it.
 */
export async function familyPassHolds<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  pass: FamilySigningPass,
  now: Date,
): Promise<boolean> {
  const scope =
    (await readSpentActionTokenScope(db, { secret, purpose: "COMPLETE_DECLARATION", now })) ??
    (await readSpentActionTokenScope(db, { secret, purpose: "WAITLIST_OFFER", now }));
  if (!scope || scope.participantId !== pass.participantId || scope.registrationId !== pass.originId) return false;
  const [origin] = await db
    .select({ eventId: registrations.eventId })
    .from(registrations)
    .where(and(eq(registrations.id, pass.originId), eq(registrations.participantId, pass.participantId)))
    .limit(1);
  return origin?.eventId === pass.eventId;
}

/** Every registration of one address at one event — the wizard's rows, whatever their state. */
export async function listFamilySigningRows<T extends Record<string, unknown>>(
  db: Database<T>,
  participantId: string,
  eventId: string,
): Promise<FamilySigningRow[]> {
  return db
    .select({
      id: registrations.id,
      registeredName: registrations.registeredName,
      status: registrations.status,
      createdAt: registrations.createdAt,
    })
    .from(registrations)
    .where(and(eq(registrations.participantId, participantId), eq(registrations.eventId, eventId)))
    .orderBy(registrations.createdAt, registrations.id);
}
