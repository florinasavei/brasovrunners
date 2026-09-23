import { useCallback, useSyncExternalStore } from "react";
import { isMinorOn } from "../domain/age";

/**
 * Whether the date typed into the form's birth-date box makes the entrant a minor today — read
 * from somebody else's input, for the islands that show or hide a block by it
 * (`GuardianForMinor`, §188; `HiddenForMinor`, §NNN).
 *
 * ## Why `useSyncExternalStore` and not an effect
 *
 * The date field is somebody else's DOM — a Server Component's MUI `TextField`, carrying native
 * validation (`min`, `max`, `required`) that lifting it into an island would trade for
 * hand-written validation on the one form that has to work everywhere. So the islands subscribe
 * to that input rather than owning it, which is exactly what `useSyncExternalStore` is for: React
 * reads the value during render instead of writing state from an effect, which is both correct
 * under concurrent rendering and what `react-hooks/set-state-in-effect` asks for.
 *
 * On the server there is no input and nothing typed, so this answers `false` there — an adult,
 * the case the server's markup is drawn for.
 */
export function useBirthDateSaysMinor(birthDateId: string): boolean {
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
      return input instanceof HTMLInputElement ? input.value : "";
    },
    () => "",
  );

  return birthDate !== "" && isMinorOn(birthDate, new Date());
}
