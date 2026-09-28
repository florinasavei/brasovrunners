"use client";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import { type CSSProperties, type FormEvent, type ReactNode, useActionState, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import { choiceAnswer, type ConfirmSpec, fillFromForm, pickConfirm, resolveBodyCount, resolveEmailCount } from "@/shared/feedback/notice";
import { useToast } from "@/shared/feedback/toast-context";
import { openFoldsAround, REVEAL_EVENT } from "@/shared/ui/fold";
import { fieldId, type FormOutcome } from "./outcome";
import { RecallProvider } from "./recall";
import { describeSubmission, replayNatively, transportFailureOf } from "./save-fallback";
import SaveBlockedNotice from "./SaveBlockedNotice";

/**
 * Bring a box into view: open every fold around it and let its language tab strip bring the tab
 * forward (`REVEAL_EVENT` bubbles). A box out of view cannot take focus; §350.
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
  /** "What you typed is still in the boxes." */
  kept: string;
  /** After a CONFLICT: sending again meets the same stale version, so copy, then reload. */
  keptConflict: string;
};

export type ActionFormAction = (state: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>;

export const REFUSAL_SUMMARY_ID = "form-refusal";

/**
 * Fill a raw catalogue template (`t.raw`: a function cannot cross from a Server Component) with
 * `FormOutcome.errorValues`. An unfilled placeholder stays visible rather than blanked.
 */
function sentenceFor(template: string, values: Readonly<Record<string, string>> | undefined): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

/**
 * A backoffice form whose refusal comes back with every box still filled (§315), with or without
 * JavaScript (`useActionState`); the summary is §47's, focusable and first in the form.
 *
 * `confirm` (§384): the submit is `preventDefault()`ed (React's form-action listener checks
 * `defaultPrevented`) and a "yes" calls `requestSubmit()` with the same submitter. Without
 * JavaScript the form just posts; the server holds every rule (BR-REQ-060-01). A returned
 * `notice` becomes a toast after paint (§371); a refusal never does.
 *
 * A transport failure (§436) offers «Trimite pe calea simplă» and is never re-sent on its own:
 * the server may have run the action (`save-fallback.ts`).
 */
export default function ActionFormIsland({
  action,
  actionKey,
  messages,
  confirm,
  children,
  scope,
  ...formProps
}: {
  action: ActionFormAction;
  /** The Server Action's key (`actionKeyOf`), stamped by `ActionForm.tsx`; absent when it has none. */
  actionKey?: string;
  /** Absent when the action only redirects with `?error=`, so row forms don't ship the catalogue. */
  messages?: RefusalMessages;
  /** Ask before sending: one dialog, or the first of several whose `when` the form meets. */
  confirm?: ConfirmSpec | readonly ConfirmSpec[];
  children: ReactNode;
  /** Id prefix for a form sharing its page with another that posts the same names (`fieldId`). */
  scope?: string;
  id?: string;
  className?: string;
  /** A form a "⋮" menu submits by id: rendered, never seen. */
  hidden?: boolean;
  style?: CSSProperties;
  "data-testid"?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  // The button behind the last submit: «Trimite pe calea simplă» sends it again with the form (§436).
  const lastSubmitter = useRef<HTMLElement | null>(null);
  // The network refused the save; the simple way is offered, never taken on its own (§436).
  const [blocked, setBlocked] = useState(false);

  // Catches a transport failure before the error boundary takes the typed form off the page;
  // sends nothing, only draws the notice (§436).
  const guardedAction: ActionFormAction = async (previous, data) => {
    try {
      return await action(previous, data);
    } catch (error) {
      if (!transportFailureOf(error) || !form.current) throw error;
      setBlocked(true);
      return previous;
    }
  };

  // The notice's button: the form as it stands now, with the button that was pressed.
  const sendSimple = async (): Promise<boolean> => {
    const element = form.current;
    if (!element) return false;
    return replayNatively(describeSubmission(element, lastSubmitter.current));
  };
  // On the server the bare action writes the no-JavaScript fields.
  const [state, formAction] = useActionState(typeof window === "undefined" ? action : guardedAction, null);
  const toast = useToast();

  // The question on screen, with the button that asked it — the submitter, replayed on "yes".
  const [asking, setAsking] = useState<{ spec: ConfirmSpec; submitter: HTMLElement | null } | null>(null);
  // The one submit that follows a "yes": let it through, then ask again next time.
  const confirmed = useRef(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    lastSubmitter.current = ((event.nativeEvent as SubmitEvent).submitter ?? null) as HTMLElement | null;
    // A new press answers the old notice: it will be offered again if this one is blocked too.
    setBlocked(false);
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
    const valuesOf = (field: string) => data.getAll(field).filter((value): value is string => typeof value === "string");
    // A body that counts the ticks (§532): with none ticked, nothing to ask — the server refuses.
    const ticked = resolveBodyCount(spec, valuesOf);
    if (!ticked) return;
    event.preventDefault();
    // A series save's email line, summed over the dates ticked at this press (§384).
    const counted = resolveEmailCount(ticked, valuesOf);
    // A typed value named in the sentence (§511): «Limita nouă: 100 ore-CU.».
    const resolved = fillFromForm(counted, (field) => {
      const value = data.get(field);
      return typeof value === "string" ? value : null;
    });
    setAsking({ spec: resolved, submitter });
  };

  const answer = (which: "confirm" | "alternative") => {
    const pending = asking;
    setAsking(null);
    const element = form.current;
    if (!pending || !element) return;
    // A two-way question (§540): the answer is the hidden field's value, set before the form is sent.
    const chosen = choiceAnswer(pending.spec, which);
    if (chosen) {
      const input = element.elements.namedItem(chosen.field);
      if (input instanceof HTMLInputElement) input.value = chosen.value;
    }
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

  // Bumped per answer during render (an effect would paint the old values first): stateful
  // islands key on it and re-mount from the recalled values.
  const [tracked, setTracked] = useState<{ state: FormOutcome | null; generation: number }>({ state, generation: 0 });
  if (tracked.state !== state) setTracked({ state, generation: tracked.generation + 1 });

  // Memoised: a press re-renders this component (pending state), and a new object would
  // re-render every recalled box for nothing (§371, `tests/e2e/perf/inp.spec.ts`).
  const fieldError = messages?.fieldError ?? "";
  const recall = useMemo(
    () => ({ values: state?.values ?? null, fields: state?.fields ?? [], generation: tracked.generation, fieldError, scope }),
    [state, tracked.generation, fieldError, scope],
  );

  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state?.error) return;
    // Reveal the named boxes in order, so the first one's tab ends on top (§350).
    for (const name of state.fields) revealField(document.getElementById(fieldId(name, scope)));
    // An element in a closed `<details>` cannot take focus (§336).
    openFoldsAround(summary.current);
    summary.current?.focus();
  }, [state, scope]);

  // A required box in a closed fold or hidden tab: revealed during `invalid`, before the browser
  // tries to focus it (§350).
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
    // `data-action-key` and `data-action-form` are `ACTION_KEY_ATTRIBUTE` and `ACTION_FORM_ATTRIBUTE` (§436).
    <form ref={form} action={formAction} {...formProps} data-action-key={actionKey} data-action-form="" onInvalidCapture={onInvalidCapture} onSubmit={onSubmit}>
      <RecallProvider value={recall}>
        {blocked && <SaveBlockedNotice onSend={sendSimple} />}
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
                      // Reveal the box before the browser scrolls to the fragment (§350).
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
      {asking && (
        <ConfirmDialog
          spec={asking.spec}
          open
          onCancel={() => setAsking(null)}
          onConfirm={() => answer("confirm")}
          // A two-way question (§540): the quiet answer beside the primary one, never on Enter.
          alternative={asking.spec.choice ? { label: asking.spec.choice.alternativeLabel, onClick: () => answer("alternative") } : null}
        />
      )}
    </form>
  );
}
