import { useCallback, useSyncExternalStore } from "react";
import { composeLegalName } from "../names";

/** The two name boxes a signature follows (§NNN), by their ids on the page (`MissingAnswersFields#answerBoxId`). */
export type NameBoxIds = { firstName: string; lastName: string };

/**
 * The full name the two name boxes above the signature hold, as it is typed (§NNN) — composed as the server composes
 * the name of record from them (`names.ts#composeLegalName`), so the signature box asks for the very name the press
 * will check it against. Null without the boxes, before a word is typed in either, and on the server.
 *
 * The boxes are somebody else's DOM — the page's plain inputs — so this subscribes to them rather than owning them,
 * the way `use-birth-date-minor.ts` reads the birth date: React reads the value during render instead of writing state
 * from an effect (`react-hooks/set-state-in-effect`).
 */
export function useNameTypedAbove(ids: NameBoxIds | undefined): string | null {
  const firstNameId = ids?.firstName;
  const lastNameId = ids?.lastName;
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const boxes = [firstNameId, lastNameId].map((id) => (id ? document.getElementById(id) : null)).filter((box) => box instanceof HTMLInputElement);
      // `input` for typing, `change` for autofill.
      for (const box of boxes) {
        box.addEventListener("input", onStoreChange);
        box.addEventListener("change", onStoreChange);
      }
      return () => {
        for (const box of boxes) {
          box.removeEventListener("input", onStoreChange);
          box.removeEventListener("change", onStoreChange);
        }
      };
    },
    [firstNameId, lastNameId],
  );

  return useSyncExternalStore(
    subscribe,
    () => {
      if (!firstNameId || !lastNameId) return null;
      const first = document.getElementById(firstNameId);
      const last = document.getElementById(lastNameId);
      if (!(first instanceof HTMLInputElement) || !(last instanceof HTMLInputElement)) return null;
      return composeLegalName(first.value, last.value) || null;
    },
    () => null,
  );
}
