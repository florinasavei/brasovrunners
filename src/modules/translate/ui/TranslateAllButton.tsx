"use client";

import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef } from "react";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import GlyphButton from "@/shared/ui/GlyphButton";
import { type TranslateOffer, useTranslateOffer } from "./TranslateProvider";
import { useTranslateAll } from "./use-translate-all";

/**
 * «Copiază și tradu tot: RO → EN» at the top of a record's editor (`DECISIONS.md` §464, §482):
 * fills every English box whose Romanian twin has words, rich texts keeping their layout; nothing
 * is saved until the ordinary save. It asks first (§384) only to overwrite English words or past
 * `ASK_ABOVE_CHARACTERS`. Greyed, with the reason and a link, when there is no key or the credit
 * is spent (§497). It must sit inside the form it reads.
 */
export default function TranslateAllButton() {
  const offer = useTranslateOffer();
  if (!offer) return null;
  return offer.action ? <TranslateAllButtonIsland /> : <TranslateAllButtonOff offer={offer} />;
}

function Frame({ children, off }: { children: ReactNode; off?: boolean }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: { xs: 1.5, sm: 2 }, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1.5, rowGap: 1, borderColor: off ? "divider" : "primary.main" }}
      data-testid="translate-all"
      data-translate-state={off ? "off" : "ready"}
    >
      {children}
    </Paper>
  );
}

function TranslateAllButtonOff({ offer }: { offer: TranslateOffer }) {
  const t = useTranslations("Translate");
  if (offer.spent) {
    return (
      <Frame off>
        <GlyphButton icon="translate" variant="contained" disabled sx={{ minHeight: 44 }}>
          {t("all")}
        </GlyphButton>
        <Typography variant="body2" color="text.secondary" sx={{ flexBasis: "100%" }} data-testid="translate-all-off" data-reason="spent">
          {offer.costsHref ? (
            <>
              {t("spent")}{" "}
              <MuiLink href={offer.costsHref} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                {t("spentSteps")}
              </MuiLink>
            </>
          ) : (
            t("spentAskAdmin")
          )}
        </Typography>
      </Frame>
    );
  }
  return (
    <Frame off>
      <GlyphButton icon="translate" variant="contained" disabled sx={{ minHeight: 44 }}>
        {t("all")}
      </GlyphButton>
      <Typography variant="body2" color="text.secondary" sx={{ flexBasis: "100%" }} data-testid="translate-all-off">
        {offer.setupHref ? t("off") : t("offAskAdmin")}{" "}
        {offer.setupHref && (
          <MuiLink href={offer.setupHref} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
            {t("offSteps")}
          </MuiLink>
        )}
      </Typography>
    </Frame>
  );
}

function TranslateAllButtonIsland() {
  const t = useTranslations("Translate");
  const anchor = useRef<HTMLSpanElement>(null);
  const { pending, message, press, dialog } = useTranslateAll(() => ({ form: anchor.current?.closest("form") ?? null }), t("confirm.bigTitle"));

  return (
    <Frame>
      <span ref={anchor} hidden />
      <GlyphButton icon="translate" variant="contained" onClick={press} disabled={pending} sx={{ minHeight: 44 }} aria-busy={pending || undefined}>
        {pending ? t("pending") : t("all")}
      </GlyphButton>
      <Typography variant="body2" color="text.secondary" sx={{ flexBasis: "100%" }}>
        {t("allHelp")}
      </Typography>
      <Typography
        variant="body2"
        role="status"
        color={message?.tone === "refused" ? "error" : "text.secondary"}
        sx={{ flexBasis: "100%" }}
        data-testid="translate-all-status"
      >
        {message?.text ?? ""}
      </Typography>
      <ConfirmDialog {...dialog} />
    </Frame>
  );
}
