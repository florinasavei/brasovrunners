/**
 * The club's legal facts as this machine knows them — for the checks that refuse to let one into
 * the repository (§NNN; the repository is public, §98, §132).
 *
 * The site shows the legal name and the CIF (the identity line and the footer's block), composed
 * from these variables; the values live on the Vercel projects and in a developer's `.env.local`,
 * never in a file git tracks. `yarn secrets:check` and
 * `tests/unit/legal-documents/club-facts-no-literal.test.ts` read them from here and look for each
 * in the tracked files. Nothing here prints a value.
 */
import { existsSync, readFileSync } from "node:fs";

/** The variables whose values must never be a literal in the repository. */
export const CLUB_FACT_VARIABLES = ["CLUB_LEGAL_NAME", "CLUB_REGISTRATION_NUMBER", "CLUB_REGISTERED_ADDRESS"];

/**
 * `KEY=value` lines of an env file, for the variables above only: quotes around a value dropped,
 * comments and blank lines skipped. A missing file is no values.
 *
 * @param {string} file
 * @returns {Record<string, string>}
 */
export function clubFactValuesFromEnvFile(file) {
  if (!existsSync(file)) return {};
  /** @type {Record<string, string>} */
  const values = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 0) continue;
    const name = line.slice(0, at).trim().replace(/^export\s+/, "");
    if (!CLUB_FACT_VARIABLES.includes(name)) continue;
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value) values[name] = value;
  }
  return values;
}

/**
 * The values to look for: the process's environment first, then the env file; each at least four
 * characters, so a stray short value never matches half the repository.
 *
 * @param {string} envFile
 * @returns {Array<[string, string]>} [variable, value]
 */
export function knownClubFactValues(envFile) {
  const fromFile = clubFactValuesFromEnvFile(envFile);
  return CLUB_FACT_VARIABLES.flatMap((name) => {
    const value = (process.env[name] ?? fromFile[name] ?? "").trim();
    return value.length >= 4 ? [/** @type {[string, string]} */ ([name, value])] : [];
  });
}
