/**
 * What `yarn docs:land` makes of one item's saved results — its DECISIONS title and body, its
 * CHANGELOG bullet, its SPECS criteria — kept apart from `land-batch.mjs`, which writes files on
 * import, so the rules are testable (§426). Refused: a blank fix report, a committed one with a
 * blank `commitSha`, a blank title or bullet. The bullet is the implementer's or the manifest's,
 * never a fixer's (a fixer writes about its round, not what a person sees). A fixer's housekeeping
 * ("carried forward", "no DECISIONS.md edit") is dropped and printed; a criterion without a full
 * `BR-REQ-\d{3}-\d{2}` id is dropped with a note.
 */

export const requirementOf = (c) => (c.requirement.match(/BR-REQ-\d{3}-\d{2}/) ?? [c.requirement])[0];

/** A later list replaces an earlier one's criteria for every requirement it names. */
export function mergeCriteria(...lists) {
  const byRequirement = new Map();
  for (const list of lists) {
    const grouped = new Map();
    for (const c of list ?? []) {
      const r = requirementOf(c);
      if (!grouped.has(r)) grouped.set(r, []);
      grouped.get(r).push(c);
    }
    for (const [r, cs] of grouped) byRequirement.set(r, cs);
  }
  return [...byRequirement.values()].flat();
}

// The landing artifact's name; "_md" because the caller replaces the dot so a filename never ends a sentence.
const ARTIFACT = String.raw`(?:DECISIONS|CHANGELOG|SPECS)(?:[._]md)?`;
const EDIT_WORD = String.raw`(?:edits?|changes?)`;
/**
 * "No DECISIONS.md … edit" in either word order. Narrow on purpose: "did not change the allocator"
 * or "… is unchanged" is the fix's substance and must not match.
 */
const NO_ARTIFACT_EDIT = new RegExp(
  String.raw`\b(no|without)\b[^.;]{0,90}\b${ARTIFACT}\b[^.;]{0,90}\b${EDIT_WORD}\b` + "|" + String.raw`\b(no|without)\b[^.;]{0,90}\b${EDIT_WORD}\b[^.;]{0,90}\b${ARTIFACT}\b`,
  "i",
);
/**
 * Any tense of "carry forward" whose complement names the landing text ("from the implementer",
 * "verbatim", "the text"). "Carries the place forward to the next person" is substance and must
 * not match.
 */
