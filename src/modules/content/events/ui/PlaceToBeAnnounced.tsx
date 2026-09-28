"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { englishFollowsTyping, englishLeftBehind, mayCopyToEnglish } from "@/modules/events/domain/place";
import type { textFieldConstraints } from "@/shared/forms/constraints";
import { fillIn } from "@/shared/forms/fill-in";
import RecallField, { useRecall } from "@/shared/forms/recall";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import { PLACE_NAMES_AS_TYPED_FIELD } from "../form-names";
import { ShownWhen } from "./OnlyForType";

/** What the switch posts; `admin/actions.ts#eventFieldsFrom` reads it by this name. */
const SWITCH_NAME = "event.locationToBeAnnounced";
/** The two boxes of "Punct de întâlnire" (§362), by the names `eventFieldsFrom` reads. */
const RO_NAME = "event.locationName";
const EN_NAME = "event.locationNameEn";
/** Nothing to listen to: whether the island runs is settled once it has hydrated. */
const noChanges = () => () => {};

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
    /** "Același nume și în engleză": copies the Romanian box into an empty English one. */
    copyToEnglish: string;
    /** Under the English box when the Romanian place moved but the English did not; `{place}` is filled here. */
    englishLeftBehind: string;
  };
  names: { ro: NameBox; en: NameBox };
  /** The map link's box, rendered by the server form, under the names. */
  children: ReactNode;
};

/**
 * Visually hidden label words for screen readers and the save button's "completează întâi: …":
 * a box labelled only "English" would say nothing out of context. The sizes are strings because in
 * MUI's `sx` a bare `1` is 100%, and a label-wide clipped span scrolled a 320-px page sideways.
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
 * "Locația se anunță mai târziu" (§328) and the place boxes whose `required` follows it: "Punct de
 * întâlnire" per language side by side (§362), then the map link. Constraints come from the schema
 * (§315); `placeRule` refuses a blank name unless the switch is on, and the browser follows the
 * same switch. The switch clears nothing typed.
 *
 * "Același nume și în engleză" copies the Romanian into an empty English box only, so a stray tap
 * never overwrites a name past the browser's undo. While both boxes say the same place the English
 * follows the Romanian as typed (`englishFollowsTyping`; the service applies the same rule,
 * `place.ts#englishNameAfterSave`); an English name of its own is never overwritten, and
 * `englishLeftBehind` flags it instead. Once the island runs it posts `PLACE_NAMES_AS_TYPED_FIELD`
 * so the service keeps the English as shown; without JavaScript the server's rule applies.
 *
 * Client because `required` changes and MUI marks the label from it. The switch recalls after a
 * refusal (§315); unticked posts nothing, so "not posted" is "off".
 */
export default function PlaceToBeAnnounced(props: Props) {
  const recall = useRecall();
  const initial = recall.has ? recall.value(SWITCH_NAME) === "on" : props.defaultChecked;
  return <Island key={recall.generation} {...props} initial={initial} />;
}

function Island({ initial, labels, names, children }: Props & { initial: boolean }) {
  const recall = useRecall();
  const [later, setLater] = useState(initial);
  // What each box holds now, for the copy button; the boxes stay uncontrolled (`RecallField`).
  const [ro, setRo] = useState(recall.value(RO_NAME) ?? names.ro.defaultValue);
  const [en, setEn] = useState(recall.value(EN_NAME) ?? names.en.defaultValue);
  const own = useRef<HTMLDivElement>(null);
  const enBox = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  // False in the server's HTML and while hydrating: only a box that can follow on screen marks its English as final.
  const running = useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  );

  /*
    The form's watchers (§315) measure on `change`, which the switch fires before React re-renders
    the boxes without `required`; so they are told again once the attribute has changed.
  */
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    own.current?.closest("form")?.dispatchEvent(new Event("change"));
  }, [later]);

  /*
    Writes into the English box as if typed — the native value setter plus an `input` event — so
    React's `onChange` and every form watcher see it. Only into an empty box or one equal to the old
    Romanian, so no name of the organizer's is lost.
  */
  const writeEnglish = (input: unknown, text: string) => {
    if (!(input instanceof HTMLInputElement)) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const copyToEnglish = () => {
    if (mayCopyToEnglish(ro, en)) writeEnglish(enBox.current, ro.trim());
  };
  // `ro` and `en` as the last keystroke left them: linked while equal. The English box is found
  // through the Romanian one's form, in the handler, not a ref read in render.
  const onRomanian = (text: string, box: HTMLInputElement | HTMLTextAreaElement) => {
    if (englishFollowsTyping(ro, en)) writeEnglish(box.form?.elements.namedItem(EN_NAME), text);
    setRo(text);
  };
  const leftBehind = englishLeftBehind({ ro: names.ro.defaultValue, en: names.en.defaultValue }, { ro, en });

  const nameBox = (
    name: string,
    language: string,
    value: NameBox,
    onChange: (text: string, box: HTMLInputElement | HTMLTextAreaElement) => void,
    inputRef?: typeof enBox,
  ) => {
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
        onChange={(event) => onChange(event.target.value, event.target)}
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
        {/* The label is the tap target, at least 44 px tall (BR-REQ-041-01 criterion 6). */}
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
        Hidden while the place is to be announced, kept mounted: a venue typed earlier is still
        posted and saved, never published, and back when the switch goes off (§328). `ShownWhen`
        makes the hidden boxes read-only, so an unmet pattern out of sight cannot silently block
        the save; the service ignores them (`ignoreHiddenFields`).
      */}
      <ShownWhen shown={!later} answer={later ? "later" : "announced"}>
        <Stack spacing={2} data-place-details>
          <Box component="fieldset" aria-describedby="place-names-help" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid="place-names">
            <Typography component="legend" variant="subtitle2" sx={{ p: 0, mb: 1.5 }}>
              {labels.meetingPoint}
            </Typography>
            {running && <input type="hidden" name={PLACE_NAMES_AS_TYPED_FIELD} value="1" />}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>{nameBox(RO_NAME, labels.ro, names.ro, onRomanian)}</Box>
              <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                {nameBox(EN_NAME, labels.en, names.en, setEn, enBox)}
                {leftBehind && (
                  <Alert severity="warning" data-testid="place-english-left-behind">
                    {fillIn(labels.englishLeftBehind, { place: en.trim() })}
                  </Alert>
                )}
                {/* 44 px tall for a thumb (BR-REQ-041-01 criterion 6). */}
                <Button
                  type="button"
                  variant="text"
                  size="small"
                  startIcon={<ContentCopyIcon />}
                  onClick={copyToEnglish}
                  disabled={!mayCopyToEnglish(ro, en)}
                  data-testid="place-copy-to-english"
                  sx={{ ...TAP_TARGET, alignSelf: "flex-start", textTransform: "none" }}
                >
                  {labels.copyToEnglish}
                </Button>
                {/* «Tradu din română» (§464). */}
                <TranslateFieldButton en={EN_NAME} />
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
