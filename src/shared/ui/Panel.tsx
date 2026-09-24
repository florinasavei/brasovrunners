import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { BOXED_DISCLOSURE_SX } from "./disclosure";
import { type FoldOpenWhen, opensByItself } from "./fold";

/**
 * What a box is saying about itself beyond its words (§350, the event editor's boxes):
 * `risk` — changing what is inside reaches people who already registered, an amber border;
 * `danger` — what is inside destroys, the red the erase panel has always had.
 */
export type PanelTone = "default" | "risk" | "danger";

/** The border a tone draws, over the boxed fold's own (the erase panel's override, named). */
function toneSx(tone: PanelTone) {
  if (tone === "risk") return { borderColor: "warning.main", borderLeftWidth: 4 } as const;
  if (tone === "danger") return { borderColor: "error.main" } as const;
  return {} as const;
}

/**
 * A card inside a card inside a card still fits at 320 pixels (§350): levels 3 and 4 pad a step
 * narrower on a phone, and the summary reaches the border with the same negative margin.
 */
const NESTED_PADDING = { xs: 1.5, sm: 2 } as const;
const BOXED_SUMMARY = BOXED_DISCLOSURE_SX["& > summary"];
const NESTED_FOLD_SX = {
  px: NESTED_PADDING,
  "& > summary": { ...BOXED_SUMMARY, mx: { xs: -1.5, sm: -2 }, px: NESTED_PADDING },
} as const;

type Props = {
  /** The heading, and — when the panel folds — the words that open it. */
  title: string;
  /** One line under the heading saying what the panel is for. Optional. */
  intro?: string;
  /**
   * A figure or a state beside the title, which stays readable while the panel is closed: how
   * many bibs are printed, how many messages wait, which plan the account is on, where the
   * contact messages go. A closed fold that says nothing is a fold nobody opens.
   */
  aside?: ReactNode;
  /** Whether the panel folds at all. A panel that holds one line does not need to. */
  collapsible?: boolean;
  /**
   * Why this fold opens by itself (`shared/ui/fold.ts`, §336). Closed when absent or when no
   * reason holds. Ignored unless `collapsible`.
   */
  openWhen?: FoldOpenWhen;
  /**
   * The heading's level: 2 for a panel on the screen, 3 for a fold inside one — the message
   * cards inside "Emailurile trimise participanților" — 4 for a card inside that (the event
   * editor's "Numere de concurs (BIB)" › "Cum arată numărul de concurs"), so the heading list a
   * screen reader navigates by has the same shape as the screen.
   */
  level?: 2 | 3 | 4;
  /** The border's meaning (`PanelTone`); the plain box when absent. */
  tone?: PanelTone;
  /**
   * A short state beside the title, as a chip, readable while the fold is shut — "23 înscriși"
   * on a box whose change reaches them. Plain text: the chip is drawn here.
   */
  badge?: string;
  /**
   * The boxed frame with no toggle at all, as a `<section>` — for the box that must never be
   * shut: a required tick in a closed box is a Save that silently does nothing (§350).
   */
  static?: boolean;
  id?: string;
  "data-testid"?: string;
  children: ReactNode;
};

