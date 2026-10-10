import { and, asc, eq, getTableColumns, inArray, ne, sql } from "drizzle-orm";
import { staffUserPermissions } from "@/db/schema/staff-user-permissions";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { STAFF_PERMISSIONS, type StaffPermission, type StaffRole } from "./domain/roles";

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

/**
 * A staff row with the permissions granted to that person (§NNN) — what the session carries, so a
 * grant-aware predicate (`canManageShop`) reads them from the actor it is handed.
 */
export type StaffAccount = StaffUser & { permissions: ReadonlySet<StaffPermission> };

/** The known permissions among those a row lists — a value the code does not know grants nothing. */
function permissionSet(listed: readonly string[] | null): ReadonlySet<StaffPermission> {
  return new Set((listed ?? []).filter((value): value is StaffPermission => (STAFF_PERMISSIONS as readonly string[]).includes(value)));
}

/** A row's grants as one array, in the same query as the row (§NNN): the session reads both at once. */
const grantedPermissions = sql<string[] | null>`(select array_agg(${staffUserPermissions.permission}) from ${staffUserPermissions} where ${staffUserPermissions.staffUserId} = ${staffUsers.id})`;

/**
 * One row by id, with its permissions — one query, re-read on every request by the session, so a
 * withdrawn grant stops at the next request as a changed role does.
 */
export async function findStaffUserById<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<StaffAccount | undefined> {
  const [row] = await db
    .select({ ...getTableColumns(staffUsers), permissions: grantedPermissions })
    .from(staffUsers)
    .where(eq(staffUsers.id, id))
    .limit(1);
  return row ? { ...row, permissions: permissionSet(row.permissions) } : undefined;
}

/** The grants of every row (§NNN), for «Echipa»: the list is the team's handful, read in one query. */
export async function listStaffPermissions<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<Map<string, ReadonlySet<StaffPermission>>> {
  const rows = await db.select().from(staffUserPermissions);
  const byPerson = new Map<string, string[]>();
  for (const row of rows) byPerson.set(row.staffUserId, [...(byPerson.get(row.staffUserId) ?? []), row.permission]);
  return new Map([...byPerson].map(([id, listed]) => [id, permissionSet(listed)]));
}

/** A grant written; `false` when it was there already (the primary key), so a second tick writes and audits nothing. */
export async function insertStaffPermission<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { staffUserId: string; permission: StaffPermission; grantedByStaffUserId: string; now: Date },
): Promise<boolean> {
  const inserted = await db
    .insert(staffUserPermissions)
    .values({ staffUserId: input.staffUserId, permission: input.permission, grantedByStaffUserId: input.grantedByStaffUserId, grantedAt: input.now })
    .onConflictDoNothing()
    .returning({ permission: staffUserPermissions.permission });
  return inserted.length > 0;
}

/** Grants removed — one, or every one a person has when `permission` is omitted; the permissions that went. */
export async function deleteStaffPermissions<T extends Record<string, unknown>>(
  db: Database<T>,
  staffUserId: string,
  permission?: StaffPermission,
): Promise<StaffPermission[]> {
  const removed = await db
    .delete(staffUserPermissions)
    .where(
      permission
        ? and(eq(staffUserPermissions.staffUserId, staffUserId), eq(staffUserPermissions.permission, permission))
        : eq(staffUserPermissions.staffUserId, staffUserId),
    )
    .returning({ permission: staffUserPermissions.permission });
  return [...permissionSet(removed.map((row) => row.permission))];
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
export async function countSuperadministrators<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(staffUsers)
    .where(eq(staffUsers.role, "SUPERADMIN"));
  return row?.count ?? 0;
}

/**
 * How many club members have an account (§524) — the members' pages say it, as a number: the list
 * is the team page's, and personal data.
 */
export async function countMembers<T extends Record<string, unknown>>(db: Database<T>): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(staffUsers)
    .where(eq(staffUsers.role, "MEMBER"));
  return row?.count ?? 0;
}

/**
 * How many people run the club's site (§524): every account but a club member's, who signs in and
 * is no staff. `/admin/tasks` asks it for "the team is invited"; the role line is the repository's,
 * so no page compares a role by hand.
 */
export async function countBackofficeStaff<T extends Record<string, unknown>>(db: Database<T>): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(staffUsers)
    .where(ne(staffUsers.role, "MEMBER"));
  return row?.count ?? 0;
}

/** The rows behind these addresses (§524): a bulk press takes an address already a member again. */
export async function findStaffUsersAmong<T extends Record<string, unknown>>(db: Database<T>, emails: readonly string[]): Promise<StaffUser[]> {
  if (emails.length === 0) return [];
  return db
    .select()
    .from(staffUsers)
    .where(inArray(staffUsers.email, emails.map(normalizeStaffEmail)));
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

/**
 * The colleague's role, read under the row's lock in the caller's transaction (§NNN): a grant
 * checks the role it may be given to here, so a role change committing at the same moment runs
 * before or after it, never between the check and the insert (the role change takes the same
 * lock through its UPDATE and drops the grants the new role may not hold).
 */
export async function lockStaffUserRole<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<StaffUser["role"] | undefined> {
  const [row] = await db.select({ role: staffUsers.role }).from(staffUsers).where(eq(staffUsers.id, id)).for("update");
  return row?.role;
}
