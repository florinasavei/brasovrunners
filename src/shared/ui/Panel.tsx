import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_INLINE_SX } from "./disclosure";
import { PANEL_GLYPHS, type PanelGlyphName } from "./panel-glyphs";
import QuietHelp from "./QuietHelp";
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

/**
 * The `help` variant's own line (§398): no card, no border, no elevation — a caret and a
 * sentence, the way a footnote reads rather than a card. Tight spacing, the density the public
 * pages' `DENSITY.gapXs`/`gapSm` name for the same reason (§380), typed here rather than pulled
 * from that file, which the backoffice does not import.
 */
const HELP_SUMMARY_SX = {
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "wrap",
  rowGap: 0,
  gap: 0.75,
  minHeight: 44,
  cursor: "pointer",
  listStyle: "none",
  "&::-webkit-details-marker": { display: "none" },
  "&::marker": { display: "none" },
} as const;

/** The caret that turns when the `<details>` it sits inside opens — CSS alone, no script. */
const HELP_CARET_SX = {
  color: "text.secondary",
  transition: "transform 120ms ease",
  flexShrink: 0,
  "[open] > summary &": { transform: "rotate(180deg)" },
} as const;

type CommonProps = {
  /** The heading, and — when the panel folds — the words that open it. */
  title: string;
  /** One line under the heading saying what the panel is for. Optional. */
  intro?: string;
  /**
   * What the intro would have said beyond its one sentence (§511): drawn as the discreet «?»
   * (`QuietHelp`) at the end of the intro's line, the words its tooltip and its accessible name.
   * Ignored without an `intro`.
   */
  introMore?: string;
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
   * A glyph leading a `help` panel's line, `aria-hidden`: `"info"` for a legend. Not `icon` —
   * that name is `action-icons.ts`'s own lookup-by-name prop (§318), and this is a plain MUI
   * icon Panel renders itself; the two must never be read as the same thing by the source walk
   * that keeps that table honest.
   */
  legendIcon?: "info";
  /**
   * The boxed frame with no toggle at all, as a `<section>` — for the box that must never be
   * shut: a required tick in a closed box is a Save that silently does nothing (§350).
   */
  static?: boolean;
  id?: string;
  "data-testid"?: string;
  /**
   * The body. A panel without one is its heading and its line alone — the event editor's cards
   * for a role that may only read them (§358): the fact, with nothing to open. Only a panel that
   * does not fold may leave it out; a fold that opens onto nothing is a control that lies.
   */
  children?: ReactNode;
};

/**
 * Every card wears a glyph before its heading (§521; the owner, 2026-09-27: a glyph on every
 * button and every fold header): the subject's picture from `panel-glyphs.ts`, by name, so a
 * closed fold is found by its picture as well as its words. Required on a card — the type
 * refuses a card without one, spread `{...card}` objects included — and absent on the `help`
 * line, whose caret (and `legendIcon`) is its picture already.
 */
type Props = CommonProps &
  (
    | {
        /**
         * The look this panel draws as (§398). `"card"` (the default, and every existing call) is
         * the boxed folder `BOXED_DISCLOSURE_SX` draws. `"help"` is a small clickable line instead
         * — no border, no elevation, `body2` in the secondary ink, a caret that turns — for an
         * explainer nobody needs a heading to find: "Ce înseamnă fiecare tip?" under the event
         * editor's type select, and the field legend on `/admin/emails`, which also takes
         * `legendIcon="info"`. `level` and `tone` are ignored on that variant; there is no card to
         * nest or to warn about. The line always folds (`collapsible` and `static` are read only
         * by the `card` variant): a `help` line's whole point is a caret.
         */
        variant?: "card";
        /** The subject's glyph before the heading, by name (`panel-glyphs.ts`). */
        glyph: PanelGlyphName;
      }
    | {
        /** A small clickable line instead of a card (§398); see `legendIcon`. */
        variant: "help";
        glyph?: undefined;
      }
  );

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
  introMore,
  aside,
  collapsible = false,
  openWhen,
  level = 2,
  tone = "default",
  variant = "card",
  glyph,
  legendIcon,
  static: isStatic = false,
  id,
  "data-testid": testId,
  children,
}: Props) {
  const folds = collapsible && !isStatic;
  const nested = level > 2;
  // The intro's «?», when the panel has more to say than its one sentence (§511).
  const more = introMore ? <QuietHelp text={introMore} /> : null;

  if (variant === "help") {
    return (
      <Box component="details" id={id} data-testid={testId} open={opensByItself(openWhen) || undefined}>
        <Box component="summary" sx={HELP_SUMMARY_SX}>
          {legendIcon === "info" && <InfoOutlinedIcon aria-hidden fontSize="small" sx={{ color: "text.secondary", flexShrink: 0 }} />}
          <ExpandMoreIcon aria-hidden fontSize="small" sx={HELP_CARET_SX} />
          <Typography component="span" variant="body2" color="text.secondary">
            {title}
            {aside ? <Box component="span" sx={{ ml: 0.5 }}>{aside}</Box> : null}
          </Typography>
        </Box>
        {intro && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, pl: 3.25 }}>
            {intro}

            {more}
          </Typography>
        )}
        {children != null && children !== false && <Box sx={{ pl: 3.25, pt: 0.5 }}>{children}</Box>}
      </Box>
    );
  }
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

  const Glyph = glyph ? PANEL_GLYPHS[glyph] : null;
  const heading = (
    <>
      {Glyph && <Glyph aria-hidden sx={FOLD_GLYPH_INLINE_SX} />}
      {title}
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

            {more}
          </Typography>
        )}
        {children != null && children !== false && <Box sx={{ mt: 1.5 }}>{children}</Box>}
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

          {more}
        </Typography>
      )}
      <Box>{children}</Box>
    </Box>
  );
}
