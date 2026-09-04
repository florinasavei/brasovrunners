import { eq } from "drizzle-orm";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { DomainError } from "@/shared/errors/domain-error";
import { env } from "@/shared/config/env";
import type { StaffRole } from "./domain/roles";

/**
 * The development staff switcher (AGENTS.md §13.1).
 *
 * There is no staff login yet — DECISIONS.md §24 records why, and what replaces this. Until
 * then a developer, and the end-to-end suite, need a way to *be* an Author or an Editor, so
 * §13.1 permits a seeded switcher with four conditions: unavailable in qa and production,
 * server guarded, synthetic identities, and the same authorization helpers as the real thing.
 * All four are met here, and the first is met twice — the process refuses to start if this
 * mode is configured outside local and test (`shared/config/env.ts`), and every function below
 * refuses again at the moment it is called.
 *
 * The identities are synthetic and say so: their subjects are prefixed `dev:`, their addresses
 * are prefixed `dev-`, and those addresses are in `.test`, a TLD reserved by RFC 6761 that can
 * never be registered or delivered to. Nobody can mistake one for a real member of the club,
 * and no real colleague can be invited at an address that collides with one.
 */

const DEV_SUBJECT_PREFIX = "dev:";

export type DevIdentityKey = "author" | "editor" | "admin";

type DevIdentity = {
  key: DevIdentityKey;
  authSubject: string;
  email: string;
  displayName: string;
  role: StaffRole;
};

export const DEV_IDENTITIES: readonly DevIdentity[] = [
  {
    key: "author",
    authSubject: `${DEV_SUBJECT_PREFIX}author`,
    email: "dev-author@dev.test",
    displayName: "Dev Author",
    role: "AUTHOR",
  },
  {
    key: "editor",
    authSubject: `${DEV_SUBJECT_PREFIX}editor`,
    email: "dev-editor@dev.test",
    displayName: "Dev Editor",
    role: "EDITOR",
  },
  {
    key: "admin",
    authSubject: `${DEV_SUBJECT_PREFIX}admin`,
    email: "dev-admin@dev.test",
    displayName: "Dev Administrator",
    role: "ADMIN",
  },
] as const;

/** The server guard. Nothing in this file does anything unless this is true. */
export function isDevStaffSwitcherEnabled(): boolean {
  return env.STAFF_AUTH_MODE === "dev-switcher";
}

export function assertDevStaffSwitcherEnabled(): void {
  if (!isDevStaffSwitcherEnabled()) {
    throw new DomainError(
      "FORBIDDEN",
      `the development staff switcher is not available with STAFF_AUTH_MODE=${env.STAFF_AUTH_MODE}`,
    );
  }
}

/**
 * Find or create the synthetic staff user for one of the identities above.
 *
 * Created on demand rather than in the seed, so signing in works on a database that was
 * migrated but never seeded — which is what the end-to-end suite and a fresh clone both have.
 * `onConflictDoNothing` then a read, rather than an upsert that overwrites: if a developer has
 * changed the role of a dev identity in their own database to try something, re-signing in
 * should not silently put it back.
 */
export async function ensureDevStaffUser<T extends Record<string, unknown>>(
  db: Database<T>,
  key: DevIdentityKey,
  now: Date = new Date(),
): Promise<StaffUser> {
  assertDevStaffSwitcherEnabled();

  const identity = DEV_IDENTITIES.find((candidate) => candidate.key === key);
  if (!identity) throw new DomainError("VALIDATION_ERROR", `unknown development identity: ${key}`);

  await db
    .insert(staffUsers)
    .values({
      authSubject: identity.authSubject,
      email: identity.email,
      displayName: identity.displayName,
      role: identity.role,
      firstSignedInAt: now,
    })
    .onConflictDoNothing({ target: staffUsers.authSubject });

  const [row] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.authSubject, identity.authSubject))
    .limit(1);

  if (!row) throw new DomainError("NOT_FOUND", `development identity ${key} could not be created`);
  return row;
}
