/**
 * A deployment keys what must outlive its process under its own secret (§543; the review of
 * 2026-09-28, round five): the family sitting's held places (`modules/registrations/family-place-slot.ts`)
 * with `AUTH_SECRET`, or `JOB_SECRET` where there is no sign-in. On qa and production neither is a
 * refusal, never a fallback — a key drawn per process would change every slot at a restart, and the
 * fixed local key is public. A deployment that signs staff in cannot start without `AUTH_SECRET`
 * already (`env.ts`, the provider rule); one that does not is refused at the first slot it keys. Local
 * and test fall back to the fixed key. Not a rule of `envSchema`, so a test may still parse a partial
 * qa or production configuration; and a module of its own, so a test that mocks `env.ts` keeps it.
 */
export function deploymentSecretIssue(value: { APP_ENV?: string; AUTH_SECRET?: string; JOB_SECRET?: string }): string | null {
  if (value.APP_ENV !== "qa" && value.APP_ENV !== "production") return null;
  if (value.AUTH_SECRET || value.JOB_SECRET) return null;
  return `APP_ENV=${value.APP_ENV} requires AUTH_SECRET or JOB_SECRET: the family sitting's held places are keyed under it, and must survive a restart.`;
}
