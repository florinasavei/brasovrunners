/**
 * A save that a corporate network refused, sent again as a plain browser form (§436).
 *
 * An inspecting proxy may block a Server Action `fetch` (a `Next-Action` POST answered as RSC)
 * while passing plain form posts. React already writes hidden `$ACTION_…` fields for the
 * no-JavaScript form, so on a *transport* failure the person is offered «Trimite pe calea simplă»:
 * the same form as a plain `multipart/form-data` POST, the §384 flash cookie still carrying the toast.
 *
 * Offered, never sent on its own: a transport failure (E394, a reset) does not prove the server did
 * not run the action, and a cancel, an erase or a message has no version (§36) to stop a second run.
 *
 * When the browser drew the form (after a client navigation, no `$ACTION_…` fields), they are read
 * from the page's own HTML by a plain GET, matched by `action-key.ts`'s key; a form or button that
 * cannot be matched with certainty is not sent, since a guessed action could be another verb.
 */

/** Set as the plain POST leaves: the simple path was *tried*; only the §384 toast says it landed. */
export const SAVE_FALLBACK_COOKIE = "br-save-path";
export const SAVE_FALLBACK_MAX_AGE_SECONDS = 60;

/** Next's message and code for an answer that is not a Server Action's (`server-action-reducer`). */
export const UNEXPECTED_RESPONSE_MESSAGE = "An unexpected response was received from the server.";
const UNEXPECTED_RESPONSE_CODE = "E394";

/** React's hidden Server Action fields: `$ACTION_ID_…`, `$ACTION_REF_…`, `$ACTION_KEY`. */
const ACTION_FIELD_PREFIX = "$ACTION_";

/** Stamped on a form by the server: `actionKeyOf` of its action. */
export const ACTION_KEY_ATTRIBUTE = "data-action-key";
/** Stamped on every `ActionForm`, which handles its own failure; the global guard leaves those alone. */
export const ACTION_FORM_ATTRIBUTE = "data-action-form";

export type TransportFailure = "network" | "unexpected";

/**
 * A `fetch` that got no answer, per browser: Chromium, Firefox, Safari. Any other `TypeError` is a
 * bug in the page, not the network.
 */
const FETCH_FAILURE_WORDS = /^(Failed to fetch|NetworkError\b|Load failed)/;

/**
 * The network's failure of a Server Action call, or `null` — never a refusal, a redirect, a 404,
 * a server error (those carry a `digest`) or "Server Action not found" (a plain post fails too).
 */
export function transportFailureOf(error: unknown): TransportFailure | null {
  if (!error || typeof error !== "object") return null;
  if ("digest" in error && (error as { digest?: unknown }).digest !== undefined) return null;
  if (error instanceof TypeError) return FETCH_FAILURE_WORDS.test(error.message) ? "network" : null;
  if (!(error instanceof Error)) return null;
  const code = (error as { __NEXT_ERROR_CODE?: unknown }).__NEXT_ERROR_CODE;
  if (code === UNEXPECTED_RESPONSE_CODE || error.message === UNEXPECTED_RESPONSE_MESSAGE) return "unexpected";
  return null;
}

/** One press of a form, as the replay needs it. */
export type Submission = {
  /** The values as they stood, with the pressed button's own name and value where it has them. */
  entries: Array<[string, FormDataEntryValue]>;
  /** The page's address without its fragment. */
  url: string;
  key: string | null;
  formId: string | null;
  /** Its place among the page's forms with the same key (or id), and how many there were. */
  ordinal: number;
  siblings: number;
  submitter: {
    name: string;
    /** Index and words, to find the button in the server's HTML. */
    index: number;
    text: string;
    /** A browser-drawn button action (`formaction="javascript:…"`): its fields exist only in the server's HTML. */
    ownAction: boolean;
  } | null;
  at: number;
};

function isSubmitButton(element: Element): element is HTMLButtonElement | HTMLInputElement {
  if (element instanceof HTMLButtonElement) return element.type === "submit";
  return element instanceof HTMLInputElement && (element.type === "submit" || element.type === "image");
}

function submitButtonsOf(form: HTMLFormElement): Array<HTMLButtonElement | HTMLInputElement> {
  return Array.from(form.elements).filter(isSubmitButton);
}

