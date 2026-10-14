"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { type ActionFormAction, RefusalSummary, type RefusalMessages, useKeptForm } from "./ActionFormIsland";
import { FormOwnerProvider } from "./form-owner";
import { type Recall, RecallProvider } from "./recall";
import SaveBlockedNotice from "./SaveBlockedNotice";

/**
 * A kept form (§315) whose boxes are drawn inside another form's markup (§NNN): «Puncte de control»
 * inside «Traseul», a card of the event editor's one save form. HTML forms cannot nest, so it is
 * three pieces where `ActionForm` is one:
 *
 * - **`DetachedActionForm`** (this, through the server wrapper `DetachedActionForm.tsx`) holds the
 *   action's state — the `useActionState` `ActionForm` holds, the same hook (`useKeptForm`) — and
 *   wraps both of the others, so it stands around the save form in the tree and draws nothing;
 * - **`DetachedForm`** is the `<form>` element itself, placed *beside* the save form, never in it —
 *   hidden, with the hidden fields every press posts;
 * - **`DetachedFields`** wraps the boxes and buttons wherever they are drawn: it names the form they
 *   belong to (`FormOwnerProvider`, so each house primitive writes the `form` attribute on its own
 *   control), recalls what a refusal kept (`RecallProvider`), and draws the refusal's summary and a
 *   blocked save's notice right above the boxes, where `ActionForm` draws them.
 *
 * What the browser then does is what the attribute says: a press of a button whose `form` names the
 * detached form posts that form's boxes and none of the save form's; «Salvează» posts the save
 * form's and none of these (`FormData` and `form.elements` follow the attribute, and so do the
 * browser's validation and the Enter key's default button). With scripts off it is the same plain
 * POST: the detached `<form>` carries React's no-JavaScript fields, and the refusal comes back in
 * the page this hook's state renders.
 */
type Detached = {
  id: string;
  actionKey?: string;
  messages?: RefusalMessages;
  scope?: string;
  kept: ReturnType<typeof useKeptForm>;
};

const DetachedContext = createContext<Readonly<Record<string, Detached>>>({});

/** No answer yet: the boxes show what the page gave them, never the save form's recall. */
const NOTHING_KEPT: Recall = { values: null, fields: [], generation: 0, fieldError: "" };

export default function DetachedActionFormIsland({
  id,
  action,
  actionKey,
  messages,
  scope,
  children,
}: {
  /** The `<form>`'s id, which every box's `form` attribute names. */
  id: string;
  action: ActionFormAction;
  actionKey?: string;
  messages?: RefusalMessages;
  /** The ids' prefix, as on `ActionForm` (`fieldId`): the boxes share the page with the save form's. */
  scope?: string;
  children: ReactNode;
}) {
  const outer = useContext(DetachedContext);
  const kept = useKeptForm(action, messages?.fieldError ?? "", scope);
  const value = useMemo(() => ({ ...outer, [id]: { id, actionKey, messages, scope, kept } }), [outer, id, actionKey, messages, scope, kept]);
  return <DetachedContext.Provider value={value}>{children}</DetachedContext.Provider>;
}

/** The detached `<form>`: hidden, beside the save form; its children are the fields every press posts. */
export function DetachedForm({ id, children }: { id: string; children?: ReactNode }) {
  const detached = useContext(DetachedContext)[id];
  if (!detached) throw new Error(`DetachedForm "${id}" is drawn outside its DetachedActionForm`);
  const { actionKey } = detached;
  const { form, formAction, pressed } = detached.kept;
  return (
    // `data-action-key` and `data-action-form` as on `ActionForm` (§436): a blocked press finds this form again.
    <form
      ref={form}
      id={id}
      action={formAction}
      hidden
      data-action-key={actionKey}
      data-action-form=""
      onSubmit={(event) => pressed(((event.nativeEvent as SubmitEvent).submitter ?? null) as HTMLElement | null)}
    >
      {children}
    </form>
  );
}

/**
 * The detached form's boxes, wherever the page draws them. Outside its `DetachedActionForm` (a unit
 * test drawing the card alone) the boxes still name their form and recall nothing — never the save
 * form's values, and never posted with it.
 */
export function DetachedFields({ form, children }: { form: string; children: ReactNode }) {
  const detached = useContext(DetachedContext)[form];
  const pending = detached?.kept.pending ?? false;
  const owner = useMemo(() => ({ id: form, pending }), [form, pending]);
  const kept = detached?.kept;
  return (
    <FormOwnerProvider value={owner}>
      <RecallProvider value={kept?.recall ?? NOTHING_KEPT}>
        {kept?.blocked && <SaveBlockedNotice onSend={kept.sendSimple} />}
        {kept?.state?.error && <RefusalSummary state={kept.state} messages={detached?.messages} scope={detached?.scope} />}
        {children}
      </RecallProvider>
    </FormOwnerProvider>
  );
}
