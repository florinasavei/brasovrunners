#!/usr/bin/env node
/**
 * Where everything stands, for the session that takes over (§688) — the first command a session
 * runs when another one stopped: out of credits, past a usage limit, a laptop closed, a phone gone.
 *
 * Usage: yarn handoff            # prints a Markdown status to paste or read
 *
 * Read-only. It fetches `origin` and prints:
 *   1. the baseline `main` (production) and `qa` carry, from CLAUDE.md's first lines;
 *   2. the open pull requests (GitHub's public API; skipped, said so, when it does not answer);
 *   3. every remote branch with commits `qa` does not have — its last commit, whether it carries
 *      its `.release/<branch>.json` entry, and the migrations it adds;
 *   4. the next free migration number across `qa` and those branches, so two branches never claim
 *      the same one again (2026-10-10: two sessions each wrote a `0134`);
 *   5. every local worktree with uncommitted or unpushed work — the one place a stopped session's
 *      work can still be lost.
 *
 * It needs nothing but git and node; no token, no hostname (the repository's owner/name are read
 * from the `origin` remote).
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

function git(...args) {
  const run = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return run.status === 0 ? run.stdout.trim() : "";
}

function baselineOf(ref) {
  const head = git("show", `${ref}:CLAUDE.md`).split("\n").slice(0, 5).join("\n");
  return /`(BR-V[0-9.]+-\d{4}-\d{2}-\d{2})`/.exec(head)?.[1] ?? "unknown";
}

function migrationsAdded(ref) {
  return git("diff", "--name-only", "--diff-filter=A", `origin/qa...${ref}`, "--", "src/db/migrations")
    .split("\n")
    .filter((file) => /^src\/db\/migrations\/\d{4}_.*\.sql$/.test(file))
    .map((file) => file.replace("src/db/migrations/", ""));
}

function highestMigration(ref) {
  const names = git("ls-tree", "--name-only", `${ref}:src/db/migrations`).split("\n");
  return Math.max(0, ...names.map((name) => Number(/^(\d{4})_/.exec(name)?.[1] ?? 0)));
}

function repositorySlug() {
  const url = git("remote", "get-url", "origin");
  return /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url)?.[1] ?? /\/git\/([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url)?.[1] ?? null;
}

function listed(pulls) {
  return Array.isArray(pulls) ? pulls.map((pull) => `#${pull.number} \`${pull.head.ref}\` → \`${pull.base.ref}\` — ${pull.title}`) : null;
}

/** Node's fetch first; curl when fetch cannot reach GitHub (a sandbox whose proxy only curl honours). */
async function openPullRequests(slug) {
  if (!slug) return null;
  const url = `https://api.github.com/repos/${slug}/pulls?state=open&per_page=50`;
  try {
    const answer = await fetch(url, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) });
    if (answer.ok) return listed(await answer.json());
  } catch {
    // fall through to curl
  }
  const curl = spawnSync("curl", ["-sf", "--max-time", "10", "-H", "accept: application/vnd.github+json", url], { encoding: "utf8" });
  try {
    return curl.status === 0 ? listed(JSON.parse(curl.stdout)) : null;
  } catch {
    return null;
  }
}

function slugOf(branch) {
  return branch.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "");
}

