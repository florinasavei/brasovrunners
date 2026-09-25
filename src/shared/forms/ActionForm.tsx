"use client";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import { type CSSProperties, type FormEvent, type ReactNode, useActionState, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import { type ConfirmSpec, pickConfirm, resolveEmailCount } from "@/shared/feedback/notice";
import { useToast } from "@/shared/feedback/toast-context";
import { openFoldsAround, REVEAL_EVENT } from "@/shared/ui/fold";
import { fieldId, type FormOutcome } from "./outcome";
import { RecallProvider } from "./recall";

/**
 * Bring a box into view wherever it sits (§350): every closed fold around it opened, and the
 * language tab that holds it — if any — brought forward by the strip itself (`REVEAL_EVENT`
 * bubbles up to it). The event editor puts a box three folds and a tab deep, and a box the reader
 * cannot see is a box the browser cannot focus.
 */
export function revealField(element: HTMLElement | null): void {
  if (!element) return;
  openFoldsAround(element);
  element.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }));
}

/** What the summary says, already translated: a Server Component passes strings, never `t`. */
export type RefusalMessages = {
  /** `Admin.errors.<code>`, for every code an action can return. */
  errors: Readonly<Record<string, string>>;
  /** The label of every box the form can name, by its `name` attribute. */
  fields: Readonly<Record<string, string>>;
  /** "The fields to check:" — above the list of links. */
  fieldsIntro: string;
  /** "Check this field." — under a box the refusal named. */
  fieldError: string;
  /** "What you typed is still in the boxes." — the one sentence the owner asked for. */
  kept: string;
  /**
   * The same, after a CONFLICT: the boxes still hold what was typed, but "send again" would meet
   * the same stale version — the colleague's save has to be loaded first, so the sentence says
   * to copy what is needed before reloading.
   */
  keptConflict: string;
};

