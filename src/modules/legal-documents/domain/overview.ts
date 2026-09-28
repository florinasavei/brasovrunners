import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import { LEGAL_DOCUMENT_KEYS } from "./keys";

/**
 * `/admin/legal` and «Versiune nouă»: grouping, filter, card lines and fold state (§539). Pure, so
 * both pages share one answer.
 */

/** Three groups in `LEGAL_DOCUMENT_KEYS` order (a unit test holds them equal); §393, §515. */
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
 * `superseded` is approved, not withdrawn and not in force — approval sets `effectiveAt` to its own
 * moment, so none waits for a later date. `withdrawn` keeps its row and number (§46, §53); a
 * deleted version has no row (§151).
 */
export type LegalVersionState = "inForce" | "draft" | "superseded" | "withdrawn";

export function versionState(row: Pick<OverviewVersion, "id" | "isApproved" | "withdrawnAt">, inForceId: string | undefined): LegalVersionState {
  if (row.withdrawnAt !== null) return "withdrawn";
  if (!row.isApproved) return "draft";
  return row.id === inForceId ? "inForce" : "superseded";
}

/** The chip row's states, in order. */
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
 * The filter from the address, working without JavaScript (§413): `?state=drafts&kind=TERMS`.
 * Unknown values are ignored; the legacy `?withdrawn=1` still means «Retrase».
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

/** Defaults left out, so there is one address per state. */
export function legalListQuery(filter: LegalListFilter): Record<string, string> {
  return {
    ...(filter.state === "all" ? {} : { state: filter.state }),
    ...(filter.kind ? { kind: filter.kind } : {}),
  };
}

/** Opens a matching card's fold (§336 `inUse`). */
export function isNarrowing(filter: LegalListFilter): boolean {
  return filter.state !== "all" || filter.kind !== null;
}

export function matchesLegalFilter(
  row: Pick<OverviewVersion, "key">,
  state: LegalVersionState,
  filter: LegalListFilter,
): boolean {
  if (filter.kind !== null && row.key !== filter.kind) return false;
  // «Toate» never shows a withdrawn version; only «Retrase» does.
  if (filter.state === "all") return state !== "withdrawn";
  return STATE_OF_FILTER[filter.state] === state;
}

/** Keeps the input order. */
export function filterLegalVersions<R extends OverviewVersion>(
  rows: readonly R[],
  inForceIds: Readonly<Partial<Record<LegalDocumentKey, string>>>,
  filter: LegalListFilter,
): R[] {
  return rows.filter((row) => matchesLegalFilter(row, versionState(row, inForceIds[row.key]), filter));
}

/** Newest first. */
export function versionsOfKind<R extends OverviewVersion>(rows: readonly R[], key: LegalDocumentKey): R[] {
  return rows.filter((row) => row.key === key).sort((a, b) => b.version - a.version);
}

/**
 * A text's card summary. `waitingDraft` uses §532's `draftExists` rule (a draft above every offered
 * approved version), so the card and «Regenerează» agree; `total` includes withdrawn versions.
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

/** The card's header lines as `Admin.legal.kinds` message keys; the page formats the date. */
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

/** Fold opens (§336) for attention — a waiting draft or nothing in force — or when a narrowing filter keeps rows. */
export function kindFoldOpens(summary: LegalKindSummary, filter: LegalListFilter, matching: number): FoldOpenWhen {
  return {
    attention: summary.waitingDraft !== null || summary.inForce === null,
    inUse: isNarrowing(filter) && matching > 0,
  };
}

/**
 * The «Șablon nou» chip (§539): the text in force differs from the filled template (§532's
 * `unchanged` test). A club-edited text reads as older; false when nothing is in force.
 */
export function templateIsNewer(
  inForce: Pick<OverviewVersion, "contentSha256"> | undefined,
  filledTemplateContentSha256: string,
): boolean {
  if (!inForce) return false;
  return inForce.contentSha256 !== filledTemplateContentSha256;
}
