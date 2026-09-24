"use client";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import { type ReactNode, useActionState, useEffect, useRef, useState } from "react";
import { openFoldsAround } from "@/shared/ui/fold";
import { fieldId, type FormOutcome } from "./outcome";
import { RecallProvider } from "./recall";

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
 */
export default function ActionForm({
  action,
  messages,
  children,
  scope,
  ...formProps
}: {
  action: ActionFormAction;
  messages: RefusalMessages;
  children: ReactNode;
  /**
   * A prefix for the ids of this form's boxes and of its summary, for a form that shares its
   * page with another posting the same names (`fieldId`). Absent on a page with one form.
   */
  scope?: string;
  id?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const [state, formAction] = useActionState(action, null);

  // A number that changes with every answer, derived during render so the server and the
  // client agree on it: islands with state of their own key on it and re-mount from the
  // recalled values. The "storing information from previous renders" pattern from React's own
  // documentation, not an effect — an effect would paint the old values first.
  const [tracked, setTracked] = useState<{ state: FormOutcome | null; generation: number }>({ state, generation: 0 });
  if (tracked.state !== state) setTracked({ state, generation: tracked.generation + 1 });

  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state?.error) return;
    // The folds around the form first (§336): backoffice folds start closed, and an element in
    // a closed `<details>` cannot take focus. Normally the person opened it to press and it is
    // still open; this is for whatever closed it in between.
    openFoldsAround(summary.current);
    summary.current?.focus();
  }, [state]);

  // The label under the exact name, then unindexed (`event.schedule[].date`), then the panel
  // the name belongs to (`event.bibDesign` for `event.bibDesign.numberScale`), then the name.
  const labelOf = (name: string): string => {
    const unindexed = name.replace(/\[\d+\]/g, "[]");
    for (const candidate of [name, unindexed]) if (messages.fields[candidate]) return messages.fields[candidate];
    const parts = unindexed.split(".");
    while (parts.length > 1) {
      parts.pop();
      const shorter = messages.fields[parts.join(".")];
      if (shorter) return shorter;
    }
    return name;
  };

  return (
    <form action={formAction} {...formProps}>
      <RecallProvider
        value={{
          values: state?.values ?? null,
          fields: state?.fields ?? [],
          generation: tracked.generation,
          fieldError: messages.fieldError,
          scope,
        }}
      >
        {state?.error && (
          <Alert
            ref={summary}
            id={scope ? `${REFUSAL_SUMMARY_ID}-${scope}` : REFUSAL_SUMMARY_ID}
            severity="error"
            tabIndex={-1}
            sx={{ mb: 3, scrollMarginTop: 16 }}
            data-testid="form-refusal"
          >
            <AlertTitle>{sentenceFor(messages.errors[state.error] ?? state.error, state.errorValues)}</AlertTitle>
            {state.fields.length > 0 && (
              <Box component="p" sx={{ m: 0 }}>
                {messages.fieldsIntro}
              </Box>
            )}
            {state.fields.length > 0 && (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {state.fields.map((name) => (
                  <li key={name}>
                    <Link href={`#${fieldId(name, scope)}`} color="inherit">
                      {labelOf(name)}
                    </Link>
                  </li>
                ))}
              </Box>
            )}
            <Box component="p" sx={{ m: 0, mt: state.fields.length > 0 ? 1 : 0 }}>
              {state.error === "CONFLICT" ? messages.keptConflict : messages.kept}
            </Box>
          </Alert>
        )}
        {children}
      </RecallProvider>
    </form>
  );
}
