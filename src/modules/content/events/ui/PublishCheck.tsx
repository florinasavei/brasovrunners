"use client";

import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { revealField } from "@/shared/forms/ActionFormIsland";
import { fieldId } from "@/shared/forms/outcome";
import GlyphButton from "@/shared/ui/GlyphButton";
import { usePublishGaps } from "./MissingForPublish";
import { type CardGapWords, cardGapLine, cardGaps, PUBLISH_GAP_CARD, type PublishGap, type PublishGapBox, publishGapLabel, type PublishGapLabels } from "./publish-check";

/**
 * What publication still needs, one reading of the form shared by the cards' closed lines, the
 * map's chips and the summary "Publică" opens (§406), so none disagree with the Publicare list:
 * all are `missingForPublish` over the boxes as typed plus what is stored for boxes the form does
 * not draw. Starts from the server's answer, so nothing moves when the script arrives.
 */
type PublishCheck = { gaps: readonly PublishGap[] };

const PublishCheckContext = createContext<PublishCheck | null>(null);

export function PublishCheckProvider({
  formId,
  locales,
  initial,
  stored,
  children,
}: {
  /** The form whose boxes are read: the save form on the editor, the create form on the create page. */
  formId: string;
  locales: readonly string[];
  initial: readonly PublishGap[];
  stored?: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const gaps = usePublishGaps(anchor, locales, { initial, formId, stored });
  return (
    <PublishCheckContext.Provider value={{ gaps }}>
      <span ref={anchor} hidden />
      {children}
    </PublishCheckContext.Provider>
  );
}

/** The gaps as the provider reads them, or `fallback` where no provider is (a card drawn alone). */
function usePublishCheck(fallback: readonly PublishGap[]): readonly PublishGap[] {
  return useContext(PublishCheckContext)?.gaps ?? fallback;
}

/**
 * A card's required line on its closed heading (`cardGapLine`). `initial` is the server's answer,
 * used until a provider has one.
 */
export function CardRequiredLine({ box, initial, words }: { box: PublishGapBox; initial: readonly PublishGap[]; words: CardGapWords }) {
  const gaps = usePublishCheck(initial);
  const missing = cardGaps(gaps, box).length > 0;
  return (
    <Box component="span" data-testid={`required-${box}`} data-missing={missing ? "true" : "false"} sx={{ color: missing ? "warning.dark" : "text.secondary" }}>
      {missing && <WarningAmberIcon aria-hidden fontSize="inherit" sx={{ verticalAlign: "-0.15em", mr: 0.5 }} />}
      {cardGapLine(gaps, box, words)}
    </Box>
  );
}

/** Whether a card is missing a box publication needs, as the provider reads it now. */
export function useCardMissing(box: PublishGapBox | null): boolean {
  const gaps = usePublishCheck(NO_GAPS);
  return box !== null && cardGaps(gaps, box).length > 0;
}

const NO_GAPS: readonly PublishGap[] = [];

/** The event a publish press sends when something is missing: the summary with this id answers. */
const ASK_EVENT = "br:publish-gaps";

/**
 * Opens the summary `id` names instead of posting (§406). A window event: the press and the
 * summary sit in different columns, and on the editor in different forms.
 */
export function askPublishGaps(id: string): void {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: id }));
}

/**
 * The editor's "Publică" (§406), never dimmed or hidden. While the saved event lacks a required
 * box (`blocked`, judged on what is stored — publishing publishes the saved row) the press opens
 * the summary; otherwise it submits, and the confirmation (§384) and the server's guard answer.
 */
export function PublishGateButton({ label, blocked, summaryId }: { label: string; blocked: boolean; summaryId: string }) {
  return (
    <GlyphButton
      icon="publish"
      type="submit"
      variant="outlined"
      size="small"
      sx={{ minHeight: 44 }}
      data-testid="publish-button"
      onClick={(event) => {
        if (!blocked) return;
        event.preventDefault();
        askPublishGaps(summaryId);
      }}
    >
      {label}
    </GlyphButton>
  );
}

/**
 * The §47 summary for a publication that cannot happen yet (§406): one link per missing box and
 * language, opening the folds and tab around it. Drawn once a publish press asks; takes focus
 * without scrolling, then brings the first missing card to the top. `gaps`, when given, is the
 * saved event's list; otherwise the provider's, as typed.
 */
export function PublishGapsSummary({
  id,
  title,
  intro,
  labels,
  gaps: fixed,
}: {
  id: string;
  title: string;
  intro: string;
  labels: PublishGapLabels;
  gaps?: readonly PublishGap[];
}) {
  const live = usePublishCheck(NO_GAPS);
  const gaps = fixed ?? live;
  const [asked, setAsked] = useState(0);
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onAsk = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) setAsked((count) => count + 1);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, [id]);

  // Each press answered once, after the summary is drawn: the focus, then the first card.
  const first = gaps[0];
  useEffect(() => {
    if (asked === 0 || !first) return;
    summary.current?.focus({ preventScroll: true });
    revealField(document.getElementById(fieldId(first.name)));
    document.getElementById(PUBLISH_GAP_CARD[first.box])?.scrollIntoView({ block: "start" });
    // Only a new press moves the page; typing into the boxes it named does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  if (asked === 0 || gaps.length === 0) return null;
  return (
    <Alert ref={summary} id={id} severity="error" tabIndex={-1} sx={{ mb: 2, scrollMarginTop: 16 }} data-testid="publish-gaps">
      <AlertTitle>{title}</AlertTitle>
      <Box component="p" sx={{ m: 0 }}>
        {intro}
      </Box>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {gaps.map((gap) => (
          <li key={gap.name}>
            <Link
              href={`#${fieldId(gap.name)}`}
              color="inherit"
              onClick={() => revealField(document.getElementById(fieldId(gap.name)))}
              sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
            >
              {publishGapLabel(gap, labels)}
            </Link>
          </li>
        ))}
      </Box>
    </Alert>
  );
}
