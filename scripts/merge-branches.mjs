#!/usr/bin/env node
/**
 * Merge branches into the branch checked out, resolving the conflicts every batch has — the
 * integrate step of `docs/DISPATCHER.md`, and the first step of `.github/workflows/release.yml` (§NNN).
 *
 * Usage: yarn batch:merge <ref> [<ref> …] [--no-probe]
 *        yarn batch:merge origin/qa                       bring a branch up to date with qa
 *        yarn batch:merge feat/a feat/b feat/c            integrate a batch, in that order
 *
 * Each ref is merged with `--no-ff`; one already merged is skipped. A conflict is resolved by the
 * rules in `merge-resolve.mjs` when every conflicted path is one of:
 *
 *   - `src/db/migrations/meta/_journal.json` — rebuilt from every side's entries, in file order;
 *   - `messages/ro.json`, `messages/en.json` — a three-way merge by key, theirs winning a leaf both changed;
 *   - `tests/…` — the union of both sides' lines;
 *
 * and the merge is committed. Any other conflicted path stops the run (exit 2) with the merge left in
 * progress and the paths named: a person or a merge agent resolves it, commits, and runs the same
 * command again — merged refs are skipped, and a merge left with only rule-resolvable paths is
 * finished first.
 *
 * After the merges: the catalogues lose any key git's line merge left twice; when the journal was
 * rebuilt, the snapshots are re-linked in journal order and the newest one's content refreshed from
 * the merged schema by a throwaway `drizzle-kit generate` (skipped with `--no-probe`); and, when
 * `origin/main` is known, every migration production has must be unchanged in this tree.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import process from "node:process";
import { conflictKind, dedupeJsonKeys, mergeJson3, rebuildJournal, relinkSnapshots, shippedJournalProblems, unionConflicts } from "./merge-resolve.mjs";

const argv = process.argv.slice(2);
const PROBE = !argv.includes("--no-probe");
const refs = argv.filter((a) => !a.startsWith("--"));
if (refs.length === 0) {
  console.error("Usage: yarn batch:merge <ref> [<ref> …] [--no-probe]");
  process.exit(1);
}

const JOURNAL = "src/db/migrations/meta/_journal.json";
const MIGRATIONS = "src/db/migrations";
const META = `${MIGRATIONS}/meta`;

function stop(message, code = 2) {
  console.error(`\n  STOP: ${message}\n`);
  process.exit(code);
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const gitMay = (...args) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const eolOf = (text) => (text.includes("\r\n") ? "\r\n" : "\n");
const writeJson = (file, value, eol) => writeFileSync(file, JSON.stringify(value, null, 2).replace(/\n/g, eol) + eol);
const stage = (n, file) => {
  const r = gitMay("show", `:${n}:${file}`);
  return r.status === 0 ? r.stdout : null;
};

const branch = git("branch", "--show-current").trim() || "HEAD";
let journalRebuilt = false;

/** The conflicted paths of the merge in progress. */
const conflicted = () => git("diff", "--name-only", "--diff-filter=U").trim().split("\n").filter(Boolean);

