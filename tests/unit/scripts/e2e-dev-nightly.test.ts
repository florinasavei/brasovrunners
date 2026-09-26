import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * §426 — the `next dev` walk (§370) runs once a night on `qa`. What it guards cannot be run on a
 * laptop, so the test holds the workflow to the few lines that make it that job: the schedule,
 * the branch, the seed the walk needs for its ids, and the command itself.
 */
const workflow = readFileSync(".github/workflows/e2e-dev-nightly.yml", "utf8").replace(/\r\n/g, "\n");
const steps = workflow.split("\n").filter((line) => /^\s+- (run|uses): /.test(line)).map((line) => line.trim());

describe("§426 the nightly next-dev walk on qa", () => {
  it("runs on a nightly schedule and by hand", () => {
    expect(workflow).toMatch(/^on:\n {2}schedule:\n(?: {4}#.*\n)* {4}- cron: "\d{1,2} \d{1,2} \* \* \*"\n/m);
    expect(workflow).toMatch(/^ {2}workflow_dispatch:$/m);
  });

  it("checks out qa, not the branch the schedule runs from", () => {
    expect(workflow).toMatch(/- uses: actions\/checkout@v4\n\s+with:\n\s+ref: qa\n/);
  });

  it("migrates and seeds before the walk, and the walk is the package's own command", () => {
    const at = (step: string) => steps.indexOf(step);
    expect(at("- run: yarn db:migrate")).toBeGreaterThan(-1);
    expect(at("- run: yarn db:seed")).toBeGreaterThan(at("- run: yarn db:migrate"));
    expect(at("- run: yarn test:e2e:dev --retries=0")).toBeGreaterThan(at("- run: yarn db:seed"));
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["test:e2e:dev"]).toMatch(/E2E_DEV=1 playwright test tests\/e2e\/dev-routes\.spec\.ts/);
  });

  it("gives the walk more time than its two thirty-minute tests", () => {
    const minutes = Number(workflow.match(/timeout-minutes: (\d+)/)?.[1]);
    expect(minutes).toBeGreaterThan(60);
    expect(readFileSync("tests/e2e/dev-routes.spec.ts", "utf8")).toMatch(/test\.setTimeout\(30 \* 60_000\)/);
  });

  it("reads nothing secret: the database is the job's own service", () => {
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
  });
});
