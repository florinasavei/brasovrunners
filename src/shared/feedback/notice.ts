/**
 * One shape for "it worked" across the backoffice (`DECISIONS.md` §NNN): a toast.
 *
 * A Server Action that succeeds says so with a **notice** — a kind, a key into `Feedback.toast`
 * and the values its sentence needs — and never with a translated string: the action stays
 * language-neutral (`AGENTS.md` §14.3) and the client provider (`ToastProvider`) turns the key
 * into the reader's sentence. Two roads carry it to the provider:
 *
 * - **returned**: an action that answers without leaving the page puts `notice` on the state it
 *   returns (`FormOutcome.notice`), and `ActionForm` hands it to the provider;
 * - **flashed**: an action that redirects writes it into a short-lived cookie (`flash.ts`), the
 *   admin layout reads it on the page the redirect lands on, and the provider shows it once and
 *   clears the cookie — a refresh finds nothing.
 *
 * A refusal is never a toast: §47's summary, focusable and naming each box, is what a refusal
 * gets, and a toast that goes away by itself is the wrong place for something to act on.
 *
 * Pure: no React, no `next/headers`, so the queue and the encoding are unit-tested in Node and
 * both the server (`flash.ts`) and the islands import it.
 */

export type NoticeKind = "success" | "info";

export type FormNotice = {
  kind: NoticeKind;
  /** A key under `Feedback.toast` — a `saved` code, so every redirect's outcome is a sentence. */
  key: string;
  /** What the sentence needs, as strings: counts, a version number, never anything typed. */
  values?: Readonly<Record<string, string>>;
};

/** The flash cookie: not `httpOnly`, because the island clears it once the toast is shown. */
export const FLASH_COOKIE = "br-flash";

/** How long a flash may wait for its page, in seconds — the redirect's own request and no more. */
export const FLASH_MAX_AGE_SECONDS = 60;

/**
 * The query parameters that count something, in the order one is taken as the sentence's
 * `count`: a `saved` outcome such as `{ saved: "eventsArchived", archived: "3", failed: "1" }`
 * becomes the notice `eventsArchived` with `count = "3"`, so `Feedback.toast.eventsArchived` can
 * be three plain keys (`one`, `few`, `other`, `count-form.ts`) rather than an ICU plural.
 */
const COUNT_PARAMETERS = [
  "count",
  "sent",
  "queued",
  "recipients",
  "archived",
  "published",
  "deleted",
  "erased",
  "cancelled",
  "created",
  "applied",
  "assigned",
  "marked",
  "approved",
  "removed",
] as const;

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * The notice a redirect's outcome carries, or none: `saved` names the sentence, every other
 * string rides along as a value, and the first counting parameter present is also `count`.
 * An outcome with an `error` and no `saved` is a refusal, which is never a toast.
 */
export function noticeOf(outcome: Readonly<Record<string, string | number | undefined>>): FormNotice | null {
  const key = outcome.saved;
  if (typeof key !== "string" || !KEY.test(key)) return null;
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(outcome)) {
    if (name === "saved" || value === undefined || !KEY.test(name)) continue;
    values[name] = String(value);
  }
  if (values.count === undefined) {
    const counted = COUNT_PARAMETERS.find((name) => values[name] !== undefined);
    if (counted) values.count = values[counted];
  }
  return { kind: "success", key, ...(Object.keys(values).length > 0 ? { values } : {}) };
}

/** The cookie's value: JSON, URL-encoded so a cookie header never sees a quote or a semicolon. */
export function encodeFlash(notice: FormNotice): string {
  return encodeURIComponent(JSON.stringify({ k: notice.kind, n: notice.key, v: notice.values ?? {} }));
}

/**
 * A notice read back from the cookie, or `null` for anything that is not one: a cookie is the
 * browser's to rewrite, so the shape is checked and every value is kept as a string, never as an
 * object something downstream might spread.
 */
export function decodeFlash(raw: string | undefined | null): FormNotice | null {
  if (!raw || raw.length > 2048) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { k, n, v } = parsed as { k?: unknown; n?: unknown; v?: unknown };
  if ((k !== "success" && k !== "info") || typeof n !== "string" || !KEY.test(n)) return null;
  const values: Record<string, string> = {};
  if (typeof v === "object" && v !== null) {
    for (const [name, value] of Object.entries(v as Record<string, unknown>)) {
      if (KEY.test(name) && (typeof value === "string" || typeof value === "number")) values[name] = String(value);
    }
  }
  return { kind: k, key: n, ...(Object.keys(values).length > 0 ? { values } : {}) };
}

