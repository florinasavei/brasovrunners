/**
 * The DOM event a backoffice form (`ActionFormIsland`) dispatches on itself when its confirm dialog is
 * answered «Anulează» — nothing was sent. A control that asked the question by changing what it shows
 * before the answer (the «Lista ascunsă» radio, §NNN) listens for it on its form and shows again what
 * the server last said. A DOM event rather than a callback prop: the form is rendered from a Server
 * Component, which can pass no function to it.
 */
export const CONFIRM_CANCEL_EVENT = "actionform:confirm-cancel";
