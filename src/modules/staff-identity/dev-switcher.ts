import { eq } from "drizzle-orm";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { DomainError } from "@/shared/errors/domain-error";
import { env } from "@/shared/config/env";
import type { StaffRole } from "./domain/roles";

/**
 * The development staff switcher (AGENTS.md §13.1).
 *
 * Real staff sign-in is Auth.js with the Zitadel provider (DECISIONS.md §26), which most
 * developer machines have no tenant for. A developer, and the end-to-end suite, still need a
 * way to *be* an Author or an Editor, so §13.1 permits a seeded switcher with four conditions:
 * unavailable in qa and production,
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

/** One key per role. `role-boundaries.test.ts` asserts the set matches `STAFF_ROLES`. */
export type DevIdentityKey = "contributor" | "moderator" | "dev" | "admin" | "superadmin";

type DevIdentity = {
  key: DevIdentityKey;
  zitadelSubject: string;
  email: string;
  displayName: string;
  role: StaffRole;
};

export const DEV_IDENTITIES: readonly DevIdentity[] = [
  /**
   * One per role, and the test in `role-boundaries.test.ts` holds it to that: a role with no
   * identity here is a role nobody can exercise locally, which is how a permission boundary
   * goes untested until it is wrong in production.
   */
  {
    key: "contributor",
    zitadelSubject: `${DEV_SUBJECT_PREFIX}contributor`,
    email: "dev-contributor@dev.test",
    displayName: "Dev Contributor",
    role: "CONTRIBUTOR",
  },
  {
    key: "moderator",
    zitadelSubject: `${DEV_SUBJECT_PREFIX}moderator`,
    email: "dev-moderator@dev.test",
    displayName: "Dev Moderator",
    role: "MODERATOR",
  },
  {
    key: "dev",
    zitadelSubject: `${DEV_SUBJECT_PREFIX}dev`,
    email: "dev-dev@dev.test",
    displayName: "Dev Technical",
    role: "DEV",
  },
  {
    key: "admin",
    zitadelSubject: `${DEV_SUBJECT_PREFIX}admin`,
    email: "dev-admin@dev.test",
    displayName: "Dev Administrator",
    role: "ADMIN",
  },
  {
    key: "superadmin",
    zitadelSubject: `${DEV_SUBJECT_PREFIX}superadmin`,
    email: "dev-superadmin@dev.test",
    displayName: "Dev Superadministrator",
    role: "SUPERADMIN",
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
 *
 * Subject first, then email, then create — the same order `resolveZitadelSignIn` uses for the
 * real provider, and for the same reason: a database can hold a row that already claims this
 * synthetic address with no subject bound yet (an invited-but-unbound row is exactly that
 * shape, and so, incidentally, is a row a schema migration had to unbind — `DECISIONS.md`
 * §26's rename left exactly one such row on a database that had signed in under the old
 * column). `ON CONFLICT` on the subject alone cannot see that case: the row it would collide
 * with has no subject to conflict on, so the insert fails on the *email* constraint instead.
 * Looking the row up by email first and binding it is what a real sign-in already has to do,
 * and doing the same here does not silently reset a role a developer changed to try something
 * — it only ever sets the subject and the sign-in timestamp.
 */
export async function ensureDevStaffUser<T extends Record<string, unknown>>(
  db: Database<T>,
  key: DevIdentityKey,
  now: Date = new Date(),
): Promise<StaffUser> {
  assertDevStaffSwitcherEnabled();

  const identity = DEV_IDENTITIES.find((candidate) => candidate.key === key);
  if (!identity) throw new DomainError("VALIDATION_ERROR", `unknown development identity: ${key}`);

  const [bySubject] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.zitadelSubject, identity.zitadelSubject))
    .limit(1);
  if (bySubject) return bySubject;

  const [byEmail] = await db.select().from(staffUsers).where(eq(staffUsers.email, identity.email)).limit(1);
  if (byEmail) {
    const [bound] = await db
      .update(staffUsers)
      .set({ zitadelSubject: identity.zitadelSubject, firstSignedInAt: now, updatedAt: now })
      .where(eq(staffUsers.id, byEmail.id))
      .returning();
    return bound;
  }

  /**
   * `onConflictDoNothing` and a re-read, rather than a bare insert.
   *
   * Two browsers signing in as the same synthetic identity in the same instant is not
   * hypothetical: it is what `yarn test:e2e` does on a freshly reset database, where both
   * Playwright projects reach this line before either has committed. A unique violation there
   * is not a bug in anybody's code — it is the second one losing a race it should simply
   * rejoin.
   */
  const [created] = await db
    .insert(staffUsers)
    .values({
      zitadelSubject: identity.zitadelSubject,
      email: identity.email,
      displayName: identity.displayName,
      role: identity.role,
      firstSignedInAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [raced] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.email, identity.email))
    .limit(1);
  if (raced) return raced;

  throw new DomainError("CONFLICT", `could not sign in as the ${key} development identity`);
}
