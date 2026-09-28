import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { timesTable, withoutWorkflow } from "../../../scripts/ship-checks.mjs";

/**
 * §NNN — one workflow ships a pull request: `.github/workflows/release.yml`, started by the label
 * `ship` or by hand. GitHub cannot run here, so the file is held to the lines that make it safe:
 * who can start it, which token writes, that nothing a person typed is pasted into a script, and
 * that it runs the same three tools the PC does.
 */
const workflow = readFileSync(".github/workflows/release.yml", "utf8").replace(/\r\n/g, "\n");
const steps = workflow.slice(workflow.indexOf("\n    steps:\n"));

describe("§NNN release.yml — who starts a release", () => {
  it("starts by hand with a PR number, or by the label ship on a pull request, nothing else", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
    expect(workflow).toMatch(/\n {2}pull_request:\n {4}types: \[labeled\]\n/);
    expect(workflow).not.toMatch(/pull_request_target|\n {2}push:|schedule:/);
    expect(workflow).toContain("github.event.label.name == 'ship'");
    // A fork's pull request is never released.
    expect(workflow).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(steps).toContain('[ "$cross" = "false" ]');
    expect(steps).toContain('[ "$base" = "qa" ]');
  });

  it("runs one release at a time and never cancels one halfway — on the job, so another label's skipped run never enters the group", () => {
    expect(workflow).not.toMatch(/\nconcurrency:/);
    const job = workflow.slice(workflow.indexOf("\n  ship:\n"), workflow.indexOf("\n    steps:\n"));
    expect(job).toMatch(/\n {4}if: >-\n/);
    expect(job).toMatch(/\n {4}concurrency:\n {6}group: release\n {6}cancel-in-progress: false\n/);
  });

  it("refuses a person without write access before anything else", () => {
    const first = steps.slice(0, steps.indexOf("\n      - name: Which pull request"));
    expect(first).toContain('gh api "repos/$GITHUB_REPOSITORY/collaborators/$ACTOR/permission" --jq .permission');
    expect(first).toMatch(/admin\|maintain\|write\) ;;/);
    expect(workflow).toContain("ACTOR: ${{ github.triggering_actor }}");
  });
});

describe("§NNN release.yml — the dry run and the summary page", () => {
  it("has a dry run, by hand only, that lands on the runner, shows the diff and pushes and ships nothing", () => {
    expect(workflow).toMatch(/\n {6}dry_run:\n {8}description: .*\n {8}required: false\n {8}type: boolean\n {8}default: false\n/);
    expect(workflow).toContain("DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run == true }}");
    expect(steps).toContain("if: env.DRY_RUN == 'true' && steps.pr.outputs.state == 'OPEN'");
    expect(steps).toContain("git show --stat HEAD");
    expect(steps).toContain("if: steps.pr.outputs.state == 'OPEN' && env.DRY_RUN != 'true'"); // the push
    const ship = steps.slice(steps.indexOf("- name: Ship\n"));
    expect(ship).toMatch(/^- name: Ship\n {8}id: ship\n {8}if: env\.DRY_RUN != 'true'\n/);
  });

  it("writes every step's outcome, and ship's timing, to the run's summary page", () => {
    expect((steps.match(/GITHUB_STEP_SUMMARY/g) ?? []).length).toBeGreaterThan(10);
    const last = steps.slice(steps.indexOf("- name: The summary"));
    expect(last).toMatch(/^- name: The summary\n {8}if: always\(\)\n/);
    for (const id of ["check", "pr", "merge", "land", "push", "ship"]) expect(last).toContain(`\${{ steps.${id}.outcome }}`);
    expect(last).toContain("timesTable");
    const table = timesTable(
      `{"release":"BR-V9.40-2031-01-01","outcome":"old"}\n` +
        JSON.stringify({ release: "BR-V9.41-2031-01-02", outcome: "stopped: a | b", totalSeconds: 125, steps: [{ name: "checks", seconds: 65 }] }) +
        "\n",
    );
    expect(table).toContain("### Ship's steps, BR-V9.41-2031-01-02 (m:ss)");
    expect(table).toContain("| checks | 1:05 |");
    expect(table).toContain("| **Total** — stopped: a / b | 2:05 |");
    expect(timesTable("")).toBe("");
  });

  it("gives ship production's baseline — main's — as the previous one, whatever qa carries", () => {
    const ship = steps.slice(steps.indexOf("- name: Ship\n"));
    expect(ship).toContain("FROM=$(git show origin/main:CLAUDE.md");
    expect(ship).not.toContain("steps.land.outputs.from");
  });
});

