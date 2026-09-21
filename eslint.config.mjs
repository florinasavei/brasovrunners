import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees are copies of this repository, build output and all (`.gitignore` too).
    ".claude/**",
    /*
      Playwright writes both of these locally: `CI=1 npx playwright test` leaves an HTML report
      whose `trace/assets` are somebody else's minified bundles, and a failing run leaves the
      traces beside them. Lint then reads them — 3,000 problems in vendored JavaScript — and
      since `yarn check` runs lint, the pre-commit hook refuses every commit after an e2e run
      until the folder is deleted by hand. Both are in `.gitignore`; ESLint has its own list.
    */
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