export type ActionFormAction = (state: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>;

export const REFUSAL_SUMMARY_ID = "form-refusal";

/**
 * A refusal's sentence with the action's words in its placeholders (`FormOutcome.errorValues`).
 *
 * The catalogue reaches this island raw (`refusalMessages` reads `t.raw("errors")`: a function
 * cannot cross from a Server Component), so `{age}` is still `{age}` here — the same template
 * the bulk bar and the photo uploader fill themselves. A placeholder the action did not fill is
 * left as it is rather than blanked, so a missing value is visible instead of a sentence with a
 * hole in it.
 */
function sentenceFor(template: string, values: Readonly<Record<string, string>> | undefined): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

/**
 * A backoffice form whose refusal comes back with every box still filled (`DECISIONS.md` §315).
 *
 * The one client island a form needs for this, and it holds one thing: the outcome the Server
 * Action returned. `useActionState` is what makes it work with JavaScript off — on a plain POST
 * the server runs the action and renders the page with the returned state, so the summary and
 * the recalled values are in the HTML — and with JavaScript on, the same state arrives without a
 * navigation, so the URL carries nothing (§14.5) and the browser stays where it was.
 *
 * The children are the page's own Server Components, rendered as they always were; the fields
 * among them read the recalled values through `RecallProvider`. A successful action redirects
 * from inside itself and this component never sees it.
 *
 * The summary is §47's: focusable, first in the form, naming each field as a link to its box.
 * A label for an indexed box (`event.schedule[2].date`) falls back to its unindexed name.
 *
 * ## Asking first, and saying it worked (§384)
 *
 * `confirm` puts the one `ConfirmDialog` in front of the submit: the `submit` event is caught,
 * the form as it stands is read (with the submitter, so a two-verb form asks the right question),
 * the first spec whose `when` conditions hold is shown, and nothing is sent until its button is
 * pressed — which calls `requestSubmit()` with the same submitter, so React's action receives
 * exactly the fields the first press would have. `preventDefault()` on the submit is what stops
 * React from running the action (`react-dom`'s form-action listener checks `defaultPrevented`).
 * A spec that matches nothing lets the submit through: the event save asks only when the notice
 * box is ticked or the status was set to cancelled. Without JavaScript there is no dialog and
 * the form posts, because every rule that matters is the server's (BR-REQ-060-01).
 *
 * A state the action *returns* with a `notice` reaches the toast provider from an effect, after
 * the answer painted (§371); an action that redirects flashes its notice instead (`flash.ts`).
 * A refusal is never a toast — it is the summary below.
 */
export default function ActionForm({
  action,
  messages,
  confirm,
  children,
  scope,
  ...formProps
}: {
  action: ActionFormAction;
  /**
   * The refusal summary's words. Absent on a form whose action never returns a refusal — a
   * button and hidden fields, which redirect with `?error=` as they always did — so a list of
   * fifty rows does not ship the error catalogue fifty times.
   */
  messages?: RefusalMessages;
  /** Ask before sending: one dialog, or the first of several whose `when` the form meets. */
  confirm?: ConfirmSpec | readonly ConfirmSpec[];
  children: ReactNode;
  /**
   * A prefix for the ids of this form's boxes and of its summary, for a form that shares its
   * page with another posting the same names (`fieldId`). Absent on a page with one form.
   */
  scope?: string;
  id?: string;
  className?: string;
  /** A form a "⋮" menu submits by id: rendered, never seen. */
  hidden?: boolean;
  style?: CSSProperties;
  "data-testid"?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);

  // The question on screen, with the button that asked it — the submitter, replayed on "yes".
  const [asking, setAsking] = useState<{ spec: ConfirmSpec; submitter: HTMLElement | null } | null>(null);
  // The one submit that follows a "yes": let it through, then ask again next time.
  const confirmed = useRef(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!confirm) return;
    if (confirmed.current) {
      confirmed.current = false;
      return;
    }
    const element = event.currentTarget;
    const submitter = ((event.nativeEvent as SubmitEvent).submitter ?? null) as HTMLElement | null;
    let data: FormData;
    try {
      data = submitter ? new FormData(element, submitter) : new FormData(element);
    } catch {
      data = new FormData(element);
    }
    const spec = pickConfirm(confirm, (field) => {
      const value = data.get(field);
      return typeof value === "string" ? value : null;
    });
    if (!spec) return;
    event.preventDefault();
    // A series save's email line, summed over the dates ticked at this press (§384).
    const resolved = resolveEmailCount(spec, (field) => data.getAll(field).filter((value): value is string => typeof value === "string"));
    setAsking({ spec: resolved, submitter });
  };

  const answerYes = () => {
    const pending = asking;
    setAsking(null);
    const element = form.current;
    if (!pending || !element) return;
    confirmed.current = true;
    // The same submitter, so a button's own `formAction` and `name=value` still travel (§287).
    const button = pending.submitter;
    const ownButton = (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) && button.form === element;
    if (ownButton) element.requestSubmit(button);
    else element.requestSubmit();
  };

  // "It worked" without a redirect: the notice, after the answer painted — never in the press.
  useEffect(() => {
    if (state?.notice) toast.show(state.notice);
  }, [state, toast]);

  // A number that changes with every answer, derived during render so the server and the
  // client agree on it: islands with state of their own key on it and re-mount from the
  // recalled values. The "storing information from previous renders" pattern from React's own
  // documentation, not an effect — an effect would paint the old values first.
  const [tracked, setTracked] = useState<{ state: FormOutcome | null; generation: number }>({ state, generation: 0 });
  if (tracked.state !== state) setTracked({ state, generation: tracked.generation + 1 });

  /*
    **One value per answer, not one per render (§371).** A press re-renders this component before
    anything is sent: `useActionState` marks its action pending the moment the form submits, in
    the same task as the press. A value built inline was a new object on that render, so every box
    that reads the recall — every `RecallField`, picker, select, rich-text editor and fold of the
    event editor, a few hundred MUI components — re-rendered too, for nothing: the answer had not
    changed. That was the whole of the owner's "blocked UI updates for 352ms" (1.5–2 s on a phone
    at 4× CPU), measured by `tests/e2e/perf/inp.spec.ts`. Memoised on what the value is made of,
    the press re-renders the buttons that show "Se salvează…" and nothing else; an answer from the
    server still changes it, and every box still re-mounts from the recalled values (§315).
  */
  const fieldError = messages?.fieldError ?? "";
  const recall = useMemo(
    () => ({ values: state?.values ?? null, fields: state?.fields ?? [], generation: tracked.generation, fieldError, scope }),
    [state, tracked.generation, fieldError, scope],
  );

  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state?.error) return;
    // The boxes the refusal names first, in order — a strip answers the first of a pass, so the
    // first named box's tab is the one on top (§350): the event editor's boxes start closed, and
    // a named box the reader cannot see is a refusal they cannot act on.
    for (const name of state.fields) revealField(document.getElementById(fieldId(name, scope)));
    // The folds around the form (§336): backoffice folds start closed, and an element in
    // a closed `<details>` cannot take focus. Normally the person opened it to press and it is
    // still open; this is for whatever closed it in between.
    openFoldsAround(summary.current);
    summary.current?.focus();
  }, [state, scope]);

  /*
    A required box inside a closed fold or behind a hidden tab (§350): the browser fires
    `invalid` on each box it refuses and then focuses the first — which it cannot do while the box
    is out of view. Caught here, during the event, before the browser looks for something to
    focus: the same moment `LocaleTabPanels` has always used for its own tabs.
  */
  const onInvalidCapture = (event: FormEvent<HTMLFormElement>) => {
    revealField(event.target as HTMLElement);
  };

  // The label under the exact name, then unindexed (`event.schedule[].date`), then the panel
  // the name belongs to (`event.bibDesign` for `event.bibDesign.numberScale`), then the name.
  const labelOf = (name: string): string => {
    const unindexed = name.replace(/\[\d+\]/g, "[]");
    const labels = messages?.fields ?? {};
    for (const candidate of [name, unindexed]) if (labels[candidate]) return labels[candidate];
    const parts = unindexed.split(".");
    while (parts.length > 1) {
      parts.pop();
      const shorter = labels[parts.join(".")];
      if (shorter) return shorter;
    }
    return name;
  };

  return (
    <form ref={form} action={formAction} {...formProps} onInvalidCapture={onInvalidCapture} onSubmit={onSubmit}>
      <RecallProvider value={recall}>
        {state?.error && (
          <Alert
            ref={summary}
            id={scope ? `${REFUSAL_SUMMARY_ID}-${scope}` : REFUSAL_SUMMARY_ID}
            severity="error"
            tabIndex={-1}
            sx={{ mb: 3, scrollMarginTop: 16 }}
            data-testid="form-refusal"
          >
            <AlertTitle>{sentenceFor(messages?.errors[state.error] ?? state.error, state.errorValues)}</AlertTitle>
            {state.fields.length > 0 && (
              <Box component="p" sx={{ m: 0 }}>
                {messages?.fieldsIntro}
              </Box>
            )}
            {state.fields.length > 0 && (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {state.fields.map((name) => (
                  <li key={name}>
                    <Link
                      href={`#${fieldId(name, scope)}`}
                      color="inherit"
                      // The box may be folded away or behind a tab: open its way before the
                      // browser scrolls to the fragment (§350).
                      onClick={() => revealField(document.getElementById(fieldId(name, scope)))}
                    >
                      {labelOf(name)}
                    </Link>
                  </li>
                ))}
              </Box>
            )}
            <Box component="p" sx={{ m: 0, mt: state.fields.length > 0 ? 1 : 0 }}>
              {state.error === "CONFLICT" ? messages?.keptConflict : messages?.kept}
            </Box>
          </Alert>
        )}
        {children}
      </RecallProvider>
      {/* The question, drawn only while it is asked: fifty hidden row forms cost no dialog DOM. */}
      {asking && <ConfirmDialog spec={asking.spec} open onCancel={() => setAsking(null)} onConfirm={answerYes} />}
    </form>
  );
}
