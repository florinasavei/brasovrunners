import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import { LEGAL_DOCUMENT_KEYS } from "./keys";

/**
 * `/admin/legal` and «Versiune nouă» as the owner reads them (§NNN, amending §532, §393, §95;
 * the owner, 2026-09-28: which text is in force, which draft waits, and where «regenerate» is).
 *
 * Pure — the rows in, the answer out — so the grouping, the filter, the card's sentence and the
 * fold's opening are one answer on both pages and are tested without a database.
 */

/**
 * The texts in three groups, in one fixed order — the order `LEGAL_DOCUMENT_KEYS` already lists
 * them (a unit test holds the two equal): the texts every registration rests on, the race's two
 * declarations, the group runs' two optional ones (§393, §515).
 */
export const LEGAL_KIND_GROUPS = [
  { id: "general", keys: ["PRIVACY_NOTICE", "TERMS"] },
  { id: "race", keys: ["EVENT_DECLARATION", "EVENT_DECLARATION_ROAD"] },
  { id: "groupRun", keys: ["GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"] },
] as const satisfies ReadonlyArray<{ id: string; keys: readonly LegalDocumentKey[] }>;

export type LegalKindGroupId = (typeof LEGAL_KIND_GROUPS)[number]["id"];

/** What the overview needs of a backoffice row (`LegalDocumentVersionRow`). */
export type OverviewVersion = {
  id: string;
  key: LegalDocumentKey;
  version: number;
  isApproved: boolean;
  effectiveAt: Date;
  withdrawnAt: Date | null;
  contentSha256: string;
};

/**
 * One version's state, in the owner's words:
 *
 * - `inForce` — the text the site serves now (`findCurrentApprovedVersionId`'s row);
 * - `draft` — not approved yet;
 * - `superseded` — approved, not withdrawn, and not the one in force: a newer one took its place
 *   (approval sets `effectiveAt` to its own moment, so an approved version above the one in
 *   force cannot wait for a later date);
 * - `withdrawn` — taken out of circulation, the row and its number kept (§46, §53).
 *
 * A deleted version has no row at all (§151): nothing is left to list, only its retired number.
 */
export type LegalVersionState = "inForce" | "draft" | "superseded" | "withdrawn";

export function versionState(row: Pick<OverviewVersion, "id" | "isApproved" | "withdrawnAt">, inForceId: string | undefined): LegalVersionState {
  if (row.withdrawnAt !== null) return "withdrawn";
  if (!row.isApproved) return "draft";
  return row.id === inForceId ? "inForce" : "superseded";
}

/** The chip row's states, in its order. `all` is the plain address. */
export const LEGAL_STATE_FILTERS = ["all", "inForce", "drafts", "superseded", "withdrawn"] as const;
export type LegalStateFilter = (typeof LEGAL_STATE_FILTERS)[number];

const STATE_OF_FILTER: Record<Exclude<LegalStateFilter, "all">, LegalVersionState> = {
  inForce: "inForce",
  drafts: "draft",
  superseded: "superseded",
  withdrawn: "withdrawn",
};

export type LegalListFilter = { state: LegalStateFilter; kind: LegalDocumentKey | null };

export const NO_LEGAL_FILTER: LegalListFilter = { state: "all", kind: null };

/**
 * The filter from the address (§413's shape: the address is the only memory, and the chips are
 * plain links, so it works without JavaScript). `?state=drafts&kind=TERMS`. An unknown value is
 * ignored; the old `?withdrawn=1` — the withdrawn fold's link before this — still means «Retrase».
 */
export function parseLegalListFilter(params: Readonly<Record<string, string | string[] | undefined>>): LegalListFilter {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const stateParam = one(params.state);
  const kindParam = one(params.kind);
  const state = (LEGAL_STATE_FILTERS as readonly string[]).includes(stateParam ?? "")
    ? (stateParam as LegalStateFilter)
    : one(params.withdrawn) === "1"
      ? "withdrawn"
      : "all";
  const kind = (LEGAL_DOCUMENT_KEYS as readonly string[]).includes(kindParam ?? "") ? (kindParam as LegalDocumentKey) : null;
  return { state, kind };
}

/** The address of a filter, the defaults left out, so there is one address per state. */
export function legalListQuery(filter: LegalListFilter): Record<string, string> {
  return {
    ...(filter.state === "all" ? {} : { state: filter.state }),
    ...(filter.kind ? { kind: filter.kind } : {}),
  };
}

/** Whether the filter narrows the list at all — the reason a matching card's fold opens (§336 `inUse`). */
export function isNarrowing(filter: LegalListFilter): boolean {
  return filter.state !== "all" || filter.kind !== null;
}

