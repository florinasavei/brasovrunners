import { and, desc, eq, gt, lte, notInArray } from "drizzle-orm";
import { personSessions, type PersonSession } from "@/db/schema/person-sessions";
import type { Database } from "@/db/types";
import { generateTokenSecret, hashTokenSecret, isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { env } from "@/shared/config/env";
import {
  encodeHint,
  maskAddress,
  PERSON_COOKIE,
  PERSON_HINT_COOKIE,
  PERSON_SESSION_DAYS,
  PERSON_SESSION_SECONDS,
  PERSON_SESSIONS_PER_ADDRESS,
} from "./domain/hint";

/**
 * The remembered browser (§NNN, «Vin!» part 1; the owner, 2026-10-18: «I want the flow to be super easy, also later to
 * integrate with the member zone») — a small module of its own, so the members' zone reuses it for its one-tap answers.
 *
 * After a person has proved an address once (the «Da, vin» link), their browser carries `br_person`, a secret whose
 * SHA-256 is the only thing stored. From then on a press on an event page is the address's own answer, verified, counted
 * at once. It is **not a login and not an account**: it opens the answers and nothing else — no registration, no
 * profile, no staff page (participants have no passwords, AGENTS.md §10.3).
 *
 *   rememberPerson        issues the secret, stores its hash, sets the two cookies (replacing this browser's old row).
 *   readRememberedPerson  verifies the cookie against the hash and the expiry; bumps `last_used_at`; null otherwise.
 *   refreshPerson         a remembered browser that answered is good for another year.
 *   forgetPerson          «Nu sunt eu»: deletes the row and clears both cookies.
 *
 * The cookie store is passed in (`cookies()` from `next/headers` in an action or a route, a fake in a test), so the
 * database half is testable without Next. Never the full address in a readable cookie or in the HTML: the readable
 * hint carries the masked address and the name only.
 */

/** What `cookies().get` answers: enough to read one cookie. */
export type CookieReader = { get(name: string): { value: string } | undefined };

export type CookieOptions = { httpOnly?: boolean; sameSite?: "lax" | "strict" | "none"; secure?: boolean; path?: string; maxAge?: number };

/** What `cookies()` is in an action: read, set, delete. */
export type CookieStore = CookieReader & {
  set(name: string, value: string, options?: CookieOptions): unknown;
  delete(name: string): unknown;
};

/** A remembered person, as the module hands it to a caller: the address as typed and its canonical identity. */
export type RememberedPerson = {
  sessionId: string;
  email: string;
  canonicalEmail: string;
  canonicalizationVersion: number;
  displayName: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + PERSON_SESSION_DAYS * DAY_MS);
}

function secureCookie(): boolean {
  return env.APP_BASE_URL.startsWith("https://");
}

function writeCookies(store: CookieStore, secret: string, hint: { email: string; displayName: string | null }): void {
  store.set(PERSON_COOKIE, secret, { httpOnly: true, sameSite: "lax", secure: secureCookie(), path: "/", maxAge: PERSON_SESSION_SECONDS });
  // Readable by scripts, and holding no secret: the masked address and the name.
  store.set(PERSON_HINT_COOKIE, encodeHint({ masked: maskAddress(hint.email), name: hint.displayName }), {
    httpOnly: false,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: PERSON_SESSION_SECONDS,
  });
}

function toPerson(row: PersonSession): RememberedPerson {
  return {
    sessionId: row.id,
    email: row.deliveryEmail,
    canonicalEmail: row.canonicalEmail,
    canonicalizationVersion: row.canonicalizationVersion,
    displayName: row.displayName,
  };
}

/** The secret in a cookie, or null when it is missing or not the shape we issue (never hashed, never looked up). */
function secretIn(cookies: CookieReader): string | null {
  const value = cookies.get(PERSON_COOKIE)?.value;
  return value && isWellFormedTokenSecret(value) ? value : null;
}

