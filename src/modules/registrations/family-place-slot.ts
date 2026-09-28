import { createHmac } from "node:crypto";
import { PRESS_SLOT } from "./domain/family-sitting";
import { registrationNameKey } from "./domain/name-key";
import { purposeSecret } from "./form-draft";

/**
 * The slot of a family sitting's held place (§NNN, `family_place_holds`; the review of 2026-09-28,
 * round four): one per person of the sitting, by the runner's name key (`registrationNameKey`, the
 * rule `sameRunner` and the server's own decisions use) — never one per form. So the server, not the
 * browser's half, decides whether a form adds a person: a form for somebody the sitting already holds
 * a place for finds that slot taken and adds nothing, whatever the sealed half it arrived with says —
 * a replayed half included (§39, AGENTS.md §19.4). A fresh address's form finds the person's own
 * registration in the sitting the same way, so both add one place per person, once.
 *
 * Keyed under the deployment's secret bound to this purpose (`purposeSecret`), so the row still names
 * no person: the hex digest of the sitting's key and the name key is no name, and cannot be matched
 * to one without the secret. A name that folds to nothing keeps the press's single slot (`PRESS_SLOT`).
 */
export function familyPlaceSlot(sittingKey: string, legalName: string | null | undefined): string {
  const key = registrationNameKey(legalName ?? "");
  if (key === "") return PRESS_SLOT;
  return createHmac("sha256", purposeSecret("family-place-hold")).update(`${sittingKey}\n${key}`).digest("hex");
}
