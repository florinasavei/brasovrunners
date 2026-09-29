import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PLACEHOLDER } from "../../../scripts/land-entry.mjs";
import { todayIn } from "../../../scripts/land-tree.mjs";
import { gitEnv } from "../../helpers/git-env";

// An id SPECS.md does not define, built so docs:check does not read it as a reference.
const UNKNOWN = ["BR", "REQ", "099", "09"].join("-");

/**
 * §535 — the landing and the merge run end to end on a throwaway repository, the way
 * `.github/workflows/release.yml` runs them: `yarn batch:merge origin/qa`, then
 * `yarn docs:land --tree --apply`. The baselines are invented (V9.x): a landing bumps every
 * literal of the current one, this file included.
 */
const LAND = path.resolve("scripts/land-batch.mjs");
const MERGE = path.resolve("scripts/merge-branches.mjs");
// The scripts commit (a merge); a CI runner has no git identity of its own. Every git here, and every
// script that runs one, gets an environment without git's own repository variables, or a run from
// the pre-commit hook points the fixture's git at the repository being committed (§553).
const ENV = gitEnv({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" });
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "br-release-"));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      encoding: "utf8",
      env: ENV,
    });
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  const read = (file: string) => readFileSync(path.join(dir, file), "utf8");
  git("init", "-q", "-b", "qa");
  // The scripts' own git calls read the repository's config: no line-ending conversion here either.
  git("config", "core.autocrlf", "false");
  return { dir, git, put, read };
}

