/**
 * The environment for a git process a test spawns in a throwaway fixture (§NNN).
 *
 * A git hook runs with git's own variables exported: `GIT_DIR`, `GIT_INDEX_FILE` and, in some
 * commands, `GIT_WORK_TREE` and `GIT_PREFIX`. `.githooks/pre-commit` runs `yarn check`, so the
 * tests ran with them, and every git a test spawned — directly, or through a script it runs —
 * inherited them: the fixture's `git init` re-initialised the repository being committed (git
 * printed «re-init: ignored --initial-branch»), its `git add` and `git rm` rewrote the committing
 * worktree's index (1 942 staged deletions on 2026-09-28), and a later run set `core.bare=true` in
 * the main checkout's config. The hooks unset them first; this is the other end, so a test is safe
 * however it is started.
 *
 * The repository-locating variables are removed too (`GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`,
 * `GIT_ALTERNATE_OBJECT_DIRECTORIES`): each would point the fixture's git at another repository.
 */
export const GIT_REPOSITORY_VARIABLES = [
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_WORK_TREE",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
] as const;

type Variables = Record<string, string | undefined>;

/** `process.env` plus `extra`, without any variable that tells git which repository it is in. */
export function gitEnv(extra: Variables = {}, base: Variables = process.env): NodeJS.ProcessEnv {
  const env: Variables = { ...base, ...extra };
  for (const name of GIT_REPOSITORY_VARIABLES) delete env[name];
  return env as NodeJS.ProcessEnv;
}
