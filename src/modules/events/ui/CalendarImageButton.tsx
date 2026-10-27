"use client";

import ImageIcon from "@mui/icons-material/Image";
import PressButton from "@/shared/ui/PressButton";
import { lazy, Suspense, useState } from "react";
import type { CalendarImageData } from "../domain/calendar-image";
import type { CalendarImageDialogWords } from "./CalendarImageDialog";

// The dialog and the drawing load on the first press (§NNN): a visitor who never presses pays nothing for them.
const CalendarImageDialog = lazy(() => import("./CalendarImageDialog"));

/**
 * «Salvează ca imagine» under the month (§NNN): the month as a picture to post — drawn in the browser, never
 * on the server, so a thousand downloads cost the club no function and no database read.
 */
export default function CalendarImageButton({ data, words }: { data: CalendarImageData; words: CalendarImageDialogWords }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <PressButton
        icon={ImageIcon}
        size="small"
        variant="outlined"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        data-testid="calendar-image-open"
      >
        {words.open}
      </PressButton>
      {loaded && (
        <Suspense fallback={null}>
          <CalendarImageDialog open={open} onClose={() => setOpen(false)} data={data} words={words} />
        </Suspense>
      )}
    </>
  );
}
