"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { hasReachedEnd, type ScrollMeasurement } from "../domain/read-gate";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * "I have read the race's conditions", behind actually opening them (`DECISIONS.md` §195).
 *
 * The owner: "oamenii trebuie să deschidă condițiile concursului într-un pop-up, să dea scroll
 * până jos și să confirme, dar fă safe! Adică unii oameni nu sunt așa tech-savvy (afișează «dă
 * click aici») mai întâi, ca să poată bifa că sunt de acord."
 *
 * ## The shape, and why it is this shape
 *
 * Before anything is read there is **a button, not a box**. A checkbox beside a link asks
 * somebody to notice the link, decide to follow it, come back, and then tick — four steps, three
 * of them skippable, and every one invisible to a person who does not already know how forms
 * work. One button that says "read the conditions" is one step and has one meaning.
 *
 * The box appears only after the text has been read to its end, already ticked, with a line
 * saying so. Nothing moves under the cursor: the button is replaced, in place, by the thing it
 * was guarding.
 *
 * ## What happens with JavaScript switched off — the part that had to be safe
 *
 * The whole gate is an enhancement. This island renders the **plain, tickable checkbox** on the
 * server and on the first client render, and takes over only once React has hydrated
 * (`useSyncExternalStore` with a server snapshot of `false` — the hydration test
 * `GuardianForMinor` uses, and lint-clean, where writing state from an effect is not).
 *
 * So: no JavaScript, a script that failed to load, or a browser this dialog does not suit — the
 * entrant gets a normal required checkbox and a normal link, and can register. A gate that could
 * lock somebody out of a race because a script did not arrive would be a worse failure than the
 * one it prevents.
 *
 * ## What is not claimed
 *
 * That anybody read anything. Scrolling is a measurement of a browser. The panel makes reading
 * the easy path and skipping it the awkward one, and the row it writes says only "was shown the
 * text and said they had read it, at this moment" — which is what a paper form records too.
 */
export default function ReadAndAgree({
  name,
  fieldId,
  title,
  openLabel,
  readingLabel,
  agreedLabel,
  agreeButtonLabel,
  keepReadingLabel,
  closeLabel,
  plainLabel,
  href,
  document,
}: {
  name: string;
  fieldId: string;
  /** The panel's heading — the race's name, so it is obvious which conditions these are. */
  title: string;
  openLabel: string;
  readingLabel: string;
  agreedLabel: string;
  agreeButtonLabel: string;
  keepReadingLabel: string;
  closeLabel: string;
  /** What the box says when this island is not in charge: no JavaScript, or before hydration. */
  plainLabel: string;
  /** The conditions as an ordinary page, for the fallback and for opening in a new tab. */
  href: string;
  /** The conditions themselves, as stored — plain data, never an element crossing the boundary. */
  document: unknown;
}) {
  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );

  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [measurement, setMeasurement] = useState<ScrollMeasurement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const read = (element: HTMLDivElement) => ({
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  });

  /**
   * Measured when the panel's body first exists, so a short set of rules — nothing to scroll —
   * opens the button immediately rather than waiting for a gesture that can never happen.
   */
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    bodyRef.current = element;
    setMeasurement({
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    });
  }, []);

  const mayAgree = hasReachedEnd(measurement);

  /*
    Before hydration — and for ever, if the script never arrives — an ordinary required checkbox
    with an ordinary link. The same input, with the same name, so a submission made this way is
    indistinguishable from one made through the panel.
  */
  if (!hydrated) {
    return (
      <FormControlLabel
        control={<Checkbox id={fieldId} name={name} required sx={CHECKBOX_TAP_TARGET} />}
        label={
          <span>
            {plainLabel}{" "}
            <a href={href} target="_blank" rel="noreferrer">
              {openLabel}
            </a>
          </span>
        }
      />
    );
  }

  if (!agreed) {
    return (
      <Box>
        <Button
          type="button"
          variant="contained"
          onClick={() => setOpen(true)}
          sx={{ minHeight: 48, fontSize: "1rem" }}
        >
          {openLabel}
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {readingLabel}
        </Typography>
        {/*
          The required input exists from the start, unticked and out of sight, so a form sent
          without reading is refused by the browser itself and the refusal names this control —
          the same refusal any other required box gives, produced without JavaScript.
        */}
        <Box
          component="input"
          type="checkbox"
          id={fieldId}
          name={name}
          required
          checked={false}
          readOnly
          aria-label={plainLabel}
          sx={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
        />

        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          fullWidth
          maxWidth="sm"
          aria-labelledby="race-conditions-title"
        >
          <DialogTitle id="race-conditions-title">{title}</DialogTitle>
          <DialogContent
            dividers
            ref={measure}
            onScroll={(event) => setMeasurement(read(event.currentTarget))}
            sx={{ maxHeight: "60vh" }}
          >
            <RichText body={document} />
          </DialogContent>
          <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 3, py: 2 }}>
            {!mayAgree && (
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>
                {keepReadingLabel}
              </Typography>
            )}
            <Button type="button" onClick={() => setOpen(false)} sx={{ minHeight: 44 }}>
              {closeLabel}
            </Button>
            <Button
              type="button"
              variant="contained"
              disabled={!mayAgree}
              onClick={() => {
                setAgreed(true);
                setOpen(false);
              }}
              sx={{ minHeight: 44 }}
            >
              {agreeButtonLabel}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  return (
    <Alert severity="success" sx={{ alignItems: "center" }}>
      <FormControlLabel
        control={
          <Checkbox id={fieldId} name={name} required checked readOnly sx={CHECKBOX_TAP_TARGET} />
        }
        label={agreedLabel}
      />
    </Alert>
  );
}
