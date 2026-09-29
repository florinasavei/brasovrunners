import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { gitEnv } from "../../helpers/git-env";

/**
 * §501 — a cloud session (Claude Code on the web) prepares itself; a session on a developer's
 * own machine never does.
 *
 * The SessionStart hook in `.claude/settings.json` runs on every session, local ones included,
 * so the guard on `CLAUDE_CODE_REMOTE` is the whole difference between "sets up a fresh cloud
 * clone" and "starts services and rewrites nothing on the owner's Windows PC". It is checked
 * twice — in the hook's command and at the top of the script — and both are pinned here. The
 * behavioural cases run bash, so they run on Linux (CI) and are skipped on Windows, where
 * `bash` on PATH may be WSL's rather than Git Bash.
 */

type Hook = { type: string; command: string; timeout?: number };
type Settings = { hooks?: { SessionStart?: { matcher?: string; hooks: Hook[] }[] } };

const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8")) as Settings;
const sessionStart = settings.hooks?.SessionStart ?? [];
const hook = sessionStart.flatMap((entry) => entry.hooks).find((h) => h.command.includes("cloud-setup.sh"));
const script = readFileSync("scripts/cloud-setup.sh", "utf8");
const onWindows = process.platform === "win32";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** The script reads git's config; started from a hook, git's own repository variables are dropped first (§NNN). */
function envWithout(...names: string[]): NodeJS.ProcessEnv {
  const env = gitEnv();
  for (const name of names) delete env[name];
  return env;
}

describe("§501 the cloud-session hook", () => {
  it("runs scripts/cloud-setup.sh on a session's start and resume, from the project root", () => {
    expect(hook, "a SessionStart command hook naming scripts/cloud-setup.sh").toBeDefined();
    const entry = sessionStart.find((e) => e.hooks.includes(hook as Hook));
    expect(entry?.matcher?.split("|")).toEqual(expect.arrayContaining(["startup", "resume"]));
    expect(hook?.type).toBe("command");
    expect(hook?.command).toContain('"$CLAUDE_PROJECT_DIR/scripts/cloud-setup.sh"');
  });

  it("exits before the script unless CLAUDE_CODE_REMOTE is true", () => {
    expect(hook?.command.startsWith('[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0;')).toBe(true);
  });

  it("the script guards itself the same way before its first action", () => {
    const guard = script.indexOf('if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]');
    expect(guard).toBeGreaterThan(-1);
    for (const action of ["corepack", "yarn install", "service postgresql", ".env.local.tmp", "db:migrate"]) {
      expect(script.indexOf(action), action).toBeGreaterThan(guard);
    }
  });

  it("carries no credential but the local one docker-compose.yml already publishes", () => {
    const passwords = [...script.matchAll(/DB_PASSWORD="([^"]*)"/g)].map((m) => m[1]);
    expect(passwords).toEqual(["local_only_not_a_secret"]);
    expect(script).not.toMatch(/postgres(?:ql)?:\/\/[^\s$]+@(?!localhost)/);
  });

  it("is checked out with LF endings everywhere, Windows included", () => {
    expect(readFileSync(".gitattributes", "utf8")).toMatch(/^\*\.sh text eol=lf$/m);
    expect(script).not.toContain("\r");
  });

  it.skipIf(onWindows)("does nothing and says nothing outside a cloud session", () => {
    const result = spawnSync("bash", ["scripts/cloud-setup.sh"], {
      env: envWithout("CLAUDE_CODE_REMOTE"),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it.skipIf(onWindows)("the hook's command reaches the script only when CLAUDE_CODE_REMOTE=true", () => {
    const project = mkdtempSync(path.join(tmpdir(), "cloud-hook-"));
    scratch.push(project);
    mkdirSync(path.join(project, "scripts"));
    writeFileSync(path.join(project, "scripts", "cloud-setup.sh"), "echo ran\n");
    const run = (remote: string | undefined) =>
      spawnSync("bash", ["-c", hook?.command ?? "false"], {
        env: { ...envWithout("CLAUDE_CODE_REMOTE"), CLAUDE_PROJECT_DIR: project, ...(remote ? { CLAUDE_CODE_REMOTE: remote } : {}) },
        encoding: "utf8",
      });
    expect(run(undefined)).toMatchObject({ status: 0, stdout: "" });
    expect(run("false")).toMatchObject({ status: 0, stdout: "" });
    expect(run("true")).toMatchObject({ status: 0, stdout: "ran\n" });
  });
});
