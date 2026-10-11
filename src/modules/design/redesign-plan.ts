/**
 * The redesign plan's rows, as data (§692): the twelve decisions only the club can make and the
 * seven phases, each with a status the dispatcher moves as the work lands. The words of each row
 * are in the catalogues (`Admin.design.plan.decisions.<id>`, `Admin.design.plan.phases.<id>`), in
 * both languages; the full text is the repository document `REDESIGN_DOC_PATH`, English, kept by
 * the dispatcher — a typed list and a document, never a Markdown renderer in the page.
 *
 * Today decision 3 is `decided` (2026-10-10), and decisions 1, 2, 9 and 12 are `decided` by their
 * defaults (the owner, 2026-10-11: phases 1 and 2 start with the plan's defaults — the pink pair, Inter
 * 800, one setting «Aspectul nou» (§708); «Evenimente speciale» is everything that is not a weekly
 * series (§709)); the others are `default` (the dispatcher's default stands until the club answers).
 * Phases 1 and 2 are `building` — phase 1 behind the setting, off until the club's yes on QA; phase 2's
 * gate is the club's photographs — and so is phase 4, the calendar, behind the same setting — and the rest `planned`. `decided` is the club's answer in writing, `open` a question the club
 * reopened; `building` a phase whose chains run, `released` one on production.
 */
export type DecisionStatus = "default" | "decided" | "open";
export type PhaseStatus = "planned" | "building" | "released";

export type RedesignDecision = { readonly id: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12; readonly status: DecisionStatus };
export type RedesignPhase = { readonly id: 0 | 1 | 2 | 3 | 4 | 5 | 6; readonly status: PhaseStatus };

export const REDESIGN_DECISIONS: readonly RedesignDecision[] = [
  { id: 1, status: "decided" },
  { id: 2, status: "decided" },
  { id: 3, status: "decided" },
  { id: 4, status: "default" },
  { id: 5, status: "default" },
  { id: 6, status: "default" },
  { id: 7, status: "default" },
  { id: 8, status: "default" },
  { id: 9, status: "decided" },
  { id: 10, status: "default" },
  { id: 11, status: "default" },
  { id: 12, status: "decided" },
];

export const REDESIGN_PHASES: readonly RedesignPhase[] = [
  { id: 0, status: "planned" },
  { id: 1, status: "building" },
  // Phase 2 (§709): the cover per event, the editor's «Copertă», the kind — built; the club's photos are its gate.
  { id: 2, status: "building" },
  { id: 3, status: "planned" },
  // Phase 4: the calendar's chips, colours and legend, the next-event panel, the subscribe box — built behind «Aspectul nou», off.
  { id: 4, status: "building" },
  { id: 5, status: "planned" },
  { id: 6, status: "planned" },
];

/** The plan's full text, in the repository; the page names the path, it does not render the file. */
export const REDESIGN_DOC_PATH = "docs/REDESIGN.md";
