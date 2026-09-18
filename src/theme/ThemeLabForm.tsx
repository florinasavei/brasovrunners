"use client";

import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import {
  DEFAULT_PREVIEW,
  parseThemePreview,
  PREVIEW_FONTS,
  PREVIEW_RADII,
  PREVIEW_SCALES,
  serializeThemePreview,
  THEME_PREVIEW_COOKIE,
  type ThemePreview,
} from "./preview";

/**
 * The theme lab's controls (BR-REQ-090-06). A client island because the setting is this
 * browser's alone — a cookie the server never reads (`AppTheme.tsx` says why) — so a Server
 * Action would be the wrong tool: it would have to set a cookie on a response the server then
 * ignores. "Apply" writes the cookie and opens the homepage, which is where the effect is.
 */
export default function ThemeLabForm({
  labels,
  homeHref,
}: {
  labels: { scale: string; display: string; body: string; radius: string; apply: string; reset: string };
  homeHref: string;
}) {
  const [draft, setDraft] = useState<ThemePreview>(() => {
    if (typeof document === "undefined") return DEFAULT_PREVIEW;
    const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_PREVIEW_COOKIE}=([^;]*)`));
    return (match && parseThemePreview(decodeURIComponent(match[1]))) || DEFAULT_PREVIEW;
  });

  const write = (value: string | null) => {
    const attributes = "; path=/; max-age=31536000; samesite=lax";
    document.cookie = value
      ? `${THEME_PREVIEW_COOKIE}=${encodeURIComponent(value)}${attributes}`
      : `${THEME_PREVIEW_COOKIE}=; path=/; max-age=0; samesite=lax`;
    window.location.assign(homeHref);
  };

  const fontField = (name: "display" | "body", label: string) => (
    <TextField
      select
      label={label}
      value={draft[name]}
      onChange={(event) => setDraft({ ...draft, [name]: event.target.value as ThemePreview["display"] })}
      sx={{ minWidth: 200 }}
    >
      {Object.entries(PREVIEW_FONTS).map(([key, font]) => (
        <MenuItem key={key} value={key} sx={{ fontFamily: font.family }}>
          {font.label}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Stack spacing={2} sx={{ maxWidth: 480 }}>
      <TextField
        select
        label={labels.scale}
        value={draft.scale}
        onChange={(event) => setDraft({ ...draft, scale: Number(event.target.value) as ThemePreview["scale"] })}
      >
        {PREVIEW_SCALES.map((scale) => (
          <MenuItem key={scale} value={scale}>
            {scale}%
          </MenuItem>
        ))}
      </TextField>
      {fontField("display", labels.display)}
      {fontField("body", labels.body)}
      <TextField
        select
        label={labels.radius}
        value={draft.radius}
        onChange={(event) => setDraft({ ...draft, radius: Number(event.target.value) as ThemePreview["radius"] })}
      >
        {PREVIEW_RADII.map((radius) => (
          <MenuItem key={radius} value={radius}>
            {radius}
          </MenuItem>
        ))}
      </TextField>
      <Stack direction="row" spacing={1.5}>
        <Button variant="contained" onClick={() => write(serializeThemePreview(draft))} sx={{ minHeight: 44 }}>
          {labels.apply}
        </Button>
        <Button variant="text" onClick={() => write(null)} sx={{ minHeight: 44 }}>
          {labels.reset}
        </Button>
      </Stack>
    </Stack>
  );
}