function wordsOf(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function pageUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function sameKeySiblings(root: ParentNode, key: string | null, formId: string | null): HTMLFormElement[] {
  if (key) return Array.from(root.querySelectorAll<HTMLFormElement>(`form[${ACTION_KEY_ATTRIBUTE}="${CSS.escape(key)}"]`));
  if (formId) return Array.from(root.querySelectorAll<HTMLFormElement>(`form[id="${CSS.escape(formId)}"]`));
  return [];
}

/** Read one press: the values now, the button, and how to find the form again. */
export function describeSubmission(form: HTMLFormElement, submitter: HTMLElement | null): Submission {
  const button = submitter && isSubmitButton(submitter) && submitter.form === form ? submitter : null;
  let data: FormData;
  try {
    data = button ? new FormData(form, button) : new FormData(form);
  } catch {
    data = new FormData(form);
  }
  const key = form.getAttribute(ACTION_KEY_ATTRIBUTE);
  const formId = form.getAttribute("id");
  const siblings = sameKeySiblings(document, key, formId);
  const ownActionAttribute = button?.getAttribute("formaction") ?? "";
  return {
    entries: Array.from(data.entries()),
    url: pageUrl(),
    key,
    formId,
    ordinal: Math.max(0, siblings.indexOf(form)),
    siblings: siblings.length,
    submitter: button
      ? {
          name: button.name,
          index: submitButtonsOf(form).indexOf(button),
          text: wordsOf(button),
          ownAction: ownActionAttribute.startsWith("javascript:"),
        }
      : null,
    at: Date.now(),
  };
}

const isActionField = (name: string) => name.startsWith(ACTION_FIELD_PREFIX);

/** The press's own values when they already carry the `$ACTION_…` fields (server-drawn), else `null`. */
export function entriesFromPress(submission: Submission): Array<[string, FormDataEntryValue]> | null {
  if (submission.submitter?.ownAction) return null;
  const submitterName = submission.submitter?.name ?? "";
  const buttonNamesAction = isActionField(submitterName);
  const formFields = submission.entries.some(([name]) => isActionField(name) && name !== submitterName);
  return formFields || buttonNamesAction ? submission.entries : null;
}

/** The server's side of one form: its hidden `$ACTION_…` fields, and the pressed button's own name and value. */
export type ServerFields = { fields: Array<[string, string]>; submitter: [string, string] | null };

/** The same form in the server's HTML and its `$ACTION_…` fields; `null` unless the match is certain. */
export function serverFieldsIn(document: Document, submission: Submission): ServerFields | null {
  const candidates = sameKeySiblings(document, submission.key, submission.formId);
  if (candidates.length === 0 || candidates.length !== submission.siblings) return null;
  const form = candidates[submission.ordinal];
  if (!form) return null;
  const fields: Array<[string, string]> = [];
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLInputElement && element.type === "hidden" && isActionField(element.name)) fields.push([element.name, element.value]);
  }
  let submitter: [string, string] | null = null;
  const pressed = submission.submitter;
  if (pressed && pressed.index >= 0) {
    const button = submitButtonsOf(form)[pressed.index];
    if (button && isActionField(button.name) && wordsOf(button) === pressed.text) submitter = [button.name, button.value];
  }
  if (pressed?.ownAction && !submitter) return null;
  if (fields.length === 0 && !submitter) return null;
  return { fields, submitter };
}

/** The server's fields first, the pressed button's last (the last action named wins). */
export function mergeServerFields(submission: Submission, server: ServerFields): Array<[string, FormDataEntryValue]> {
  const submitterName = submission.submitter?.name ?? "";
  const own = submission.entries.filter(([name]) => !isActionField(name) && !(server.submitter && name === submitterName && submitterName !== ""));
  return [...server.fields, ...own, ...(server.submitter ? [server.submitter] : [])];
}

async function fetchServerFields(submission: Submission): Promise<ServerFields | null> {
  if (!submission.key && !submission.formId) return null;
  try {
    const response = await fetch(submission.url, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "text/html" },
    });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) return null;
    // Redirected elsewhere (the sign-in page): its forms are not this one's.
    if (response.redirected && new URL(response.url).pathname !== new URL(submission.url, window.location.href).pathname) return null;
    const html = await response.text();
    return serverFieldsIn(new DOMParser().parseFromString(html, "text/html"), submission);
  } catch {
    return null;
  }
}

/** Posted as `multipart/form-data`, like React's own no-JavaScript form; a file stays a file. */
function detachedForm(url: string, entries: Array<[string, FormDataEntryValue]>): HTMLFormElement {
  const form = document.createElement("form");
  form.method = "post";
  form.enctype = "multipart/form-data";
  form.acceptCharset = "UTF-8";
  form.action = url;
  form.hidden = true;
  for (const [name, value] of entries) {
    const input = document.createElement("input");
    input.name = name;
    if (typeof value === "string") {
      input.type = "hidden";
      input.value = value;
    } else {
      input.type = "file";
      if (value.size > 0 || value.name !== "") {
        const transfer = new DataTransfer();
        transfer.items.add(value);
        input.files = transfer.files;
      }
    }
    form.append(input);
  }
  return form;
}

/**
 * Send one press again as a plain POST, only from the person's click. `true` when it left;
 * `false` when nothing was sent. The cookie is set only here.
 */
export async function replayNatively(submission: Submission): Promise<boolean> {
  try {
    // Offline, a plain post would land on the browser's error page and lose what was typed.
    if (navigator.onLine === false) return false;
    let entries = entriesFromPress(submission);
    if (!entries) {
      const server = await fetchServerFields(submission);
      if (!server) return false;
      entries = mergeServerFields(submission, server);
    }
    const form = detachedForm(submission.url, entries);
    document.cookie = `${SAVE_FALLBACK_COOKIE}=1; Max-Age=${SAVE_FALLBACK_MAX_AGE_SECONDS}; path=/; SameSite=Lax`;
    document.body.append(form);
    // The prototype's, not the element's: a field named "submit" would shadow the method.
    HTMLFormElement.prototype.submit.call(form);
    return true;
  } catch {
    return false;
  }
}

// The last press of a non-`ActionForm` form, for the admin error boundary where its failure lands.
let lastPress: Submission | null = null;

/** How recent a press must be for the boundary to pair it with an error: a slow network, not an old press. */
export const RECENT_PRESS_MS = 10_000;

export function rememberSubmission(submission: Submission): void {
  lastPress = submission;
}

/** The press a failure may belong to — only while it is recent. Read, not taken: the button takes it. */
export function recentSubmission(now = Date.now(), maxAgeMs = RECENT_PRESS_MS): Submission | null {
  const press = lastPress;
  if (!press || now - press.at > maxAgeMs || press.at > now) return null;
  return press;
}

/** Once sent, a press is never offered again. */
export function forgetSubmission(): void {
  lastPress = null;
}

/**
 * Whether the admin boundary treats an error as a blocked save (§436): only a transport failure
 * right after a remembered press. Any other error goes to the backoffice's boundary (§52).
 */
export function boundaryFailureOf(error: unknown, press: Submission | null, now = Date.now()): TransportFailure | null {
  if (!press || now - press.at > RECENT_PRESS_MS || press.at > now) return null;
  return transportFailureOf(error);
}
