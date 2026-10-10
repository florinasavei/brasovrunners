/**
 * The redesign plan's rows, as data (§NNN): the twelve decisions only the club can make and the
 * seven phases, each with a status the dispatcher moves as the work lands. The words of each row
 * are in the catalogues (`Admin.design.plan.decisions.<id>`, `Admin.design.plan.phases.<id>`), in
 * both languages; the full text is the repository document `REDESIGN_DOC_PATH`, English, kept by
 * the dispatcher — a typed list and a document, never a Markdown renderer in the page.
 *
 * Today every decision is `default` (the dispatcher's default stands until the club answers) and
 * every phase `planned`. `decided` is the club's answer in writing, `open` a question the club
 * reopened; `building` a phase whose chains run, `released` one on production.
 */
export type DecisionStatus = "default" | "decided" | "open";
export type PhaseStatus = "planned" | "building" | "released";

export type RedesignDecision = { readonly id: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12; readonly status: DecisionStatus };
export type RedesignPhase = { readonly id: 0 | 1 | 2 | 3 | 4 | 5 | 6; readonly status: PhaseStatus };

export const REDESIGN_DECISIONS: readonly RedesignDecision[] = [
  { id: 1, status: "default" },
  { id: 2, status: "default" },
  { id: 3, status: "default" },
  { id: 4, status: "default" },
  { id: 5, status: "default" },
  { id: 6, status: "default" },
  { id: 7, status: "default" },
  { id: 8, status: "default" },
  { id: 9, status: "default" },
  { id: 10, status: "default" },
  { id: 11, status: "default" },
  { id: 12, status: "default" },
];

export const REDESIGN_PHASES: readonly RedesignPhase[] = [
  { id: 0, status: "planned" },
  { id: 1, status: "planned" },
  { id: 2, status: "planned" },
  { id: 3, status: "planned" },
  { id: 4, status: "planned" },
  { id: 5, status: "planned" },
  { id: 6, status: "planned" },
];

/** The plan's full text, in the repository; the page names the path, it does not render the file. */
export const REDESIGN_DOC_PATH = "docs/REDESIGN.md";