function unmergedBranches() {
  const refs = git("for-each-ref", "--sort=-committerdate", "--format=%(refname:short)\t%(committerdate:iso)", "refs/remotes/origin").split("\n");
  const rows = [];
  for (const line of refs) {
    const [ref, date] = line.split("\t");
    if (!ref || ref === "origin/HEAD" || ref === "origin/qa" || ref === "origin/main" || ref === "origin") continue;
    const ahead = Number(git("rev-list", "--count", "--no-merges", `origin/qa..${ref}`) || 0);
    if (ahead === 0) continue;
    const branch = ref.replace(/^origin\//, "");
    const entry = `.release/${slugOf(branch)}.json`;
    const hasEntry = git("ls-tree", "--name-only", ref, entry) !== "";
    rows.push({ branch, date, ahead, subject: git("log", "-1", "--format=%s", ref), hasEntry, migrations: migrationsAdded(ref) });
  }
  return rows;
}

function dirtyWorktrees() {
  const rows = [];
  for (const block of git("worktree", "list", "--porcelain").split("\n\n")) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? "(detached)";
    if (!path) continue;
    const changed = spawnSync("git", ["-C", path, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" })
      .stdout.split("\n")
      .filter((line) => line && !/ node_modules$| public\/flags\/$/.test(line)).length;
    // Merged into qa already (its remote branch deleted after the merge): nothing of it can be lost.
    const merged = spawnSync("git", ["-C", path, "merge-base", "--is-ancestor", "HEAD", "origin/qa"]).status === 0;
    const upstream = spawnSync("git", ["-C", path, "rev-list", "--count", `origin/${branch}..HEAD`], { encoding: "utf8" });
    const unpushed = merged ? 0 : upstream.status === 0 ? Number(upstream.stdout.trim() || 0) : branch === "(detached)" ? 0 : -1;
    if (changed > 0 || unpushed !== 0) rows.push({ path, branch, changed, unpushed });
  }
  return rows;
}

git("fetch", "--quiet", "--prune", "origin");
const branches = unmergedBranches();
const pulls = await openPullRequests(repositorySlug());
const next = Math.max(highestMigration("origin/qa"), ...branches.flatMap((row) => row.migrations.map((name) => Number(name.slice(0, 4))))) + 1;
const claimed = new Map();
for (const row of branches) for (const name of row.migrations) claimed.set(name.slice(0, 4), [...(claimed.get(name.slice(0, 4)) ?? []), row.branch]);

const out = [];
out.push(`# Handoff — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "");
out.push(`- **Production (\`main\`):** \`${baselineOf("origin/main")}\``);
out.push(`- **QA (\`qa\`):** \`${baselineOf("origin/qa")}\`${git("rev-list", "--count", "origin/main..origin/qa") === "0" ? " — the same as production" : " — ahead of production: a release waits for the owner's «prod»"}`);
out.push(`- **Next free migration number:** \`${String(next).padStart(4, "0")}\``, "");
out.push("## Open pull requests", "");
out.push(...(pulls === null ? ["- (GitHub did not answer; list them by hand)"] : pulls.length ? pulls.map((line) => `- ${line}`) : ["- none"]), "");
out.push("## Branches with work `qa` does not have", "");
if (!branches.length) out.push("- none");
for (const row of branches) {
  const flags = [row.hasEntry ? "release entry ✓" : "**no release entry**", row.migrations.length ? `migrations: ${row.migrations.join(", ")}` : null].filter(Boolean).join(" · ");
  out.push(`- \`${row.branch}\` — ${row.ahead} commit(s), last ${row.date.slice(0, 16)}: ${row.subject} · ${flags}`);
}
const clashes = [...claimed].filter(([, owners]) => owners.length > 1);
if (clashes.length) out.push("", ...clashes.map(([number, owners]) => `- **Migration ${number} is claimed by ${owners.length} branches** (${owners.join(", ")}): renumber the later one at batch time.`));
out.push("", "## Local work not on GitHub", "");
const dirty = dirtyWorktrees();
if (!dirty.length) out.push("- none: every worktree is clean and pushed");
for (const row of dirty) out.push(`- \`${row.path}\` (\`${row.branch}\`): ${row.changed} uncommitted file(s)${row.unpushed > 0 ? `, ${row.unpushed} unpushed commit(s)` : row.unpushed < 0 ? ", never pushed" : ""}`);
out.push("", "Next: read `docs/QUEUE.md` § «Where things stand» and `docs/DISPATCHER.md` § «When a session stops».");
process.stdout.write(`${out.join("\n")}\n`);