describe("§535 yarn docs:land --tree lands the facts a branch carries", () => {
  it("bumps the baseline, numbers the section, the bullet, the criterion and the code, writes the hand steps and deletes the entry", () => {
    const { dir, git, put, read } = repo();
    const from = "BR-V9.40-2031-01-01";
    put("CLAUDE.md", `**Baseline \`${from}\`**\n\n- **Batch 7 (2031-01-01, \`BR-V9.40\`):** old (§12).\n- \`/admin/tasks\`: what the club still owes\n`);
    put("DECISIONS.md", `<!-- PROJECT_BASELINE: ${from} -->\n\n**Baseline \`${from}\`**\n\n## 12. Old\n\nOld body.\n\nBaseline \`${from}\`.\n`);
    put("CHANGELOG.md", `# Changelog\n\n## ${from}\n\n- old §12.\n`);
    put("SPECS.md", "#### BR-REQ-041-01 Pages\n\n1. First.\n\n**Verification:** tests.\n");
    put("docs/QUEUE.md", "## Released\n\n| Release | What |\n| --- | --- |\n| `BR-V9.40` | old |\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/qa", "HEAD");
    git("checkout", "-qb", "feat/night-pill");
    put("src/night.ts", `// the pill (${PLACEHOLDER})\nexport const night = 1;\n`);
    put(
      ".release/feat-night-pill.json",
      JSON.stringify({
        branch: "feat/night-pill",
        decisionsTitle: "The night pill says «Noapte»",
        decisionsSection: "**Decision.** A crescent and one word.",
        changelogLine: `- **«Noapte»** on the night pill. ${PLACEHOLDER}.`,
        specsCriteria: [{ requirement: "BR-REQ-041-01", text: `The pill reads «Noapte» (<today's date>, \`DECISIONS.md\` ${PLACEHOLDER}).` }],
        batchLine: "the night pill says «Noapte»",
      }),
    );
    git("add", "-A");
    git("commit", "-qm", "feat: the night pill");

    const output = path.join(dir, "gh-output.txt");
    const dry = spawnSync("node", [LAND, "--tree"], { cwd: dir, encoding: "utf8", env: ENV });
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("§13 ← feat/night-pill: The night pill says «Noapte»");
    expect(read("CLAUDE.md")).toContain(from); // a dry run writes nothing

    const run = spawnSync("node", [LAND, "--tree", "--apply"], { cwd: dir, encoding: "utf8", env: { ...ENV, GITHUB_OUTPUT: output } });
    expect(run.status, run.stderr).toBe(0);
    const today = todayIn();
    const to = `BR-V9.41-${today}`;
    expect(read("CLAUDE.md")).toContain(`**Baseline \`${to}\`**`);
    expect(read("CLAUDE.md")).toContain(`- **Batch 8 (${today}, \`BR-V9.41\`):** the night pill says «Noapte» (§13).`);
    expect(read("DECISIONS.md")).toContain(`<!-- PROJECT_BASELINE: ${to} -->`);
    expect(read("DECISIONS.md")).toContain(`## 13. The night pill says «Noapte»\n\n**Decision.** A crescent and one word.\n\nBaseline \`${to}\`.`);
    expect(read("DECISIONS.md")).toContain(`Old body.\n\nBaseline \`${from}\`.`); // a shipped section keeps its footer
    expect(read("CHANGELOG.md")).toContain(`## ${to}\n\n- **«Noapte»** on the night pill. §13.\n## ${from}`);
    expect(read("SPECS.md")).toContain(`2. The pill reads «Noapte» (${today}, \`DECISIONS.md\` §13).`);
    expect(read("src/night.ts")).toContain("// the pill (§13)");
    expect(read("docs/QUEUE.md")).toContain("| `BR-V9.41` | the night pill says «Noapte» (§13) |\n| `BR-V9.40` | old |");
    expect(existsSync(path.join(dir, ".release/feat-night-pill.json"))).toBe(false);
    expect(readFileSync(output, "utf8")).toBe(`from=${from}\nto=${to}\ntitle=the night pill says «Noapte»\n`);
  });

  it("with a manifest, lands the manifest's item for a branch instead of its entry, an entry-only item from the tree, and deletes both entries", () => {
    const { dir, git, put, read } = repo();
    const from = "BR-V9.40-2031-01-01";
    put("CLAUDE.md", `**Baseline \`${from}\`**\n`);
    put("DECISIONS.md", `<!-- PROJECT_BASELINE: ${from} -->\n\n**Baseline \`${from}\`**\n\n## 12. Old\n\nOld.\n`);
    put("CHANGELOG.md", `## ${from}\n\n- old.\n`);
    put("SPECS.md", "#### BR-REQ-041-01 Pages\n\n1. First.\n\n**Verification:** tests.\n");
    const facts = (branch: string, title: string) => ({ branch, decisionsTitle: title, decisionsSection: `${title}, the body.`, changelogLine: `- **${title}**. ${PLACEHOLDER}.` });
    put(".release/feat-a.json", JSON.stringify(facts("feat/a", "From the tree, not landed")));
    put(".release/feat-b.json", JSON.stringify(facts("feat/b", "B from the tree")));
    git("add", "-A");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/qa", "HEAD");
    const outside = mkdtempSync(path.join(tmpdir(), "br-manifest-"));
    dirs.push(outside);
    writeFileSync(path.join(outside, "a.json"), JSON.stringify({ impl: facts("feat/a", "A from the chain") }));
    writeFileSync(
      path.join(outside, "manifest.json"),
      JSON.stringify({ baseline: { from, to: "BR-V9.41-2031-01-02" }, date: "2031-01-02", items: [{ branch: "feat/a", chain: "a.json" }, { branch: "feat/b" }] }),
    );
    const run = spawnSync("node", [LAND, path.join(outside, "manifest.json"), "--apply"], { cwd: dir, encoding: "utf8", env: ENV });
    expect(run.status, run.stderr).toBe(0);
    const decisions = read("DECISIONS.md");
    expect(decisions).toContain("## 13. A from the chain");
    expect(decisions).toContain("## 14. B from the tree");
    expect(decisions).not.toContain("From the tree, not landed");
    expect(read("CHANGELOG.md")).toContain("## BR-V9.41-2031-01-02\n\n- **A from the chain**. §13.\n- **B from the tree**. §14.\n");
    expect(existsSync(path.join(dir, ".release/feat-a.json"))).toBe(false);
    expect(existsSync(path.join(dir, ".release/feat-b.json"))).toBe(false);
  });

  it("refuses a malformed entry before writing anything, and a branch with no entry at all", () => {
    const { dir, git, put, read } = repo();
    put("CLAUDE.md", "**Baseline `BR-V9.40-2031-01-01`**\n");
    put(".release/feat-x.json", JSON.stringify({ branch: "feat/y", decisionsTitle: "T" }));
    git("add", "-A");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/qa", "HEAD");
    const refused = spawnSync("node", [LAND, "--tree", "--to", "BR-V9.45", "--apply"], { cwd: dir, encoding: "utf8", env: ENV });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/"decisionsSection" is missing or blank/);
    expect(refused.stderr).toMatch(/named for another branch/);
    expect(read("CLAUDE.md")).toBe("**Baseline `BR-V9.40-2031-01-01`**\n");

    rmSync(path.join(dir, ".release"), { recursive: true });
    const empty = spawnSync("node", [LAND, "--tree"], { cwd: dir, encoding: "utf8", env: ENV });
    expect(empty.status).toBe(1);
    expect(empty.stderr).toMatch(/no \.release\/\*\.json on this branch/);
  });

  it("refuses, unattended, what needs a person — docsNotes and a requirement SPECS.md lacks — dry run or not, and says so in the run's summary", () => {
    const { dir, git, put, read } = repo();
    const from = "BR-V9.40-2031-01-01";
    put("CLAUDE.md", `**Baseline \`${from}\`**\n\n- \`/admin/tasks\`: what the club still owes\n`);
    put("DECISIONS.md", `<!-- PROJECT_BASELINE: ${from} -->\n\n**Baseline \`${from}\`**\n\n## 12. Old\n\nOld.\n`);
    put("CHANGELOG.md", `## ${from}\n\n- old.\n`);
    put("SPECS.md", "#### BR-REQ-041-01 Pages\n\n1. First.\n\n**Verification:** tests.\n");
    put(
      ".release/feat-x.json",
      JSON.stringify({
        branch: "feat/x",
        decisionsTitle: "X",
        decisionsSection: "Body.",
        changelogLine: `- **X**. ${PLACEHOLDER}.`,
        specsCriteria: [{ requirement: UNKNOWN, text: `Gone (<today's date>, \`DECISIONS.md\` ${PLACEHOLDER}).` }],
        docsNotes: "SETUP.md needs a paragraph",
      }),
    );
    git("add", "-A");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/qa", "HEAD");
    const summary = path.join(dir, "summary.md");
    for (const args of [["--tree"], ["--tree", "--apply"]]) {
      const run = spawnSync("node", [LAND, ...args], { cwd: dir, encoding: "utf8", env: { ...ENV, GITHUB_STEP_SUMMARY: summary } });
      expect(run.status, args.join(" ")).toBe(1);
      expect(run.stderr).toMatch(/--tree cannot land what needs a person/);
      expect(run.stderr).toMatch(/docsNotes left for a person .*SETUP\.md needs a paragraph/);
      expect(run.stderr).toContain(`a requirement SPECS.md does not have: ${UNKNOWN}`);
    }
    expect(read("CLAUDE.md")).toContain(from);
    expect(existsSync(path.join(dir, ".release/feat-x.json"))).toBe(true);
    expect(read("summary.md")).toMatch(/### The landing stopped/);
  });
});

