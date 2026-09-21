"use client";

import TextField from "@mui/material/TextField";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";

/**
 * The runner's club, filled in and locked while "I am a member of the Brașov Runners group" is
 * ticked (`DECISIONS.md` §215; the owner: "if people check that they are brasov runners
 * members, the club input must be auto-filled and readonly").
 *
 * The two questions sit side by side and are the same question asked twice (BR-REQ-031-06): a
 * person who ticks the box is in the club whose name they would otherwise type, and typing it
 * by hand is how the export ends up with "BRASOV RUNNERS", "Brasov runners" and "BvR" as three
 * clubs. The tick still **grants nothing** — §48 is untouched, it is a claim the club reads and
 * no capability — this only stops the same fact being written two ways.
 *
 * ## Why the value is written imperatively and the input stays uncontrolled (§211)
 *
 * A controlled input over a server-rendered form wipes what somebody typed before hydration:
 * state that began empty replaces their text the moment React attaches. So the box keeps its
 * `defaultValue`, the DOM owns the value, and this island writes to it **only** in response to
 * a gesture — the checkbox changing — which by definition happens after hydration. The first
 * paint is byte-for-byte the server's markup.
 *
 * `readOnly` rather than `disabled`, deliberately: a disabled input posts nothing, so ticking
 * the box would silently clear the club from the submission. Read-only posts the value and
 * still refuses the keyboard, which is what was asked for.
 *
 * ## What happens with JavaScript off
 *
 * The field is an ordinary editable text box, as it was before this existed — and the service
 * writes the club's own name anyway when the tick arrives, so the stored row is the same
 * either way. That is the part that makes this a convenience rather than a rule living in a
 * browser (`AGENTS.md` §1.5: this form works with JavaScript off).
 */
export default function ClubForMember({
  memberCheckboxId,
  clubName,
  id,
  name,
  label,
  helperText,
  lockedHelperText,
  defaultValue,
  error,
}: {
  /** The "I am a member" checkbox this field follows. */
  memberCheckboxId: string;
  /** The club's own name, as it should be recorded — from the catalogue, not typed here. */
  clubName: string;
  id: string;
  name: string;
  label: string;
  helperText?: string;
  /** What the box says while it is filled in for them. */
  lockedHelperText: string;
  defaultValue?: string;
  error?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * What they had typed before ticking, so unticking gives it back rather than leaving the
   * club's name behind in a box that is now editable — which would read as their own answer.
   */
  const previous = useRef<string | null>(null);
  /**
   * Whether the box has anything in it, kept only so the floating label knows to move.
   *
   * The DOM owns the value (§211), so nothing else needs this — but MUI decides where to draw
   * the label from events it never sees when the value is written through a ref, and a label
   * resting on top of the text is exactly what that looks like.
   */
  const [hasValue, setHasValue] = useState(Boolean(defaultValue));

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const box = document.getElementById(memberCheckboxId);
      if (!(box instanceof HTMLInputElement)) return () => {};

      const apply = () => {
        const input = inputRef.current;
        if (input) {
          if (box.checked) {
            if (previous.current === null) previous.current = input.value;
            input.value = clubName;
          } else if (previous.current !== null) {
            input.value = previous.current;
            previous.current = null;
          }
          setHasValue(input.value !== "");
        }
        onStoreChange();
      };

      /*
        Fill it on mount too, but only when the box is already ticked and the field is empty.

        That is the form coming back from a server rejection with the tick still on: the value
        belongs there and nothing has been typed since, so writing it takes nothing away. The
        emptiness check is what keeps this clear of §211 — an island over a server-rendered
        form must never replace something a person typed before hydration, and here it cannot,
        because it writes only into a blank field.
      */
      if (box.checked && inputRef.current && inputRef.current.value === "") {
        previous.current = "";
        inputRef.current.value = clubName;
        setHasValue(true);
      }

      box.addEventListener("change", apply);
      return () => box.removeEventListener("change", apply);
    },
    [memberCheckboxId, clubName],
  );

  const locked = useSyncExternalStore(
    subscribe,
    () => {
      const box = document.getElementById(memberCheckboxId);
      return box instanceof HTMLInputElement ? box.checked : false;
    },
    // On the server there is no checkbox to read. The field renders exactly as it always did.
    () => false,
  );

  return (
    <TextField
      id={id}
      name={name}
      label={label}
      /*
        The ref has to be here, and forgetting it is what shipped the field empty and locked.

        `inputRef` is the prop MUI forks onto the real `<input>` (`InputBase` merges it with its
        own through `useForkRef`); a plain `ref` would land on the wrapper. Without it
        `inputRef.current` stayed null, the handler below wrote the club's name into nothing,
        and ticking the box produced exactly the wrong half of the feature: read-only, with no
        value in it.
      */
      inputRef={inputRef}
      defaultValue={defaultValue}
      error={error}
      autoComplete="organization"
      helperText={locked ? lockedHelperText : helperText}
      /*
        The label has to be told to move (§226; the owner: "the brasov runners text is
        overlapping with the placeholder here").

        MUI floats a label by watching the input's own events, and this island writes the value
        **imperatively** through the ref — which fires nothing. So the field had text in it and
        the label still sat in its resting position, the two drawn on top of each other. It is
        the price of writing to the DOM instead of holding the value in state, and §211 is why
        state is not an option here.

        `shrink` is forced only when there is something to shrink for; left `undefined`
        otherwise, so MUI keeps deciding for itself on focus and blur as it does everywhere
        else. Forcing `false` would be worse than the bug — the label would refuse to move even
        while somebody typed.
      */
      slotProps={{
        inputLabel: { shrink: locked || hasValue || undefined },
        htmlInput: {
          maxLength: 120,
          readOnly: locked,
          // A read-only box is still reachable and still read aloud; saying so is what stops
          // somebody tapping at it and concluding the form is broken.
          "aria-readonly": locked || undefined,
        },
      }}
    />
  );
}
