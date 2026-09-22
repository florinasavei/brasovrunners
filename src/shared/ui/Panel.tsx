import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { DISCLOSURE_SUMMARY_SX } from "./disclosure";

type Props = {
  /** The heading, and — when the panel folds — the words that open it. */
  title: string;
  /** One line under the heading saying what the panel is for. Optional. */
  intro?: string;
  /**
   * A figure or a state beside the title, which stays readable while the panel is closed: how
   * many bibs are printed, how many messages wait. A closed fold that says nothing is a fold
   * nobody opens.
   */
  aside?: ReactNode;
  /** Whether the panel folds at all. A panel that holds one line does not need to. */
  collapsible?: boolean;
  /** Open on arrival. Ignored unless `collapsible`. */
  defaultOpen?: boolean;
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
 * **A panel that holds a form starts open.** A closed `<details>` is not in the accessibility
 * tree at all — a screen reader cannot find its heading, and neither could the e2e suite, which
 * is how this was caught. So `defaultOpen={false}` is for what is *read* and only when there is
 * nothing in it to act on: the outbox queue with nothing waiting. Everything with a control in
 * it folds on request and not on arrival.
 *
 * **A Server Component over `<details>`, never client state.** The same reasoning `SubNav`
 * records: the backoffice works with JavaScript off, and a panel whose open state lived in
 * React would be a panel that does not open before hydration — on the very screens a volunteer
 * opens on a phone at the desk. `DISCLOSURE_SUMMARY_SX` is what makes the summary read as a
 * control (§164), and it carries the 44-pixel target with it.
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
  defaultOpen = true,
  id,
  "data-testid": testId,
  children,
}: Props) {
  const frame = {
    border: 1,
    borderColor: "divider",
    borderRadius: 1,
    px: 2,
    py: collapsible ? 0.5 : 2,
    scrollMarginTop: 16,
  } as const;

  const heading = (
    <>
      {title}
      {aside ? (
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
          {aside}
        </Typography>
      ) : null}
    </>
  );

  if (!collapsible) {
    return (
      <Box component="section" id={id} data-testid={testId} sx={frame}>
        <Typography variant="h2" sx={{ fontSize: "1.1rem" }}>
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
    <Box component="details" id={id} data-testid={testId} open={defaultOpen || undefined} sx={frame}>
      {/*
        The heading is an `h2` **inside** the summary, not the summary itself.

        `component="summary"` with `variant="h2"` was the first version, and it is a trap: the
        variant is only the typography, so the element is a `<summary>` and carries no heading
        role at all. The section then exists for a pointer and disappears from the heading list
        a screen reader navigates by — the e2e suite caught it as "no heading with that name".
        A block heading inside the summary keeps both: the disclosure's own behaviour and the
        landmark. The `sx` stays on the summary, because that is what must not be `display:
        flex` (Chrome and Safari drop the marker when it is).
      */}
      <Box component="summary" sx={DISCLOSURE_SUMMARY_SX}>
        <Typography component="h2" variant="h2" sx={{ fontSize: "1.1rem", display: "inline" }}>
          {heading}
        </Typography>
      </Box>
      {intro && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {intro}
        </Typography>
      )}
      <Box sx={{ pb: 1.5 }}>{children}</Box>
    </Box>
  );
}