const CARRIED_FORWARD = /\bcarr(?:y|ies|ied|ying)\s+forward\b[^.;]{0,30}\b(from the implementer|verbatim|unchanged|the implementer's\s+\w+|the text)\b/i;
/** A whole text that says nothing, including a bare "(carried forward)" with no qualifier. */
const EMPTY_WORDS = /^[(\s]*(none|n\/a|unchanged|carried forward|no (changes?|edits?|addendum)|nothing( (new|to add))?|same( as (above|before))?|—|-+)[.)\s]*$/i;

function isHousekeepingClause(clause) {
  // A file name's dot ("DECISIONS.md") is not the end of a clause for NO_ARTIFACT_EDIT.
  const plain = clause.replace(/\.(md|mjs|js|ts)\b/g, "_$1");
  return CARRIED_FORWARD.test(plain) || NO_ARTIFACT_EDIT.test(plain);
}

/**
 * A fixer's text without its housekeeping sentences — or clauses, when a ';' joins housekeeping to
 * substance. Returns the text left and the pieces dropped.
 */
export function withoutHousekeeping(text) {
  const kept = [];
  const dropped = [];
  for (const paragraph of String(text ?? "").trim().split(/\n\s*\n/)) {
    // [sentence, separator, sentence, separator, …]: a sentence ends at . ! or ? before a space.
    const parts = paragraph.split(/((?<=[.!?])\s+)/);
    let out = "";
    for (let i = 0; i < parts.length; i += 2) {
      const sentence = parts[i];
      const separator = parts[i + 1] ?? "";
      if (!sentence) continue;
      if (!sentence.includes(";")) {
        if (isHousekeepingClause(sentence)) dropped.push(sentence.trim());
        else out += sentence + separator;
        continue;
      }
      // Test each clause alone so substance is kept beside a housekeeping neighbour.
      const clauseParts = sentence.split(/(;\s*)/);
      const survivors = [];
      let sawHousekeeping = false;
      for (let j = 0; j < clauseParts.length; j += 2) {
        const clause = clauseParts[j];
        if (!clause.trim()) continue;
        if (isHousekeepingClause(clause)) {
          dropped.push(clause.trim());
          sawHousekeeping = true;
        } else {
          survivors.push(clause.replace(/;\s*$/, "").trim());
        }
      }
      if (!sawHousekeeping) {
        out += sentence + separator;
        continue;
      }
      let rebuilt = survivors.join("; ");
      if (rebuilt) {
        rebuilt = rebuilt.charAt(0).toUpperCase() + rebuilt.slice(1);
        if (!/[.!?]$/.test(rebuilt)) rebuilt += ".";
        out += rebuilt + separator;
      }
    }
    out = out.trim();
    if (out && !EMPTY_WORDS.test(out)) kept.push(out);
    else if (out) dropped.push(out);
  }
  return { text: kept.join("\n\n"), dropped };
}

const blank = (value) => !String(value ?? "").trim();

/** A fix report with no result or no summary: the fixer said nothing about what it did. */
export function isBlankFixReport(fixed) {
  return !fixed || typeof fixed !== "object" || blank(fixed.summary);
}

/**
 * One item's entry from its br-chain result, its fix rounds in order and the manifest's overrides
 * (`title`, `changelog`). Throws naming `label` on a blank. `notes` are lines for the dry run.
 */
export function entryFromResults(chain, rounds = [], item = {}, label = "item") {
  const refuse = (message) => {
    throw new Error(`${label}: ${message}`);
  };
  const notes = [];
  const impl = chain?.impl;
  if (!impl) refuse("no implementer's result (impl)");
  if (chain.fixed != null && isBlankFixReport(chain.fixed)) refuse("the chain's fix report is blank — no summary of what the fixer did");
  if (chain.fixed?.committed && blank(chain.fixed.commitSha)) refuse("the chain's fix report says committed with a blank commitSha");

  const fixers = [];
  if (chain.fixed?.committed) fixers.push({ who: "the chain's fixer", report: chain.fixed, text: chain.fixed.decisionsSection });
  rounds.forEach((result, i) => {
    const report = result?.fixed;
    if (isBlankFixReport(report)) refuse(`fix round ${i + 1}'s report is blank — no result, or no summary of what the fixer did`);
    if (!report.committed) {
      notes.push(`fix round ${i + 1} committed nothing: its text is not landed`);
      return;
    }
    if (blank(report.commitSha)) refuse(`fix round ${i + 1}'s report says committed with a blank commitSha`);
    fixers.push({ who: `fix round ${i + 1}`, report, text: report.decisionsAddendum, addendum: true });
  });

  let body = String(impl.decisionsSection ?? "").trim();
  let title = String(impl.decisionsTitle ?? "").trim();
  for (const { who, report, text, addendum } of fixers) {
    const { text: clean, dropped } = withoutHousekeeping(text);
    for (const sentence of dropped) notes.push(`DROPPED from ${who}: "${sentence.slice(0, 160)}"`);
    if (clean) body = addendum ? `${body}\n\n${clean}` : clean;
    if (!addendum && !blank(report.decisionsTitle) && !EMPTY_WORDS.test(report.decisionsTitle) && !CARRIED_FORWARD.test(report.decisionsTitle)) title = report.decisionsTitle.trim();
    if (!blank(report.changelogLine) && report.changelogLine.trim() !== String(impl.changelogLine ?? "").trim() && !CARRIED_FORWARD.test(report.changelogLine)) {
      notes.push(`${who} proposed another CHANGELOG bullet, not landed (set the item's "changelog" to use it): ${report.changelogLine.trim().slice(0, 160)}`);
    }
  }
  if (!blank(item.title)) title = item.title.trim();
  if (blank(title)) refuse("blank decisionsTitle — give the manifest item a \"title\"");
  if (blank(body)) refuse("no decisionsSection");

  const changelog = String(item.changelog ?? "").trim() || String(impl.changelogLine ?? "").trim();
  if (blank(changelog)) refuse("blank changelogLine — give the manifest item a \"changelog\"");

  // An empty criterion, or one whose id land-batch.mjs cannot resolve, is dropped before the merge.
  const VALID_REQUIREMENT = /^BR-REQ-\d{3}-\d{2}$/;
  const real = (list) =>
    (list ?? []).filter((c) => {
      const empty = blank(c.text) || EMPTY_WORDS.test(c.text.trim()) || CARRIED_FORWARD.test(c.text);
      if (empty) {
        notes.push(`dropped an empty SPECS criterion for ${c.requirement}: "${String(c.text ?? "").slice(0, 80)}"`);
        return false;
      }
      const id = requirementOf(c);
      if (!VALID_REQUIREMENT.test(id)) {
        notes.push(`dropped a SPECS criterion with no BR-REQ-NNN-NN id (got "${c.requirement}"): "${String(c.text ?? "").slice(0, 80)}"`);
        return false;
      }
      return true;
    });
  const criteria = mergeCriteria(real(impl.specsCriteria), ...fixers.map((f) => real(f.report.specsCriteria)));
  return { title, body, changelog, criteria, notes };
}

/**
 * The decision placeholder, spelled in two pieces: `yarn docs:land` numbers every literal one in
 * tracked files, this file included (§535).
 */
export const PLACEHOLDER = "§" + "NNN";

/**
 * Rewrites, in place in every landed field, a literal `§N` above `threshold` (the last number in
 * DECISIONS.md) to the placeholder: it is a guess, not a citation. Returns the rewrites.
 */
export function rewriteFreeSectionRefs(entry, threshold) {
  const tooHigh = new RegExp(String.raw`§(\d+)`, "g");
  const rewrites = [];
  const fix = (text) =>
    String(text ?? "").replace(tooHigh, (whole, n) => {
      if (Number(n) <= threshold) return whole;
      rewrites.push(`§${n} → ${PLACEHOLDER}`);
      return PLACEHOLDER;
    });
  entry.title = fix(entry.title);
  entry.body = fix(entry.body);
  entry.changelog = fix(entry.changelog);
  entry.criteria = (entry.criteria ?? []).map((c) => ({ ...c, text: fix(c.text) }));
  return rewrites;
}
