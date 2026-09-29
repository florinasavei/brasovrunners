import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GIT_REPOSITORY_VARIABLES, gitEnv } from "../../helpers/git-env";

/**
 * §553 — a hook strips git's own environment before it runs anything that may spawn git, and a test
 * that spawns git in a throwaway fixture strips it again.
 *
 * The incident, 2026-09-28: `.githooks/pre-commit` runs `yarn check`; git had exported `GIT_DIR`
 * and `GIT_INDEX_FILE` into the hook, and `release-from-branch.test.ts` inherited them — the
 * fixture's `git init` re-initialised the repository being committed, its `git add` / `git rm`
 * left 1 942 staged deletions in the committing worktree's index, and a later run set
 * `core.bare=true` in the main checkout's config.
 */
const HOOK_VARIABLES = ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX"];

describe("§553 the hooks forget git's own environment first", () => {
  it.each(["pre-commit", "pre-push"])(".githooks/%s unsets the four variables before any command", (name) => {
    const hook = readFileSync(path.join(".githooks", name), "utf8");
    const lines = hook.split(/\r?\n/);
    const unset = lines.findIndex((line) => /^unset\s/.test(line));
    expect(unset, "an `unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX` line").toBeGreaterThan(0);
    expect(lines[unset].split(/\s+/).slice(1).sort()).toEqual([...HOOK_VARIABLES].sort());
    // Before the first line that runs something: only comments and blank lines above it.
    const commands = lines.slice(1, unset).filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
    expect(commands).toEqual([]);
  });
});

describe("§553 gitEnv — the environment for a git a test spawns", () => {
  const polluted: Record<string, string | undefined> = {
    PATH: "/usr/bin",
    GIT_DIR: "/the/committing/repo/.git",
    GIT_INDEX_FILE: "/the/committing/repo/.git/index.lock",
    GIT_WORK_TREE: "/the/committing/repo",
    GIT_PREFIX: "src/",
    GIT_COMMON_DIR: "/the/committing/repo/.git",
    GIT_OBJECT_DIRECTORY: "/the/committing/repo/.git/objects",
    GIT_ALTERNATE_OBJECT_DIRECTORIES: "/elsewhere/objects",
    GIT_AUTHOR_NAME: "kept",
  };

  it("drops every variable that tells git which repository it is in, and keeps the rest", () => {
    const env = gitEnv({}, polluted);
    for (const name of [...HOOK_VARIABLES, ...GIT_REPOSITORY_VARIABLES]) expect(env, name).not.toHaveProperty(name);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.GIT_AUTHOR_NAME).toBe("kept");
  });

  it("adds the caller's variables, and never lets one of them bring a repository back", () => {
    const env = gitEnv({ GITHUB_OUTPUT: "/tmp/out", GIT_DIR: "/again" }, polluted);
    expect(env.GITHUB_OUTPUT).toBe("/tmp/out");
    expect(env).not.toHaveProperty("GIT_DIR");
  });

  it("does not touch the environment it copies", () => {
    gitEnv({}, polluted);
    expect(polluted.GIT_DIR).toBe("/the/committing/repo/.git");
  });

  it("is what every test that spawns git passes", () => {
    const files = readdirSync("tests", { recursive: true, encoding: "utf8" })
      .map((file) => file.split(path.sep).join("/"))
      .filter((file) => /\.test\.ts$/.test(file) && !file.endsWith("hook-git-env.test.ts"));
    // git itself, and node or bash, which run the scripts that run git.
    const call = /\b(?:spawnSync|execFileSync|execSync|spawn|execFile|exec)\(\s*"(?:git|node|bash)"/g;
    const spawning = files.filter((file) => new RegExp(call.source).test(readFileSync(path.join("tests", file), "utf8")));
    expect(spawning.length).toBeGreaterThan(0);
    for (const file of spawning) {
      const text = readFileSync(path.join("tests", file), "utf8");
      expect(text, `${file} spawns a process that may run git: build its env with gitEnv()`).toMatch(/\bgitEnv\(/);
      expect(text, `${file} hands a child process.env as it is`).not.toMatch(/env:\s*\{\s*\.\.\.process\.env/);
      // Every call names its env: without one, the child inherits process.env as it is.
      for (const found of text.matchAll(call)) {
        const options = text.slice(found.index, text.indexOf("})", found.index) + 2);
        expect(options, `${file}: ${found[0]} without an env`).toMatch(/\benv\b/);
      }
    }
  });
});
