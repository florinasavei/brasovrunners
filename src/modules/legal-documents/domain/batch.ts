import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { DomainError } from "@/shared/errors/domain-error";
import { confirmationPhrase } from "./confirmation";

/**
 * The three presses over many versions at once on `/admin/legal` (§532): regenerate every text
 * from its template, approve the drafts, delete a ticked selection. Pure — the rows in, a plan
 * out — so what the page offers, what its confirm dialog names and what the service does are one
 * answer, and it is tested without a database.
 *
 * None of them is a new rule. Each is the one-version verb, asked for several versions, under the
 * same guards: a draft is written by `createDraftVersion`, approved by `approveVersion`, deleted by
 * the draft's delete; an approved version by `deleteApprovedVersion`'s audit row, reason and
 * retired number (§46, §53, §151, §316).
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
 * - `create` — a new draft from the platform's template, the club's facts written in;
 * - `unchanged` — the text in force (or an approved version above it, not withdrawn) is already
 *   the template, word for word: a draft of the same words would be a version with nothing new;
 * - `draftExists` — a draft of this text is already waiting to be read and approved: one numbered
 *   above every approved version still offered, whatever its words. Not only a draft with the
 *   template's exact words: a regenerated draft whose `<PLACEHOLDER>` the club then typed in, or a
 *   draft made the long way, no longer hashes as the template does, and offering «Regenerează» on
 *   it would make a newer placeholder draft that supersedes the club's filled-in one. A draft
 *   numbered below an offered approved version would never take effect (`behind`) and waits for
 *   nothing, so it does not hold the template back.
 *
 * Never an edit of anything: an existing draft, even an older one of the same key, is left as the
 * club typed it (§46), and an approved text is replaced only by approving the draft (§57).
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
 * - `ready` — the newest draft of its key, above every approved version still offered, with no
 *   club-fact `<PLACEHOLDER>` left in either language: approved by the press;
 * - `superseded` — a newer draft of the same key exists; approving both would put two versions in
 *   force within the same second, the older one never read by anybody. It stays a draft, to be
 *   deleted or approved on its own page;
 * - `behind` — an approved version with a higher number is still offered, so approving this one
 *   would never put it in force (`findCurrentApprovedDocument` takes the highest): an approval
 *   that changes nothing on the site is a record that misleads;
 * - `placeholders` — a club fact is still a `<PLACEHOLDER>`: a notice that reads
 *   `<ADRESA SEDIULUI>` is not a notice, the refusal `approvePlatformTemplates` makes (§132).
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
 * The order a batch deletion runs in: per key, the lowest number first.
 *
 * A terms version's window in force ends where a higher approved version took effect (§316), so
 * deleting the higher one first would widen the lower one's window over time it was never the
 * text in force — and the check that follows would count registrations it should not. Lowest
 * first is the order the club would take one by one, and each check sees its successors still
 * standing.
 */
export function deletionOrder<T extends Pick<BatchVersion, "key" | "version">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.key === b.key ? a.version - b.version : a.key < b.key ? -1 : 1));
}

/**
 * A batch deletion refused because of one version, and which one: `version` is its phrase,
 * `GDPR 2` — a document code and a number, nothing about any person — so the batch screen names
 * the version that stopped the press instead of a bare `CONFLICT`, which the backoffice reads as
 * "somebody else saved meanwhile". The code and the fields are the one-version verb's refusal.
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
