"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { hasReachedEnd } from "../domain/read-gate";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * "I have read the race's conditions", behind actually opening them (`DECISIONS.md` §195, §NNN).
 *
 * The owner: "oamenii trebuie să deschidă condițiile concursului într-un pop-up, să dea scroll
 * până jos și să confirme, dar fă safe! Adică unii oameni nu sunt așa tech-savvy (afișează «dă
 * click aici») mai întâi, ca să poată bifa că sunt de acord." And, looking at the result: "that
 * button should have a checkbox within it".
 *
 * ## The shape, and why it is this shape
 *
 * **One row: the box inside the read button** (§NNN). §195 put a button where the box would be
 * and hid the required box itself — a transparent pixel, placed by the browser wherever its
 * static position fell. Measured on the form, that was some six hundred pixels above the button:
 * a press on "send" with the conditions unread made the browser say "tick this box" at a spot
 * with no box in it, and the send button's "fill in the fields marked *" named nothing anybody
 * could find. So the box is back where a person looks for it, visible and real — the required
 * input the form posts — drawn inside the button that opens the text:
 *
 * - a press on the box, or on the words beside it, opens the text; the box does not tick;
 * - the text read to its end, "Am citit și sunt de acord" ticks it, and the row turns to say so;
 * - once read, the box behaves like any other box — untick it, tick it again, no second reading.
 *
 * The button is still the first thing a person sees (§195's "dă click aici"); the box inside it
 * is what the browser's refusal and the send button's list of what is missing (§NNN) point at.
 *
 * ## Robust, measured (§NNN)
 *
 * - **Having read to the end stays true.** It was a measurement taken afresh on every opening, so
 *   closing the panel after reading and opening it again asked for the scroll again.
 * - **Re-measured when the text's box changes size**, not only on a scroll: a phone turned upright
 *   or a picture arriving can make a text that needed scrolling fit its box, and a text that fits
 *   can never be scrolled — the one way the gate could trap somebody who had read everything.
 * - **The text can be scrolled from the keyboard**: it is a focusable region, so arrows and Page
 *   Down move it, where before only a pointer could.
 * - **A refusal about something else keeps the tick** (§286: "vreau să persist inclusiv bifele"):
 *   the draft's tick comes back as `defaultAgreed`, read, agreed and ticked.
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
  tickLabel,
  href,
  document,
  defaultAgreed = false,
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
  /** The box's own accessible name inside the button: what ticking it says. */
  tickLabel: string;
  /** The conditions as an ordinary page, for the fallback and for opening in a new tab. */
  href: string;
  /** The conditions themselves, as stored — plain data, never an element crossing the boundary. */
  document: unknown;
  /** The tick a refused submission posted (§286): read and agreed already, so it comes back ticked. */
  defaultAgreed?: boolean;
}) {
  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );

  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(defaultAgreed);
  // Sticky: once the end has been reached it stays reached, whatever a later opening measures.
  const [readToEnd, setReadToEnd] = useState(defaultAgreed);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const hintId = useId();
  const tickRef = useRef<HTMLInputElement | null>(null);

  /*
    Tell the form the box changed (§NNN). A tick given from the panel is React state, and a
    property React writes fires no event — so the send button's watcher, which listens to the
    form's own `input` and `change`, went on listing "Condițiile concursului" after it had been
    ticked. A bubbling native `change` is what any other box sends; React's own `onChange` for a
    checkbox listens to `click`, so this never reaches the handler below.
  */
  useEffect(() => {
    tickRef.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [agreed, hydrated]);
  const titleId = useId();

  const take = useCallback((element: HTMLDivElement) => {
    if (
      hasReachedEnd({
        scrollTop: element.scrollTop,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      })
    ) {
      setReadToEnd(true);
    }
  }, []);

  /**
   * Measured when the panel's body first exists, so a short set of rules — nothing to scroll —
   * opens the button immediately rather than waiting for a gesture that can never happen.
   */
  const attachBody = useCallback(
    (element: HTMLDivElement | null) => {
      setBody(element);
      if (element) take(element);
    },
    [take],
  );

  /*
    And again whenever the body or the text inside it changes size — a rotation, a zoom, a picture
    that arrived after the first measurement (`load` does not bubble, so it is caught on the way
    down). Only the observer's callbacks write state here, never the effect itself.
  */
  useEffect(() => {
    if (!body) return;
    const again = () => take(body);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(again) : null;
    observer?.observe(body);
    for (const child of Array.from(body.children)) observer?.observe(child);
    body.addEventListener("load", again, true);
    return () => {
      observer?.disconnect();
      body.removeEventListener("load", again, true);
    };
  }, [body, take]);

  /*
    Before hydration — and for ever, if the script never arrives — an ordinary required checkbox
    with an ordinary link. The same input, with the same name, so a submission made this way is
    indistinguishable from one made through the panel.
  */
  if (!hydrated) {
    return (
      <FormControlLabel
        control={<Checkbox id={fieldId} name={name} required defaultChecked={defaultAgreed} sx={CHECKBOX_TAP_TARGET} />}
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

  return (
    <Box data-testid="rules-gate">
      {/*
        The row is the button's surface, and the box and the words are two controls on it: an
        input cannot sit inside a `<button>` (interactive content inside interactive content is
        invalid HTML, and the press would belong to one of them at random). Drawn as one — the
        button's colour, the button's corners — so it reads as the button with its box inside.
      */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          borderRadius: 1,
          border: 1,
          pl: 0.5,
          ...(agreed
            ? { borderColor: "success.main", color: "text.primary" }
            : { borderColor: "primary.main", bgcolor: "primary.main", color: "primary.contrastText" }),
        }}
      >
        <Checkbox
          id={fieldId}
          name={name}
          required
          checked={agreed}
          onChange={(event) => {
            // Unread, the press on the box is the press on the button: the text opens, the box waits.
            if (!readToEnd) {
              setOpen(true);
              return;
            }
            setAgreed(event.target.checked);
          }}
          slotProps={{ input: { ref: tickRef, "aria-label": tickLabel, "aria-describedby": agreed ? undefined : hintId } }}
          sx={{
            ...CHECKBOX_TAP_TARGET,
            color: "inherit",
            "&.Mui-checked": { color: "success.main" },
          }}
        />
        <Button
          type="button"
          color="inherit"
          onClick={() => setOpen(true)}
          sx={{
            flex: 1,
            minHeight: 48,
            justifyContent: "flex-start",
            textAlign: "left",
            fontSize: "1rem",
            pl: 0.5,
          }}
        >
          <span>
            {agreed ? agreedLabel : openLabel}
            {/* The required mark every other required box wears (the legend above the form). */}
            <span aria-hidden="true"> *</span>
          </span>
        </Button>
      </Box>
      {!agreed && (
        <Typography id={hintId} variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {readingLabel}
        </Typography>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby={titleId}>
        <DialogTitle id={titleId}>{title}</DialogTitle>
        <DialogContent
          dividers
          ref={attachBody}
          onScroll={(event) => take(event.currentTarget)}
          // A region the keyboard can scroll (arrows, Page Down), named by the panel's title.
          role="region"
          aria-labelledby={titleId}
          tabIndex={0}
          data-testid="rules-text"
          sx={{ maxHeight: "60vh" }}
        >
          <RichText body={document} />
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 3, py: 2 }}>
          {!readToEnd && (
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
            disabled={!readToEnd}
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
