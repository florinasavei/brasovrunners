"use client";

import TextField from "@mui/material/TextField";
import { useCallback, useRef, useSyncExternalStore } from "react";

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
        }
        onStoreChange();
      };

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
      defaultValue={defaultValue}
      error={error}
      autoComplete="organization"
      helperText={locked ? lockedHelperText : helperText}
      slotProps={{
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
