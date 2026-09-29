import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import {
  filterLegalVersions,
  isNarrowing,
  kindFoldOpens,
  kindHeadline,
  kindSummary,
  LEGAL_KIND_GROUPS,
  LEGAL_STATE_FILTERS,
  legalListQuery,
  NO_LEGAL_FILTER,
  type OverviewVersion,
  parseLegalListFilter,
  templateIsNewer,
  versionState,
  versionsOfKind,
} from "@/modules/legal-documents/domain/overview";

/**
 * BR-REQ-053-02 (§539, amending §532) — `/admin/legal` grouped by text, filtered through the
 * address, each card saying its state in words, and «Versiune nouă» showing each template's
 * state under its button. The pure half: the grouping, the filter, the header's sentences, the
 * folds' opening and «Șablon nou».
 */
const DAY = new Date("2026-09-04T08:00:00.000Z");
const HASH = (n: number) => n.toString(16).padStart(64, "0");

let next = 0;
function row(key: LegalDocumentKey, version: number, extra: Partial<OverviewVersion> = {}): OverviewVersion {
  next += 1;
  return {
    id: `id-${key}-${version}-${next}`,
    key,
    version,
    isApproved: true,
    effectiveAt: DAY,
    withdrawnAt: null,
    contentSha256: HASH(version),
    ...extra,
  };
}

describe("the texts' groups", () => {
  it("are the catalogue's six texts in three groups, in the catalogue's own order", () => {
    expect(LEGAL_KIND_GROUPS.map((group) => group.id)).toEqual(["general", "race", "groupRun"]);
    expect(LEGAL_KIND_GROUPS.flatMap((group) => group.keys)).toEqual([...LEGAL_DOCUMENT_KEYS]);
  });

  it("have a label in both languages, and every text a short name for its filter chip", () => {
    for (const catalogue of [ro, en]) {
      const legal = catalogue.Admin.legal as unknown as { groups: Record<string, string>; shortKeys: Record<string, string> };
      for (const group of LEGAL_KIND_GROUPS) expect(legal.groups[group.id]).toBeTruthy();
      for (const key of LEGAL_DOCUMENT_KEYS) expect(legal.shortKeys[key]).toBeTruthy();
    }
    expect(ro.Admin.legal.groups).toEqual({
      general: "Documente generale",
      race: "Declarații de cursă",
      groupRun: "Declarații pentru alergările de grup",
    });
  });
});

describe("a version's state", () => {
  const inForce = row("TERMS", 3);
  it("names the one in force, the drafts, the ones it replaced and the withdrawn", () => {
    expect(versionState(inForce, inForce.id)).toBe("inForce");
    expect(versionState(row("TERMS", 4, { isApproved: false }), inForce.id)).toBe("draft");
    expect(versionState(row("TERMS", 2), inForce.id)).toBe("superseded");
    expect(versionState(row("TERMS", 1, { withdrawnAt: DAY }), inForce.id)).toBe("withdrawn");
    // A withdrawn draft is not a thing; a withdrawn approved row is withdrawn whatever its number.
    expect(versionState(row("TERMS", 5, { withdrawnAt: DAY }), undefined)).toBe("withdrawn");
  });
});

