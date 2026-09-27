import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The migrations' snapshot chain (§491, AGENTS.md §7.6).
 *
 * `drizzle-kit generate` diffs the schema against the newest snapshot, and refuses to run at all
 * when two snapshots name the same parent. Sibling branches that each generated on top of 0081 left
 * 0082, 0083, 0084, 0088, 0089 and 0090 all pointing at 0081's id — a fork drizzle-kit calls "a
 * collision" — and every schema change after that had to be hand-written (§483 queued the team links'
 * CHECK behind it). The chain was re-linked in journal order, and this holds it that way:
 *
 * - every journal entry has its SQL file and its snapshot, named by the tag's four digits;
 * - each snapshot's `prevId` is the snapshot before it in journal order, the first one the zero id;
 * - no two snapshots share an id, and no two tags share a number;
 * - the journal's `when` only grows — the migrator applies only entries newer than the last one
 *   applied, so an entry that sorts back in time is silently skipped on a deployed database.
 *
 * The file numbers are not the journal's `idx`: drizzle-kit names a new file by the entry count
 * (0088 sits at idx 85), so a generated file is renamed to the next number by hand, with its
 * snapshot and its journal tag — which is what these checks catch when it is not.
 */
const MIGRATIONS = "src/db/migrations";
type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };
type Snapshot = { id: string; prevId: string };

const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as Journal;
const snapshotOf = (tag: string) => JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", `${tag.slice(0, 4)}_snapshot.json`), "utf8")) as Snapshot;

describe("the migrations' snapshot chain", () => {
  it("has a SQL file and a snapshot for every journal entry, and nothing the journal does not list", () => {
    for (const entry of journal.entries) {
      expect(existsSync(path.join(MIGRATIONS, `${entry.tag}.sql`)), entry.tag).toBe(true);
      expect(existsSync(path.join(MIGRATIONS, "meta", `${entry.tag.slice(0, 4)}_snapshot.json`)), entry.tag).toBe(true);
    }
    const numbers = journal.entries.map((entry) => entry.tag.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
    const sql = readdirSync(MIGRATIONS).filter((file) => /^\d{4}_.*\.sql$/.test(file)).map((file) => file.replace(/\.sql$/, ""));
    expect(sql.sort()).toEqual(journal.entries.map((entry) => entry.tag).sort());
    const snapshots = readdirSync(path.join(MIGRATIONS, "meta")).filter((file) => file.endsWith("_snapshot.json")).map((file) => file.slice(0, 4));
    expect(snapshots.sort()).toEqual([...numbers].sort());
  });

  it("links each snapshot to the one before it in journal order, with no fork and no repeated id", () => {
    let previous = "00000000-0000-0000-0000-000000000000";
    const ids = new Set<string>();
    for (const entry of journal.entries) {
      const snapshot = snapshotOf(entry.tag);
      expect(snapshot.prevId, `${entry.tag}'s parent`).toBe(previous);
      expect(ids.has(snapshot.id), `${entry.tag}'s id is unique`).toBe(false);
      ids.add(snapshot.id);
      previous = snapshot.id;
    }
  });

  it("numbers the journal in order: idx counts up from 0, the tags' numbers and the `when`s only grow", () => {
    journal.entries.forEach((entry, index) => {
      expect(entry.idx, entry.tag).toBe(index);
      if (index === 0) return;
      const before = journal.entries[index - 1];
      expect(Number(entry.tag.slice(0, 4)), entry.tag).toBeGreaterThan(Number(before.tag.slice(0, 4)));
      expect(entry.when, entry.tag).toBeGreaterThan(before.when);
    });
  });
});
