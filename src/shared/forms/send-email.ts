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
 * What a press's outcome adds when the box was unticked: `mailSkipped`, how many emails it kept back — one for a press on
 * one person, the people a bulk press reached — which its toast turns into «Emailul nu a plecat …» or «3 emailuri nu au
 * plecat …» (`flash.ts#flashOutcome`, `mail-line.ts`); nothing when the email went. Unticked over nobody, `0`: the box was
 * unticked, and the toast says nothing of an email kept back.
 */
export function mailSkippedOf(sendEmail: boolean, count = 1): { mailSkipped?: string } {
  return sendEmail ? {} : { mailSkipped: String(Math.max(0, Math.trunc(count))) };
}

/** The count a `mailSkipped` value carries, or null for one the browser rewrote (`mail-line.ts`, `flash.ts`). */
export function mailSkippedCount(value: unknown): number | null {
  return typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : null;
}
