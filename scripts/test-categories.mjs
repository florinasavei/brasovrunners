// The test categories (§NNN): which category each vitest file is in, and the suite run without some of them.
//
//   yarn test:categories                  each category: its files, what it guards, whether `test:fast` leaves it out
//   yarn test:categories --files drawn    the files of one category
//   yarn test:fast                        the categories marked `fast` in tests/categories.mjs — what the pre-commit
//                                         hook runs, on the tests of the staged files
//   yarn test:skip drawn pages            every category but the ones named
//   yarn test:fast related --run a.ts     after the names, vitest's own arguments: a subcommand (`related`, `list`, `watch`)
//                                         or filters; `run` when none
//
// «trust» — the tests of the rules that cannot be broken (CLAUDE.md) — is never left out: naming it is refused.
// One category alone is vitest's own `yarn test --project=<name>`; `yarn test` runs everything, as CI does.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CATEGORIES, categorize } from "../tests/categories.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUBCOMMANDS = new Set(["run", "related", "list", "watch", "dev"]);

/**
 * `run [--skip] [names…] [vitest args…]` as the vitest command line: the categories kept, one `--project` each (vitest
 * joins several `--project=!x` with «or», so leaving two out takes the list of the others), then vitest's own arguments.
 * Throws on an unknown category and on «trust».
 */
export function vitestArgs(argv, categories = CATEGORIES) {
  const names = new Set(categories.map((category) => category.name));
  const rest = argv[0] === "--skip" ? argv.slice(1) : argv;
  const explicit = argv[0] === "--skip";
  const skipped = [];
  let index = 0;
  for (; index < rest.length && !rest[index].startsWith("-") && !SUBCOMMANDS.has(rest[index]) && !rest[index].includes("/") && !rest[index].includes("."); index++) {
    if (!names.has(rest[index])) throw new Error(`no test category «${rest[index]}» — the categories are ${[...names].join(", ")}`);
    skipped.push(rest[index]);
  }
  if (explicit && skipped.length === 0) throw new Error("name the categories to leave out, like `yarn test:skip drawn pages`");
  const leftOut = explicit ? skipped : categories.filter((category) => !category.fast).map((category) => category.name);
  const protectedOnes = categories.filter((category) => !category.skippable && leftOut.includes(category.name));
  if (protectedOnes.length > 0) throw new Error(`«${protectedOnes.map((category) => category.name).join("», «")}» is never left out: it holds the tests of the rules that cannot be broken`);
  let vitest = rest.slice(index);
  if (vitest[0] === "--") vitest = vitest.slice(1);
  const subcommand = SUBCOMMANDS.has(vitest[0]) ? vitest[0] : "run";
  if (SUBCOMMANDS.has(vitest[0])) vitest = vitest.slice(1);
  const kept = categories.filter((category) => !leftOut.includes(category.name)).map((category) => `--project=${category.name}`);
  return [subcommand, ...kept, ...vitest];
}

/** The listing: one block per category, in the order a file is matched. */
export function listing(byCategory, categories = CATEGORIES) {
  const total = [...byCategory.values()].reduce((sum, files) => sum + files.length, 0);
  const lines = [`${total} test files in ${categories.length} categories (tests/categories.mjs; a file is in the first that matches):`, ""];
  for (const category of categories) {
    const files = byCategory.get(category.name) ?? [];
    const mark = !category.skippable ? "never left out" : category.fast ? "run by yarn test:fast and the pre-commit hook" : "left out by yarn test:fast and the pre-commit hook";
    lines.push(`${category.name.padEnd(9)} ${String(files.length).padStart(4)} files   ${mark}`);
    lines.push(`          ${category.description}`);
  }
  lines.push("", "yarn test --project=<name>   one category · yarn test:skip <names…>   all but those · yarn test   everything (CI)");
  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "run") {
    let args;
    try {
      args = vitestArgs(argv.slice(1));
    } catch (error) {
      console.error(String(error.message));
      process.exit(2);
    }
    const vitest = path.join(path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
    const run = spawnSync(process.execPath, [vitest, ...args], { cwd: ROOT, stdio: "inherit" });
    process.exit(run.status ?? 1);
  }
  const byCategory = categorize(ROOT);
  if (argv[0] === "--files") {
    const files = byCategory.get(argv[1]);
    if (!files) {
      console.error(`no test category «${argv[1] ?? ""}» — the categories are ${CATEGORIES.map((category) => category.name).join(", ")}`);
      process.exit(2);
    }
    console.log(files.join("\n"));
    return;
  }
  console.log(listing(byCategory));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
