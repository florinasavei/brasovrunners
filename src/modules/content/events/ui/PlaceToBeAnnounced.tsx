"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
/** The two boxes of "Punct de întâlnire" (§NNN), by the names `eventFieldsFrom` reads. */
const RO_NAME = "event.locationName";
const EN_NAME = "event.locationNameEn";

/** A box's constraints as the Locul box read them off the schema (§315): plain data, never zod. */
type BoxConstraints = ReturnType<typeof textFieldConstraints>;
type NameBox = { defaultValue: string; box: BoxConstraints };

type Props = {
  /** The event's own state; the create form starts announced. */
  defaultChecked: boolean;
  labels: {
    toggle: string;
    toggleHelp: string;
    /** "Punct de întâlnire": the one heading over both boxes. */
    meetingPoint: string;
    /** Each box's own label: the language in its own words ("Română", "English"). */
    ro: string;
    en: string;
    locationHelp: string;
    /** "Not published while the place is to be announced", under the boxes while the switch is on. */
    unpublished: string;
    /** "Același nume și în engleză": copies the Romanian box into the English one. */
    copyToEnglish: string;
  };
  names: { ro: NameBox; en: NameBox };
  /** The map link's box, rendered by the server form as it always was, under the names. */
  children: ReactNode;
};

/**
 * A label's words a screen reader and the save button's "completează întâi: …" read, and nobody
 * sees: the heading says "Punct de întâlnire" once over both boxes, and each box shows only its
 * language — but a box named "English" on its own would say nothing out of context.
 *
 * The sizes are strings on purpose: in MUI's `sx` a bare `1` is 100%, and a clipped span as wide
 * as the label pushed a 320-pixel page to 342 — a sideways scroll on a phone, and every tap below
 * it landing beside its target.
 */
const UNSEEN = {
  position: "absolute",
  width: "1px",
  height: "1px",
  p: 0,
  m: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/**
 * "Locația se anunță mai târziu" (`DECISIONS.md` §328; the owner: "I want to be able to set the
 * location as TBD, and to not announce it yet") — the switch, and the place's boxes whose
 * `required` follows it: "Punct de întâlnire" once per language (§NNN; the owner: "There is some
 * redundance on this meeting spot location"), Romanian and English side by side from `sm` and
 * stacked on a phone, then the map link.
 *
 * The boxes' constraints are the schema's (§315), read on the server and handed over as data:
 * `fields.ts` declares both names required, and `placeRule` there is what refuses a blank one —
 * unless this switch is on. So the browser's rule follows the switch the same way: on, neither box
 * is required and they say that what is in them is not published; off, both are required again.
 * Nothing typed is cleared by the switch — the organizer may write the venue down the moment it
 * is known and announce it later with one save.
 *
 * "Același nume și în engleză" under the English box copies the Romanian text into it: a place's
 * name is often the same in both ("Stadionul Tineretului" is not translated). It is off while the
 * two boxes already say the same, and while there is nothing to copy; it never writes anywhere the
 * organizer is not looking — the box it fills is the one right above it.
 *
 * A client island because the `required` attribute is what changes, and MUI marks a required
 * label itself; a server-rendered box would ask for a place the server no longer wants. With
 * JavaScript off the boxes keep the state they were rendered with, the copy button does nothing,
 * and the server's rule is the whole answer — as for every other cross-field rule on this form.
 *
 * After a refusal the switch comes back as it was posted (§315): an unticked switch posts
 * nothing, so "not posted" is "off", and the island re-mounts on every answer.
 */
export default function PlaceToBeAnnounced(props: Props) {
  const recall = useRecall();
  const initial = recall.has ? recall.value(SWITCH_NAME) === "on" : props.defaultChecked;
  return <Island key={recall.generation} {...props} initial={initial} />;
}

function Island({ initial, labels, names, children }: Props & { initial: boolean }) {
  const recall = useRecall();
  const [later, setLater] = useState(initial);
  // What each box holds now, for the copy button's state; the boxes themselves stay uncontrolled
  // (`RecallField`), so a refusal fills them back from what was posted.
  const [ro, setRo] = useState(recall.value(RO_NAME) ?? names.ro.defaultValue);
  const [en, setEn] = useState(recall.value(EN_NAME) ?? names.en.defaultValue);
  const own = useRef<HTMLDivElement>(null);
  const enBox = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);

  /*
    The form's own watchers — the create button's "lipsește: …" and the save button's named hint
    (§315) — measure on `change`, which the switch fires *before* React has re-rendered the boxes
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

  /*
    The Romanian text into the English box, as if it had been typed there: through the input's own
    value setter and an `input` event, so React's `onChange` runs (MUI lifts the label off the
    text, `en` follows) and every watcher of the form reads the new value — the publish check
    stops naming the English place.
  */
  const copyToEnglish = () => {
    const input = enBox.current;
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, ro.trim());
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const nothingToCopy = ro.trim() === "" || ro.trim() === en.trim();

  const nameBox = (name: string, language: string, value: NameBox, onChange: (text: string) => void, inputRef?: typeof enBox) => {
    const required = later ? undefined : value.box.required;
    return (
      <RecallField
        name={name}
        label={
          <>
            <Box component="span" sx={UNSEEN}>
              {`${labels.meetingPoint} (`}
            </Box>
            {language}
            <Box component="span" sx={UNSEEN}>
              )
            </Box>
          </>
        }
        defaultValue={value.defaultValue}
        fullWidth
        onChange={(event) => onChange(event.target.value)}
        inputRef={inputRef}
        {...value.box}
        required={required}
        slotProps={{ ...value.box.slotProps, htmlInput: { ...value.box.slotProps.htmlInput, required } }}
      />
    );
  };

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
          <Box component="fieldset" aria-describedby="place-names-help" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid="place-names">
            <Typography component="legend" variant="subtitle2" sx={{ p: 0, mb: 1.5 }}>
              {labels.meetingPoint}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>{nameBox(RO_NAME, labels.ro, names.ro, setRo)}</Box>
              <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                {nameBox(EN_NAME, labels.en, names.en, setEn, enBox)}
                {/* A thumb presses it on a phone: 44 pixels tall (BR-REQ-041-01 criterion 6). */}
                <Button
                  type="button"
                  variant="text"
                  size="small"
                  startIcon={<ContentCopyIcon />}
                  onClick={copyToEnglish}
                  disabled={nothingToCopy}
                  data-testid="place-copy-to-english"
                  sx={{ ...TAP_TARGET, alignSelf: "flex-start", textTransform: "none" }}
                >
                  {labels.copyToEnglish}
                </Button>
              </Stack>
            </Stack>
            <Typography id="place-names-help" variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, px: 1.75 }}>
              {later ? `${labels.unpublished} ${labels.locationHelp}` : labels.locationHelp}
            </Typography>
          </Box>

          {children}
        </Stack>
      </ShownWhen>
    </Stack>
  );
}
