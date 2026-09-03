import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
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
