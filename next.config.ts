import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Build identity, resolved here because this file runs during the build and the values it
 * needs — the git checkout, the working tree — exist then and not at runtime. Next inlines
 * anything under `env`, so the deployed bundle carries the answers rather than the tools.
 *
 * Nothing here may throw: a shallow clone, a source archive with no `.git`, or a host that
 * strips git all produce an unknown value, and an unknown value renders as "dev" rather than
 * failing a build over a badge.
 */
function git(...args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/**
 * The documentation baseline, read from the top heading of CHANGELOG.md — the same value
 * `docs:check` already forces to agree across every root document, so this reads the one
 * source rather than adding a second place to keep in sync.
 */
function readBaseline(): string {
  try {
    const changelog = readFileSync(new URL("./CHANGELOG.md", import.meta.url), "utf8");
    return /^## (BR-V\S+)/m.exec(changelog)?.[1] ?? "";
  } catch {
    return "";
  }
}

// Vercel exposes the commit it built from; a local build asks git directly.
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? git("rev-parse", "HEAD") ?? "";
// The commit's own date, not the build's: "last updated" means when the code changed, and a
// rebuild of an unchanged commit should not claim the site was updated today.
const commitDate = git("log", "-1", "--format=%cI") ?? "";

const nextConfig: NextConfig = {
  /**
   * Inlined at build time and read by `src/shared/config/build-info.ts`. Not secrets: a
   * commit hash and a date, on a build whose source the club owns.
   */
  env: {
    BUILD_BASELINE: readBaseline(),
    BUILD_COMMIT: commitSha.slice(0, 7),
    BUILD_COMMITTED_AT: commitDate,
  },

  // Nothing host-specific belongs here. The app must run with `yarn build && yarn start`
  // on any Node host honouring PORT (BR-REQ-101-01); Vercel is an adapter, not a dependency.

  // `next dev` otherwise appends a block to AGENTS.md and re-adds it on every run.
  // AGENTS.md is one of the six synchronized root documents: it carries the baseline marker,
  // docs:check verifies it, and AGENTS.md §1.4 governs who may edit it. A tool rewriting it
  // on every dev run produces permanent uncommitted churn in a governed file. The advice in
  // that block is worth keeping, so it lives in CLAUDE.md, which is the agent entry point.
  agentRules: false,
};

// Looks for src/i18n/request.ts by default.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
