/**
 * The club's two files, read by the scripts (§NNN): `club/club.json` (its identity) and
 * `club/infra.json` (the names its tooling holds). Plain `fs` and `JSON.parse`, so a `.mjs` script needs
 * no compiler; nothing under `src/` imports `infra.json` (`tests/unit/club/import-surface.test.ts`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (name) => JSON.parse(readFileSync(path.join(ROOT, "club", name), "utf8"));

/** `club/club.json`: the name, the slug, the place and its time zone. */
export const readClub = () => read("club.json");

/** `club/infra.json`: `domainLabels`, `vercelProjects`, `releaseAuthor`. */
export const readInfra = () => read("infra.json");

/**
 * The pattern for the club's own hostname: any subdomain, any of the labels, a dotted suffix required
 * so a bare repository name does not match. Case-insensitive as DNS is.
 */
export function ownHostPattern(labels) {
  const alternatives = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?<![A-Za-z0-9.-])(?:[A-Za-z0-9-]+\\.)*(?:${alternatives})(?:\\.[A-Za-z0-9-]+)+(?![A-Za-z0-9-])`, "gi");
}

/** The repository's own clone URL: a bare label plus ".git", nothing either side. */
export function ownCloneUrlPattern(labels) {
  const alternatives = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`^(?:${alternatives})\\.git$`, "i");
}
