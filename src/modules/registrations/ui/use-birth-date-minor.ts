import { useCallback, useSyncExternalStore } from "react";
import { readTypedDate } from "@/shared/forms/pickers/wall-values";
import { isMinorOn } from "../domain/age";

/**
 * Whether the date typed into the form's birth-date box makes the entrant a minor today — read
 * from somebody else's input, for the islands that show or hide a block by it
 * (`GuardianForMinor`, §188; `HiddenForMinor`, §323).
 *
 * ## Why `useSyncExternalStore` and not an effect
 *
 * The date field is somebody else's DOM — `BirthDateField`, an island of its own since §561 (a
 * typed, day-first box). So the islands subscribe to that input rather than owning it, which is
 * exactly what `useSyncExternalStore` is for: React
 * reads the value during render instead of writing state from an effect, which is both correct
 * under concurrent rendering and what `react-hooks/set-state-in-effect` asks for.
 *
 * On the server there is no input and nothing typed, so this answers `false` there — an adult,
 * the case the server's markup is drawn for.
 */
/** The birth-date box's date, `YYYY-MM-DD` read day first (`readTypedDate`): "" before a whole day is typed, and on the server. */
export function useBirthDateValue(birthDateId: string): string {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const input = document.getElementById(birthDateId);
      if (!(input instanceof HTMLInputElement)) return () => {};
      // `input` for typing, `change` for the picker and for autofill.
      input.addEventListener("input", onStoreChange);
      input.addEventListener("change", onStoreChange);
      return () => {
        input.removeEventListener("input", onStoreChange);
        input.removeEventListener("change", onStoreChange);
      };
    },
    [birthDateId],
  );

  const birthDate = useSyncExternalStore(
    subscribe,
    () => {
      const input = document.getElementById(birthDateId);
      return input instanceof HTMLInputElement ? readTypedDate(input.value) : "";
    },
    () => "",
  );

  return birthDate;
}

/**
 * `minorOn` asks about another instant than today, as an ISO string so a Server Component may pass it:
 * the registration page's correction asks whether the typed date made the person a minor on the day
 * the row was written, the server's own test for a guardian (`answers.ts#GUARDIAN_ADULT`, §645).
 */
export function useBirthDateSaysMinor(birthDateId: string, minorOn?: string): boolean {
  const birthDate = useBirthDateValue(birthDateId);
  return birthDate !== "" && isMinorOn(birthDate, minorOn ? new Date(minorOn) : new Date());
}
