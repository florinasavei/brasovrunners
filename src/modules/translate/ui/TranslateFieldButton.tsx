"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import GlyphButton from "@/shared/ui/GlyphButton";
import { boxNamed, isEmptyValue, readBox } from "./form-fields";
import { useTranslateAction } from "./TranslateProvider";
import { useTranslatePress } from "./use-translate-press";

/**
 * «Tradu din română» beside one English box (`DECISIONS.md` §464); asks first (§384) before
 * replacing words. Absent — not even a catalogue lookup — where the page offers no translation.
 */
export default function TranslateFieldButton({ en }: { en: string }) {
  return useTranslateAction() ? <TranslateFieldButtonIsland en={en} /> : null;
}

function TranslateFieldButtonIsland({ en }: { en: string }) {
  const t = useTranslations("Translate");
  const anchor = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const { pending, message, translate } = useTranslatePress();

  const form = () => anchor.current?.closest("form") ?? null;
  const press = () => {
    const english = boxNamed(form(), en);
    if (english && !isEmptyValue(readBox(en, english))) setAsking(true);
    else void translate(form(), [en]);
  };

  return (
    <Box ref={anchor} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1.5 }} data-translate-for={en}>
      <GlyphButton icon="translate" size="small" onClick={press} disabled={pending} sx={{ minHeight: 44 }} aria-busy={pending || undefined}>
        {pending ? t("pending") : t("button")}
      </GlyphButton>
      <Typography
        variant="caption"
        role="status"
        color={message?.tone === "refused" ? "error" : "text.secondary"}
        data-testid="translate-status"
      >
        {message?.text ?? ""}
      </Typography>
      <ConfirmDialog
        open={asking}
        spec={{ title: t("confirm.title"), body: t("confirm.body"), confirmLabel: t("confirm.go"), cancelLabel: t("confirm.cancel") }}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          void translate(form(), [en]);
        }}
      />
    </Box>
  );
}
