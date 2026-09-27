"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { TranslateOutcome } from "../service";

/** The Server Action the buttons call (`admin/translate/actions.ts#translateFieldAction`). */
export type TranslateAction = (input: unknown) => Promise<TranslateOutcome>;

/**
 * What the backoffice layout tells the buttons (`DECISIONS.md` §464, §482):
 *
 * - `null` — the reader's role writes none of the club's words, so no button anywhere;
 * - `action` set — a translator is configured and the role may use it: every button works;
 * - `action` null — the role may, but this deployment has no DeepL key yet. The per-box buttons
 *   stay away (thirty grey buttons would say nothing), and the one «Copiază și tradu tot» at the
 *   top of each editor is still drawn, greyed, saying why and — for a reader who may open
 *   `/admin/tasks` — linking the row with the steps (`setupHref`). The owner, 2026-09-27: «I
 *   can't find or don't know how to use the AI translate»: a button that is not there cannot be
 *   found, so the one that matters is always there.
 * - `spent` (§NNN) — a key is set, and DeepL's own meter says its one-time credit is spent: the
 *   same as no key — no per-box button, the whole-record one greyed — with the sentence «Creditul
 *   DeepL s-a terminat — vezi Costuri», linked (`costsHref`) for a reader who may open Costuri.
 */
export type TranslateOffer = {
  action: TranslateAction | null;
  setupHref: string | null;
  spent?: boolean;
  costsHref?: string | null;
};

/**
 * Decided once, on the server, by the backoffice layout, which hands the Server Action down with
 * the answer. A courtesy only: the action asks both questions again (BR-REQ-060-01).
 *
 * The action travels in the context rather than being imported by the buttons, so the editor's
 * islands carry no import of the server's session and database: they render the same in a unit
 * test, where no provider means no button.
 */
const TranslateContext = createContext<TranslateOffer | null>(null);

export default function TranslateProvider({ offer, children }: { offer: TranslateOffer | null; children: ReactNode }) {
  return <TranslateContext.Provider value={offer}>{children}</TranslateContext.Provider>;
}

/** What this page offers: null when the reader's role translates nothing. */
export function useTranslateOffer(): TranslateOffer | null {
  return useContext(TranslateContext);
}

/** The action, or null when this page cannot translate (no key, or a role that may not). */
export function useTranslateAction(): TranslateAction | null {
  return useContext(TranslateContext)?.action ?? null;
}
