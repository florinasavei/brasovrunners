"use client";

import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import GlyphButton from "@/shared/ui/GlyphButton";
import { englishBoxesToTranslate, englishBoxesWithWords, labelOfBox } from "./form-fields";
import { type TranslateOffer, useTranslateOffer } from "./TranslateProvider";
import { useTranslatePress } from "./use-translate-press";

/**
 * «Copiază și tradu tot: RO → EN» at the top of a record's editor (`DECISIONS.md` §464, §NNN; the
 * owner, 2026-09-26: «I wanna override the descriptions and all from RO to EN so I have the same
 * layout and all», and 2026-09-27: «I can't find or don't know how to use the AI translate … I
 * just wanna copy all from RO to English and auto-translate with a single button click»).
 *
 * Every English box of the form whose Romanian twin has words — the title, the summary, the
 * description, the rules, the route, the programme's notes and rows, what to bring, the place's
 * name, the partners' texts, the links' labels, the search-engine texts; on «Echipa» the role, the
 * words about the person and the links' labels — is filled with the Romanian translated, a rich
 * text keeping the Romanian's layout exactly (headings, lists, tables, pictures, films;
 * `domain/rich-text-html.ts`). One request; nothing saved until the ordinary save.
 *
 * **One press** (§NNN). Where every English box it fills is empty, the press translates at once.
 * It asks first (§384) only when English words already written would be replaced, and the
 * question names those boxes alone.
 *
 * **Always there** (§NNN) for a role that writes the club's words: a deployment with no DeepL key
 * draws it greyed, with the sentence saying why and, for a reader who may open the tasks page,
 * the link to the row with the steps — a missing button is one nobody can find. A role that
 * writes no words sees nothing.
 *
 * Inside the form it reads, so it finds the boxes by the form they post in.
 */
export default function TranslateAllButton() {
  const offer = useTranslateOffer();
  if (!offer) return null;
  return offer.action ? <TranslateAllButtonIsland /> : <TranslateAllButtonOff offer={offer} />;
}

/** The frame both states share: an outlined card, the button first, the sentence under it. */
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
  const [asking, setAsking] = useState<{ names: string[]; labels: string[] } | null>(null);
  const { pending, message, translate } = useTranslatePress();

  const form = () => anchor.current?.closest("form") ?? null;
  const press = () => {
    const current = form();
    const names = current ? englishBoxesToTranslate(current) : [];
    // Only English words already written make it ask; empty boxes are filled at once.
    const replaced = englishBoxesWithWords(current, names);
    if (replaced.length === 0) {
      void translate(current, names, { all: true });
      return;
    }
    setAsking({ names, labels: replaced.map((name) => labelOfBox(current, name)) });
  };

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
      <ConfirmDialog
        open={asking !== null}
        spec={
          asking
            ? {
                title: t("confirm.allTitle"),
                body: t("confirm.allBody", { fields: asking.labels.join(" · ") }),
                confirmLabel: t("confirm.go"),
                cancelLabel: t("confirm.cancel"),
              }
            : null
        }
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const names = asking?.names ?? [];
          setAsking(null);
          void translate(form(), names, { all: true });
        }}
      />
    </Frame>
  );
}
