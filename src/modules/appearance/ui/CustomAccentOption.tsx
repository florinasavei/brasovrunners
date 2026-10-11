"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useState } from "react";
import { ACCENT_SHADE_KEYS, deriveAccentShades, judgeAccent } from "@/modules/appearance/domain/accent-shades";
import { RecallRadio, useRecall } from "@/shared/forms/recall";
import { LOOK_ACCENT } from "@/theme/brand";
import AccentPreview, { type AccentPreviewWords } from "./AccentPreview";

type Props = {
  /** The colour the box opens with: the typed accent in force, else the pink's. */
  initialHex: string;
  /** Whether «Personalizat» is the choice in force. */
  defaultChecked: boolean;
  words: {
    name: string;
    help: string;
    hexLabel: string;
    pickerLabel: string;
    /** The rule, in words, always shown. */
    rule: string;
    /** The line before the derived shades' values. */
    shades: string;
    /** The live verdict under the box, one sentence per outcome. */
    ok: string;
    notAColour: string;
    tooGrey: string;
  };
  preview: AccentPreviewWords;
};

/**
 * «Personalizat» for the new look's accent (§723): a colour typed as `#rrggbb`, with the browser's own
 * colour picker beside it, and the accent in miniature redrawn as it is typed — by day and after dark,
 * from the very shades the server will derive (`accent-shades.ts`), with their values written out. The
 * server decides; this only says it early.
 *
 * A client island because it is live; strings and plain values in its props only (§370). The text box
 * is the field that posts (`accentHex`, apart from the tint card's `hex` on the same page); the picker
 * is unnamed and writes into it. Typing or picking selects the option, so nobody types a colour and
 * saves the preset that was ticked.
 */
export default function CustomAccentOption(props: Props) {
  // Re-mounted on every refusal, so the box shows the colour that was sent, not the one it held.
  const recall = useRecall();
  return <CustomAccentOptionBody key={recall.generation} {...props} />;
}

function CustomAccentOptionBody({ initialHex, defaultChecked, words, preview }: Props) {
  const recall = useRecall();
  const recalled = recall.value("accentHex");
  const [hex, setHex] = useState(recalled ?? initialHex);
  const normalized = (hex.trim().startsWith("#") ? hex.trim() : `#${hex.trim()}`).toLowerCase();
  const verdict = judgeAccent(normalized);
  const shades = verdict === null ? deriveAccentShades(normalized) : LOOK_ACCENT.pink;

  function choose(event: ChangeEvent<HTMLInputElement>, value: string) {
    setHex(value);
    const radio = event.currentTarget.form?.querySelector<HTMLInputElement>('input[name="accent"][value="custom"]');
    if (radio) radio.checked = true;
  }

  const verdictText = verdict === null ? words.ok : words[verdict];
  const hexId = recall.idOf("accentHex");

  return (
    <Box data-testid="site-look-accent-option-custom" sx={{ py: 0.5 }}>
      <Box component="label" sx={{ display: "flex", flexWrap: { xs: "wrap", sm: "nowrap" }, alignItems: "center", gap: 1.25, minHeight: 44, cursor: "pointer" }}>
        <RecallRadio name="accent" value="custom" defaultChecked={defaultChecked} style={{ width: 20, height: 20, flexShrink: 0 }} />
        <AccentPreview shades={shades} words={preview} />
        <Box component="span" sx={{ minWidth: 0, flexBasis: { xs: "calc(100% - 32px)", sm: "auto" } }}>
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
          name="accentHex"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={7}
          value={hex}
          aria-invalid={recall.named("accentHex") || verdict !== null}
          aria-describedby="site-look-accent-verdict site-look-accent-rule"
          onChange={(event: ChangeEvent<HTMLInputElement>) => choose(event, event.currentTarget.value)}
          sx={{ font: "inherit", width: "9ch", minHeight: 44, px: 1, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.paper", color: "text.primary" }}
          data-testid="site-look-accent-hex"
        />
        <Box
          component="input"
          type="color"
          aria-label={words.pickerLabel}
          value={verdict === "notAColour" ? LOOK_ACCENT.pink.light.accent : normalized}
          onChange={(event: ChangeEvent<HTMLInputElement>) => choose(event, event.currentTarget.value)}
          sx={{ width: 44, height: 44, p: 0.25, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "transparent", cursor: "pointer" }}
        />
      </Box>
      <Typography
        id="site-look-accent-verdict"
        variant="caption"
        role="status"
        sx={{ display: "block", pl: "30px", mt: 0.5, color: verdict === null ? "success.main" : "error.main" }}
        data-testid="site-look-accent-verdict"
      >
        {verdictText}
      </Typography>
      {verdict === null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: "30px", fontFamily: "monospace" }} data-testid="site-look-accent-shades">
          {words.shades} {ACCENT_SHADE_KEYS.map((key) => shades.light[key]).join(" · ")} / {ACCENT_SHADE_KEYS.map((key) => shades.dark[key]).join(" · ")}
        </Typography>
      )}
      <Typography id="site-look-accent-rule" variant="caption" color="text.secondary" sx={{ display: "block", pl: "30px" }}>
        {words.rule}
      </Typography>
    </Box>
  );
}