/** Resolves every conflicted path by its rule; true when all were, false (nothing written) when one has no rule. */
function resolveAll(paths) {
  const without = paths.filter((p) => !conflictKind(p));
  if (without.length) return { ok: false, without };
  for (const file of paths) {
    const kind = conflictKind(file);
    if (kind !== "journal" && (stage(2, file) === null || stage(3, file) === null)) {
      stop(`${file}: one side deleted it and the other changed it — no rule decides that; resolve it by hand and commit`);
    }
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const eol = eolOf(current || "\r\n");
    if (kind === "journal") {
      const sides = [2, 3, 1].map((n) => stage(n, file)).map((t) => (t ? JSON.parse(t) : null));
      const tags = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.+\.sql$/.test(f)).map((f) => f.replace(/\.sql$/, ""));
      const { journal, missing, dropped } = rebuildJournal(sides, tags);
      if (missing.length) stop(`migration files with no journal entry on any side: ${missing.join(", ")}`);
      writeJson(file, journal, eol);
      journalRebuilt = true;
      console.log(`  ${file}: rebuilt, ${journal.entries.length} entries${dropped.length ? `; entries without a file dropped: ${dropped.join(", ")}` : ""}`);
    } else if (kind === "catalogue") {
      const [base, ours, theirs] = [1, 2, 3].map((n) => stage(n, file));
      if (ours === null || theirs === null) stop(`${file}: one side deleted it — resolve by hand`);
      const { merged, conflicts } = mergeJson3(base ? JSON.parse(base) : {}, JSON.parse(ours), JSON.parse(theirs));
      writeJson(file, merged, eolOf(ours));
      console.log(`  ${file}: merged by key${conflicts.length ? `; theirs won at ${conflicts.join(", ")}` : ""}`);
    } else {
      const { text, blocks } = unionConflicts(current);
      writeFileSync(file, text);
      console.log(`  ${file}: ${blocks} block(s) resolved as the union`);
    }
    git("add", "--", file);
  }
  return { ok: true };
}

// A merge a previous run left in progress: finish it when the rules can.
if (gitMay("rev-parse", "-q", "--verify", "MERGE_HEAD").status === 0) {
  const paths = conflicted();
  const { ok, without } = paths.length ? resolveAll(paths) : { ok: true };
  if (!ok) stop(`a merge is in progress with conflicts no rule resolves: ${without.join(", ")} — resolve them and commit, or git merge --abort`);
  git("commit", "--no-verify", "--no-edit", "-q");
  console.log("finished the merge left in progress");
}