/**
 * One box around one thing in the backoffice (`DECISIONS.md` §269; the owner, 2026-09-22:
 * "overall I want the admin area to have more boxes and collapsables").
 *
 * The screens had grown into long scrolls of loose rows — the registrations list is a heading,
 * a bib toolbar, a counter strip, an outbox line, eight filter fields and a table, none of them
 * separated by anything but vertical space. Half of them are read once a week and occupy the
 * screen every time. A box says where one thing ends, and a fold takes the ones that are not
 * today's work out of the way without hiding that they exist.
 *
 * **A fold starts closed, and opens by itself when it holds something to see** (§336, reversing
 * §269's "a panel that holds a form starts open"; the owner, 2026-09-23: "I would like the
 * accordions to be closed by default"). §269's reason was a heading nobody could find, and it
 * was the heading's fault rather than the fold's: the heading was once the `<summary>` itself
 * with a heading's typography, which carries no heading role. It is a real `h2` inside the
 * summary now, and a summary is rendered while its fold is shut — so the heading list and the
 * e2e suite find every closed panel by name, and what is out of sight is only the body. What
 * still has to be seen is opened by `openWhen`, which names why: a refusal from the panel's own
 * form, its own save, something that asks for action, a filter or a language shaping the page.
 * A kept form's refusal (§315) and a `#fragment` are handled beside it — `shared/ui/fold.ts`
 * says where.
 *
 * **A Server Component over `<details>`, never client state.** The same reasoning `SubNav`
 * records: the backoffice works with JavaScript off, and a panel whose open state lived in
 * React would be a panel that does not open before hydration — on the very screens a volunteer
 * opens on a phone at the desk. `BOXED_DISCLOSURE_SX` is what draws the box and makes the
 * summary read as a control — a bar with a wash behind it (§164, and the owner's "mai
 * boxed") — and it carries the 44-pixel target with it. The same object every other fold in
 * the backoffice spreads, so they all change together.
 *
 * **The summary is never `display: flex`.** Chrome and Safari drop the disclosure marker when
 * it is, which is exactly how a fold becomes grey text; the title and the aside are inline
 * elements inside it instead.
 */
export default function Panel({
  title,
  intro,
  aside,
  collapsible = false,
  openWhen,
  level = 2,
  tone = "default",
  badge,
  static: isStatic = false,
  id,
  "data-testid": testId,
  children,
}: Props) {
  const folds = collapsible && !isStatic;
  const nested = level > 2;
  // The open section and the fold are the same box — the fold's border, radius, surface and
  // padding come from the shared object, so a screen of both reads as one system.
  const frame = folds
    ? ({ ...BOXED_DISCLOSURE_SX, ...(nested ? NESTED_FOLD_SX : {}), ...toneSx(tone), scrollMarginTop: 16 } as const)
    : ({
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        px: nested ? NESTED_PADDING : 2,
        py: 2,
        bgcolor: "background.paper",
        scrollMarginTop: 16,
        ...toneSx(tone),
      } as const);

  const headingTag = level === 4 ? "h4" : level === 3 ? "h3" : "h2";
  // A fold inside a panel reads a step smaller, so the card and its cards are told apart.
  const headingSize = level === 4 ? "0.95rem" : level === 3 ? "1rem" : "1.1rem";

  const heading = (
    <>
      {title}
      {badge ? (
        <Chip component="span" size="small" color="warning" variant="outlined" label={badge} sx={{ ml: 1, verticalAlign: "middle", fontWeight: 400 }} />
      ) : null}
      {aside ? (
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
          {aside}
        </Typography>
      ) : null}
    </>
  );

  if (!folds) {
    return (
      <Box component="section" id={id} data-testid={testId} sx={frame}>
        <Typography component={headingTag} variant="h2" sx={{ fontSize: headingSize }}>
          {heading}
        </Typography>
        {intro && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {intro}
          </Typography>
        )}
        <Box sx={{ mt: 1.5 }}>{children}</Box>
      </Box>
    );
  }

  return (
    <Box component="details" id={id} data-testid={testId} open={opensByItself(openWhen) || undefined} sx={frame}>
      {/*
        The heading is an `h2` **inside** the summary, not the summary itself.

        `component="summary"` with `variant="h2"` was the first version, and it is a trap: the
        variant is only the typography, so the element is a `<summary>` and carries no heading
        role at all. The section then exists for a pointer and disappears from the heading list
        a screen reader navigates by — the e2e suite caught it as "no heading with that name".
        A block heading inside the summary keeps both: the disclosure's own behaviour and the
        landmark. The summary's own look — the wash, the padding, the 44 pixels — is addressed
        from the `<details>` by `BOXED_DISCLOSURE_SX`, and it is never `display: flex` (Chrome
        and Safari drop the marker when it is).
      */}
      <Box component="summary">
        <Typography component={headingTag} variant="h2" sx={{ fontSize: headingSize, display: "inline" }}>
          {heading}
        </Typography>
      </Box>
      {intro && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {intro}
        </Typography>
      )}
      <Box>{children}</Box>
    </Box>
  );
}