export function matchesLegalFilter(
  row: Pick<OverviewVersion, "key">,
  state: LegalVersionState,
  filter: LegalListFilter,
): boolean {
  if (filter.kind !== null && row.key !== filter.kind) return false;
  // «Toate» is every version still offered or waiting — never a withdrawn one. The point of
  // withdrawing is to get a version out of the way, so «Retrase» is the one place it shows.
  if (filter.state === "all") return state !== "withdrawn";
  return STATE_OF_FILTER[filter.state] === state;
}

/** The rows the filter keeps, in the order they came (the repository's: per key, newest first). */
export function filterLegalVersions<R extends OverviewVersion>(
  rows: readonly R[],
  inForceIds: Readonly<Partial<Record<LegalDocumentKey, string>>>,
  filter: LegalListFilter,
): R[] {
  return rows.filter((row) => matchesLegalFilter(row, versionState(row, inForceIds[row.key]), filter));
}

/** One text's rows grouped under it, newest first, whatever order they came in. */
export function versionsOfKind<R extends OverviewVersion>(rows: readonly R[], key: LegalDocumentKey): R[] {
  return rows.filter((row) => row.key === key).sort((a, b) => b.version - a.version);
}

/**
 * What a text's card says about it before anything is opened:
 *
 * - `inForce` — the version the site serves and the day it took effect, or null;
 * - `waitingDraft` — the draft waiting to be read and approved: the newest draft numbered above
 *   every approved version still offered — §532's `draftExists` rule, so the card and
 *   «Regenerează» agree on what "a draft waits" means. A draft below an offered approved
 *   version would never take effect (`behind`) and waits for nothing;
 * - `total` — every version of the text, withdrawn ones included.
 */
export type LegalKindSummary = {
  key: LegalDocumentKey;
  inForce: { id: string; version: number; effectiveAt: Date } | null;
  waitingDraft: { id: string; version: number } | null;
  total: number;
};

export function kindSummary(key: LegalDocumentKey, rows: readonly OverviewVersion[], inForceId: string | undefined): LegalKindSummary {
  const ofKey = versionsOfKind(rows, key);
  const inForce = ofKey.find((row) => row.id === inForceId && row.isApproved && row.withdrawnAt === null);
  const highestOffered = Math.max(0, ...ofKey.filter((row) => row.isApproved && row.withdrawnAt === null).map((row) => row.version));
  const waiting = ofKey.find((row) => !row.isApproved && row.version > highestOffered);
  return {
    key,
    inForce: inForce ? { id: inForce.id, version: inForce.version, effectiveAt: inForce.effectiveAt } : null,
    waitingDraft: waiting ? { id: waiting.id, version: waiting.version } : null,
    total: ofKey.length,
  };
}

/**
 * The card's header, as message keys under `Admin.legal.kinds` and their values — the page
 * formats the date, so this stays free of the locale:
 *
 * - «În vigoare: versiunea 3 din 4 sept. 2026» / «Nicio versiune în vigoare»;
 * - and, when one waits, «O ciornă așteaptă aprobarea: versiunea 4».
 */
export type KindLine =
  | { key: "inForce"; version: number; effectiveAt: Date }
  | { key: "noneInForce" }
  | { key: "draftWaiting"; version: number };

export function kindHeadline(summary: LegalKindSummary): KindLine[] {
  const lines: KindLine[] = [
    summary.inForce
      ? { key: "inForce", version: summary.inForce.version, effectiveAt: summary.inForce.effectiveAt }
      : { key: "noneInForce" },
  ];
  if (summary.waitingDraft) lines.push({ key: "draftWaiting", version: summary.waitingDraft.version });
  return lines;
}

/**
 * Why a text's versions fold opens on arrival (§336): **attention** when a draft waits for
 * approval or no version is in force — the two things to act on — and **inUse** when a filter
 * narrows the list and this text has rows it keeps. Closed otherwise.
 */
export function kindFoldOpens(summary: LegalKindSummary, filter: LegalListFilter, matching: number): FoldOpenWhen {
  return {
    attention: summary.waitingDraft !== null || summary.inForce === null,
    inUse: isNarrowing(filter) && matching > 0,
  };
}

/**
 * Whether the platform's template changed after the text in force was made from it — the
 * «Șablon nou» chip on «Versiune nouă» (§NNN, the owner, 2026-09-28).
 *
 * - With nothing in force, no: the state line already says «Nicio versiune în vigoare».
 * - Otherwise the text in force is compared by its words with the template's, the club's facts
 *   written in — the same test §532's `regenerationOutcome` calls `unchanged`. A text the club
 *   edited after starting from a template reads as older than it until a draft from the template
 *   is approved; no fingerprint of the template is stored, so no migration is needed for it.
 */
export function templateIsNewer(
  inForce: Pick<OverviewVersion, "contentSha256"> | undefined,
  filledTemplateContentSha256: string,
): boolean {
  if (!inForce) return false;
  return inForce.contentSha256 !== filledTemplateContentSha256;
}
