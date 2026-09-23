"use client";

import Button from "@mui/material/Button";
import { useSyncExternalStore, type ReactNode } from "react";
import { fallsBackToDownload, instagramShareData, offersInstagramShare } from "../instagram-share";
import { SHARE_PILL_SX } from "./share-pill";

/**
 * "Instagram" on the share row (`DECISIONS.md` §90, §140): an actual share where the phone
 * can take a picture, the picture as a download everywhere else.
 *
 * The server renders the download — a plain anchor to the square card, labelled as the
 * download it is — and that is what every browser gets first, JavaScript or not. Once the
 * browser has said it can share a file from a touch screen (`offersInstagramShare`, asked
 * through `useSyncExternalStore` so the first client render matches the HTML), the anchor
 * becomes a button that fetches the card and hands it to the share sheet, where Instagram is.
 *
 * ## Why the fetch is in the handler and the share in its `then`
 *
 * `navigator.share` needs the tap it answers to: iOS Safari refuses a call made after an
 * `await` that took too long, and refuses `window.open` after any. So there is no `async`
 * handler here — the fetch starts in the click and the share is called in its `.then`, the
 * one shape iOS accepts as the same activation while the picture arrives fast (the route
 * caches it for an hour). When iOS still says no, the catch falls back to the download; when
 * the person closed the sheet, it does nothing (`fallsBackToDownload`).
 *
 * The download in the catch is a navigation to the picture, not a click on a made-up anchor:
 * the route answers `Content-Disposition: attachment`, so the page stays and the file is
 * offered, and a navigation needs no user activation to be honoured.
 *
 * The glyph is `children`, made on the server side of the boundary (`AGENTS.md` §14.1).
 */
export default function InstagramShareButton({
  imageHref,
  fileName,
  title,
  url,
  shareLabel,
  downloadLabel,
  children,
}: {
  imageHref: string;
  fileName: string;
  title: string;
  url: string;
  shareLabel: string;
  downloadLabel: string;
  children: ReactNode;
}) {
  // Server snapshot false, client snapshot the truth: the first client render matches the HTML.
  const shareable = useSyncExternalStore(
    () => () => {},
    () => offersInstagramShare(navigator, window.matchMedia("(pointer: coarse)").matches),
    () => false,
  );

  if (!shareable) {
    return (
      <Button component="a" href={imageHref} download variant="outlined" size="small" sx={SHARE_PILL_SX}>
        {children}
        {downloadLabel}
      </Button>
    );
  }

  return (
    <Button
      variant="outlined"
      size="small"
      sx={SHARE_PILL_SX}
      onClick={() => {
        fetch(imageHref)
          .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(`share-image ${response.status}`))))
          .then((picture) => navigator.share(instagramShareData(picture, { fileName, title, url })))
          .catch((error: unknown) => {
            if (fallsBackToDownload(error)) window.location.assign(imageHref);
          });
      }}
    >
      {children}
      {shareLabel}
    </Button>
  );
}
