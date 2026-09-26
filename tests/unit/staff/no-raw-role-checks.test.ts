import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-060-01, §450 — every door names a capability, never a rank.
 *
 * The Administrator runs the club and the Superadministrator the platform: which of the two may
 * do a thing is a named predicate in `domain/roles.ts` (`canWriteLegalTexts`, `canManageStaff`,
 * `canManagePlatform`, …), and the page that hides a button, the action that refuses the POST and
 * the service that refuses the call all ask that same predicate. A bare "at least ADMIN" at one of
 * them is the second answer to one question — the legal pages asked `canWriteLegalTexts` while
 * their actions asked `requireStaffRole("ADMIN")`, and nothing would have noticed the day the two
 * parted. A guard, grep-shaped on purpose: the next raw comparison is refused by the suite.
 *
 * Allowed: `domain/roles.ts` (where the ladder is written), `session.ts` (the door itself) and the
 * database schema and migrations (where the enum is). Comment lines are ignored — a sentence that
 * tells the story of the old check is not a check.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const ALLOWED = new Set(
  ["src/modules/staff-identity/domain/roles.ts", "src/modules/staff-identity/session.ts"].map((file) =>
    path.join(ROOT, file),
  ),
);
const ALLOWED_DIR = path.join(SRC, "db") + path.sep;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const ROLE = `"(?:${STAFF_ROLES.join("|")})"`;
const RAW = [
  /\brequireStaffRole\s*\(/,
  /\batLeast\s*\(/,
  new RegExp(`\\brole\\s*[!=]==?\\s*${ROLE}`),
  new RegExp(`${ROLE}\\s*[!=]==?\\s*[\\w.?]*\\brole\\b`),
];

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("{/*");
}

function offenders(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    if (ALLOWED.has(file) || file.startsWith(ALLOWED_DIR)) continue;
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (isComment(line)) return;
        if (RAW.some((pattern) => pattern.test(line))) {
          found.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${index + 1}: ${line.trim()}`);
        }
      });
  }
  return found;
}

describe("§450 no raw role checks outside roles.ts and the door", () => {
  it("no source file asks a bare rank or compares a role to a string", () => {
    expect(offenders()).toEqual([]);
  });

  it("the patterns catch what they are for", () => {
    // A guard that matches nothing guards nothing: each shape it refuses, once.
    const samples = [
      'const actor = await requireStaffRole("ADMIN");',
      'if (!atLeast(actor.role, "ADMIN")) {',
      'if (target.role === "SUPERADMIN") {',
      'role !== "SUPERADMIN" &&',
      'if ("ADMIN" === actor.role) {',
    ];
    for (const sample of samples) expect(RAW.some((pattern) => pattern.test(sample)), sample).toBe(true);
    for (const fine of ['await requireStaffCapability(canManagePlatform);', 'role: "ADMIN",', 'unregister(db, event, id, "ADMIN", now);']) {
      expect(RAW.some((pattern) => pattern.test(fine)), fine).toBe(false);
    }
  });

  it("a club setting asks one predicate at the page, the action and the service", () => {
    // What a role sees and what the server allows are one answer (BR-REQ-060-01): each settings
    // service asserts `canManageClubSettings`, the action that calls it asserts the same, and the
    // page that draws its form asks it too — never `canManageRegistrations`, which is another verb.
    const services = [
      "src/modules/notifications/email-plan.ts",
      "src/modules/contact/recipients.ts",
      "src/modules/notifications/club-notices.ts",
      "src/modules/deadlines/deadlines.ts",
      "src/modules/registrations/address-cap.ts",
      "src/modules/diagnostics/neon-plan.ts",
      "src/modules/media/older-pictures.ts",
    ];
    for (const file of services) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source, file).toMatch(/if \(!canManageClubSettings\(actor\.role\)\)/);
      expect(source, file).not.toMatch(/canManageRegistrations\(/);
    }
    const emailsPage = readFileSync(path.join(ROOT, "src/app/[locale]/admin/emails/page.tsx"), "utf8");
    expect(emailsPage).toMatch(/const mayEditEmail = canManageClubSettings\(staff\.role\);/);
    const tasksPage = readFileSync(path.join(ROOT, "src/app/[locale]/admin/tasks/page.tsx"), "utf8");
    expect(tasksPage).toMatch(/canManageClubSettings\(actor\.role\) && <OlderPicturesPanel/);
  });

  it("the door takes a predicate, not a role", () => {
    const session = readFileSync(path.join(ROOT, "src/modules/staff-identity/session.ts"), "utf8");
    expect(session).toMatch(/export async function requireStaffCapability\(capability: \(role: StaffRole\) => boolean\)/);
    expect(session).not.toMatch(/export async function requireStaffRole/);
  });
});
