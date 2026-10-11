"use client";

import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useState } from "react";
import { type GpxRefusal, gpxSizeWords, MAX_GPX_BYTES, type RouteGpx } from "@/modules/events/domain/route-gpx";
import { LINK_GLYPH } from "@/modules/events/ui/link-glyphs";
import GlyphButton from "@/shared/ui/GlyphButton";

/** The file input's id: the «Traseul (GPX)» link row's button is a label for it, so it opens with no script. */
export const ROUTE_GPX_INPUT_ID = "event-route-gpx";

/** The GPX kind's own glyph: the one the link rows' kind select and the public page draw for it. */
const GpxGlyph = LINK_GLYPH.GPX;

export type RouteGpxFieldWords = {
  label: string;
  help: string;
  upload: string;
  replace: string;
  remove: string;
  uploading: string;
  none: string;
  removed: string;
  errors: Record<GpxRefusal | "failed", string>;
};

/**
 * The route's GPX file in «Linkuri și fișiere» (§NNN): «Încarcă un GPX», «Înlocuiește fișierul», «Scoate
 * fișierul». The file goes to `/api/admin/route-gpx` the moment it is chosen — checked there for
 * what it is, an XML document whose root is `<gpx>`, never by its extension — and the answer lands
 * in the hidden input `event.routeGpx`, which the event's one save stores; «Scoate» empties it, and
 * the save then deletes the object once no date of the series names it. Nothing is stored on the
 * event until the save, like the cover (§709).
 *
 * The native file picker inside a `GlyphButton` label (the team photo's pattern, §694), so the
 * choice opens with no script; the upload itself needs one, as every upload of the backoffice does.
 * The «Traseul (GPX)» link row's button is a second label for the same input and is not disabled with
 * this card's own, so a choice made while an upload runs is dropped, never a second upload.
 */
export default function RouteGpxField({
  name,
  initial,
  words,
  locale,
}: {
  name: string;
  initial: RouteGpx | null;
  words: RouteGpxFieldWords;
  locale: string;
}) {
  const [gpx, setGpx] = useState<RouteGpx | null>(initial);
  const [state, setState] = useState<"idle" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputId = ROUTE_GPX_INPUT_ID;

  const onChoose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    // Both labels open this one input: a choice made while an upload runs is ignored.
    if (!file || state === "uploading") return;
    setError(null);
    if (file.size > MAX_GPX_BYTES) {
      setError(words.errors.tooLarge);
      return;
    }
    setState("uploading");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/admin/route-gpx", { method: "POST", body });
      const answer = (await response.json().catch(() => null)) as (RouteGpx & { detail?: string }) | null;
      if (response.ok && answer?.key) {
        setGpx({ key: answer.key, name: answer.name, size: answer.size, uploadedAt: answer.uploadedAt });
      } else {
        const reason = answer?.detail as GpxRefusal | undefined;
        setError(reason && reason in words.errors ? words.errors[reason] : words.errors.failed);
      }
    } catch {
      setError(words.errors.failed);
    } finally {
      setState("idle");
    }
  };

  return (
    <Stack spacing={1} data-testid="route-gpx-field">
      <Typography variant="subtitle2" component="p" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <GpxGlyph aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary" }} />
        {words.label}
      </Typography>
      <input type="hidden" name={name} value={gpx ? JSON.stringify(gpx) : ""} />
      <Typography variant="body2" color={gpx ? "text.primary" : "text.secondary"} data-testid="route-gpx-current">
        {gpx ? `${gpx.name} · ${gpxSizeWords(gpx.size, locale)}` : initial ? words.removed : words.none}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <GlyphButton htmlFor={inputId} icon={gpx ? "replace" : "upload"} variant="outlined" disabled={state === "uploading"} sx={{ minHeight: 44 }}>
          {state === "uploading" ? words.uploading : gpx ? words.replace : words.upload}
          <input id={inputId} type="file" accept=".gpx,application/gpx+xml" hidden onChange={onChoose} data-testid="route-gpx-input" />
        </GlyphButton>
        {gpx && (
          <GlyphButton icon="delete" variant="text" color="error" sx={{ minHeight: 44 }} onClick={() => setGpx(null)}>
            {words.remove}
          </GlyphButton>
        )}
      </Stack>
      {error && (
        <Typography variant="body2" color="error" role="alert" data-testid="route-gpx-error">
          {error}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {words.help}
      </Typography>
    </Stack>
  );
}
