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
 * What publication still needs, seen from outside every card (§406; the owner, 2026-09-25, of a
 * closed "Titlu și rezumat" whose tabs said only "incomplet": "I need to see on the cards as well
 * what info is required", and of "Creează și publică" dimmed out of sight: "this should be
 * consistent!").
 *
 * One reading of the form, shared by everything that shows it — the closed lines of the cards
 * that hold a required box, the map's chips, the summary "Publică" opens — so they cannot
 * disagree with each other or with the Publicare list: every one of them is `missingForPublish`
 * (`publish-check.ts`), over the boxes as typed, and over what is stored for a box the form does
 * not draw (a language the reader may not write, the place for a role without the settings).
 * Starts from the server's answer, so the first paint is already right and nothing moves when the
 * script arrives.
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
 * A card's required line on its closed heading: «lipsesc: Titlu (RO, EN) · Rezumat (RO)» behind the
 * warning glyph, or «complet» (`cardGapLine`). `initial` is the card's own answer from the server,
 * read until a provider has one.
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
 * Open the summary `id` names (§406): what a publish press does instead of posting while a box
 * publication needs is empty. A window event, because the press and the summary sit in different
 * columns — on the editor, in different forms.
 */
export function askPublishGaps(id: string): void {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: id }));
}

/**
 * The editor's "Publică" (§406): the same button on every event, whatever it lacks — never dimmed,
 * never hidden. While the saved event misses a box publication needs (`blocked`, read on the
 * server by `missingForPublish` over what is stored — publishing publishes what is saved), the
 * press posts nothing and opens the summary instead; otherwise it is the plain submit of its
 * transition form, and the confirmation (§384) and the server's guard answer it as before.
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
 * The §47 summary for a publication that cannot happen yet (§406): focusable, first in the column,
 * one link per missing box and language ("Titlu și rezumat › English › Titlu"), each opening the
 * folds and the tab around its box. Drawn only once a publish press asked for it, and gone when
 * nothing is missing any more.
 *
 * On arrival it takes the focus without moving the page, opens the first missing box and brings
 * its card to the top of the screen — the card whose closed line already said what it lacks.
 *
 * `gaps`, when given, is the list to name (the editor's saved event: "Publică" publishes what is
 * saved, so a box typed but not saved is still missing); otherwise the provider's, as typed.
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
