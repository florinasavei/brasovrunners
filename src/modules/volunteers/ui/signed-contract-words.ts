import { SIGNED_CONTRACT_MAX_BYTES } from "@/db/schema/event-volunteer-documents";
import { formatBytes } from "@/modules/media/ui/stored-facts";
import type { SignedContractUploadLabels } from "./SignedContractUpload";

/** The catalogue's `t` under `Admin`, as the pages hold it: a key and its values in, the reader's words out. */
type Words = ((key: string, values?: Record<string, string | number>) => string) & { raw: (key: string) => unknown };

/** The refusals an upload can meet, as the page's own `Admin.errors.*` sentences; `FAILED` for a request that got no answer. */
const UPLOAD_CODES = [
  "VOLUNTEER_CONTRACT_EMPTY",
  "VOLUNTEER_CONTRACT_TOO_LARGE",
  "VOLUNTEER_CONTRACT_TYPE",
  "VOLUNTEER_CONTRACT_UPLOAD_GONE",
  "NOT_FOUND",
  "FORBIDDEN",
  "UNAUTHENTICATED",
  "VALIDATION_ERROR",
] as const;

/** The reasons a file of «Încarcă contractele semnate» is left, by name and by content (`signed-contract.ts`). */
const REASONS = ["noName", "noMatch", "ambiguous", "cancelledOnly", "twice", "empty", "tooLarge", "type", "gone"] as const;

/** The largest file, as the page says it: «10 MB». */
export function signedContractMaxWords(locale: string): string {
  return formatBytes(SIGNED_CONTRACT_MAX_BYTES, locale);
}

/**
 * The words of «Contract semnat»'s upload island (§998), for one volunteer's card (`one`, the press «Încarcă» or, over a copy
 * already there, «Înlocuiește») or for the event's every file at once (`many`): strings only, `{max}` filled here.
 */
export function signedContractUploadLabels(t: Words, locale: string, mode: "one" | "replace" | "many"): SignedContractUploadLabels {
  const max = signedContractMaxWords(locale);
  const errors: Record<string, string> = { FAILED: t("volunteers.contract.failed") };
  for (const code of UPLOAD_CODES) errors[code] = t(`errors.${code}`);
  const common = { pending: t("volunteers.contract.sending"), done: t("volunteers.contract.done"), chooseFirst: t("volunteers.contract.chooseFirst"), errors };
  if (mode !== "many") {
    return { ...common, choose: t("volunteers.contract.choose"), submit: t(mode === "replace" ? "volunteers.contract.replace" : "volunteers.contract.upload"), sending: t("volunteers.contract.sending") };
  }
  return {
    ...common,
    // Pressed with nothing chosen: the sentence the plain form comes back with (§998), the files in the plural.
    chooseFirst: t("errors.VOLUNTEER_CONTRACTS_NONE_CHOSEN"),
    choose: t("volunteers.contract.bulkChoose"),
    submit: t("volunteers.contract.bulkSubmit"),
    // Filled in the browser, file by file: the raw sentence with its `{done}` and `{total}`.
    sending: t.raw("volunteers.contract.bulkSending") as string,
    matching: t("volunteers.contract.bulkMatching"),
    reasons: Object.fromEntries(REASONS.map((reason) => [reason, t(`volunteers.contract.reasons.${reason}`, { max })])),
    attached: t.raw("volunteers.contract.bulkAttached") as SignedContractUploadLabels["attached"],
    left: t.raw("volunteers.contract.bulkLeft") as SignedContractUploadLabels["left"],
    line: t.raw("volunteers.contract.bulkLine") as string,
  };
}