describe("the filter in the address", () => {
  it("reads the state and the text, and ignores anything else", () => {
    expect(parseLegalListFilter({})).toEqual(NO_LEGAL_FILTER);
    expect(parseLegalListFilter({ state: "drafts", kind: "TERMS" })).toEqual({ state: "drafts", kind: "TERMS" });
    expect(parseLegalListFilter({ state: "nope", kind: "NOPE" })).toEqual(NO_LEGAL_FILTER);
    expect(parseLegalListFilter({ state: ["inForce", "drafts"] })).toEqual({ state: "inForce", kind: null });
  });

  it("keeps the old withdrawn fold's address meaning «Retrase»", () => {
    expect(parseLegalListFilter({ withdrawn: "1" })).toEqual({ state: "withdrawn", kind: null });
    // An explicit state wins over the old parameter.
    expect(parseLegalListFilter({ withdrawn: "1", state: "drafts" })).toEqual({ state: "drafts", kind: null });
  });

  it("writes one address per state, the defaults left out, and reads it back", () => {
    expect(legalListQuery(NO_LEGAL_FILTER)).toEqual({});
    expect(legalListQuery({ state: "drafts", kind: null })).toEqual({ state: "drafts" });
    for (const state of LEGAL_STATE_FILTERS) {
      for (const kind of [null, ...LEGAL_DOCUMENT_KEYS]) {
        const filter = { state, kind };
        expect(parseLegalListFilter(legalListQuery(filter))).toEqual(filter);
      }
    }
    expect(isNarrowing(NO_LEGAL_FILTER)).toBe(false);
    expect(isNarrowing({ state: "all", kind: "TERMS" })).toBe(true);
  });

  it("keeps the rows of the state and the text asked for", () => {
    const termsInForce = row("TERMS", 2);
    const termsOld = row("TERMS", 1);
    const termsDraft = row("TERMS", 3, { isApproved: false });
    const noticeInForce = row("PRIVACY_NOTICE", 1);
    const noticeWithdrawn = row("PRIVACY_NOTICE", 2, { withdrawnAt: DAY });
    const rows = [noticeInForce, noticeWithdrawn, termsDraft, termsInForce, termsOld];
    const inForce = { TERMS: termsInForce.id, PRIVACY_NOTICE: noticeInForce.id };

    // «Toate» keeps everything but the withdrawn: «Retrase» is the one place they show.
    expect(filterLegalVersions(rows, inForce, NO_LEGAL_FILTER)).toEqual([noticeInForce, termsDraft, termsInForce, termsOld]);
    expect(filterLegalVersions(rows, inForce, { state: "all", kind: "PRIVACY_NOTICE" })).toEqual([noticeInForce]);
    expect(filterLegalVersions(rows, inForce, { state: "inForce", kind: null })).toEqual([noticeInForce, termsInForce]);
    expect(filterLegalVersions(rows, inForce, { state: "drafts", kind: null })).toEqual([termsDraft]);
    expect(filterLegalVersions(rows, inForce, { state: "superseded", kind: null })).toEqual([termsOld]);
    expect(filterLegalVersions(rows, inForce, { state: "withdrawn", kind: null })).toEqual([noticeWithdrawn]);
    expect(filterLegalVersions(rows, inForce, { state: "all", kind: "TERMS" })).toEqual([termsDraft, termsInForce, termsOld]);
    expect(filterLegalVersions(rows, inForce, { state: "drafts", kind: "PRIVACY_NOTICE" })).toEqual([]);
  });

  it("lists a text's versions newest first, whatever order they came in", () => {
    const rows = [row("TERMS", 1), row("PRIVACY_NOTICE", 7), row("TERMS", 3), row("TERMS", 2)];
    expect(versionsOfKind(rows, "TERMS").map((version) => version.version)).toEqual([3, 2, 1]);
  });
});

