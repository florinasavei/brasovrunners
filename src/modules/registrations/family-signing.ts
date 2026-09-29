import { and, eq, inArray, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { readActionTokenContext, readSpentActionTokenScope } from "@/modules/action-tokens/repository";
import { env } from "@/shared/config/env";
import {
  currentFamilyStep,
  FAMILY_PASS_MINUTES,
  type FamilySigningRow,
  type FamilyStep,
  familyPassExpiresAt,
  familySigningSteps,
} from "./domain/family-signing";
import { withFamilyRank } from "./domain/family-sitting";
import { sittingOrderFor } from "./family-sitting";
import { openFormDraft, purposeSecret, sealFormDraft } from "./form-draft";

/**
 * The pass that carries the family's declarations from one person to the next (§471).
 *
 * AGENTS.md §13.2, step 4: the server "consumes the token or exchanges it for a short-lived,
 * purpose-limited HTTP-only action session". The pass is that session, held by the browser sealed
 * rather than in a table — a deliberate choice, argued in the decision: it is a few ids, it never
 * outlives the holds it serves, and every press re-reads the rows and the token it is bound to, so
 * nothing it says is trusted beyond "these are the people this browser was walking through".
 *
 * - **sealed** (AES-256-GCM under the deployment's secret bound to this purpose, the form draft's
 *   sealing, `purposeSecret`), `httpOnly`, `sameSite=lax`, and sent only to its link's own page;
 * - **bound** to a secret the server re-reads at every use (`familyPassHolds`): the opened
 *   declaration link — spent by its own signature, or still live when its own person was put off
 *   with «Semnez mai târziu» — or the «Înscrierile mele» link it was exchanged for on that page
 *   (§77), still live. A pass copied out of the browser is nothing without the email;
 * - **bound to the people**: the registration ids on the address at the event when it was issued
 *   (`eligibleIds`) and nobody added later; each press signs only the step that is current;
 * - **short-lived**: {@link FAMILY_PASS_MINUTES} after the last press and never past the earliest
 *   hold still running among the people left to sign (`familyPassExpiresAt`);
 * - **ended by the last step**: once no step is current the pass is `done` — it still lists who was
 *   signed on the last screen, and it signs and skips nobody.
 *
 * Nothing about a person goes in the URL (§14.5): the pass is the only memory of which people were
 * signed or put off on this device, and the page reads the rest from the rows.
 */

/**
 * One cookie per language, each on its own page's path (§547, found walking the family on a
 * production build): a response keeps one cookie per name, so two writes of one name on two paths
 * left only the last — the English page's — and the Romanian wizard's second press arrived with no
 * pass. The same sealed value under a name per locale; a request only ever carries its own page's.
 */
const COOKIE = "br_family_sign";
const cookieName = (locale: string) => `${COOKIE}_${locale}`;
const PURPOSE = "family-signing";

/**
 * What the pass is bound to: the opened declaration link (`link`), the «Înscrierile mele» link it was
 * exchanged for (`mine`), or the family message's one link (`family`, §519), spent by the press that
 * confirmed the family and opened the wizard.
 */
export type FamilyPassBinding = "link" | "mine" | "family";

export type FamilySigningPass = {
  binding: FamilyPassBinding;
  participantId: string;
  eventId: string;
  /** The registration whose emailed link was opened; null when the wizard began on «Înscrierile mele». */
  originId: string | null;
  /** The people the wizard walks through, fixed when the pass was issued. */
  eligibleIds: string[];
  /** Everybody signed through this pass, in the order they signed — the origin included. */
  signedIds: string[];
  /** «Semnez mai târziu»: shown, never current; their own emailed link still signs them. */
  skippedIds: string[];
  /** No step is current: the pass lists, and signs nobody. */
  done: boolean;
  expiresAt: Date;
};

export function sealFamilyPass(pass: FamilySigningPass, secret = purposeSecret(PURPOSE)): string | null {
  return sealFormDraft(
    {
      b: pass.binding,
      p: pass.participantId,
      e: pass.eventId,
      o: pass.originId ?? "",
      l: pass.eligibleIds.join(","),
      s: pass.signedIds.join(","),
      k: pass.skippedIds.join(","),
      d: pass.done ? "1" : "0",
      x: String(pass.expiresAt.getTime()),
    },
    secret,
  );
}

const ids = (value: string | undefined) => (value ?? "").split(",").filter(Boolean);

/** The pass, when it opens under this deployment's key and has not lapsed; null otherwise. */
export function openFamilyPass(sealed: string, now: Date, secret = purposeSecret(PURPOSE)): FamilySigningPass | null {
  const opened = openFormDraft(sealed, secret);
  if (!opened?.p || !opened.e || !opened.x || (opened.b !== "link" && opened.b !== "mine" && opened.b !== "family")) return null;
  const expiresAt = new Date(Number(opened.x));
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) return null;
  const originId = opened.o || null;
  // A link's pass always names its link's person; a pass from «Înscrierile mele» or the family message never does.
  if ((opened.b === "link") !== (originId !== null)) return null;
  return {
    binding: opened.b,
    participantId: opened.p,
    eventId: opened.e,
    originId,
    eligibleIds: ids(opened.l),
    signedIds: ids(opened.s),
    skippedIds: ids(opened.k),
    done: opened.d === "1",
    expiresAt,
  };
}

