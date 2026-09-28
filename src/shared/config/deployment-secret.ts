/**
 * The family sitting's held places (`modules/registrations/family-place-slot.ts`) are keyed
 * under `AUTH_SECRET`, else `JOB_SECRET` (§543). On qa and production having neither is refused,
 * never a fallback: a per-process key changes at restart and the local key is public. Kept out
 * of `envSchema` and `env.ts` so tests can parse partial configs or mock `env.ts`.
 */
export function deploymentSecretIssue(value: { APP_ENV?: string; AUTH_SECRET?: string; JOB_SECRET?: string }): string | null {
  if (value.APP_ENV !== "qa" && value.APP_ENV !== "production") return null;
  if (value.AUTH_SECRET || value.JOB_SECRET) return null;
  return `APP_ENV=${value.APP_ENV} requires AUTH_SECRET or JOB_SECRET: the family sitting's held places are keyed under it, and must survive a restart.`;
}
