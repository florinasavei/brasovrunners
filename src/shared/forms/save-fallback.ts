/**
 * A save that a corporate network refused, sent again as a plain browser form (§NNN).
 *
 * The owner, 2026-09-26: "Amalia is still having trouble on her Siemens laptop, but just on some
 * pages, performing some actions in the back-office like saving stuff". Her pages load; her saves
 * do not. A save with JavaScript on is not a form post: it is a `fetch` POST to the page's own
 * address with a `Next-Action` header, and its answer is an RSC stream (`text/x-component`). An
 * inspecting proxy (Zscaler, there) that passes ordinary page loads and form posts can refuse
 * exactly that request, or answer it with its own HTML block page — and then the button went back
 * to rest with nothing saved and nothing said.
 *
 * Every backoffice form already carries the other way in: React writes hidden `$ACTION_…` fields
 * into the server's HTML of a form whose action is a Server Action, so that the form works before
 * (or without) JavaScript — a plain `multipart/form-data` POST to the page, which Next decodes and
 * answers with a 303 to the page the action redirects to, or with the page itself carrying a
 * refusal. That is the request a proxy passes, because it is what every web form sends. So when the
 * scripted call fails *in transport*, the form is sent again that way, with the values as they
 * stand, and the flash cookie (§384) still carries the toast to the page it lands on.
 *
 * What this module decides and does, in the browser only:
 * - `transportFailureOf` — which failures are the network's: the fetch rejected (`TypeError`), or
 *   the answer was not a Server Action's (Next's "An unexpected response was received from the
 *   server.", error `E394` — an HTML block page, a 403). Never a refusal (that is a returned state,
 *   not an error), never a redirect or a 404 (Next's own signals, with a `digest`), never a server
 *   error (a `digest` too), and never "Server Action not found" (a new deployment: a plain post
 *   would fail the same way).
 * - `describeSubmission` — the form, the button that sent it and the values, read once.
 * - `replayNatively` — the plain POST, built as a detached `<form>` so React has no say in it.
 *   The `$ACTION_…` fields come from the form itself when the server drew it; when the browser drew
 *   it (after a client-side navigation the page is rendered from the RSC payload, and React writes
 *   no such fields there) they come from the same form in the page's own HTML, fetched with a plain
 *   GET — the request the proxy lets through — and matched by the key the server stamps on it
 *   (`action-key.ts`). A button with a Server Action of its own must be found there too, by its
 *   place among the form's buttons and its words; anything that cannot be matched with certainty is
 *   not sent at all, because a guessed action could be a different verb.
 */

/** The cookie the replay sets before it leaves, read by the admin layout on the page it lands on. */
export const SAVE_FALLBACK_COOKIE = "br-save-path";
export const SAVE_FALLBACK_MAX_AGE_SECONDS = 60;

/** Next's message and code for an answer that is not a Server Action's (`server-action-reducer`). */
export const UNEXPECTED_RESPONSE_MESSAGE = "An unexpected response was received from the server.";
const UNEXPECTED_RESPONSE_CODE = "E394";

/** The prefix of every field React writes for a Server Action form (`$ACTION_ID_…`, `$ACTION_REF_…`, `$ACTION_KEY`). */
const ACTION_FIELD_PREFIX = "$ACTION_";

/** Stamped on a form by the server: the key `actionKeyOf` computed for its action. */
export const ACTION_KEY_ATTRIBUTE = "data-action-key";
/** Stamped on every `ActionForm`, which handles its own failure; the global guard leaves those alone. */
export const ACTION_FORM_ATTRIBUTE = "data-action-form";

export type TransportFailure = "network" | "unexpected";

/**
 * Whether an error thrown by a Server Action call is the network's (see above), and which kind.
 * `null` for everything else, which then goes where it always went.
 */
export function transportFailureOf(error: unknown): TransportFailure | null {
  if (!error || typeof error !== "object") return null;
  // Next's own signals — a redirect, a 404, a server error — all carry a digest.
  if ("digest" in error && (error as { digest?: unknown }).digest !== undefined) return null;
  if (error instanceof TypeError) return "network";
  if (!(error instanceof Error)) return null;
  const code = (error as { __NEXT_ERROR_CODE?: unknown }).__NEXT_ERROR_CODE;
  if (code === UNEXPECTED_RESPONSE_CODE || error.message === UNEXPECTED_RESPONSE_MESSAGE) return "unexpected";
  return null;
}