describe("a text's card", () => {
  it("says what is in force and which draft waits", () => {
    const inForce = row("TERMS", 2, { effectiveAt: DAY });
    const rows = [row("TERMS", 1), inForce, row("TERMS", 3, { isApproved: false })];
    const summary = kindSummary("TERMS", rows, inForce.id);
    expect(summary.inForce).toEqual({ id: inForce.id, version: 2, effectiveAt: DAY });
    expect(summary.waitingDraft?.version).toBe(3);
    expect(summary.total).toBe(3);
    expect(kindHeadline(summary)).toEqual([
      { key: "inForce", version: 2, effectiveAt: DAY },
      { key: "draftWaiting", version: 3 },
    ]);
  });

  it("says nothing is in force, and waits for no draft numbered below an approved version still offered (§532's rule)", () => {
    const behind = row("PRIVACY_NOTICE", 1, { isApproved: false });
    const approvedNotYet = row("PRIVACY_NOTICE", 2);
    // Nothing in force (say, the approved one's moment has not come), and the draft below it waits for nothing.
    const summary = kindSummary("PRIVACY_NOTICE", [behind, approvedNotYet], undefined);
    expect(summary.inForce).toBeNull();
    expect(summary.waitingDraft).toBeNull();
    expect(kindHeadline(summary)).toEqual([{ key: "noneInForce" }]);
    // The newest of two drafts above everything offered is the one that waits.
    const two = kindSummary("TERMS", [row("TERMS", 4, { isApproved: false }), row("TERMS", 5, { isApproved: false })], undefined);
    expect(two.waitingDraft?.version).toBe(5);
  });

  it("opens its versions only for a waiting draft, nothing in force, or a filter that keeps rows in it (§336)", () => {
    const inForce = row("TERMS", 2);
    const quiet = kindSummary("TERMS", [inForce], inForce.id);
    expect(kindFoldOpens(quiet, NO_LEGAL_FILTER, 1)).toEqual({ attention: false, inUse: false });
    const waiting = kindSummary("TERMS", [inForce, row("TERMS", 3, { isApproved: false })], inForce.id);
    expect(kindFoldOpens(waiting, NO_LEGAL_FILTER, 2).attention).toBe(true);
    expect(kindFoldOpens(kindSummary("TERMS", [], undefined), NO_LEGAL_FILTER, 0).attention).toBe(true);
    expect(kindFoldOpens(quiet, { state: "inForce", kind: null }, 1).inUse).toBe(true);
    expect(kindFoldOpens(quiet, { state: "drafts", kind: null }, 0).inUse).toBe(false);
  });

  it("says its sentences in both languages, in the owner's words", () => {
    const format = (locale: "ro" | "en") => {
      const t = createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Admin" });
      return {
        inForce: t("legal.kinds.inForce", { version: 3, date: locale === "ro" ? "4 septembrie 2026" : "4 September 2026" }),
        none: t("legal.kinds.noneInForce"),
        waiting: t("legal.kinds.draftWaiting", { version: 4 }),
        pending: t("legal.kinds.draftPending", { version: 4 }),
        dialog: t("legal.kinds.regenerateBody", { kind: "GDPR", version: 4 }),
        count: t("legal.filter.count.few", { count: 4, total: 11 }),
        // «4 din 6» and the rule beside it (§555, amending §539): the owner read «(4)» as a bug.
        regenerate: t("legal.batch.regenerate", { count: 4, total: LEGAL_DOCUMENT_KEYS.length }),
        rule: t("legal.batch.regenerateRule"),
      };
    };
    expect(format("ro")).toEqual({
      inForce: "În vigoare: versiunea 3 din 4 septembrie 2026",
      none: "Nicio versiune în vigoare",
      waiting: "O ciornă așteaptă aprobarea: versiunea 4",
      pending: "Ciornă în așteptare: versiunea 4",
      dialog: "O ciornă nouă pentru GDPR, din șablon, versiunea 4; textul în vigoare nu se schimbă până nu o aprobi.",
      count: "4 versiuni din 11",
      regenerate: "Regenerează din șabloane (4 din 6)",
      rule: "Doar textele cu «Șablon nou» se regenerează; celelalte au deja cuvintele șablonului.",
    });
    expect(format("en")).toEqual({
      inForce: "In force: version 3 since 4 September 2026",
      none: "No version in force",
      waiting: "A draft waits for approval: version 4",
      pending: "Draft waiting: version 4",
      dialog: "A new draft of GDPR, from the template, version 4; the text in force does not change until you approve it.",
      count: "4 versions of 11",
      regenerate: "Regenerate from the templates (4 of 6)",
      rule: "Only the texts marked «New template» are regenerated; the others already have the template's words.",
    });
  });

  it("gives the page's three steps and «Versiune nouă»'s in both languages", () => {
    expect(ro.Admin.legal.steps.title).toBe(
      "1. Regenerează (ciornă din șablon) · 2. Citește ciorna și completează ce a rămas de forma '<'…>, apoi «Salvează ciorna» · 3. Aprobă — abia atunci intră în vigoare",
    );
    expect(ro.Admin.legal.startFrom.help).toBe(
      "1. Alege șablonul (sau Regenerează toate) · 2. Citește, completează și «Salvează ciorna» · 3. Aprobă — abia atunci intră în vigoare.",
    );
    expect(en.Admin.legal.steps.title.startsWith("1. Regenerate")).toBe(true);
    expect(en.Admin.legal.startFrom.help.startsWith("1. Pick the template")).toBe(true);
  });
});

describe("«Șablon nou»", () => {
  it("compares the text in force by its words with the template's, the facts written in", () => {
    expect(templateIsNewer({ contentSha256: HASH(2) }, HASH(2))).toBe(false);
    expect(templateIsNewer({ contentSha256: HASH(1) }, HASH(2))).toBe(true);
  });

  it("says nothing with no text in force", () => {
    expect(templateIsNewer(undefined, HASH(2))).toBe(false);
  });
});
