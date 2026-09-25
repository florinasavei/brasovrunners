/**
 * One shape for "it worked" across the backoffice (`DECISIONS.md` §384): a toast.
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

import { type CountForm, countForm } from "@/i18n/count-form";

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
 * The sentences whose number is not the first counting parameter present, and the other numbers
 * a sentence names. A series save that also told its participants carries `applied` (the dates)
 * and `queued` (the emails): "Salvat pe {count} date ale seriei" counts `applied`, and the
 * notified sentence counts `queued` and names the dates as `{dates}`.
 */
const SENTENCES: Readonly<Record<string, { count?: string; values?: Readonly<Record<string, string>> }>> = {
  eventSeries: { count: "applied" },
  eventNotified: { count: "queued" },
  eventCancelled: { count: "queued" },
  eventSeriesNotified: { count: "queued", values: { dates: "applied" } },
  eventSeriesCancelled: { count: "queued", values: { dates: "applied" } },
};

/**
 * The event editor's save names what it did beyond saving (§331): an update notice or a
 * cancellation queued is a sentence of its own, with the number of emails — the brief's "the
 * toast states how many were queued". The URL keeps `saved=event` for the page's banner; only
 * the toast's key is chosen here.
 */
function sentenceKeyOf(saved: string, notice: string | number | undefined): string {
  if (saved !== "event" && saved !== "eventSeries") return saved;
  const series = saved === "eventSeries";
  if (notice === "update") return series ? "eventSeriesNotified" : "eventNotified";
  if (notice === "cancelled") return series ? "eventSeriesCancelled" : "eventCancelled";
  if (notice === "cancelledQuiet" || notice === "cancelledNobody") return "eventCancelledQuiet";
  return saved;
}

/** The toast keys chosen here rather than written by an action — each needs its sentence too (`feedback-catalogue.test.ts`). */
export const DERIVED_TOAST_KEYS: readonly string[] = [
  ...Object.keys(SENTENCES).filter((key) => key !== "eventSeries"),
  "eventCancelledQuiet",
  "registrationsCancelledTest",
];

/**
 * The provider's answers that mean the verb happened (§171, §288). A staff verb that reaches
 * Zitadel redirects with `saved` whatever Zitadel said — the page's banner tells `failed`,
 * `missing` and `unconfigured` apart — so a green "the link was sent" is owed only to these.
 */
const PROVIDER_DONE: ReadonlySet<string> = new Set(["invited", "exists", "done"]);
const PROVIDER_FIELDS = ["invite", "account"] as const;

/** Sentences that say nothing happened, however the action got there: an `info`, never a green tick. */
const NOTHING_HAPPENED: ReadonlySet<string> = new Set(["interestNotFound", "participantMessageDuplicate", "neonLimitsSame"]);

/**
 * The notice a redirect's outcome carries, or none: `saved` names the sentence and the first
 * counting parameter present is its `count`. An outcome with an `error` and no `saved` is a
 * refusal, which is never a toast.
 *
 * **Only numbers travel.** The outcome is the redirect's query, and a query may hold what a
 * cookie must not — the desk's search box (a participant's name), Zitadel's error text — so the
 * notice keeps `count` and the numbers `SENTENCES` names, and nothing else (`flash.ts`).
 *
 * A provider verb that did not happen is no notice at all: the banner says why. A count of zero,
 * or a sentence that says nothing was done, is `info`.
 */
export function noticeOf(outcome: Readonly<Record<string, string | number | undefined>>): FormNotice | null {
  const saved = outcome.saved;
  if (typeof saved !== "string" || !KEY.test(saved)) return null;
  for (const field of PROVIDER_FIELDS) {
    const answer = outcome[field];
    if (answer !== undefined && !PROVIDER_DONE.has(String(answer))) return null;
  }
  let key = sentenceKeyOf(saved, outcome.notice);
  const numberOf = (name: string): string | undefined => {
    const value = outcome[name];
    if (value === undefined) return undefined;
    const text = String(value);
    return /^\d{1,9}$/.test(text) ? text : undefined;
  };
  // A bulk cancel that also cancelled test rows (§30, §384): the club's own count stays the real
  // rows only, and a variant sentence — never the plain one — says the test rows moved too, so
  // "0 anulate" is not read as nothing having happened.
  const testCount = key === "registrationsCancelled" ? numberOf("test") : undefined;
  if (testCount !== undefined && testCount !== "0") key = "registrationsCancelledTest";
  const sentence = SENTENCES[key];
  const values: Record<string, string> = {};
  const counted = sentence?.count ?? COUNT_PARAMETERS.find((name) => numberOf(name) !== undefined);
  const count = counted ? numberOf(counted) : undefined;
  if (count !== undefined) values.count = count;
  for (const [placeholder, name] of Object.entries(sentence?.values ?? {})) {
    const value = numberOf(name);
    if (value !== undefined) values[placeholder] = value;
  }
  if (key === "registrationsCancelledTest" && testCount !== undefined) values.test = testCount;
  const kind: NoticeKind = (count === "0" && key !== "registrationsCancelledTest") || NOTHING_HAPPENED.has(key) ? "info" : "success";
  return { kind, key, ...(Object.keys(values).length > 0 ? { values } : {}) };
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
   * Hard to undo: the confirm button is red, and Enter never confirms — it reaches the focused
   * cancel button, which cancels — so only the red button itself does. Off, Enter confirms, because the safe button has the focus and a press of Enter
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
   * The same sentence, counted from the form as posted, for a press whose reach the reader chose
   * in the browser: a series save reaches the ticked dates, and each date's registrants are
   * emailed (`announceSave`). Replaces `email` once the dialog opens (`resolveEmailCount`).
   */
  emailCount?: EmailCount;
  /**
   * Ask only when the form, as submitted, matches every condition: `notice.notify` ticked (a
   * tick posts `on`), the status select on `CANCELLED`. A form whose conditions all fail is
   * submitted without a question — the save that changes nothing outward asks nothing.
   */
  when?: readonly FormCondition[];
};

export type FormCondition = { field: string; equals?: string; notEquals?: string };

/**
 * "An email will be sent to N participants" for the dates a series save reaches (§331, §384):
 * the numbers read on the server with the send's own query, one per date, summed in the browser
 * over the dates ticked at the press — the ticks exist only there.
 */
export type EmailCount = {
  /** The field whose posted values name what else the press reaches: the ticked `dates`. */
  field: string;
  /** Who is written to whatever is ticked: the date being edited, always told when asked. */
  base: number;
  /**
   * Who each other value adds. A value absent here adds nobody — a date already run is told
   * nothing (`announceSave`), and the date being edited is `base`, never counted twice.
   */
  counts: Readonly<Record<string, number>>;
  /** `Admin.confirm.email`'s three forms, raw, each with `{count}`. */
  forms: Readonly<Record<CountForm, string>>;
  locale: string;
};

/** The dialog with its email line counted from the posted values, or without one when nobody is written to. */
export function resolveEmailCount(spec: ConfirmSpec, valuesOf: (field: string) => readonly string[]): ConfirmSpec {
  const counted = spec.emailCount;
  if (!counted) return spec;
  let total = counted.base;
  for (const value of new Set(valuesOf(counted.field))) total += counted.counts[value] ?? 0;
  const rest: ConfirmSpec = { ...spec, emailCount: undefined, email: undefined };
  return total > 0 ? { ...rest, email: counted.forms[countForm(total, counted.locale)].replace("{count}", String(total)) } : rest;
}

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