/**
 * One toast at a time (the provider's rule): the one showing, and the ones waiting their turn.
 * A reducer, so the order — show, dismiss, the next one up — is a pure function the unit suite
 * can drive without a DOM; the provider owns the timer and the `Snackbar`.
 */
export type ToastQueue = {
  /** The toast on screen, or none. `id` changes with every toast so the Snackbar re-enters. */
  current: (FormNotice & { id: number }) | null;
  waiting: readonly FormNotice[];
  nextId: number;
};

export const EMPTY_TOAST_QUEUE: ToastQueue = { current: null, waiting: [], nextId: 1 };

export type ToastQueueAction = { type: "show"; notice: FormNotice } | { type: "dismiss" };

export function toastQueueReducer(state: ToastQueue, action: ToastQueueAction): ToastQueue {
  switch (action.type) {
    case "show":
      if (state.current === null) return { ...state, current: { ...action.notice, id: state.nextId }, nextId: state.nextId + 1 };
      return { ...state, waiting: [...state.waiting, action.notice] };
    case "dismiss": {
      const [next, ...rest] = state.waiting;
      if (next === undefined) return { ...state, current: null };
      return { current: { ...next, id: state.nextId }, waiting: rest, nextId: state.nextId + 1 };
    }
  }
}

/**
 * How long a toast stays, in milliseconds: long enough to read a sentence with a number in it,
 * short enough that a desk volunteer is not waiting for it to go (5–6 s, the owner's brief).
 */
export const TOAST_AUTO_HIDE_MS = 5500;

/**
 * A confirmation dialog's contract (`ConfirmDialog`), as a Server Component words it — strings
 * only, translated on the server, so no catalogue crosses the boundary for it.
 */
export type ConfirmSpec = {
  title: string;
  /** The consequence, with its values: the event's title, the version number. */
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /**
   * Hard to undo: the confirm button is red, and Enter does nothing — only the button itself
   * confirms. Off, Enter confirms, because the safe button has the focus and a press of Enter
   * on it would otherwise cancel a dialog the reader is trying to agree with.
   */
  destructive?: boolean;
  /**
   * "An email will be sent to N participants", worded on the server from the same count the
   * send uses (the owner: "I need to know each time a participant will be emailed!"). Absent
   * for an action that writes to nobody, which then says nothing about email.
   */
  email?: string;
  /**
   * Ask only when the form, as submitted, matches every condition: `notice.notify` ticked (a
   * tick posts `on`), the status select on `CANCELLED`. A form whose conditions all fail is
   * submitted without a question — the save that changes nothing outward asks nothing.
   */
  when?: readonly FormCondition[];
};

export type FormCondition = { field: string; equals?: string; notEquals?: string };

/**
 * The first dialog whose conditions the posted form meets, or none. A spec without `when`
 * always matches, so it goes last in a list.
 */
export function pickConfirm(
  specs: ConfirmSpec | readonly ConfirmSpec[] | undefined,
  valueOf: (field: string) => string | null,
): ConfirmSpec | null {
  if (!specs) return null;
  const list = Array.isArray(specs) ? (specs as readonly ConfirmSpec[]) : [specs as ConfirmSpec];
  return list.find((spec) => (spec.when ?? []).every((condition) => holds(condition, valueOf(condition.field)))) ?? null;
}

function holds(condition: FormCondition, value: string | null): boolean {
  if (condition.equals !== undefined && value !== condition.equals) return false;
  if (condition.notEquals !== undefined && value === condition.notEquals) return false;
  return true;
}

/**
 * What a key does in the dialog: Enter confirms a dialog that is not destructive, whichever
 * button has the focus; a destructive one answers only to its own red button, and Escape is
 * the dialog's (MUI closes it, which cancels). Pure, so the rule is tested in Node.
 */
export function confirmOnKey(key: string, destructive: boolean | undefined): "confirm" | null {
  return key === "Enter" && !destructive ? "confirm" : null;
}
