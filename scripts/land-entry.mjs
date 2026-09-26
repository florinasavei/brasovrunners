/**
 * What `yarn docs:land` makes of one item's saved results — its DECISIONS title and body, its
 * CHANGELOG bullet, its SPECS criteria — kept apart from `land-batch.mjs`, which writes files on
 * import, so the rules are testable (§426).
 *
 * The rules came from landings that went wrong (BR-V1.91's among them):
 *
 *   - a fix report with nothing in it — a fixer that returned no result, or one with no summary —
 *     is refused, never skipped in silence: the item would land as if the fix had happened;
 *   - the CHANGELOG bullet is the implementer's, or the manifest item's own `changelog` when the
 *     dispatcher rewrote it; a fixer's `changelogLine` is never taken, because a fixer writes it
 *     about its round ("fixed the reviewer's findings") rather than about what a person sees;
 *   - a blank `decisionsTitle` is refused: the fixer's when it has one, else the implementer's,
 *     else the manifest item's `title`, or nothing lands;
 *   - a fixer's housekeeping is never landed: a section or an addendum that only says the text was
 *     "carried forward", or a sentence saying no DECISIONS.md or CHANGELOG.md edit was made, is
 *     dropped — a whole sentence when it is nothing else, or just its clause when a ';' joins it
 *     to real substance — and every dropped piece is printed so the dry run shows it. The match is
 *     narrow — any tense of "carr(y/ies/ied/ying) forward" followed by "from the implementer/
 *     verbatim/unchanged", or "no … DECISIONS/CHANGELOG/SPECS … edit/change" in either order —
 *     never a bare "unchanged" or "did not change" on its own, nor "carries the place forward",
 *     which belong to the fix's substance as often as to its housekeeping;
 *   - a committed fix report with a blank `commitSha` is refused, naming the item and the round —
 *     "committed" with nothing to point at is the same defect as a blank summary;
 *   - a SPECS criterion whose `requirement` is not a full `BR-REQ-\d{3}-\d{2}` id is dropped, with
 *     a note, rather than landed under a heading `land-batch.mjs` cannot resolve.
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

/** The landing artifact's name, for the two housekeeping patterns below — never a bare "unchanged". */
// "\.md" reads "_md" here — the caller replaces the dot so a filename never ends a sentence.
const ARTIFACT = String.raw`(?:DECISIONS|CHANGELOG|SPECS)(?:[._]md)?`;
const EDIT_WORD = String.raw`(?:edits?|changes?)`;
/**
 * "No DECISIONS.md … edit was made" or "no changes … to DECISIONS.md were needed" — the subject
 * has to be the landing artifact itself, in either word order. Narrow on purpose: "the SPECS
 * criterion … did not change the allocator" and "… §31 is unchanged" are the fix's substance, not
 * housekeeping, and must not match — there is no "no"/"without" attached to the artifact there.
 */
const NO_ARTIFACT_EDIT = new RegExp(
  String.raw`\b(no|without)\b[^.;]{0,90}\b${ARTIFACT}\b[^.;]{0,90}\b${EDIT_WORD}\b` + "|" + String.raw`\b(no|without)\b[^.;]{0,90}\b${EDIT_WORD}\b[^.;]{0,90}\b${ARTIFACT}\b`,
  "i",
);
/**
 * "Carried forward from the implementer", "carries forward unchanged", "carrying forward
 * verbatim", "carrying forward the implementer's section", "carry forward the text" — any
 * tense of "carry … forward" whose complement names the landing text itself (a qualifier, or
 * "the implementer's <noun>" / "the text", as the object *after* "forward"). A sentence like
 * "a declined offer carries the place forward to the next person", or "a waiting-list offer's
 * deadline is carried forward to the next day", is the fix's substance (a direct object
 * between "carr(y|ies|ied|ying)" and "forward", or an object after "forward" that names
 * something other than the document text) and must not match.
 */
const CARRIED_FORWARD = /\bcarr(?:y|ies|ied|ying)\s+forward\b[^.;]{0,30}\b(from the implementer|verbatim|unchanged|the implementer's\s+\w+|the text)\b/i;
/** A whole text that says nothing, including a bare "(carried forward)" with no qualifier. */
const EMPTY_WORDS = /^[(\s]*(none|n\/a|unchanged|carried forward|no (changes?|edits?|addendum)|nothing( (new|to add))?|same( as (above|before))?|—|-+)[.)\s]*$/i;

/** True when `clause` is on its own nothing but housekeeping — carried-forward or a no-edit note. */
function isHousekeepingClause(clause) {
  // A file name's dot ("DECISIONS.md") is not the end of a clause for NO_ARTIFACT_EDIT.
  const plain = clause.replace(/\.(md|mjs|js|ts)\b/g, "_$1");
  return CARRIED_FORWARD.test(plain) || NO_ARTIFACT_EDIT.test(plain);
}

/**
 * A fixer's text without its housekeeping: the sentences — or, when housekeeping shares a
 * sentence with real substance across a ';', the clauses — that only say what was not written
 * or that the text was carried forward. Returns the text left and the pieces dropped.
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
        // No ';' to hide substance behind — test the whole sentence, as before.
        if (isHousekeepingClause(sentence)) dropped.push(sentence.trim());
        else out += sentence + separator;
        continue;
      }
      // A ';' may join a housekeeping clause to real substance in one sentence — test each
      // clause on its own (never the whole sentence at once) so the substance is kept rather
      // than lost with its housekeeping neighbour.
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
 * One item's entry, from its br-chain result, its br-fix-round results in order, and the
 * manifest item's own overrides (`title`, `changelog`). Throws an Error naming `label` for a
 * blank fix report, a blank title, a blank section or a blank bullet.
 *
 * Returns { title, body, changelog, criteria, notes } — `notes` are lines for the dry run: what
 * was dropped, and a fixer's bullet that differs from the one landed.
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
 * A literal `§N` a fixer or implementer typed instead of the `§426` placeholder — guessing at a
 * number `land-batch.mjs` has not assigned yet. Above `threshold` (the last number already in
 * DECISIONS.md, before this batch's own numbers are handed out) it cannot be a citation of an
 * existing decision, so it is rewritten to `§426` before step 4's numbering gives it the real one;
 * `§N` at or below `threshold` is left alone, since it names a decision that already exists.
 *
 * Rewrites every one of `entry`'s landed fields (title, body, changelog, each criterion's text) in
 * place and returns the sentences changed, for the dry run to print.
 */
export function rewriteFreeSectionRefs(entry, threshold) {
  const tooHigh = new RegExp(String.raw`§(\d+)`, "g");
  const rewrites = [];
  const fix = (text) =>
    String(text ?? "").replace(tooHigh, (whole, n) => {
      if (Number(n) <= threshold) return whole;
      rewrites.push(`§${n} → §426`);
      return "§426";
    });
  entry.title = fix(entry.title);
  entry.body = fix(entry.body);
  entry.changelog = fix(entry.changelog);
  entry.criteria = (entry.criteria ?? []).map((c) => ({ ...c, text: fix(c.text) }));
  return rewrites;
}
