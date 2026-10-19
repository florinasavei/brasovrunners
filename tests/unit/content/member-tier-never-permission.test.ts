import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §811, BR-REQ-060-01 — a member's level is a label and what the member gets, never a permission: the source-walk that
 * holds it. Only the files that give, keep, show or filter by a level may mention one; no domain file, session, door or
 * module that decides what a person may do names it. A new file that reads a level fails here until someone puts it in
 * the list below on purpose.
 */
const SRC = join(process.cwd(), "src");
const TOKEN = /memberTierId|member_tier_id|tierIds|tier_ids/;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.(ts|tsx|sql|json)$/.test(name) ? [path] : [];
  });
}

const FILES = filesUnder(SRC).map((path) => ({ path: relative(process.cwd(), path).split(sep).join("/"), text: readFileSync(path, "utf8") }));

/** The files that may name a level: the data, the lists of benefits, the team page's select and the zone. */
const MAY_NAME_A_LEVEL: RegExp[] = [
  /^src\/db\/schema\/(member-tiers|staff-users|member-discount-codes)\.ts$/,
  /^src\/db\/migrations\/(0169_member_tiers\.sql|meta\/0169_snapshot\.json)$/,
  /^src\/db\/migrations\/meta\/\d+_snapshot\.json$/,
  /^src\/modules\/content\/member-tiers\//,
  /^src\/modules\/content\/member-codes\//,
  /^src\/modules\/staff-identity\/(service|repository)\.ts$/,
  /^src\/app\/\[locale\]\/admin\/staff\/page\.tsx$/,
  /^src\/app\/\[locale\]\/admin\/pages\/members\//,
  /^src\/app\/\[locale\]\/members-area\/(codes\/page|zone)\.tsx$/,
];

describe("§811 a level is read by no door", () => {
  const naming = FILES.filter((file) => TOKEN.test(file.text));

  it("is named only by the files that give, keep, show or filter by it", () => {
    const strangers = naming.filter((file) => !MAY_NAME_A_LEVEL.some((allowed) => allowed.test(file.path))).map((file) => file.path);
    expect(strangers).toEqual([]);
    expect(naming.length).toBeGreaterThan(8);
  });

  it("is named by no role file, session, door, shop or registrations file", () => {
    const forbidden = [
      /^src\/modules\/staff-identity\/domain\//,
      /^src\/modules\/staff-identity\/session/,
      /staff-door/,
      /require-staff/i,
      /^src\/modules\/content\/shop\//,
      /^src\/modules\/registrations\//,
    ];
    const named = naming.map((file) => file.path).filter((path) => forbidden.some((pattern) => pattern.test(path)));
    expect(named).toEqual([]);
  });
});