describe("§535 yarn batch:merge resolves the conflicts every batch has, and stops on the rest", () => {
  function siblings() {
    const r = repo();
    r.put("messages/ro.json", '{\n  "Admin": {\n    "a": "A"\n  }\n}\n');
    r.put("tests/unit/a.test.ts", 'import { a } from "./x";\n\nit("base", () => {});\n');
    r.put("notes.txt", "base\n");
    r.git("add", "-A");
    r.git("commit", "-qm", "base");
    r.git("checkout", "-qb", "feat/mine");
    r.put("messages/ro.json", '{\n  "Admin": {\n    "a": "A",\n    "mine": "M"\n  }\n}\n');
    r.put("tests/unit/a.test.ts", 'import { a } from "./x";\n\nit("base", () => {});\nit("mine", () => {});\n');
    r.git("commit", "-qam", "mine");
    r.git("checkout", "-q", "qa");
    r.put("messages/ro.json", '{\n  "Admin": {\n    "a": "A",\n    "yours": "Y"\n  }\n}\n');
    r.put("tests/unit/a.test.ts", 'import { a, b } from "./x";\n\nit("base", () => {});\nit("yours", () => {});\n');
    r.git("commit", "-qam", "yours");
    r.git("checkout", "-q", "feat/mine");
    return r;
  }

  it("merges the catalogue by key and the test as the union, and commits the merge", () => {
    const { dir, git, read } = siblings();
    const run = spawnSync("node", [MERGE, "qa", "--no-probe"], { cwd: dir, encoding: "utf8", env: ENV });
    expect(run.status, run.stderr + run.stdout).toBe(0);
    expect(JSON.parse(read("messages/ro.json"))).toEqual({ Admin: { a: "A", mine: "M", yours: "Y" } });
    const test = read("tests/unit/a.test.ts");
    expect(test).toContain('import { a, b } from "./x";');
    expect(test).toContain('it("mine", () => {});');
    expect(test).toContain('it("yours", () => {});');
    expect(test).not.toMatch(/<<<<<<<|>>>>>>>/);
    expect(git("status", "--porcelain").trim()).toBe("");
    expect(git("log", "-1", "--format=%s")).toMatch(/^Merge qa into feat\/mine \(resolved by rule: /);
    // A second run finds it merged.
    expect(spawnSync("node", [MERGE, "qa", "--no-probe"], { cwd: dir, encoding: "utf8", env: ENV }).stdout).toContain("already merged qa");
  });

  // Different numbers: what the journal looks like once a same-number sibling was renumbered by hand (the test below).
  it("rebuilds the journal two sibling migrations collided in, and re-links their snapshots", () => {
    const { dir, git, put, read } = repo();
    const journal = (...entries: Array<[string, number]>) =>
      JSON.stringify({ version: "7", dialect: "postgresql", entries: entries.map(([tag, when], idx) => ({ idx, version: "7", when, tag, breakpoints: true })) }, null, 2) + "\n";
    const snapshot = (id: string, prevId: string) => JSON.stringify({ id, prevId, tables: {} }, null, 2) + "\n";
    put("src/db/migrations/0001_a.sql", "CREATE TABLE a ();\n");
    put("src/db/migrations/meta/0001_snapshot.json", snapshot("id-1", "00000000-0000-0000-0000-000000000000"));
    put("src/db/migrations/meta/_journal.json", journal(["0001_a", 1000]));
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "feat/mine");
    put("src/db/migrations/0002_mine.sql", "ALTER TABLE a ADD COLUMN m int;\n");
    put("src/db/migrations/meta/0002_snapshot.json", snapshot("id-2", "id-1"));
    put("src/db/migrations/meta/_journal.json", journal(["0001_a", 1000], ["0002_mine", 3000]));
    git("add", "-A");
    git("commit", "-qm", "mine");
    git("checkout", "-q", "qa");
    put("src/db/migrations/0003_yours.sql", "ALTER TABLE a ADD COLUMN y int;\n");
    put("src/db/migrations/meta/0003_snapshot.json", snapshot("id-3", "id-1"));
    put("src/db/migrations/meta/_journal.json", journal(["0001_a", 1000], ["0003_yours", 2000]));
    git("add", "-A");
    git("commit", "-qm", "yours");
    git("checkout", "-q", "feat/mine");

    const run = spawnSync("node", [MERGE, "qa", "--no-probe"], { cwd: dir, encoding: "utf8", env: ENV });
    expect(run.status, run.stderr + run.stdout).toBe(0);
    const merged = JSON.parse(read("src/db/migrations/meta/_journal.json"));
    expect(merged.entries.map((e: { idx: number; tag: string; when: number }) => [e.idx, e.tag, e.when])).toEqual([
      [0, "0001_a", 1000],
      [1, "0002_mine", 3000],
      [2, "0003_yours", 4000],
    ]);
    expect(JSON.parse(read("src/db/migrations/meta/0003_snapshot.json")).prevId).toBe("id-2");
    expect(git("status", "--porcelain").trim()).toBe("");
  });

  it("stops when two siblings picked the same migration number, and says to renumber one by hand", () => {
    // The real case: siblings cut from the same qa both take the next number, so both add
    // meta/0002_snapshot.json — an add/add conflict no rule resolves.
    const { dir, git, put } = repo();
    const journal = (...entries: Array<[string, number]>) =>
      JSON.stringify({ version: "7", dialect: "postgresql", entries: entries.map(([tag, when], idx) => ({ idx, version: "7", when, tag, breakpoints: true })) }, null, 2) + "\n";
    const snapshot = (id: string, prevId: string) => JSON.stringify({ id, prevId, tables: {} }, null, 2) + "\n";
    put("src/db/migrations/0001_a.sql", "CREATE TABLE a ();\n");
    put("src/db/migrations/meta/0001_snapshot.json", snapshot("id-1", "00000000-0000-0000-0000-000000000000"));
    put("src/db/migrations/meta/_journal.json", journal(["0001_a", 1000]));
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "feat/mine");
    put("src/db/migrations/0002_mine.sql", "ALTER TABLE a ADD COLUMN m int;\n");
    put("src/db/migrations/meta/0002_snapshot.json", snapshot("id-2m", "id-1"));
    put("src/db/migrations/meta/_journal.json", journal(["0001_a", 1000], ["0002_mine", 3000]));
    git("add", "-A");
    git("commit", "-qm", "mine");
    git("checkout", "-q", "qa");
    put("src/db/migrations/0002_yours.sql", "ALTER TABLE a ADD COLUMN y int;\n");
    put("src/db/migrations/meta/0002_snapshot.json", snapshot("id-2y", "id-1"));
    put("src/db/migrations/meta/_journal.json", journal(["0001_a", 1000], ["0002_yours", 2000]));
    git("add", "-A");
    git("commit", "-qm", "yours");
    git("checkout", "-q", "feat/mine");

    const run = spawnSync("node", [MERGE, "qa", "--no-probe"], { cwd: dir, encoding: "utf8", env: ENV });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/no rule resolves: .*src\/db\/migrations\/meta\/0002_snapshot\.json/);
    expect(run.stderr).toMatch(/Two branches added migration number 0002: renumber one by hand/);
    expect(existsSync(path.join(dir, ".git", "MERGE_HEAD"))).toBe(true);
  });

  it("stops on a conflict no rule resolves, names it, and leaves the merge for a person", () => {
    const { dir, git, put } = siblings();
    put("notes.txt", "mine\n");
    git("commit", "-qam", "notes mine");
    git("checkout", "-q", "qa");
    put("notes.txt", "yours\n");
    git("commit", "-qam", "notes yours");
    git("checkout", "-q", "feat/mine");
    const run = spawnSync("node", [MERGE, "qa", "--no-probe"], { cwd: dir, encoding: "utf8", env: ENV });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/no rule resolves: notes\.txt/);
    expect(existsSync(path.join(dir, ".git", "MERGE_HEAD"))).toBe(true);
  });

  /**
   * The runner installed the branch's dependencies before qa came in: when qa changed them, the
   * checks would run against the old ones. A fake `yarn` first on the PATH records what it was asked.
   */
  function withFakeYarn(dir: string) {
    const bin = path.join(dir, ".fake-bin");
    mkdirSync(bin);
    const log = path.join(dir, ".yarn-calls.txt");
    writeFileSync(path.join(bin, "yarn"), '#!/bin/sh\necho "$@" >> "$YARN_LOG"\n', { mode: 0o755 });
    writeFileSync(path.join(bin, "yarn.cmd"), '@echo %* >> "%YARN_LOG%"\r\n');
    const env: NodeJS.ProcessEnv = { ...ENV, YARN_LOG: log };
    const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[key] = `${bin}${path.delimiter}${env[key] ?? ""}`;
    const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
    return { env, calls };
  }

  it("runs yarn install --immutable after a merge that changed yarn.lock, before the checks — and not when it did not", () => {
    const { dir, git, put } = repo();
    put("package.json", '{\n  "name": "t",\n  "private": true\n}\n');
    put("yarn.lock", "# old\n");
    put("notes.txt", "base\n");
    put(".gitignore", ".fake-bin/\n.yarn-calls.txt\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "feat/mine");
    put("notes.txt", "mine\n");
    git("commit", "-qam", "mine");
    git("checkout", "-q", "qa");
    put("yarn.lock", "# new: qa added a dependency\n");
    git("commit", "-qam", "qa adds a dependency");
    git("checkout", "-q", "feat/mine");
    const { env, calls } = withFakeYarn(dir);

    const run = spawnSync("node", [MERGE, "qa", "--no-probe"], { cwd: dir, encoding: "utf8", env });
    expect(run.status, run.stderr + run.stdout).toBe(0);
    expect(run.stdout).toContain("the merges changed yarn.lock: yarn install --immutable");
    expect(calls().trim()).toBe("install --immutable");

    // A second merge that leaves the dependencies alone installs nothing.
    git("checkout", "-q", "qa");
    put("other.txt", "qa\n");
    git("add", "-A");
    git("commit", "-qm", "qa, no dependency");
    git("checkout", "-q", "feat/mine");
    const again = spawnSync("node", [MERGE, "qa", "--no-probe"], { cwd: dir, encoding: "utf8", env });
    expect(again.status, again.stderr + again.stdout).toBe(0);
    expect(again.stdout).not.toContain("yarn install");
    expect(calls().trim()).toBe("install --immutable");
  });
});
