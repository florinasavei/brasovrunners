import { asc, eq, sql } from "drizzle-orm";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { StaffRole } from "./domain/roles";

/**
 * Reading and writing `staff_users` (AGENTS.md §12.1).
 *
 * Every function takes the database rather than reaching for a module-level connection, so
 * the same code runs against the application pool, against PGlite in tests, and inside a
 * transaction when one is open.
 */

/** The allowlist key. Lowercased once, here, so no caller has to remember to. */
export function normalizeStaffEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findStaffUserById<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<StaffUser | undefined> {
  const [row] = await db.select().from(staffUsers).where(eq(staffUsers.id, id)).limit(1);
  return row;
}

export async function findStaffUserByEmail<T extends Record<string, unknown>>(
  db: Database<T>,
  email: string,
): Promise<StaffUser | undefined> {
  const [row] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.email, normalizeStaffEmail(email)))
    .limit(1);
  return row;
}

export async function findStaffUserByZitadelSubject<T extends Record<string, unknown>>(
  db: Database<T>,
  zitadelSubject: string,
): Promise<StaffUser | undefined> {
  const [row] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.zitadelSubject, zitadelSubject))
    .limit(1);
  return row;
}

export async function listStaffUsers<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<StaffUser[]> {
  return db.select().from(staffUsers).orderBy(asc(staffUsers.email));
}

export async function insertStaffUser<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { email: string; displayName: string; role: StaffRole; preferredLocale?: "ro" | "en" },
): Promise<StaffUser> {
  const [row] = await db
    .insert(staffUsers)
    .values({
      email: normalizeStaffEmail(input.email),
      displayName: input.displayName,
      role: input.role,
      preferredLocale: input.preferredLocale ?? "ro",
    })
    .returning();
  return row;
}

export async function updateStaffUserRole<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
  role: StaffRole,
): Promise<StaffUser | undefined> {
  const [row] = await db
    .update(staffUsers)
    .set({ role, updatedAt: new Date() })
    .where(eq(staffUsers.id, id))
    .returning();
  return row;
}

export async function deleteStaffUser<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<void> {
  await db.delete(staffUsers).where(eq(staffUsers.id, id));
}

/**
 * How many Administrators exist.
 *
 * Used to refuse the removal or demotion of the last one. Counted in the database rather than
 * by loading the list, because the answer is a number and the list is personal data.
 */
export async function countAdministrators<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(staffUsers)
    .where(eq(staffUsers.role, "ADMIN"));
  return row?.count ?? 0;
}

/**
 * Bind Zitadel's subject to an invited row, on first sign-in.
 *
 * The invitation is matched by email; the subject is what every later sign-in is matched by,
 * because an address can be reassigned inside an organization and a subject cannot
 * (AGENTS.md §13.1 step 1).
 */
export async function recordFirstSignIn<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
  zitadelSubject: string,
  now: Date,
): Promise<StaffUser | undefined> {
  const [row] = await db
    .update(staffUsers)
    .set({ zitadelSubject, firstSignedInAt: now, updatedAt: now })
    .where(eq(staffUsers.id, id))
    .returning();
  return row;
}
