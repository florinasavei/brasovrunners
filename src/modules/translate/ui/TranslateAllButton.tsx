"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import GlyphButton from "@/shared/ui/GlyphButton";
import { englishBoxesToTranslate, labelOfBox } from "./form-fields";
import { useTranslateAction } from "./TranslateProvider";
import { useTranslatePress } from "./use-translate-press";

/**
 * «Tradu tot din română» at the top of a record's editor (`DECISIONS.md` §464; the owner,
 * 2026-09-26: «I wanna override the descriptions and all from RO to EN so I have the same layout
 * and all»).
 *
 * Every English box of the form whose Romanian twin has words — the title, the summary, the
 * description, the rules, the route, the programme's notes and rows, what to bring, the place's
 * name, the partners' texts, the links' labels, the search-engine texts — is replaced by the
 * Romanian translated, a rich text keeping the Romanian's layout exactly (headings, lists,
 * tables, pictures, films; `domain/rich-text-html.ts`). One question first (§384), naming every
 * box it will overwrite; one request; nothing saved until the ordinary save.
 *
 * Inside the form it reads, so it finds the boxes by the form they post in.
 */
export default function TranslateAllButton() {
  return useTranslateAction() ? <TranslateAllButtonIsland /> : null;
}

function TranslateAllButtonIsland() {
  const t = useTranslations("Translate");
  const anchor = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<{ names: string[]; labels: string[] } | null>(null);
  const { pending, message, translate } = useTranslatePress();

  const form = () => anchor.current?.closest("form") ?? null;
  const press = () => {
    const current = form();
    const names = current ? englishBoxesToTranslate(current) : [];
    if (names.length === 0) {
      void translate(current, []);
      return;
    }
    setAsking({ names, labels: names.map((name) => labelOfBox(current, name)) });
  };

  return (
    <Box ref={anchor} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1.5, rowGap: 0.5 }} data-testid="translate-all">
      <GlyphButton icon="translate" variant="outlined" onClick={press} disabled={pending} sx={{ minHeight: 44 }} aria-busy={pending || undefined}>
        {pending ? t("pending") : t("all")}
      </GlyphButton>
      <Typography variant="caption" color="text.secondary" sx={{ flexBasis: { xs: "100%", sm: "auto" }, flexShrink: 1 }}>
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
                body: t("confirm.allBody", { count: asking.names.length, fields: asking.labels.join(" · ") }),
                confirmLabel: t("confirm.go"),
                cancelLabel: t("confirm.cancel"),
              }
            : null
        }
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const names = asking?.names ?? [];
          setAsking(null);
          void translate(form(), names);
        }}
      />
    </Box>
  );
}
