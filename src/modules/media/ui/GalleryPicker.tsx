"use client";

import Box from "@mui/material/Box";
import CloseIcon from "@mui/icons-material/Close";
import ArticleIcon from "@mui/icons-material/Article";
import CollectionsIcon from "@mui/icons-material/Collections";
import EventIcon from "@mui/icons-material/Event";
import GroupsIcon from "@mui/icons-material/Groups";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { PICTURE_SOURCES, type PickerScope, pickerScopeParam, type PictureSource, type PictureUse, visiblePictures } from "../picker";
import { formatBytes } from "./stored-facts";

/** Each chip's glyph (§521). */
const SOURCE_ICON = {
  all: CollectionsIcon,
  event: EventIcon,
  album: PhotoAlbumIcon,
  page: ArticleIcon,
  team: GroupsIcon,
  here: MyLocationIcon,
} as const;

/** One stored picture, as `GET /api/admin/media` lists it; `poster` is a film's automatic `yt-<id>` (§403). */
export type StoredPicture = {
  id: string;
  src: string;
  thumb: string;
  width: number;
  height: number;
  bytes: number;
  name: string;
  uses: PictureUse[];
  poster?: boolean;
  /** Asked for from a place (`scope`): whether that very place already uses it (§485). */
  here?: boolean;
};

export type GalleryPickerLabels = {
  loading: string;
  empty: string;
  close: string;
  /** The name box over the grid. */
  filter: string;
  /** Nothing matches what was typed or chosen. */
  noMatch: string;
  /** The chips' legend, «Folosită în», and one word per chip, «toate» first. */
  sourceLegend: string;
  sources: Record<Exclude<PictureSource, "here">, string>;
  /** The first chip when the picker knows its place, worded by the caller (§485). */
  here?: string;
};

/**
 * «Din galerie» — reuse a stored picture wherever the backoffice takes one (§485). The list is
 * fetched only when the picker opens (§73) and narrowed on both sides by `media/picker.ts`.
 * Thumbnails are 88-px buttons (BR-REQ-041-01 criterion 6); `onMouseDown` keeps the editor's caret.
 */
