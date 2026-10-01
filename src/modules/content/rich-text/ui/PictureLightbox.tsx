"use client";

import Box from "@mui/material/Box";
import { useTranslations } from "next-intl";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { leavePreviewEntry, previewPopListener, pushPreviewEntry } from "./picture-preview-history";

/**
 * The large preview's own layer, fetched the first time a reader taps a picture: until then the
 * page carries this file's trigger and nothing of the dialog (§NNN, §577 — no request in idle).
 */
const PictureLightboxDialog = lazy(() => import("./PictureLightboxDialog"));

/**
 * A description picture that opens large in place (§NNN): the owner, 2026-10-01, «în descrierea
 * full, când dau click pe o poză, vreau să se facă mare (dar nu deschisă ca și poză) și să o pot
 * închide apoi».
 *
 * The figure and its `<img>` are still rendered by `RichText` on the server and arrive as
 * `children`, so the page's markup, the cache and the lazy loading are what they were; this island
 * only wraps them in a button. The props are plain values (§318): the stored address, its ladder
 * and its words.
 *
 * The preview is the same stored file the figure already uses — its `srcSet` with `sizes="100vw"`,
 * so the browser takes the rung as wide as the screen, up to the master — and nothing new is
 * uploaded or kept. Back closes it (`picture-preview-history.ts`); Escape, the ✕ and a tap close
 * it through the dialog; focus goes back to the picture.
 */
export default function PictureLightbox({
  src,
  srcSet,
  alt,
  caption,
  children,
}: {
  src: string;
  srcSet?: string;
  alt: string;
  caption: string;
  children: ReactNode;
}) {
  const t = useTranslations("Picture");
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Once fetched, the dialog stays mounted, so closing it runs its transition and gives focus back.
  const [loaded, setLoaded] = useState(false);

  const show = useCallback(() => {
    // Safari does not focus a button it clicks; the dialog gives focus back to what had it.
    trigger.current?.focus({ preventScroll: true });
    pushPreviewEntry(window.history);
    setLoaded(true);
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    leavePreviewEntry(window.history);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const listener = previewPopListener(window.history, () => setOpen(false));
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, [open]);

  return (
    <>
      <Box
        component="button"
        type="button"
        ref={trigger}
        onClick={show}
        aria-haspopup="dialog"
        aria-label={alt ? t("openNamed", { alt }) : t("open")}
        data-testid="picture-preview-trigger"
        sx={{
          display: "block",
          width: "100%",
          p: 0,
          m: 0,
          border: 0,
          bgcolor: "transparent",
          color: "inherit",
          font: "inherit",
          textAlign: "inherit",
          cursor: "zoom-in",
          borderRadius: 1,
          "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 },
        }}
      >
        {children}
      </Box>
      {loaded && (
        <Suspense fallback={null}>
          <PictureLightboxDialog
            open={open}
            onClose={hide}
            src={src}
            srcSet={srcSet}
            alt={alt}
            caption={caption}
            closeLabel={t("close")}
            title={alt || t("title")}
          />
        </Suspense>
      )}
    </>
  );
}
