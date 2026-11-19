"use client";

import Box from "@mui/material/Box";
import { type FormEvent, useCallback, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import GlyphButton from "@/shared/ui/GlyphButton";
import { seedServerClock, serverClockNow } from "./server-clock";

/**
 * «Start» on «Cronometrare» (§986; the owner: «un buton „Start" pe pagină, pe care îl apasă un organizator la pistol»): one plain
 * form, so it works with scripts off — the server then takes its own clock for the gun. With scripts on, the moment of the tap is
 * written into the form before it leaves (`claimedAtMs`), on the server's clock as this phone measured it (`server-clock.ts`, the
 * finish line's island beside it asking the server as the page wakes; the wall clock, so a phone that slept while the organizer
 * waited for the gun still taps the right moment), so the round trip on a slow signal does not move the gun; the server keeps it
 * when it hears it at most ten seconds later (`domain/finish-line.ts#raceGunMoment`). A second press moves the gun, which the button
 * says («Mută startul acum»).
 *
 * **One tap, one «Start»** (the review: a tap again while the first was still on its way was queued behind it and sent as a second
 * «Start», which moved the gun by the gap and shortened every runner's time): from the tap until the server answered, the button
 * says so («Se trimite…», `aria-busy`) and a press of it is swallowed — `aria-disabled`, not `disabled`, so the focus stays on it, as
 * `SubmitButton` keeps it — and the form sends nothing more until then. The server holds the same line on its side: the
 * organizer's own «Start» heard again within ten seconds changes nothing (`domain/finish-line.ts#raceGunRepeats`).
 *
 * **The gun the page saw goes with the press** (`seenGunAtMs`: empty for none, else its instant; the integration's review: with two
 * organizers at the start line, the one who pressed seconds later — their page still saying «Start» — moved the first one's gun): the
 * server refuses a press whose page saw another gun than the one stored (`RACE_GUN_CHANGED`) and the page, drawn again, says who gave
 * the start and when. Plain data crosses the boundary — the words, the server's `now`, the gun seen and the Server Action — and the
 * glyph by its name.
 */
export default function RaceGunPress({
  action,
  eventId,
  uiLocale,
  serverNowMs,
  seenGunAtMs,
  label,
  pendingLabel,
}: {
  action: (form: FormData) => Promise<void>;
  eventId: string;
  uiLocale: string;
  /** The server's clock as it drew the page: the clock's first reading, until a measured one is known. */
  serverNowMs: number;
  /** The gun the page was drawn with: null while «Start» was not pressed («Start»), else its instant («Mută startul acum»). */
  seenGunAtMs: number | null;
  label: string;
  /** What the button says while its press is on its way: «Se trimite…». */
  pendingLabel: string;
}) {
  const claimed = useRef<HTMLInputElement>(null);
  // A press on its way, from the tap — before the form's own status has said so — until the server answered.
  const sending = useRef(false);
  useEffect(() => {
    seedServerClock(serverNowMs);
  }, [serverNowMs]);
  const settled = useCallback(() => {
    sending.current = false;
  }, []);
  return (
    <Box
      component="form"
      action={action}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        // Before React reads the form. A press while one is on its way sends nothing: it is that press, tapped again.
        if (sending.current) {
          event.preventDefault();
          return;
        }
        sending.current = true;
        // The tap's moment, on the server's clock.
        if (claimed.current) claimed.current.value = String(serverClockNow());
      }}
      data-testid="race-gun-form"
    >
      <input type="hidden" name="uiLocale" value={uiLocale} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="intent" value="start" />
      <input type="hidden" name="seenGunAtMs" value={seenGunAtMs === null ? "" : String(seenGunAtMs)} />
      <input ref={claimed} type="hidden" name="claimedAtMs" defaultValue="" />
      <StartButton label={label} pendingLabel={pendingLabel} onSettled={settled} />
    </Box>
  );
}

/** The button, inside its form so it reads the form's status: busy while the press is on its way, a press of it then swallowed. */
function StartButton({ label, pendingLabel, onSettled }: { label: string; pendingLabel: string; onSettled: () => void }) {
  const { pending } = useFormStatus();
  // The press answered (or never sent): the form may send again.
  useEffect(() => {
    if (!pending) onSettled();
  }, [pending, onSettled]);
  return (
    <GlyphButton
      type="submit"
      icon="raceStart"
      variant="contained"
      color="success"
      aria-disabled={pending}
      aria-busy={pending}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      sx={{ minHeight: 56, fontSize: "1.125rem", px: 3, ...(pending ? { opacity: 0.7, cursor: "progress" } : {}) }}
      data-testid="race-gun-start"
      data-pending={pending ? "true" : undefined}
    >
      {pending ? pendingLabel : label}
    </GlyphButton>
  );
}