export default function GalleryPicker({
  onPick,
  onClose,
  withPosters = false,
  picked = [],
  scope,
  opensHere = true,
  labels,
  testId = "gallery-picker",
}: {
  onPick: (picture: StoredPicture) => void;
  onClose: () => void;
  /** A film's automatic poster is offered too (the film's own poster picker). */
  withPosters?: boolean;
  /** Pictures already chosen in this sitting, marked as such (an album taking several). */
  picked?: readonly string[];
  /** The place whose editor the picker is in (§485); it opens on that place's pictures, or «Toate» if none. */
  scope?: PickerScope;
  /** False for an album, whose own pictures are already in it. */
  opensHere?: boolean;
  labels: GalleryPickerLabels;
  testId?: string;
}) {
  const [pictures, setPictures] = useState<StoredPicture[] | null>(null);
  const [filter, setFilter] = useState("");
  const scoped = scope !== undefined && labels.here !== undefined;
  const [source, setSource] = useState<PictureSource>(scoped && opensHere ? "here" : "all");
  /** The first answer only: a place that uses no picture yet opens on «Toate», not on nothing. */
  const firstAnswer = useRef(true);
  const scopeParam = scoped ? pickerScopeParam(scope) : null;
  /** The typed name as sent: a moment after the last key rather than on every one. */
  const [needle, setNeedle] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(filter.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams();
    if (needle) query.set("q", needle);
    if (source !== "all") query.set("source", source);
    if (withPosters) query.set("posters", "1");
    if (scopeParam) query.set("for", scopeParam);
    const search = query.toString();
    fetch(`/api/admin/media${search ? `?${search}` : ""}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const { assets } = (await response.json()) as { assets: StoredPicture[] };
        if (cancelled) return;
        const first = firstAnswer.current;
        firstAnswer.current = false;
        if (first && source === "here" && needle === "" && assets.length === 0) {
          setSource("all");
          return;
        }
        setPictures(assets);
      })
      .catch(() => {
        if (!cancelled) setPictures([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needle, source, withPosters, scopeParam]);

  // The server's filter again, so typing narrows at once while the next answer is on its way.
  const shown = visiblePictures(pictures ?? [], {
    accept: (picture) => withPosters || !picture.poster,
    needle: filter,
    source,
  });
  const narrowed = filter.trim() !== "" || source !== "all" || needle !== "";
  const chips: PictureSource[] = scoped ? ["here", ...PICTURE_SOURCES] : [...PICTURE_SOURCES];
  const lang = typeof document === "undefined" ? "ro" : document.documentElement.lang || "ro";

  return (
    <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }} data-testid={testId}>
      {pictures === null ? (
        <Typography variant="body2" color="text.secondary">
          {labels.loading}
        </Typography>
      ) : shown.length === 0 && !narrowed ? (
        <Typography variant="body2" color="text.secondary">
          {labels.empty}
        </Typography>
      ) : (
        <>
          <TextField
            size="small"
            label={labels.filter}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              // Inside a form: Enter narrows the list, it never submits the page.
              if (event.key === "Enter") event.preventDefault();
            }}
            sx={{ mb: 1, width: "100%", maxWidth: 320 }}
          />
          <Box sx={{ mb: 1 }}>
            <Typography component="span" variant="body2" sx={{ display: "block", fontWeight: 600, mb: 0.5 }}>
              {labels.sourceLegend}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={source}
              onChange={(_event, next: PictureSource | null) => {
                if (next !== null) setSource(next);
              }}
              aria-label={labels.sourceLegend}
              data-testid={`${testId}-sources`}
              sx={{ flexWrap: "wrap" }}
            >
              {chips.map((value) => {
                const SourceIcon = SOURCE_ICON[value];
                return (
                  <ToggleButton key={value} value={value} sx={{ minWidth: 44, minHeight: 44, px: 1, gap: 0.5 }}>
                    <SourceIcon aria-hidden fontSize="small" />
                    {value === "here" ? labels.here : labels.sources[value]}
                  </ToggleButton>
                );
              })}
            </ToggleButtonGroup>
          </Box>
          {shown.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {labels.noMatch}
            </Typography>
          ) : (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, maxHeight: 320, overflowY: "auto" }}>
              {shown.map((picture) => {
                const chosen = picked.includes(picture.id);
                const weight = formatBytes(picture.bytes, lang);
                const facts = `${picture.width} × ${picture.height} · ${weight}`;
                return (
                  <Box key={picture.id} sx={{ width: 88, flex: "0 0 auto" }}>
                    <Box
                      component="button"
                      type="button"
                      aria-label={`${picture.name}, ${facts}`}
                      aria-pressed={picked.length > 0 ? chosen : undefined}
                      title={`${picture.name} · ${facts}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onPick(picture)}
                      data-testid="gallery-picker-item"
                      sx={{
                        display: "block",
                        p: 0,
                        border: chosen ? 3 : 1,
                        borderColor: chosen ? "primary.main" : "divider",
                        borderRadius: 1,
                        bgcolor: "transparent",
                        cursor: "pointer",
                        overflow: "hidden",
                        width: 88,
                        height: 88,
                      }}
                    >
                      <Box component="img" src={picture.thumb} alt="" width={88} height={88} loading="lazy" sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                    </Box>
                    {/* Visible on a phone, where a title never shows (§485). */}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      component="p"
                      aria-hidden
                      data-testid="gallery-picker-item-facts"
                      sx={{ lineHeight: 1.2, mt: 0.25, fontSize: 11, textAlign: "center" }}
                    >
                      {picture.width} × {picture.height}
                      <br />
                      {weight}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          )}
        </>
      )}
      <Button color="inherit" size="small" onClick={onClose} startIcon={<CloseIcon fontSize="small" />} sx={{ mt: 1, minHeight: 44 }}>
        {labels.close}
      </Button>
    </Box>
  );
}