/** One press of a form, as the replay needs it. */
export type Submission = {
  /** The values as they stood, with the pressed button's own name and value where it has them. */
  entries: Array<[string, FormDataEntryValue]>;
  /** The page's address without its fragment — where the scripted call went, and where the plain POST goes. */
  url: string;
  /** `data-action-key`, or null. */
  key: string | null;
  /** The form's `id`, or null. */
  formId: string | null;
  /** Its place among the page's forms with the same key (or id), and how many there were. */
  ordinal: number;
  siblings: number;
  submitter: {
    name: string;
    /** Its place among the form's submit buttons, and its words — to find it in the server's HTML. */
    index: number;
    text: string;
    /**
     * A Server Action of its own that the browser drew (`formaction="javascript:…"`): its fields
     * exist only in the server's HTML, and without them the form's own action would run instead.
     */
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

/** The address a plain POST goes to: this page, its query included, its fragment not. */
function pageUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function sameKeySiblings(root: ParentNode, key: string | null, formId: string | null): HTMLFormElement[] {
  if (key) return Array.from(root.querySelectorAll<HTMLFormElement>(`form[${ACTION_KEY_ATTRIBUTE}="${CSS.escape(key)}"]`));
  if (formId) return Array.from(root.querySelectorAll<HTMLFormElement>(`form[id="${CSS.escape(formId)}"]`));
  return [];
}

/** Read one press — the values now, the button that sent them, and how to find the form again. */
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

/**
 * The fields the plain POST carries, when the press already holds everything: the server drew the
 * form (its hidden `$ACTION_…` fields are among the values) and the button, if it has an action of
 * its own, was drawn by the server too (its name is the action's). `null` when something is missing.
 */
export function entriesFromPress(submission: Submission): Array<[string, FormDataEntryValue]> | null {
  if (submission.submitter?.ownAction) return null;
  const submitterName = submission.submitter?.name ?? "";
  const buttonNamesAction = isActionField(submitterName);
  const formFields = submission.entries.some(([name]) => isActionField(name) && name !== submitterName);
  return formFields || buttonNamesAction ? submission.entries : null;
}

/** The server's side of one form: its hidden `$ACTION_…` fields, and the pressed button's own name and value. */
export type ServerFields = { fields: Array<[string, string]>; submitter: [string, string] | null };

/**
 * The same form in the page's HTML as the server draws it, and the fields only that HTML has.
 * `null` whenever the match is not certain: no key and no id, a different number of such forms, a
 * pressed button with an action of its own that is not the same button there.
 */
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

/** The values of the press with the server's fields put in: theirs first, the pressed button's last (the last action named wins). */
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
    // Sent to the sign-in page, or anywhere else: that page's forms are not this one's.
    if (response.redirected && new URL(response.url).pathname !== new URL(submission.url, window.location.href).pathname) return null;
    const html = await response.text();
    return serverFieldsIn(new DOMParser().parseFromString(html, "text/html"), submission);
  } catch {
    return null;
  }
}

/**
 * The detached form: one field per value, a file as a file (`DataTransfer`), posted to the page as
 * `multipart/form-data` — the encoding React's own no-JavaScript form declares.
 */
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
 * Send one press again as a plain browser POST. `true` when it left — the page is on its way to the
 * answer and nothing more should be drawn; `false` when it could not be sent, and nothing was.
 */
export async function replayNatively(submission: Submission): Promise<boolean> {
  try {
    // With no network at all a plain post fails too, onto the browser's own error page — where
    // what was typed is gone. Here, the form keeps it.
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

/*
  The last press of a form that is not an `ActionForm` — a plain `<form action={…}>`, a button
  with its own action — kept for the admin error boundary, which is where such a form's failure
  arrives, after React has taken the form off the page.
*/
let lastPress: Submission | null = null;

export function rememberSubmission(submission: Submission): void {
  lastPress = submission;
}

/** The press the failure belongs to: recent, and handed out once. */
export function takeSubmission(now = Date.now(), maxAgeMs = 120_000): Submission | null {
  const press = lastPress;
  lastPress = null;
  if (!press || now - press.at > maxAgeMs) return null;
  return press;
}
