import { readFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

/**
 * The repository's own documents, readable in the deployed app (`DECISIONS.md` §88): the
 * owner asked to "read MD files straight from the repo" without a laptop and a checkout. A
 * closed list, on purpose — a name from the URL is looked up here and never joined to a path,
 * so `../` cannot reach anything — and the files are traced into the function that reads them
 * (`next.config.ts`), because a file read with `fs` at runtime is invisible to the bundler.
 *
 * Rendered with `marked` (GFM: tables, task lists) into HTML the page injects as is. The
 * content is the repository's, written by the people who deploy it, and the readers are the
 * `DEV`-and-above roles that can already read `/devs`; it is not user input.
 */

/*
 * One literal path per entry, not `path.join(cwd, doc.file)` with a variable: Turbopack traces
 * a filesystem read whose path it can see, and a read it cannot see makes it trace the whole
 * project into the function ("Dynamic filesystem access causes tracing of the whole project").
 */
const root = () => process.cwd();
export const REPO_DOCS = [
  { name: "README", file: "README.md", read: () => readFile(path.join(root(), "README.md"), "utf8") },
  { name: "CLAUDE", file: "CLAUDE.md", read: () => readFile(path.join(root(), "CLAUDE.md"), "utf8") },
  { name: "SETUP", file: "SETUP.md", read: () => readFile(path.join(root(), "SETUP.md"), "utf8") },
  { name: "RUNBOOKS", file: "docs/RUNBOOKS.md", read: () => readFile(path.join(root(), "docs/RUNBOOKS.md"), "utf8") },
  { name: "DEVELOPMENT", file: "docs/DEVELOPMENT.md", read: () => readFile(path.join(root(), "docs/DEVELOPMENT.md"), "utf8") },
  { name: "PLATFORM", file: "docs/PLATFORM.md", read: () => readFile(path.join(root(), "docs/PLATFORM.md"), "utf8") },
  { name: "PRACTICES", file: "docs/PRACTICES.md", read: () => readFile(path.join(root(), "docs/PRACTICES.md"), "utf8") },
  { name: "AGENTS", file: "AGENTS.md", read: () => readFile(path.join(root(), "AGENTS.md"), "utf8") },
  { name: "SPECS", file: "SPECS.md", read: () => readFile(path.join(root(), "SPECS.md"), "utf8") },
  { name: "DECISIONS", file: "DECISIONS.md", read: () => readFile(path.join(root(), "DECISIONS.md"), "utf8") },
  { name: "BUSINESS", file: "BUSINESS.md", read: () => readFile(path.join(root(), "BUSINESS.md"), "utf8") },
  { name: "CHANGELOG", file: "CHANGELOG.md", read: () => readFile(path.join(root(), "CHANGELOG.md"), "utf8") },
  { name: "WEEKEND", file: "WEEKEND.md", read: () => readFile(path.join(root(), "WEEKEND.md"), "utf8") },
] as const;

export type RepoDocName = (typeof REPO_DOCS)[number]["name"];

export function isRepoDocName(value: string): value is RepoDocName {
  return REPO_DOCS.some((doc) => doc.name === value);
}

/** The document as HTML, or null when the file is not there (a deployment traced without it). */
export async function renderRepoDoc(name: RepoDocName): Promise<{ html: string; bytes: number } | null> {
  const doc = REPO_DOCS.find((entry) => entry.name === name);
  if (!doc) return null;
  try {
    const source = await doc.read();
    const html = await marked.parse(source, { gfm: true, breaks: false });
    return { html, bytes: Buffer.byteLength(source) };
  } catch {
    return null;
  }
}
