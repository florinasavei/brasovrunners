"use client";

import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useState } from "react";
import GlyphButton from "@/shared/ui/GlyphButton";

/** The file input's id: the button is a label for it, so it opens the picker with no script, as the house's other pickers do. */
export const RESULTS_IMPORT_FILE_ID = "results-import-file";

/**
 * «Alege un fișier» of «Importă din CSV» (§NNN): the house's picker — `GlyphButton` as a label for a hidden file input
 * (`RouteGpxField`, `EventImportPanel`), so the button wears its glyph and its words in the page's language rather than the browser's —
 * and, beside it, the name of the file chosen. The input is named `importFile` and sits inside the page's one form, so it posts with the
 * rest, with scripts off too; the name under the button is the only thing that needs a script.
 */
export default function ImportFilePicker({ words }: { words: { choose: string; chooseAgain: string; none: string } }) {
  const [fileName, setFileName] = useState<string | null>(null);
  function onChoose(event: ChangeEvent<HTMLInputElement>) {
    setFileName(event.target.files?.[0]?.name ?? null);
  }
  return (
    <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
      <GlyphButton htmlFor={RESULTS_IMPORT_FILE_ID} icon="upload" variant="outlined" sx={{ minHeight: 44 }}>
        {fileName ? words.chooseAgain : words.choose}
        <input id={RESULTS_IMPORT_FILE_ID} type="file" name="importFile" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={onChoose} data-testid="results-import-file" />
      </GlyphButton>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }} data-testid="results-import-file-name">
        {fileName ?? words.none}
      </Typography>
    </Stack>
  );
}