/** The pass's own page, in every language: where it travels, and nowhere else — one cookie name per page. */
function passCookies(token: string): { name: string; path: string }[] {
  return routing.locales.map((locale) => ({
    name: cookieName(locale),
    path: getPathname({ locale, href: { pathname: "/registrations/declare/[token]", params: { token } } }),
  }));
}

export async function readFamilySigningPass(now: Date): Promise<FamilySigningPass | null> {
  const jar = await cookies();
  // The request carries only its own page's cookie (its path), whichever language that is.
  for (const locale of routing.locales) {
    const sealed = jar.get(cookieName(locale))?.value;
    const pass = sealed ? openFamilyPass(sealed, now) : null;
    if (pass) return pass;
  }
  return null;
}

/** Give the browser the pass, or its next state after a press. */
export async function writeFamilySigningPass(pass: FamilySigningPass, token: string, now: Date): Promise<void> {
  const sealed = sealFamilyPass(pass);
  if (!sealed) return;
  const maxAge = Math.max(1, Math.ceil((pass.expiresAt.getTime() - now.getTime()) / 1000));
  const jar = await cookies();
  for (const { name, path } of passCookies(token)) {
    jar.set(name, sealed, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.APP_BASE_URL.startsWith("https://"),
      path,
      maxAge,
    });
  }
}

/**
 * Take the pass back from the browser (§471, nit found in review): the opened link's own person
 * signed on a page where no wizard follows, so a pass left from an earlier walk on this device —
 * done, or bound to another person of the address — must not stand beside the fresh signature.
 * The fresh link wins.
 */
export async function clearFamilySigningPass(token: string): Promise<void> {
  const jar = await cookies();
  for (const { name, path } of passCookies(token)) {
    jar.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: env.APP_BASE_URL.startsWith("https://"),
      path,
      maxAge: 0,
    });
  }
}

/**
 * Whether a pass belongs beside the registration the opened link names (§471, nit found in
 * review): a pass from «Înscrierile mele» never does, and a link's pass only for its own origin.
 * A live link whose pass names another person is signed as the link alone — the fresh link wins.
 */
export function passFitsLink(pass: Pick<FamilySigningPass, "binding" | "originId">, linkRegistrationId: string | null): boolean {
  return pass.binding === "link" && linkRegistrationId !== null && pass.originId === linkRegistrationId;
}

export type FamilyPassBase = Omit<FamilySigningPass, "done" | "expiresAt">;

/** What a pass carries from one press to the next: everything but its lapse and whether it is done. */
export function passBase(pass: FamilySigningPass): FamilyPassBase {
  return {
    binding: pass.binding,
    participantId: pass.participantId,
    eventId: pass.eventId,
    originId: pass.originId,
    eligibleIds: pass.eligibleIds,
    signedIds: pass.signedIds,
    skippedIds: pass.skippedIds,
  };
}

/**
 * The pass after a press: its steps read again from the rows, `done` when nobody is current, and
 * its lapse capped by the holds still running (`familyPassExpiresAt`). A pure recomputation — the
 * caller writes it.
 */
export async function nextFamilyPass<T extends Record<string, unknown>>(
  db: Database<T>,
  base: FamilyPassBase,
  now: Date,
): Promise<{ pass: FamilySigningPass; steps: FamilyStep[] }> {
  const steps = stepsOfPass(await listFamilySigningRows(db, base.participantId, base.eventId), base);
  const done = currentFamilyStep(steps) === null;
  const expiresAt = done ? new Date(now.getTime() + FAMILY_PASS_MINUTES * 60_000) : familyPassExpiresAt(steps, now);
  return { pass: { ...base, done, expiresAt }, steps };
}

function stepsOfPass(rows: readonly FamilySigningRow[], pass: Pick<FamilySigningPass, "originId" | "eligibleIds" | "signedIds" | "skippedIds">) {
  return familySigningSteps(rows, {
    originId: pass.originId,
    // The link's own person is in `signedIds` or `skippedIds` from the pass's first press on.
    originSignable: false,
    signedIds: pass.signedIds,
    skippedIds: pass.skippedIds,
    eligibleIds: pass.eligibleIds,
  });
}