/**
 * Remember this browser as `person` for a year. The address is canonicalised here (a caller cannot store a raw string
 * as an identity). If the browser already carried a remembered cookie its row goes first, so one browser holds one row;
 * and an address keeps at most `PERSON_SESSIONS_PER_ADDRESS` browsers, the least recently used going.
 * Throws the canonicalizer's error on an address that is not one.
 */
export async function rememberPerson<T extends Record<string, unknown>>(
  db: Database<T>,
  cookies: CookieStore,
  person: { email: string; displayName?: string | null },
  now: Date,
): Promise<RememberedPerson> {
  const identity = canonicalizeEmail(person.email);
  const displayName = person.displayName && person.displayName.trim() !== "" ? person.displayName.trim().slice(0, 80) : null;
  const previous = secretIn(cookies);
  const secret = generateTokenSecret();
  const row = await db.transaction(async (tx) => {
    if (previous) await tx.delete(personSessions).where(eq(personSessions.secretHash, hashTokenSecret(previous)));
    const [created] = await tx
      .insert(personSessions)
      .values({
        canonicalEmail: identity.canonicalEmail,
        deliveryEmail: identity.deliveryEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        displayName,
        secretHash: hashTokenSecret(secret),
        createdAt: now,
        lastUsedAt: now,
        expiresAt: expiryFrom(now),
      })
      .returning();
    // The most recently used keep their place; an address does not collect browsers without end.
    const keep = await tx
      .select({ id: personSessions.id })
      .from(personSessions)
      .where(eq(personSessions.canonicalEmail, identity.canonicalEmail))
      .orderBy(desc(personSessions.lastUsedAt), desc(personSessions.createdAt))
      .limit(PERSON_SESSIONS_PER_ADDRESS);
    await tx.delete(personSessions).where(
      and(
        eq(personSessions.canonicalEmail, identity.canonicalEmail),
        notInArray(
          personSessions.id,
          keep.map((kept) => kept.id),
        ),
      ),
    );
    return created;
  });
  writeCookies(cookies, secret, { email: row.deliveryEmail, displayName });
  return toPerson(row);
}

/**
 * The person this browser is remembered as, or null: no cookie, a cookie that is not the shape we issue, an unknown
 * secret (forged, or forgotten) and an expired row all read the same. A hit bumps `last_used_at`.
 */
export async function readRememberedPerson<T extends Record<string, unknown>>(
  db: Database<T>,
  cookies: CookieReader,
  now: Date,
): Promise<RememberedPerson | null> {
  const secret = secretIn(cookies);
  if (!secret) return null;
  const [row] = await db
    .update(personSessions)
    .set({ lastUsedAt: now })
    .where(and(eq(personSessions.secretHash, hashTokenSecret(secret)), gt(personSessions.expiresAt, now)))
    .returning();
  return row ? toPerson(row) : null;
}

/** A remembered browser that answered is good for another year: the row's expiry and both cookies' lives move on. */
export async function refreshPerson<T extends Record<string, unknown>>(
  db: Database<T>,
  cookies: CookieStore,
  person: RememberedPerson,
  now: Date,
): Promise<void> {
  const secret = secretIn(cookies);
  if (!secret) return;
  await db
    .update(personSessions)
    .set({ expiresAt: expiryFrom(now), lastUsedAt: now })
    .where(and(eq(personSessions.id, person.sessionId), eq(personSessions.secretHash, hashTokenSecret(secret))));
  writeCookies(cookies, secret, { email: person.email, displayName: person.displayName });
}

/** «Nu sunt eu»: this browser's row goes, and both cookies are cleared. Idempotent. */
export async function forgetPerson<T extends Record<string, unknown>>(db: Database<T>, cookies: CookieStore): Promise<void> {
  const secret = secretIn(cookies);
  if (secret) await db.delete(personSessions).where(eq(personSessions.secretHash, hashTokenSecret(secret)));
  cookies.delete(PERSON_COOKIE);
  cookies.delete(PERSON_HINT_COOKIE);
}

/** The retention sweep's step: every expired row goes. Returns how many. */
export async function deleteExpiredPersonSessions<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const gone = await db.delete(personSessions).where(lte(personSessions.expiresAt, now)).returning({ id: personSessions.id });
  return gone.length;
}