describe("§NNN release.yml — the token and what a person typed", () => {
  it("reads with its own token and writes only through SHIP_TOKEN, which it refuses to run without", () => {
    expect(workflow).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(workflow).not.toMatch(/: write\b/);
    expect(workflow).toContain("GH_TOKEN: ${{ secrets.SHIP_TOKEN }}");
    expect(workflow).toMatch(/uses: actions\/checkout@v4\n {8}with:\n(?: {10}.*\n)*? {10}token: \$\{\{ secrets\.SHIP_TOKEN \}\}\n/);
    expect(steps).toContain('[ -n "$GH_TOKEN" ] || missing="$missing the secret SHIP_TOKEN;"');
    expect(workflow).toContain("SHIP_PRODUCTION_URL: ${{ vars.SHIP_PRODUCTION_URL }}");
  });

  it("never pastes a title, a branch name or an input into a script — they reach it as environment variables", () => {
    const runs = [...steps.matchAll(/\n {8}run: (\|\n(?: {10}.*\n| *\n)+|.*\n)/g)].map((m) => m[1]);
    expect(runs.length).toBeGreaterThan(5);
    for (const script of runs) expect(script, script.slice(0, 80)).not.toMatch(/\$\{\{/);
  });

  it("names no host, no account and no secret value", () => {
    expect(workflow).not.toMatch(/https?:\/\/(?!docs\.github\.com)/);
    expect(workflow).not.toMatch(/ghp_|github_pat_/);
  });
});

describe("§NNN release.yml — the same tools as the PC, in order", () => {
  it("merges qa by rule, lands the tree's entries, checks the docs, pushes, then ships", () => {
    const order = [
      "yarn install --immutable",
      'git show "origin/qa:scripts/$f" > "$RUNNER_TEMP/land/$f"',
      'node "$RUNNER_TEMP/land/merge-branches.mjs" origin/qa',
      "node scripts/land-batch.mjs --tree --apply",
      "yarn docs:check",
      "git commit --no-verify",
      'git push origin "HEAD:$HEAD_REF"',
      'node scripts/ship.mjs "$PR" "$TO" "$FROM" "$TITLE"',
    ];
    const at = order.map((s) => steps.indexOf(s));
    for (const [i, s] of order.entries()) expect(at[i], s).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("runs qa's own merge tool and rules, never the branch's, and says so plainly when qa has none", () => {
    const merge = steps.slice(steps.indexOf("- name: Up to date with qa"), steps.indexOf("- name: Land the release facts"));
    expect(merge).toContain("for f in merge-branches.mjs merge-resolve.mjs; do");
    expect(merge).not.toContain("node scripts/merge-branches.mjs");
    expect(merge).toContain("qa has no scripts/$f yet");
    // The tool installs the dependencies again when qa changed them: the runner's are the branch's.
    const tool = readFileSync("scripts/merge-branches.mjs", "utf8");
    const install = tool.indexOf('spawnSync("yarn", ["install", "--immutable"]');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(tool.indexOf("if (PROBE) refreshNewestSnapshot("));
    expect(install).toBeLessThan(tool.indexOf('for (const script of ["migrations:check", "typecheck"])'));
  });

  it("names a conflicted pull request's way out: the label starts nothing, a run by hand does", () => {
    expect(workflow).toContain("«This branch has conflicts»");
    expect(workflow).toContain("`workflow_dispatch` runs regardless");
  });

  it("refuses a branch that carries nothing to release, and takes a branch landed by hand as it is", () => {
    expect(steps).toContain("Nothing to release: the branch has no .release/*.json");
    expect(steps).toContain('elif [ "$here" != "$qa" ]; then');
  });

  it("never waits for itself: ship leaves the release workflow's own check out by its name", () => {
    expect(workflow).toMatch(/^name: release\n/);
    expect(steps).toContain("SHIP_SKIP_WORKFLOW: release");
    const checks = [
      { name: "docs-check", workflow: "docs-check" },
      { name: "ship", workflow: "release" },
      { name: "Vercel", workflow: "" },
    ];
    expect(withoutWorkflow(checks, "release").map((c) => c.name)).toEqual(["docs-check", "Vercel"]);
    expect(withoutWorkflow(checks, "")).toBe(checks);
    const ship = readFileSync("scripts/ship.mjs", "utf8");
    expect(ship).toContain('const fields = skip ? "name,state,bucket,workflow" : "name,state,bucket";');
  });

  it("says the outcome on the pull request and takes the label off a stopped release", () => {
    expect(steps).toContain("if: always() && steps.pr.outputs.state != ''");
    expect(steps).toContain("--remove-label ship");
  });
});
