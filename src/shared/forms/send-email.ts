/**
 * «Trimite emailul» (the design «telling the owner about every email a staff press sends», 2026-11-03, slice 4, its
 * section 4: the owner's choice 3 — let him untick the person's email where that is sensible).
 *
 * The one parser of the box, for every press that offers it. Two ways it reaches a form:
 *
 * - **in a question** (`ConfirmDialog`, `ConfirmSpec.emailOptOut`): the form carries a hidden `sendEmail` drawn `on`,
 *   and the dialog writes `on` or `off` into it as it confirms (`emailOptOutAnswer`);
 * - **beside the button** (`MailLine`'s `optOut`): the box itself, `sendEmail=on` while ticked, followed by a hidden
 *   `sendEmail=off` — so an unticked box still posts the field and says it was unticked.
 *
 * Whatever posts the field, the email goes while any of its values is `on`, and a form that offers no choice — no field
 * at all, an older page, JavaScript off before a dialog could ask — sends: the box only ever takes an email away, never
 * adds one. Pure.
 */

/** The field every opt-out posts under; the event editor's window box has its own (`WINDOW_SEND_EMAIL_FIELD`). */
export const SEND_EMAIL_FIELD = "sendEmail";

/** The editor's «Fereastra de confirmare» box: the moved deadlines' «Semnează declarația», apart from the save's other emails. */
export const WINDOW_SEND_EMAIL_FIELD = "sendEmail.window";

/** Whether the press sends the person's email: no value posted, or `on` among them. */
export function sendEmailOf(form: Pick<FormData, "getAll">, field: string = SEND_EMAIL_FIELD): boolean {
  const values = form.getAll(field);
  return values.length === 0 || values.includes("on");
}

/**
 * What a press's outcome adds when the box was unticked: `mailSkipped=1`, which its toast turns into «Persoanei nu i-a
 * plecat niciun email» (`flash.ts#flashOutcome`, `mail-line.ts`); nothing when the email went.
 */
export function mailSkippedOf(sendEmail: boolean): { mailSkipped?: "1" } {
  return sendEmail ? {} : { mailSkipped: "1" };
}