for (const ref of refs) {
  if (gitMay("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).status !== 0) stop(`no such ref: ${ref}`, 9);
  if (gitMay("merge-base", "--is-ancestor", ref, "HEAD").status === 0) {
    console.log(`already merged ${ref}`);
    continue;
  }
  const message = `Merge ${ref} into ${branch}`;
  const merged = gitMay("merge", "--no-ff", "--no-verify", "-m", message, ref);
  if (merged.status === 0) {
    console.log(`merged ${ref}`);
    continue;
  }
  const paths = conflicted();
  if (paths.length === 0) stop(`git merge ${ref} failed without a conflict:\n  ${(merged.stderr || merged.stdout).trim()}`);
  console.log(`merging ${ref}: ${paths.length} conflicted path(s)`);
  const { ok, without } = resolveAll(paths);
  if (!ok) stop(`merge conflict on ${ref} that no rule resolves: ${without.join(", ")}\n  The merge is left in progress: resolve those paths, commit, and run this again (or git merge --abort).`);
  git("commit", "--no-verify", "-q", "-m", `${message} (resolved by rule: ${paths.join(", ")})`);
  console.log(`merged ${ref} — resolved by rule`);
}

// The catalogues: a key git's line merge left twice.
for (const file of ["messages/ro.json", "messages/en.json"]) {
  if (!existsSync(file)) continue;
  const { duplicates, text } = dedupeJsonKeys(readFileSync(file, "utf8"));
  if (text) {
    writeFileSync(file, text);
    console.log(`  ${file}: dropped ${duplicates.length} duplicate key(s), the last kept: ${duplicates.join(", ")}`);
  }
}
if (git("status", "--porcelain", "--", "messages").trim()) {
  git("add", "--", "messages");
  git("commit", "--no-verify", "-q", "-m", "chore(i18n): drop duplicate keys left by the merges");
}

// The snapshot chain, when the journal was rebuilt.
if (journalRebuilt) {
  const journalText = readFileSync(JOURNAL, "utf8");
  const journal = JSON.parse(journalText);
  const snapFile = (tag) => `${META}/${tag.slice(0, 4)}_snapshot.json`;
  for (const e of journal.entries) if (!existsSync(snapFile(e.tag))) stop(`no snapshot for ${e.tag}: two branches may have added the same migration number — renumber one`);
  const snaps = journal.entries.map((e) => JSON.parse(readFileSync(snapFile(e.tag), "utf8")));
  for (const i of relinkSnapshots(snaps)) {
    const file = snapFile(journal.entries[i].tag);
    writeJson(file, snaps[i], eolOf(readFileSync(file, "utf8")));
    console.log(`  relinked ${journal.entries[i].tag} → ${journal.entries[i - 1]?.tag ?? "(first)"}`);
  }
  if (PROBE) refreshNewestSnapshot(journal, journalText, snapFile);
  if (git("status", "--porcelain", "--", MIGRATIONS).trim()) {
    git("add", "--", MIGRATIONS);
    git("commit", "--no-verify", "-q", "-m", "chore(db): re-link the sibling snapshots and refresh the newest from the merged schema");
  }
}

/**
 * The newest snapshot's content from the merged schema: a throwaway `drizzle-kit generate` whose
 * files are discarded. drizzle-kit names its file by the journal's entry count, not the newest
 * number, so whatever it would overwrite is saved first and put back.
 */
function refreshNewestSnapshot(journal, journalText, snapFile) {
  const prefix = String(journal.entries.length).padStart(4, "0");
  const saved = new Map();
  for (const dir of [META, MIGRATIONS]) {
    for (const f of readdirSync(dir)) if (f.startsWith(`${prefix}_`)) saved.set(`${dir}/${f}`, readFileSync(`${dir}/${f}`));
  }
  const before = new Set([...readdirSync(MIGRATIONS).map((f) => `${MIGRATIONS}/${f}`), ...readdirSync(META).map((f) => `${META}/${f}`)]);
  spawnSync("yarn", ["drizzle-kit", "generate", "--name", "chain_probe"], { encoding: "utf8", timeout: 180_000, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  const probeSql = readdirSync(MIGRATIONS).find((f) => f.includes("chain_probe") && f.endsWith(".sql"));
  const probeSnapPath = `${META}/${prefix}_snapshot.json`;
  const probe = probeSql && existsSync(probeSnapPath) ? JSON.parse(readFileSync(probeSnapPath, "utf8")) : null;
  const sqlText = probeSql ? readFileSync(`${MIGRATIONS}/${probeSql}`, "utf8") : "";
  // Put everything back: the overwritten files, the journal, and nothing new.
  for (const [file, bytes] of saved) writeFileSync(file, bytes);
  for (const dir of [MIGRATIONS, META]) {
    for (const f of readdirSync(dir)) if (!before.has(`${dir}/${f}`) && /\.(sql|json)$/.test(f)) unlinkSync(`${dir}/${f}`);
  }
  writeFileSync(JOURNAL, journalText);
  if (!probeSql) return console.log("  snapshots: the newest already matches the merged schema");
  if (!probe) stop("the drizzle-kit probe wrote SQL but no snapshot — look before landing");
  if (/\bDROP\b/i.test(sqlText)) stop(`the drizzle-kit probe wanted to DROP something — a sibling's snapshot and its SQL disagree:\n${sqlText.trim().split("\n").slice(0, 14).join("\n")}`);
  const newest = journal.entries.at(-1).tag;
  const file = snapFile(newest);
  const current = JSON.parse(readFileSync(file, "utf8"));
  probe.id = current.id;
  probe.prevId = current.prevId;
  writeJson(file, probe, eolOf(readFileSync(file, "utf8")));
  console.log(`  snapshots: ${newest} refreshed from the merged schema; what the siblings' SQL already applies:\n${sqlText.trim().split("\n").slice(0, 14).join("\n")}`);
}

// Production's migrations, unchanged.
if (gitMay("rev-parse", "--verify", "--quiet", "origin/main^{commit}").status === 0 && existsSync(JOURNAL)) {
  const shipped = gitMay("show", `origin/main:${JOURNAL}`);
  if (shipped.status === 0) {
    const problems = shippedJournalProblems(JSON.parse(readFileSync(JOURNAL, "utf8")), JSON.parse(shipped.stdout));
    if (problems.length) stop(`the journal differs from production's:\n  ${problems.join("\n  ")}`);
    console.log("journal: every migration production has is unchanged");
  }
}
console.log(`done: ${git("log", "--oneline", "-1").trim()}`);