/** The steps a pass walks, read from the rows now. Reads only. */
export async function familyStepsOfPass<T extends Record<string, unknown>>(db: Database<T>, pass: FamilySigningPass) {
  return stepsOfPass(await listFamilySigningRows(db, pass.participantId, pass.eventId), pass);
}

/**
 * Whether this pass is honoured beside this secret. Reads only — a GET may call it; it never
 * charges the throttle, so a caller that finds it false charges the attempt itself (§19.4, §202).
 *
 * - `link`: the secret is the origin's declaration or offer link, for the pass's participant —
 *   spent (its own signature spent it), or still live when its person was put off with
 *   «Semnez mai târziu» (then the link alone could sign that person anyway);
 * - `mine`: the secret is the participant's live «Înscrierile mele» link (§77).
 *
 * And in both, every person the pass names is a registration of that participant at that event.
 */
export async function familyPassHolds<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  pass: FamilySigningPass,
  now: Date,
): Promise<boolean> {
  if (!(await bindingHolds(db, secret, pass, now))) return false;
  if (pass.eligibleIds.length === 0) return false;
  const rows = await db
    .select({ participantId: registrations.participantId, eventId: registrations.eventId })
    .from(registrations)
    .where(inArray(registrations.id, pass.eligibleIds));
  return (
    rows.length === pass.eligibleIds.length &&
    rows.every((row) => row.participantId === pass.participantId && row.eventId === pass.eventId)
  );
}

async function bindingHolds<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  pass: FamilySigningPass,
  now: Date,
): Promise<boolean> {
  if (pass.binding === "mine") {
    const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_PROFILE", now });
    return context.ok && context.token.participantId === pass.participantId;
  }
  /*
    The family message's link (§519): spent by the press that confirmed the family and handed this
    browser the pass, for this participant, scoped to a registration of this event. Until the token's
    own lapse — the pass's half hour is always shorter.
  */
  if (pass.binding === "family") {
    const spent = await readSpentActionTokenScope(db, { secret, purpose: "REGISTER_ANOTHER_PERSON", now });
    if (!spent?.registrationId || spent.participantId !== pass.participantId) return false;
    const [anchor] = await db
      .select({ eventId: registrations.eventId })
      .from(registrations)
      .where(eq(registrations.id, spent.registrationId))
      .limit(1);
    return anchor?.eventId === pass.eventId;
  }
  if (!pass.originId || !pass.eligibleIds.includes(pass.originId)) return false;
  const matches = (scope: { participantId: string; registrationId: string | null } | null) =>
    scope !== null && scope.participantId === pass.participantId && scope.registrationId === pass.originId;

  const spent =
    (await readSpentActionTokenScope(db, { secret, purpose: "COMPLETE_DECLARATION", now })) ??
    (await readSpentActionTokenScope(db, { secret, purpose: "WAITLIST_OFFER", now }));
  if (matches(spent)) return true;
  if (!pass.skippedIds.includes(pass.originId)) return false;
  for (const purpose of ["COMPLETE_DECLARATION", "WAITLIST_OFFER"] as const) {
    const live = await readActionTokenContext(db, { secret, purpose, now });
    if (live.ok) return matches(live.token);
  }
  return false;
}

/**
 * Every registration of one address at one event — the wizard's rows, whatever their state — and
 * whether each carries a declaration acceptance (`signedBefore`: a person who signed before the
 * wizard began is a step shown as signed, §471, found in review).
 */
export async function listFamilySigningRows<T extends Record<string, unknown>>(
  db: Database<T>,
  participantId: string,
  eventId: string,
): Promise<FamilySigningRow[]> {
  const rows = await db
    .select({
      id: registrations.id,
      registeredName: registrations.registeredName,
      status: registrations.status,
      createdAt: registrations.createdAt,
      holdExpiresAt: registrations.holdExpiresAt,
      checkinCode: registrations.checkinCode,
      // The race number beside the desk code (§87, §94, §173; the owner: «aici vreau să văd și BIB-urile»).
      bibNumber: registrations.bibNumber,
      // Qualified by hand: inside a one-table select Drizzle prints a column bare, and a bare "id"
      // in the subquery would be the acceptance's own.
      declared: sql<boolean>`exists (select 1 from ${declarationAcceptances} where ${declarationAcceptances}."registration_id" = ${registrations}."id")`,
    })
    .from(registrations)
    .where(and(eq(registrations.participantId, participantId), eq(registrations.eventId, eventId)))
    .orderBy(registrations.createdAt, registrations.id);
  // In the order the family's forms were sent (§519, `compareFamilyOrder`), which `familySigningSteps` sorts by.
  return withFamilyRank(rows, await sittingOrderFor(db, participantId, eventId));
}
