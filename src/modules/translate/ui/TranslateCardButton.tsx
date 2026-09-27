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
 * Read by assistive technology, out of sight: the sticky tab row keeps its one line (§514).
 *
 * `"1px"` and not `1`: MUI reads a number between 0 and 1 in `sx` as a fraction, so `width: 1` is
 * `100%` and `m: -1` is eight pixels. The greyed button's reason was laid out as wide as the card,
 * starting at the row's right end: the editor scrolled sideways on a desktop and, on a phone, the
 * page grew wider than the screen and the cards landed over the save buttons (the same trap
 * `AdminTable`'s caption documents).
 */
const VISUALLY_HIDDEN = { position: "absolute", width: "1px", height: "1px", p: 0, m: "-1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

/**
 * The button at the end of the tab row: never squeezed, 44 px tall. Below `sm` it is the translate
 * glyph alone in a 44-px square, so the sticky row stays one line on a phone (§480, §514); from `sm`
 * up the glyph and the words. The words are then in the `aria-label` and the tooltip.
 */
const BUTTON_SX = {
  minHeight: 44,
  minWidth: { xs: 44, sm: 64 },
  px: { xs: 0, sm: 1 },
  flex: "none",
  textTransform: "none",
  "& .MuiButton-startIcon": { mr: { xs: 0, sm: 1 }, ml: { xs: 0, sm: -0.5 } },
} as const;

/** The wrapper that holds the tooltip (a disabled button fires no pointer events) and the row's right end. */
const WRAPPER_SX = { ml: "auto", flex: "none", display: "inline-flex" } as const;

/** The button's words: drawn from `sm` up, the glyph alone below it (the `aria-label` says them there). */
function Words({ children }: { children: string }) {
  return (
    <Box component="span" data-translate-card-words="" sx={{ display: { xs: "none", sm: "inline" } }}>
      {children}
    </Box>
  );
}

/**
 * «Tradu cardul: RO → EN» / "Translate this card: RO → EN" in a card's Română | English tab row
 * (§514), between the one box's «Tradu din română» (§464) and the whole editor's «Copiază și tradu
 * tot» (§482): every English box of this card whose Romanian twin has words, in one press — the
 * card's boxes outside its tabs too (the programme's timed rows), since the card is the nearest
 * `Panel` around the strip (`cardOf`). The rest of the form is untouched.
 *
 * The same press as the whole editor's (`useTranslateAll`): it asks first only when English words
 * already written would be replaced («Înlocuiește tot» / «Doar cele goale») or the text is large,
 * says what happened in a toast naming the card (§496, «Gata: 3 câmpuri traduse în „Descrierea
 * completă”»), and saves nothing — the boxes change as if typed and the ordinary save stores them
 * under the both-languages rule (§352). When it filled something, `onTranslated` brings the
 * English tab forward, so the person reads the result.
 *
 * **Always drawn for a role that writes the club's words** (§482, §497): with no DeepL key, or a
 * spent credit, it is greyed and says why — in a tooltip with the link to the steps or to Costuri,
 * and to assistive technology through `aria-describedby`. The tooltip's link is for the pointer
 * only; a keyboard user reaches the same steps through the whole editor's «Copiază și tradu tot»
 * strip right above the cards (§482), which draws that link in the page, so no focusable duplicate
 * is added here. A role that writes no words, or a page
 * with no translation at all, sees nothing. The Server Action asks the role and the key again on
 * every press (BR-REQ-060-01).
 *
 * The status line is read out (`role="status"`) and not drawn: it sits in the sticky tab row, and a
 * long sentence there would grow the row over the text scrolling under it; the toast says it.
 */
export default function TranslateCardButton({ onTranslated }: { onTranslated?: () => void }) {
  const offer = useTranslateOffer();
  if (!offer) return null;
  return offer.action ? <TranslateCardButtonIsland onTranslated={onTranslated} /> : <TranslateCardButtonOff offer={offer} />;
}

/** Why the button is greyed, in the whole editor's own sentences (§482, §497), and where to fix it. */
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
      {/* A disabled button fires no pointer events: the wrapper holds the tooltip and the focus. */}
      <Box
        component="span"
        tabIndex={0}
        aria-label={t("card")}
        aria-describedby={reasonId}
        sx={WRAPPER_SX}
        data-testid="translate-card-off"
        data-reason={reason}
      >
        <GlyphButton icon="translate" size="small" disabled aria-label={t("card")} sx={BUTTON_SX}>
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
