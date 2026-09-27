"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useState } from "react";
import { HEX_COLOR, judgeTint } from "@/modules/appearance/domain/tint-contrast";
import { RecallRadio, useRecall } from "@/shared/forms/recall";
import { COLOR } from "@/theme/brand";
import TintPreview, { type TintPreviewWords } from "./TintPreview";

type Props = {
  /** The colour the box opens with: the custom colour in force, else the platform's paper. */
  initialHex: string;
  /** Whether «Personalizat» is the choice in force. */
  defaultChecked: boolean;
  words: {
    name: string;
    help: string;
    hexLabel: string;
    pickerLabel: string;
    /** The two rules, in words, always shown. */
    rule: string;
    /** The live verdict under the box, one sentence per outcome. */
    ok: string;
    notAColour: string;
    unreadable: string;
    tooDark: string;
  };
  preview: TintPreviewWords;
};

/**
 * «Personalizat» (§488): the one option the Administrator types — `#rrggbb` in a text box, with the
 * browser's own colour picker beside it — and the page in miniature redrawn as they type, with the
 * verdict of the same two rules the service refuses by (`tint-contrast.ts`): body and muted text at
 * AA, and a white card still a card. The server decides; this only says it early.
 *
 * A client island because it is live; strings and plain values in its props only (§370). The text
 * box is the field that posts (`hex`); the picker is unnamed and writes into it. Typing or picking
 * selects the option, so nobody types a colour and saves the preset that was ticked.
 */
export default function CustomTintOption(props: Props) {
  // Re-mounted on every refusal, so the box shows the colour that was sent, not the one it held.
  const recall = useRecall();
  return <CustomTintOptionBody key={recall.generation} {...props} />;
}

function CustomTintOptionBody({ initialHex, defaultChecked, words, preview }: Props) {
  const recall = useRecall();
  const recalled = recall.value("hex");
  const [hex, setHex] = useState(recalled ?? initialHex);
  const normalized = (hex.trim().startsWith("#") ? hex.trim() : `#${hex.trim()}`).toLowerCase();
  const verdict = judgeTint(normalized);
  const valid = HEX_COLOR.test(normalized);

  function choose(event: ChangeEvent<HTMLInputElement>, value: string) {
    setHex(value);
    const radio = event.currentTarget.form?.querySelector<HTMLInputElement>('input[name="tint"][value="custom"]');
    if (radio) radio.checked = true;
  }

  const verdictText = verdict === null ? words.ok : words[verdict];
  const hexId = recall.idOf("hex");

  return (
    <Box data-testid="site-tint-option-custom" sx={{ py: 0.5 }}>
      <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, cursor: "pointer" }}>
        <RecallRadio name="tint" value="custom" defaultChecked={defaultChecked} style={{ width: 20, height: 20, flexShrink: 0 }} />
        <TintPreview page={valid ? normalized : COLOR.surface} words={preview} />
        <Box component="span" sx={{ minWidth: 0 }}>
          <Typography component="span" variant="body2" sx={{ display: "block", fontWeight: 500 }}>
            {words.name}
          </Typography>
          <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {words.help}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ pl: "30px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mt: 0.5 }}>
        <Typography component="label" htmlFor={hexId} variant="body2">
          {words.hexLabel}
        </Typography>
        <Box
          component="input"
          id={hexId}
          name="hex"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={7}
          value={hex}
          aria-invalid={recall.named("hex") || verdict !== null}
          aria-describedby="site-tint-custom-verdict site-tint-custom-rule"
          onChange={(event: ChangeEvent<HTMLInputElement>) => choose(event, event.currentTarget.value)}
          sx={{ font: "inherit", width: "9ch", minHeight: 44, px: 1, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.paper", color: "text.primary" }}
          data-testid="site-tint-hex"
        />
        <Box
          component="input"
          type="color"
          aria-label={words.pickerLabel}
          value={valid ? normalized : COLOR.surface}
          onChange={(event: ChangeEvent<HTMLInputElement>) => choose(event, event.currentTarget.value)}
          sx={{ width: 44, height: 44, p: 0.25, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "transparent", cursor: "pointer" }}
        />
      </Box>
      <Typography
        id="site-tint-custom-verdict"
        variant="caption"
        role="status"
        sx={{ display: "block", pl: "30px", mt: 0.5, color: verdict === null ? "success.main" : "error.main" }}
        data-testid="site-tint-verdict"
      >
        {verdictText}
      </Typography>
      <Typography id="site-tint-custom-rule" variant="caption" color="text.secondary" sx={{ display: "block", pl: "30px" }}>
        {words.rule}
      </Typography>
    </Box>
  );
}
