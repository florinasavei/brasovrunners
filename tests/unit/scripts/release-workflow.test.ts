import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withoutWorkflow } from "../../../scripts/ship-checks.mjs";

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

  it("runs one release at a time and never cancels one halfway", () => {
    expect(workflow).toMatch(/\nconcurrency:\n {2}group: release\n {2}cancel-in-progress: false\n/);
  });
});

describe("§NNN release.yml — the token and what a person typed", () => {
  it("reads with its own token and writes only through RELEASE_TOKEN, which it refuses to run without", () => {
    expect(workflow).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(workflow).not.toMatch(/: write\b/);
    expect(workflow).toContain("GH_TOKEN: ${{ secrets.RELEASE_TOKEN }}");
    expect(workflow).toMatch(/uses: actions\/checkout@v4\n {8}with:\n(?: {10}.*\n)*? {10}token: \$\{\{ secrets\.RELEASE_TOKEN \}\}\n/);
    expect(steps).toContain('[ -n "$GH_TOKEN" ] || missing="$missing the secret RELEASE_TOKEN;"');
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
      "node scripts/merge-branches.mjs origin/qa",
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
