import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { DomainError } from "@/shared/errors/domain-error";
import { confirmationPhrase } from "./confirmation";

/**
 * The batch presses on `/admin/legal` (§532): regenerate from templates, approve drafts, delete a
 * selection. Pure, so page, confirm dialog and service share one answer. Each is the one-version
 * verb under the same guards (§46, §53, §151, §316).
 */

/** What a plan needs of a backoffice row (`LegalDocumentVersionRow`). */
export type BatchVersion = {
  id: string;
  key: LegalDocumentKey;
  version: number;
  isApproved: boolean;
  withdrawnAt: Date | null;
  contentSha256: string;
};

/**
 * What «Regenerează din șabloane» does with one key:
 *
 * - `create` — a new draft from the template, the club's facts written in;
 * - `unchanged` — the text in force (or an offered approved version above it) already is the template;
 * - `draftExists` — a draft numbered above every offered approved version waits, whatever its words
 *   (the club may have filled its placeholders; a new draft would supersede that work). A draft
 *   below one (`behind`) never takes effect and does not count.
 *
 * Never edits anything (§46, §57).
 */
export type RegenerationOutcome = "create" | "unchanged" | "draftExists";

export function regenerationOutcome(
  key: LegalDocumentKey,
  templateSha256: string,
  versions: readonly BatchVersion[],
  inForceId: string | undefined,
): RegenerationOutcome {
  const ofKey = versions.filter((row) => row.key === key);
  const inForce = ofKey.find((row) => row.id === inForceId);
  const approvedFromInForce = ofKey.filter(
    (row) => row.isApproved && row.withdrawnAt === null && (inForce === undefined || row.version >= inForce.version),
  );
  if (approvedFromInForce.some((row) => row.contentSha256 === templateSha256)) return "unchanged";
  const highestOffered = Math.max(0, ...approvedFromInForce.map((row) => row.version));
  if (ofKey.some((row) => !row.isApproved && row.version > highestOffered)) return "draftExists";
  return "create";
}

/**
 * What «Aprobă toate ciornele» does with one draft:
 *
 * - `ready` — newest of its key, above every offered approved version, no `<PLACEHOLDER>` left;
 * - `superseded` — a newer draft exists; it stays a draft rather than two approvals in one second;
 * - `behind` — a higher approved version is offered, so this one would never be in force
 *   (`findCurrentApprovedDocument` takes the highest);
 * - `placeholders` — a club fact is still a `<PLACEHOLDER>` (§132).
 */
export type DraftApprovalOutcome = "ready" | "superseded" | "behind" | "placeholders";

export function draftApprovalOutcome(
  draft: BatchVersion,
  versions: readonly BatchVersion[],
  hasPlaceholders: boolean,
): DraftApprovalOutcome {
  const ofKey = versions.filter((row) => row.key === draft.key && row.id !== draft.id);
  if (ofKey.some((row) => !row.isApproved && row.version > draft.version)) return "superseded";
  if (ofKey.some((row) => row.isApproved && row.withdrawnAt === null && row.version > draft.version)) return "behind";
  if (hasPlaceholders) return "placeholders";
  return "ready";
}

/**
 * Per key, lowest number first: a terms version's window in force ends where the next took effect
 * (§316), so deleting the higher one first would widen the lower one's window for its check.
 */
export function deletionOrder<T extends Pick<BatchVersion, "key" | "version">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.key === b.key ? a.version - b.version : a.key < b.key ? -1 : 1));
}

/**
 * A batch deletion refused because of one version, named by its phrase (`GDPR 2`) so the screen
 * does not show a bare `CONFLICT`; code and fields are the one-version verb's refusal.
 */
export class LegalBatchVersionRefused extends DomainError {
  readonly version: string;

  constructor(row: Pick<BatchVersion, "key" | "version">, cause: DomainError) {
    const version = confirmationPhrase(row.key, row.version);
    super(cause.code, `${version}: ${cause.message}; nothing was deleted`, cause.fields);
    this.name = "LegalBatchVersionRefused";
    this.version = version;
  }
}
