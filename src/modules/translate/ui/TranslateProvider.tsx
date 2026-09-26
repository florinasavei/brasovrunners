"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { TranslateOutcome } from "../service";

/** The Server Action the buttons call (`admin/translate/actions.ts#translateFieldAction`). */
export type TranslateAction = (input: unknown) => Promise<TranslateOutcome>;

/**
 * Whether «Tradu din română» is offered on this page, and the action behind it (`DECISIONS.md`
 * §NNN): a translator is configured on this deployment and the reader's role may use it. Decided
 * once, on the server, by the backoffice layout, which hands the Server Action down with the
 * answer; every button reads both and draws nothing without them — no key, no button. A courtesy
 * only: the action asks both questions again (BR-REQ-060-01).
 *
 * The action travels in the context rather than being imported by the buttons, so the editor's
 * islands carry no import of the server's session and database: they render the same in a unit
 * test, where no provider means no button.
 */
const TranslateContext = createContext<TranslateAction | null>(null);

export default function TranslateProvider({ action, children }: { action: TranslateAction | null; children: ReactNode }) {
  return <TranslateContext.Provider value={action}>{children}</TranslateContext.Provider>;
}

/** The action, or null when this page offers no translation. */
export function useTranslateAction(): TranslateAction | null {
  return useContext(TranslateContext);
}
