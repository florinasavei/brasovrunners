import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/../messages/en.json";
import ro from "@/../messages/ro.json";
import { bareRegistrationNumber as siteBare } from "@/modules/legal-documents/templates/club-facts";
import {
  bareRegistrationNumber as scriptBare,
  CLUB_FACT_VARIABLES,
  clubFactValuesFromEnvFile,
  knownClubFactValues,
} from "../../../scripts/club-facts-values.mjs";

/**
 * §565 (amending §132's "environment, never source" into a check) — the club's legal name, CIF and
 * seat are shown on the site now (the identity line, on the about and contact pages and in the
 * footer's fold), and every one of them is composed from the environment: no file of the
 * repository — public — may carry one.
 *
 * The values are known only where they are set: the Vercel projects and a developer's `.env.local`.
 * So this reads them from there (and from the process's own environment) and looks for each in
 * every text file of `src/`, `tests/`, `messages/`, `.release/`, `docs/`, `scripts/` and the root's
 * documents; in CI, where none is set, that half has nothing to look for. `yarn secrets:check`
 * makes the same search over every tracked file before a commit (`scripts/secrets-check.mjs`).
 *
 * The public phone is a setting in the database, not in the environment, so its half is a shape:
 * the identity's own sources and words carry no telephone-shaped run of digits.
 */
const ROOT = process.cwd();
const DIRECTORIES = ["src", "tests", "messages", ".release", "docs", "scripts"];
const TEXT = /\.(ts|tsx|mts|mjs|js|json|md|sql|css|txt|yml|yaml|sh)$/;

function textFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return textFiles(full);
    return TEXT.test(entry) ? [full] : [];
  });
}

const files = [
  ...DIRECTORIES.flatMap((directory) => textFiles(path.join(ROOT, directory))),
  ...readdirSync(ROOT).filter((entry) => entry.endsWith(".md")).map((entry) => path.join(ROOT, entry)),
];

/** The values in force here: the process's environment first, then `.env.local` beside it. */
const knownValues = () => knownClubFactValues(path.join(ROOT, ".env.local"));

describe("§565 no legal fact of the club's is a literal in the repository", () => {
  it("finds the files it walks", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((file) => file.endsWith(path.join("src", "shared", "ui", "ClubIdentity.tsx")))).toBe(true);
  });

  it("reads the three variables from an env file, quotes and comments aside, and nothing else", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "club-facts-")), ".env.local");
    writeFileSync(
      file,
      ["# a comment", 'CLUB_LEGAL_NAME="Asociația Exemplu"', "CLUB_REGISTRATION_NUMBER=RO00000000", "CLUB_REGISTERED_ADDRESS=", "OTHER=x", ""].join("\r\n"),
    );
    expect(clubFactValuesFromEnvFile(file)).toEqual({ CLUB_LEGAL_NAME: "Asociația Exemplu", CLUB_REGISTRATION_NUMBER: "RO00000000" });
    expect(clubFactValuesFromEnvFile(path.join(path.dirname(file), "missing"))).toEqual({});
  });

  it("looks for the CIF both as the variable holds it and bare, as the site shows it", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "club-facts-")), ".env.local");
    writeFileSync(file, ['CLUB_REGISTRATION_NUMBER="CIF 00000000"', ""].join("\n"));
    const saved = Object.fromEntries(CLUB_FACT_VARIABLES.map((name) => [name, process.env[name]]));
    try {
      for (const name of CLUB_FACT_VARIABLES) delete process.env[name];
      expect(knownClubFactValues(file)).toEqual([
        ["CLUB_REGISTRATION_NUMBER", "CIF 00000000"],
        ["CLUB_REGISTRATION_NUMBER", "00000000"],
      ]);
      // A value without a label is looked for once.
      writeFileSync(file, "CLUB_REGISTRATION_NUMBER=RO00000000\n");
      expect(knownClubFactValues(file)).toEqual([["CLUB_REGISTRATION_NUMBER", "RO00000000"]]);
    } finally {
      for (const [name, value] of Object.entries(saved)) if (value !== undefined) process.env[name] = value;
    }
  });

  it("drops the CIF's label by the same rule as the site", () => {
    for (const value of ["CIF 00000000", "C.I.F. 00000000", "CUI: 00000000", "RO00000000", "00000000"]) {
      expect(scriptBare(value)).toBe(siteBare(value));
    }
  });

  it("carries none of the values the environment holds — legal name, CIF, seat", () => {
    const found: string[] = [];
    for (const [name, value] of knownValues()) {
      for (const file of files) {
        if (readFileSync(file, "utf8").includes(value)) found.push(`${path.relative(ROOT, file)} carries ${name}`);
      }
    }
    // The variable's name, never its value: this output is read in a public CI log.
    expect(found).toEqual([]);
  });

  it("composes the identity from the variables and the site's one name, never from a typed value", () => {
    const source = readFileSync(path.join(ROOT, "src/shared/ui/ClubIdentity.tsx"), "utf8");
    expect(source).toContain("clubFactsFromEnv(env)");
    expect(source).toContain("CLUB_NAME");
    expect(source).not.toMatch(/Bra(?:ș|s)ov Runners/);
    expect(source).not.toMatch(/Asocia[țt]i|Clubul Sportiv|\bACS\b|\bRO\d{4,}/);
  });

  it("writes no telephone number into the identity's sources or words: the public phone is a setting", () => {
    const sources = [
      "src/shared/ui/ClubIdentity.tsx",
      "src/shared/ui/club-socials.ts",
      "src/modules/contact/domain/public-phone.ts",
      "src/modules/contact/public-phone.ts",
      "src/modules/contact/ui/PublicPhonePanel.tsx",
    ].map((file) => readFileSync(path.join(ROOT, file), "utf8"));
    const words = [ro.Identity, en.Identity, ro.Admin.emails.publicPhone, en.Admin.emails.publicPhone].map((entry) => JSON.stringify(entry));
    // A number as a club writes one: a country code or a leading zero, then eight digits or more
    // (a date's dashes are not a number's separators here).
    const phoneShaped = /(?:\+\d{2}|\b0)(?:[\s.]?\d){8,}/;
    expect("+40 123 456 789").toMatch(phoneShaped);
    expect("0123 456 789").toMatch(phoneShaped);
    expect("2026-09-29").not.toMatch(phoneShaped);
    for (const text of [...sources, ...words]) expect(text).not.toMatch(phoneShaped);
    if (existsSync(path.join(ROOT, ".release"))) {
      for (const file of textFiles(path.join(ROOT, ".release"))) expect(readFileSync(file, "utf8"), file).not.toMatch(phoneShaped);
    }
  });
});
