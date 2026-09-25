/**
 * The retention windows, as data — pure numbers, no database and no job (§322).
 *
 * `jobs/retention.ts`'s sweep and `notifications/templates.ts`'s words about "seven days" and
 * "three years" both need exactly these two numbers, and neither needed the other's machinery:
 * the sweep imports `drizzle`, every schema it touches, the audit repository and
 * `next/cache`'s `revalidatePublicContent`, none of which a template — or a unit test of one —
 * has any business loading. Moved out from under `RETENTION` for that reason (review finding,
 * following the counsel-required sentences added to the email templates); `jobs/retention.ts`
 * re-exports `RETENTION` unchanged, so every other caller and every comment above is still
 * correct — only where the two numbers `templates.ts` reads live has moved.
 */
export const RETENTION_PERIODS = {
  /**
   * A registration and the declaration signed for it are kept three years from the event's
   * start — the general limitation period of Codul civil art. 2517, within which a claim
   * about the event could still be made and the declaration is the evidence — and then go,
   * with the participant row when it was their last registration (`DECISIONS.md` §95). The
   * privacy notice says exactly this, and this is what makes it true.
   */
  registrationsYearsAfterEvent: 3,
  /**
   * The identity document's series and number, and the health note, go seven days after the
   * event's start — the kits are handed out by then, and the privacy notice says so (§95).
   * The declaration keeps the name, the signature, the version and the hash; the participant
   * keeps the PDF that was emailed with the number in it.
   */
  identityAndHealthDaysAfterEvent: 7,
} as const;
