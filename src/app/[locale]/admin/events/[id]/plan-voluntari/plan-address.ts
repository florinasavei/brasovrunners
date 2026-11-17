/*
  The addresses of «Planul voluntarilor» (§974; the owner, 2026-11-17, of the page's long run of cards: «vreau secțiuni
  colapsabile aici la plan voluntari că nu mai înțeleg nimic: de fapt tabel sau mai multe views»): which of its two views the
  page draws, which point and which fold it comes back with open, and the refusal it says — one builder for the page's own
  links and for every press's way back, so the two never disagree. A plain module, never a "use server" file: nothing here
  is a verb a browser may call, and it names no person, no point and no word of the plan.
*/

/** The page's two views: «Tabel» (the default) and «Pe puncte». */
export type PlanView = "table" | "points";

/** The view an address or a form names: «Pe puncte» when it says so, «Tabel» for anything else — the page's default. */
export function planViewOf(value: unknown): PlanView {
  return value === "points" ? "points" : "table";
}

/**
 * The fold a press that went through comes back open in (`saved=`, `shared/ui/fold.ts`'s «saved»): one word a fold, whatever
 * the press's own outcome — a picture changed or left as it was, a point added, the volunteers told.
 */
export const PLAN_SAVED = { picture: "planPicture", added: "planPointAdded", sent: "planPointsSent" } as const;

type PlanAddress = {
  view: PlanView;
  /** The point the press changed, which the page draws open, in its open group. «Pe puncte» alone has points to open. */
  open?: string;
  /** The fold the press saved in (`PLAN_SAVED`), written as the address's `saved=`. */
  savedIn?: string;
  /** A refusal's code, which the page's alert says in words (§953). */
  planError?: string;
  /** Where the page lands: a point, a fold, the alert. */
  hash?: string;
};

/** One address of the plan's page, from its path: the view always written out, then what the page opens or says, then where it lands. */
export function planAddress(path: string, { view, open, savedIn, planError, hash }: PlanAddress): string {
  const query = new URLSearchParams({ view });
  if (open && view === "points") query.set("open", open);
  if (savedIn) query.set("saved", savedIn);
  if (planError) query.set("planError", planError);
  return `${path}?${query.toString()}${hash ? `#${hash}` : ""}`;
}
