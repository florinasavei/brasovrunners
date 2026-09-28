"use client";

import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Tooltip from "@mui/material/Tooltip";
import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import GlyphButton from "@/shared/ui/GlyphButton";
import { cardOf, cardTitleOf } from "./form-fields";
import { type TranslateOffer, useTranslateOffer } from "./TranslateProvider";
import { useTranslateAll } from "./use-translate-all";

/**
 * Visually hidden, so the sticky tab row keeps one line (§514). `"1px"`, not `1`: MUI reads
 * 0–1 in `sx` as a fraction (`width: 1` is 100%), which overflowed the page sideways.
 */
const VISUALLY_HIDDEN = { position: "absolute", width: "1px", height: "1px", p: 0, m: "-1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

/** Below `sm` the glyph alone in a 44-px square, so the sticky row stays one line on a phone (§480, §514). */
const BUTTON_SX = {
  minHeight: 44,
  minWidth: { xs: 44, sm: 64 },
  px: { xs: 0, sm: 1 },
  flex: "none",
  textTransform: "none",
  "& .MuiButton-startIcon": { mr: { xs: 0, sm: 1 }, ml: { xs: 0, sm: -0.5 } },
} as const;

/** Holds the tooltip, since a disabled button fires no pointer events. */
const WRAPPER_SX = { ml: "auto", flex: "none", display: "inline-flex" } as const;

function Words({ children }: { children: string }) {
  return (
    <Box component="span" data-translate-card-words="" sx={{ display: { xs: "none", sm: "inline" } }}>
      {children}
    </Box>
  );
}

/**
 * «Tradu cardul: RO → EN» in a card's tab row (§514): the whole editor's press (`useTranslateAll`,
 * §482) narrowed to this card (`cardOf`). `onTranslated` brings the English tab forward.
 *
 * With no key or a spent credit it is greyed and says why (§482, §497). The tooltip's link is
 * pointer-only; keyboard users reach the same link in the whole-editor strip above the cards.
 * The Server Action re-checks role and key on every press (BR-REQ-060-01).
 *
 * The status is announced, not drawn: a long sentence would grow the sticky row; the toast shows it.
 */
export default function TranslateCardButton({ onTranslated }: { onTranslated?: () => void }) {
  const offer = useTranslateOffer();
  if (!offer) return null;
  return offer.action ? <TranslateCardButtonIsland onTranslated={onTranslated} /> : <TranslateCardButtonOff offer={offer} />;
}

/** Why the button is greyed (§482, §497), and where to fix it. */
export function cardOffReason(offer: TranslateOffer): { reason: "spent" | "off"; href: string | null } {
  return offer.spent ? { reason: "spent", href: offer.costsHref ?? null } : { reason: "off", href: offer.setupHref };
}

function TranslateCardButtonOff({ offer }: { offer: TranslateOffer }) {
  const t = useTranslations("Translate");
  const reasonId = useId();
  const { reason, href } = cardOffReason(offer);
  const sentence = reason === "spent" ? (href ? t("spent") : t("spentAskAdmin")) : href ? t("off") : t("offAskAdmin");
  const steps = reason === "spent" ? t("spentSteps") : t("offSteps");
  return (
    <Tooltip
      describeChild
      enterTouchDelay={0}
      leaveTouchDelay={8000}
      title={
        <>
          {t("card")} — {sentence}
          {href && (
            <>
              {" "}
              <MuiLink href={href} color="inherit" underline="always">
                {steps}
              </MuiLink>
            </>
          )}
        </>
      }
    >
      {/* The wrapper carries the name once (§520); the inner button has no `aria-label`, or it is read twice. */}
      <Box
        component="span"
        tabIndex={0}
        aria-label={t("card")}
        aria-describedby={reasonId}
        sx={WRAPPER_SX}
        data-testid="translate-card-off"
        data-reason={reason}
      >
        <GlyphButton icon="translate" size="small" disabled sx={BUTTON_SX}>
          <Words>{t("card")}</Words>
        </GlyphButton>
        <Box component="span" id={reasonId} sx={VISUALLY_HIDDEN}>
          {sentence}
        </Box>
      </Box>
    </Tooltip>
  );
}

function TranslateCardButtonIsland({ onTranslated }: { onTranslated?: () => void }) {
  const t = useTranslations("Translate");
  const anchor = useRef<HTMLDivElement>(null);
  const { pending, message, press, dialog } = useTranslateAll(
    () => {
      const here = anchor.current;
      const strip = here?.closest("[data-locale-tabs]") ?? null;
      const card = strip ? cardOf(strip) : null;
      // Never `within: null` while the button is mounted: that would be the whole form.
      return { form: here?.closest("form") ?? null, within: card ?? here ?? null, card: card ? cardTitleOf(card) : null };
    },
    t("confirm.cardBigTitle"),
    onTranslated,
  );

  return (
    <Box ref={anchor} sx={{ display: "contents" }} data-translate-card="">
      <Tooltip title={t("card")} describeChild>
        {/* The span keeps the tooltip alive while the press is pending and the button disabled. */}
        <Box component="span" sx={WRAPPER_SX}>
          <GlyphButton
            icon="translate"
            size="small"
            onClick={press}
            disabled={pending}
            aria-busy={pending || undefined}
            aria-label={t("card")}
            sx={BUTTON_SX}
            data-testid="translate-card"
          >
            <Words>{pending ? t("pending") : t("card")}</Words>
          </GlyphButton>
        </Box>
      </Tooltip>
      <Box component="span" role="status" sx={VISUALLY_HIDDEN} data-testid="translate-card-status" data-tone={message?.tone}>
        {message?.text ?? ""}
      </Box>
      <ConfirmDialog {...dialog} />
    </Box>
  );
}
