"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import GlyphButton from "@/shared/ui/GlyphButton";
import { cardOf } from "./form-fields";
import { useTranslateAction } from "./TranslateProvider";
import { useTranslateAll } from "./use-translate-all";

/**
 * «Tradu cardul: RO → EN» / "Translate this card: RO → EN" in a card's Română | English tab row
 * (§NNN), between the one box's «Tradu din română» (§464) and the whole editor's «Copiază și tradu
 * tot» (§482): every English box of this card whose Romanian twin has words, in one press — the
 * card's boxes outside its tabs too (a programme's rows, the meeting place's English name), since
 * the card is the nearest `Panel` around the strip (`cardOf`). The rest of the form is untouched.
 *
 * The same press as the whole editor's (`useTranslateAll`): it asks first only when English words
 * already written would be replaced («Înlocuiește tot» / «Doar cele goale») or the text is large,
 * says what happened in the line under the tabs and in a toast (§496), and saves nothing — the
 * boxes change as if typed and the ordinary save stores them under the both-languages rule (§352).
 *
 * Absent — like the per-box buttons, not greyed — where the page cannot translate (no DeepL key,
 * a spent credit, a role that writes no words): the whole editor's button is the one that says
 * why. The Server Action asks the role and the key again on every press (BR-REQ-060-01).
 */
export default function TranslateCardButton() {
  // Nothing at all — not even a catalogue lookup — where the page offers no translation.
  return useTranslateAction() ? <TranslateCardButtonIsland /> : null;
}

function TranslateCardButtonIsland() {
  const t = useTranslations("Translate");
  const anchor = useRef<HTMLDivElement>(null);
  const { pending, message, press, dialog } = useTranslateAll(() => {
    const here = anchor.current;
    const strip = here?.closest("[data-locale-tabs]") ?? null;
    // Never `within: null` while the button is mounted: that would be the whole form.
    return { form: here?.closest("form") ?? null, within: strip ? cardOf(strip) : (here ?? null) };
  }, t("confirm.cardBigTitle"));

  return (
    <Box ref={anchor} sx={{ display: "contents" }} data-translate-card="">
      <GlyphButton
        icon="translate"
        size="small"
        onClick={press}
        disabled={pending}
        aria-busy={pending || undefined}
        sx={{ minHeight: 44, ml: "auto", flex: "none", textTransform: "none" }}
        data-testid="translate-card"
      >
        {pending ? t("pending") : t("card")}
      </GlyphButton>
      <Typography
        variant="caption"
        role="status"
        color={message?.tone === "refused" ? "error" : "text.secondary"}
        sx={{ flexBasis: "100%" }}
        data-testid="translate-card-status"
      >
        {message?.text ?? ""}
      </Typography>
      <ConfirmDialog {...dialog} />
    </Box>
  );
}
