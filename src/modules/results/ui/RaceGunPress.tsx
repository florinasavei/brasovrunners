"use client";

import Box from "@mui/material/Box";
import { useEffect, useRef } from "react";
import GlyphButton from "@/shared/ui/GlyphButton";
import { anchorAtLoad, type ServerAnchor, serverNowOf } from "../domain/finish-line";

const localNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * «Start» on «Cronometrare» (§NNN; the owner: «un buton „Start" pe pagină, pe care îl apasă un organizator la pistol»): one plain
 * form, so it works with scripts off — the server then takes its own clock for the gun. With scripts on, the moment of the tap is
 * written into the form before it leaves (`claimedAtMs`), on the server's clock as the page brought it (`domain/finish-line.ts`), so
 * the round trip on a slow signal does not move the gun; the server keeps it when it is within thirty seconds of its own clock.
 * A second press moves the gun, which the button says («Mută startul acum»). Plain data crosses the boundary — the words, the
 * server's `now` and the Server Action — and the glyph by its name.
 */
export default function RaceGunPress({
  action,
  eventId,
  uiLocale,
  serverNowMs,
  label,
}: {
  action: (form: FormData) => Promise<void>;
  eventId: string;
  uiLocale: string;
  serverNowMs: number;
  label: string;
}) {
  const anchor = useRef<ServerAnchor>(anchorAtLoad(serverNowMs, 0));
  const claimed = useRef<HTMLInputElement>(null);
  useEffect(() => {
    anchor.current = anchorAtLoad(serverNowMs, localNow());
  }, [serverNowMs]);
  return (
    <Box
      component="form"
      action={action}
      onSubmit={() => {
        // Before React reads the form: the tap's moment, on the server's clock.
        if (claimed.current) claimed.current.value = String(serverNowOf(anchor.current, localNow()));
      }}
      data-testid="race-gun-form"
    >
      <input type="hidden" name="uiLocale" value={uiLocale} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="intent" value="start" />
      <input ref={claimed} type="hidden" name="claimedAtMs" defaultValue="" />
      <GlyphButton type="submit" icon="raceStart" variant="contained" color="success" sx={{ minHeight: 56, fontSize: "1.125rem", px: 3 }} data-testid="race-gun-start">
        {label}
      </GlyphButton>
    </Box>
  );
}
