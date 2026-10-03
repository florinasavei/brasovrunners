"use client";

import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { CONFIRM_CANCEL_EVENT } from "@/shared/forms/confirm-cancel";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import InfoTip from "@/shared/ui/InfoTip";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

type Choice = "counted" | "hidden";

/**
 * «Lista ascunsă» on a registration's page (§647, amending §643; the owner, 2026-10-02: «Nu îmi place
 * deloc cum arată bifa asta, trebuia să fie doar radio»): two radios — «Se numără între locurile
 * evenimentului» and «Pe lista ascunsă» — the one the server said checked, under a heading wearing the
 * incognito glyph. On screen it is «Lista de invitați speciali» since §NNN (the code keeps `hiddenList`),
 * and the heading has an «i» beside it (`info`, §640's touch-friendly pattern): what the list is for, what
 * the person keeps, and that an ordinary participant does not go there. Beside the heading, not inside
 * it, so the radio group's name stays the heading's words.
 *
 * A client island only for what a radio needs: a change asks the form's existing confirm. The radio
 * changes, then `requestSubmit()` puts the submit through `ActionFormIsland`, whose dialog says what
 * the press does in this row's state; «Da» sends the form's own hidden `outside` value — the radios
 * post nothing that matters — and «Anulează» dispatches `CONFIRM_CANCEL_EVENT` on the form, on which
 * the radio shows the server's answer again. Once a submission ends (`useFormStatus`), the radio
 * follows the page the action redirected to, whatever it says: moved, or refused and unchanged.
 *
 * `disabled` is the Organizer's (§289), or a row whose state allows no change: the state is read, no
 * control is live — and the server refuses anyway (`canManageRegistrations`, asserted in the action and
 * the service). Each radio's label wraps at 320 pixels, inside a 44-pixel target.
 */
export default function HiddenListRadio({
  onList,
  headingId,
  heading,
  countedLabel,
  hiddenLabel,
  info,
  disabled = false,
}: {
  /** What the server says: `registrations.outside_capacity`. */
  onList: boolean;
  headingId: string;
  /** «Lista de invitați speciali». */
  heading: string;
  countedLabel: string;
  hiddenLabel: string;
  /** The «i» beside the heading: one line per fact, newline-separated (`InfoTip` draws them as lines). */
  info?: string;
  disabled?: boolean;
}) {
  const current: Choice = onList ? "hidden" : "counted";
  // The choice made and not yet answered — shown while the dialog asks; null shows the server's.
  const [asked, setAsked] = useState<Choice | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  // «Anulează»: nothing was sent, the server's state again.
  useEffect(() => {
    const form = group.current?.closest("form");
    if (!form) return;
    const restore = () => setAsked(null);
    form.addEventListener(CONFIRM_CANCEL_EVENT, restore);
    return () => form.removeEventListener(CONFIRM_CANCEL_EVENT, restore);
  }, []);

  // A submission ended (moved, or refused): the page now says the truth, so the radio follows it.
  useEffect(() => {
    if (wasPending.current && !pending) setAsked(null);
    wasPending.current = pending;
  }, [pending]);

  const onChange = (_event: unknown, value: string) => {
    if (disabled || pending) return;
    const choice: Choice = value === "hidden" ? "hidden" : "counted";
    if (choice === current) {
      setAsked(null);
      return;
    }
    setAsked(choice);
    group.current?.closest("form")?.requestSubmit();
  };

  const Glyph = ACTION_ICONS.hiddenList;
  const option = (value: Choice, label: string) => (
    <FormControlLabel
      value={value}
      control={<Radio sx={CHECKBOX_TAP_TARGET} />}
      label={label}
      disabled={disabled || pending}
      data-testid={`hidden-list-${value}`}
      // The words wrap rather than run past a 320-pixel screen; the radio stays on their first line.
      sx={{ mr: 0, minWidth: 0, maxWidth: "100%", "& .MuiFormControlLabel-label": { minWidth: 0, overflowWrap: "anywhere" } }}
    />
  );

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, mb: 0.5, minWidth: 0 }}>
        <Typography id={headingId} variant="h3" sx={{ fontSize: "1rem", display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, overflowWrap: "anywhere" }}>
          <Glyph fontSize="small" aria-hidden />
          {heading}
        </Typography>
        {info ? <InfoTip text={info} /> : null}
      </Box>
      <RadioGroup ref={group} aria-labelledby={headingId} value={asked ?? current} onChange={onChange} sx={{ minWidth: 0 }}>
        {option("counted", countedLabel)}
        {option("hidden", hiddenLabel)}
      </RadioGroup>
    </>
  );
}
