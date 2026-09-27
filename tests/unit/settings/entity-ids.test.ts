import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLUB_TODO_ENTITY_ID } from "@/modules/club-todo/domain/club-todo";

/**
 * `DECISIONS.md` §483 — every club setting names itself in `audit_logs.entity_id` by a fixed id of
 * its own (`…e001`, `…e002`, …; `email-plan.ts` started the convention, §100). Three pairs of
 * settings built on the same day took the same id — the job cadence and the Neon limits (`…e007`),
 * the club's notices and the delivery timing (`…e003`), the checklist and the budget thresholds
 * (`…e00b`) — and a fourth the contact address and the translation budget (`…e00a`). Nothing reads
 * a setting's history by its id today, so the audit rows told them apart by `action`; the next
 * screen that asks "who changed this setting" would have read two settings' rows as one.
 *
 * A source walk rather than imports: the constants live beside database code, and a new setting
 * is found here without anybody remembering to add it to a list.
 */
const SRC = path.join(process.cwd(), "src");
const DECLARATION = /export const (\w+ENTITY_ID) = "([0-9a-f-]{36})";/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const declared = sourceFiles(SRC).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(DECLARATION)].map((match) => ({
    name: match[1],
    id: match[2],
    file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
  })),
);

describe("§483 every setting's audit id is its own", () => {
  it("finds the settings' ids in the source", () => {
    // A floor, not a count: the walk must be finding them, and the checklist's is one of them.
    expect(declared.length).toBeGreaterThanOrEqual(15);
    expect(declared.map((entry) => entry.id)).toContain(CLUB_TODO_ENTITY_ID);
  });

  it("gives no two settings the same id", () => {
    const byId = new Map<string, string[]>();
    for (const entry of declared) byId.set(entry.id, [...(byId.get(entry.id) ?? []), `${entry.name} (${entry.file})`]);
    const shared = [...byId.entries()].filter(([, names]) => names.length > 1);
    expect(shared).toEqual([]);
  });
});
