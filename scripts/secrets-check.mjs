#!/usr/bin/env node
/**
 * `yarn secrets:check` — refuse a commit that would put a credential into a public repository.
 *
 * The repository is public (`SETUP.md` § Contributing), so a key that lands in one commit is
 * a key to rotate, whatever happens to the commit afterwards. GitHub's own secret scanning
 * and push protection are switched on for the provider formats it knows; this is the local
 * half, which runs in `yarn check` — before the commit exists — and knows the shapes *this*
 * platform's providers use, including the ones GitHub does not scan for (Neon, Turnstile,
 * a `JOB_SECRET`). No network, no dependency, a second to run.
 *
 * What it looks at: every tracked file and every staged file, text only, `yarn.lock` and the
 * migrations excluded. What it refuses: the patterns below. `.env.example` is allowed to name
 * a variable and forbidden to give it a value. A false positive is escaped by writing the
 * example differently, never by an allowlist file — an allowlist is where the next real key
 * gets waved through.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** [name, pattern]. Each pattern matches the credential itself, not the variable name. */
const PATTERNS = [
  ["Mailgun API key", /\bkey-[0-9a-f]{32}\b/],
  ["Mailgun webhook signing key", /\b[0-9a-f]{32}-[0-9a-f]{8}-[0-9a-f]{8}\b/],
  ["Neon connection password", /postgres(?:ql)?:\/\/[^\s:@/]+:(?!local_only_not_a_secret@)[^\s@/]{8,}@/],
  ["Neon API key", /\bnapi_[A-Za-z0-9]{20,}\b/],
  ["Cloudflare Turnstile key", /\b0x4AAAAAA[A-Za-z0-9_-]{10,}\b/],
  ["Vercel token", /\bvcp_[A-Za-z0-9]{20,}\b/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["Zitadel client secret", /\bAUTH_ZITADEL_CLIENT_SECRET\s*[=:]\s*["']?[A-Za-z0-9]{20,}/],
  ["a secret with a value", /\b(?:JOB_SECRET|AUTH_SECRET|MAILGUN_API_KEY|MAILGUN_WEBHOOK_SIGNING_KEY|TURNSTILE_SECRET_KEY|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|NEON_API_KEY|VERCEL_API_TOKEN|DATABASE_URL_(?:QA|PRODUCTION))\s*=\s*["']?[A-Za-z0-9+/=_-]{16,}/],
];

/** Text files only; anything with a NUL byte in its first 8 KB is binary and skipped. */
const SKIP = /^(yarn\.lock|\.yarn\/|src\/db\/migrations\/|public\/|.*\.(png|jpg|jpeg|webp|gif|ico|woff2?|ttf|otf|pdf|zip|doc|docx)$)/;

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
}

const files = new Set([...git("ls-files"), ...git("diff", "--cached", "--name-only", "--diff-filter=ACMR")]);
const findings = [];

for (const file of files) {
  if (SKIP.test(file) || file === "scripts/secrets-check.mjs") continue;
  let text;
  try {
    const buffer = readFileSync(file);
    if (buffer.subarray(0, 8192).includes(0)) continue;
    text = buffer.toString("utf8");
  } catch {
    continue; // deleted in the working tree
  }
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const [name, pattern] of PATTERNS) {
      if (pattern.test(line)) findings.push(`${file}:${index + 1}  ${name}`);
    }
  });
}

if (findings.length > 0) {
  console.error("secrets:check failed — a credential would be committed to a public repository:\n");
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    "\nMove the value to .env.local (ignored) or the host's environment variables, and if it was ever pushed, rotate it (`SETUP.md` § Contributing).",
  );
  process.exit(1);
}

console.log(`secrets:check passed (${files.size} files).`);
