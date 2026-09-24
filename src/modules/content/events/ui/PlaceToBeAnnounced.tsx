"use client";

import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField, { useRecall } from "@/shared/forms/recall";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { ShownWhen } from "./OnlyForType";

/** What the switch posts; `admin/actions.ts#eventFieldsFrom` reads it by this name. */
const SWITCH_NAME = "event.locationToBeAnnounced";

/** The meeting point's box as the Locul box read it off the schema (§315): plain data, never zod. */
type BoxProps = ReturnType<typeof textFieldConstraints>;

type Props = {
  /** The event's own state; the create form starts announced. */
  defaultChecked: boolean;
  labels: {
    toggle: string;
    toggleHelp: string;
    locationName: string;
    locationHelp: string;
    /** "Not published while the place is to be announced", under the box while the switch is on. */
    unpublished: string;
  };
  locationName: { defaultValue: string; box: BoxProps };
  /** The map link's box, rendered by the server form as it always was, under the name. */
  children: ReactNode;
};

/**
 * "Locația se anunță mai târziu" (`DECISIONS.md` §328; the owner: "I want to be able to set the
 * location as TBD, and to not announce it yet") — the switch, and the meeting point's box whose
 * `required` follows it.
 *
 * The box's constraints are the schema's (§315), read on the server and handed over as data:
 * `fields.ts` declares the meeting point required, and `placeRule` there is what refuses a blank
 * one — unless this switch is on. So the browser's rule follows the switch the same way: on, the
 * box is not required and says that what is in it is not published; off, it is required again.
 * Nothing typed is cleared by the switch — the organizer may write the venue down the moment it
 * is known and announce it later with one save.
 *
 * A client island because the `required` attribute is what changes, and MUI marks a required
 * label itself; a server-rendered box would ask for a place the server no longer wants. With
 * JavaScript off the box keeps the state it was rendered with, and the server's rule is the
 * whole answer — as for every other cross-field rule on this form.
 *
 * After a refusal the switch comes back as it was posted (§315): an unticked switch posts
 * nothing, so "not posted" is "off", and the island re-mounts on every answer.
 */
export default function PlaceToBeAnnounced(props: Props) {
  const recall = useRecall();
  const initial = recall.has ? recall.value(SWITCH_NAME) === "on" : props.defaultChecked;
  return <Island key={recall.generation} {...props} initial={initial} />;
}

function Island({ initial, labels, locationName, children }: Props & { initial: boolean }) {
  const [later, setLater] = useState(initial);
  const own = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  /*
    The form's own watchers — the create button's "lipsește: …" and the save button's named hint
    (§315) — measure on `change`, which the switch fires *before* React has re-rendered the box
    without `required`. So once the attribute has actually changed, they are told again, from the
    form itself: no input of theirs is named, so the bib preview and the rest ignore it.
  */
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    own.current?.closest("form")?.dispatchEvent(new Event("change"));
  }, [later]);

  const { box } = locationName;
  const required = later ? undefined : box.required;

  return (
    <Stack spacing={2} ref={own}>
      <Stack spacing={0.5}>
        {/* The label is the tap target, and it is at least 44 pixels tall (BR-REQ-041-01 criterion 6). */}
        <FormControlLabel
          sx={{ ...TAP_TARGET, alignSelf: "flex-start" }}
          control={
            <Switch
              name={SWITCH_NAME}
              checked={later}
              onChange={(event) => setLater(event.target.checked)}
              slotProps={{ input: { "aria-describedby": "place-to-be-announced-help" } }}
            />
          }
          label={labels.toggle}
        />
        <Typography id="place-to-be-announced-help" variant="body2" color="text.secondary">
          {labels.toggleHelp}
        </Typography>
      </Stack>

      {/*
        The place's boxes are hidden while the place is to be announced (the owner, 2026-09-24:
        "if the location is announced later, we should hide these fields"), and kept mounted: a
        venue typed before the switch went on is still posted, still saved, never published, and
        back in its box the moment the switch goes off (§328). `display: none` keeps them out of
        the accessibility tree as well as out of sight; nothing is required while they are hidden.

        And nothing in them can stop the save while hidden (§350, the editor's boxes, found by
        re-review): the map link keeps its https pattern, and one typed as `www.harta.ro` before
        the switch went on made the browser refuse the submit and then fail to focus a box it
        could not show — Salvează did nothing and said nothing. `ShownWhen` makes every box in the
        block read-only while it is hidden, which the browser does not check and still posts; the
        service ignores a map link it could not store while the switch is on
        (`ignoreHiddenFields`). Switched off, the boxes are checked again as they stand.
      */}
      <ShownWhen shown={!later} answer={later ? "later" : "announced"}>
        <Stack spacing={2} data-place-details>
          <RecallField
            name="event.locationName"
            label={labels.locationName}
            helperText={later ? `${labels.unpublished} ${labels.locationHelp}` : labels.locationHelp}
            defaultValue={locationName.defaultValue}
            {...box}
            required={required}
            slotProps={{ ...box.slotProps, htmlInput: { ...box.slotProps.htmlInput, required } }}
          />

          {children}
        </Stack>
      </ShownWhen>
    </Stack>
  );
}
