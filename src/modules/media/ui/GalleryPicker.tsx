"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

/**
 * One stored picture, as `GET /api/admin/media` lists it: the master's address in the shape a
 * body carries, the small file for the grid, the stored size, the file's own name, and whether
 * it is a film's automatic poster (`yt-<id>`, §403) rather than a picture somebody uploaded.
 */
export type StoredPicture = {
  id: string;
  src: string;
  thumb: string;
  width: number;
  height: number;
  name: string;
  poster?: boolean;
};

export type GalleryPickerLabels = {
  loading: string;
  empty: string;
  close: string;
  /** The name box over the grid. */
  filter: string;
  /** Nothing matches what was typed. */
  noMatch: string;
};

/**
 * «Din galerie» — every picture the club already stored, to use again wherever the backoffice
 * takes a picture (§NNN): a picture in a text, a film's poster, a card of «Echipa», an album.
 *
 * The list is asked for when the picker opens and never before: a form is opened far more often
 * than a picture is reused, and the list is a request every editor would otherwise make on every
 * load (§73). The newest first, as the pictures page shows them; a name box narrows them, because
 * three hundred thumbnails are a wall.
 *
 * `accept` says which pictures the place can hold: a film's automatic poster is 480 pixels of
 * YouTube's thumbnail and belongs under a film, not in a text or an album, so those places leave
 * it out; the film's own poster picker takes it.
 *
 * Each thumbnail is a plain button (88 px: a thumb-sized target, BR-REQ-041-01 criterion 6) whose
 * accessible name is the file's; `onMouseDown` keeps the editor's selection where it was, so a
 * picture chosen in a text lands where the caret stood.
 */
export default function GalleryPicker({
  onPick,
  onClose,
  accept = (picture) => !picture.poster,
  picked = [],
  labels,
  testId = "gallery-picker",
}: {
  onPick: (picture: StoredPicture) => void;
  onClose: () => void;
  accept?: (picture: StoredPicture) => boolean;
  /** Pictures already chosen in this sitting, marked as such (an album taking several). */
  picked?: readonly string[];
  labels: GalleryPickerLabels;
  testId?: string;
}) {
  const [pictures, setPictures] = useState<StoredPicture[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/media")
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const { assets } = (await response.json()) as { assets: StoredPicture[] };
        if (!cancelled) setPictures(assets);
      })
      .catch(() => {
        if (!cancelled) setPictures([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const usable = (pictures ?? []).filter(accept);
  const needle = filter.trim().toLocaleLowerCase();
  const shown = needle ? usable.filter((picture) => picture.name.toLocaleLowerCase().includes(needle)) : usable;

  return (
    <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }} data-testid={testId}>
      {pictures === null ? (
        <Typography variant="body2" color="text.secondary">
          {labels.loading}
        </Typography>
      ) : usable.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {labels.empty}
        </Typography>
      ) : (
        <>
          {usable.length > 12 && (
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
          )}
          {shown.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {labels.noMatch}
            </Typography>
          ) : (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, maxHeight: 260, overflowY: "auto" }}>
              {shown.map((picture) => {
                const chosen = picked.includes(picture.id);
                return (
                  <Box
                    key={picture.id}
                    component="button"
                    type="button"
                    aria-label={picture.name}
                    aria-pressed={picked.length > 0 ? chosen : undefined}
                    title={`${picture.name} · ${picture.width} × ${picture.height}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onPick(picture)}
                    data-testid="gallery-picker-item"
                    sx={{
                      p: 0,
                      border: chosen ? 3 : 1,
                      borderColor: chosen ? "primary.main" : "divider",
                      borderRadius: 1,
                      bgcolor: "transparent",
                      cursor: "pointer",
                      overflow: "hidden",
                      width: 88,
                      height: 88,
                      flex: "0 0 auto",
                    }}
                  >
                    <Box component="img" src={picture.thumb} alt="" width={88} height={88} loading="lazy" sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                  </Box>
                );
              })}
            </Box>
          )}
        </>
      )}
      <Button color="inherit" size="small" onClick={onClose} sx={{ mt: 1, minHeight: 44 }}>
        {labels.close}
      </Button>
    </Box>
  );
}
