"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import ImageQualityChoice, { type ImageQualityLabels, useImageQuality } from "@/modules/media/ui/ImageQualityChoice";
import { type ChosenFacts, type ChosenFactsLabels, describeChosenImage } from "@/modules/media/ui/stored-facts";
import { uploadPicture } from "@/modules/media/ui/upload-picture";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/** The island's words, translated on the server and handed over as strings (AGENTS.md §14.5). */
export type PlanPictureUploadLabels = {
  /** «Adaugă o poză»: the button, whatever the plan already holds — a picture uploaded goes last (§978). */
  upload: string;
  /** «Se încarcă…», while the file goes up. */
  uploading: string;
  /** «Se salvează…», while the form that records the picture is on its way. */
  saving: string;
  /** What the line under the button says once an upload failed. */
  failed: string;
  /** What it says otherwise: which files are taken. */
  help: string;
  /** «Calitate» and its four levels (§414, §437). */
  quality: ImageQualityLabels;
  /** The chosen file's pixels and weight, and what was sent in its place (§437). */
  chosen: ChosenFactsLabels;
};

type Props = {
  /** The file input's id, which the button is the label of. */
  inputId: string;
  /** The page's language, for the weight's decimal mark. */
  lang: string;
  labels: PlanPictureUploadLabels;
};

/**
 * «Adaugă o poză» in «Poze și hărți» on «Planul voluntarilor» (§952; the owner, 2026-11-16: «trebui sa pot incarca si
 * planul voluntarilor pe traseu in genul [pozei]» — and since §978, 2026-11-18: «sa pot pune mai multe poze»): the plan as the
 * organizers drew it, uploaded where the plan is, one picture after another, each going last.
 *
 * An island for the one thing the server cannot do — send a file chosen on this device through the backoffice's one upload
 * (`uploadPicture`, the quality beside it as beside every upload, §414) — and nothing more. The page draws it inside the form
 * that records the picture: when the upload answers with the stored picture's id, the island writes it into the form's
 * `assetId` box and sends that form (`requestSubmit`, so React's action receives it as from a press), and the Server Action
 * does the rest — the role, the event, the picture, the limit, the trail (`plan-voluntari/actions.ts#addPlanPictureAction`). A picture
 * uploaded and never recorded — the tab closed in between — is used nowhere, and the sweep's after its week (§73).
 *
 * It is handed strings and nothing else: no row, no name, no component, no element. The file input is the native one behind
 * its label, 44 pixels tall for a thumb (BR-REQ-041-01 criterion 6).
 */
export default function PlanPictureUpload({ inputId, lang, labels }: Props) {
  const [state, setState] = useState<"idle" | "uploading" | "failed">("idle");
  const [chosen, setChosen] = useState<ChosenFacts | null>(null);
  // Shared with every other uploader of the sitting (§414).
  const [quality, setQuality] = useImageQuality();
  const assetId = useRef<HTMLInputElement>(null);
  // The form this island stands in, once it has sent it: «Se salvează…» until the page comes back with the picture.
  const { pending } = useFormStatus();
  const busy = state === "uploading" || pending;

  const onChoose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file chosen twice in a row must still fire a change.
    event.target.value = "";
    if (!file) return;
    setState("uploading");
    setChosen(null);
    try {
      const uploaded = await uploadPicture(file, setChosen, quality);
      const box = assetId.current;
      if (!box?.form) throw new Error("the picture's form is gone");
      // Written into the box itself, not through state: the form is read as it stands at the very next line.
      box.value = uploaded.assetId;
      setState("idle");
      // `requestSubmit`, never `submit`: React's form action listens for the submit event.
      box.form.requestSubmit();
    } catch {
      setState("failed");
    }
  };

  return (
    <Box sx={{ minWidth: 0 }}>
      <input ref={assetId} type="hidden" name="assetId" defaultValue="" />
      {/* The button, and the quality its upload takes beside it — under it on a phone, where the row wraps. */}
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "flex-start", columnGap: 3, rowGap: 1 }}>
        <GlyphButton htmlFor={inputId} icon="upload" variant="outlined" disabled={busy} aria-busy={busy || undefined} sx={TAP_TARGET} data-testid="plan-picture-upload">
          {state === "uploading" ? labels.uploading : pending ? labels.saving : labels.upload}
          <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={onChoose} />
        </GlyphButton>
        <ImageQualityChoice value={quality} onChange={setQuality} labels={labels.quality} disabled={busy} />
      </Stack>
      <Typography
        variant="caption"
        color={state === "failed" ? "error" : "text.secondary"}
        role={state === "failed" ? "alert" : undefined}
        sx={{ display: "block", mt: 0.5 }}
        data-testid="plan-picture-upload-line"
      >
        {state === "failed" ? labels.failed : labels.help}
      </Typography>
      {chosen && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: "anywhere" }} aria-live="polite" data-testid="plan-picture-chosen">
          {describeChosenImage(chosen, labels.chosen, lang)}
        </Typography>
      )}
    </Box>
  );
}
