/**
 * What `yarn docs:land` makes of one item's saved results — its DECISIONS title and body, its
 * CHANGELOG bullet, its SPECS criteria — kept apart from `land-batch.mjs`, which writes files on
 * import, so the rules are testable (§NNN).
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
 *     dropped, and every dropped sentence is printed so the dry run shows it.
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

/** The things the landing writes, as a fixer names them when it says it did not write them. */
const LANDING_ARTIFACT =
  /\b(DECISIONS|CHANGELOG|SPECS)(\.md)?\b|PROJECT_BASELINE|baseline marker|\bchangelog ?line\b|\bchangelogLine\b|\bspecsCriteria\b|\bdecisions(Section|Title|Addendum)\b|§\s?(text|body|section)\b/i;
/**
 * "No … edit was made", "was not edited", "did not touch", "left unchanged", "for the orchestrator
 * to place" — said of a landing artifact, these are the fixer's housekeeping. Narrow on purpose: a
 * sentence like "§372 did not say what changed" is the fix's substance and stays.
 */
const NOT_WRITTEN = new RegExp(
  [
    String.raw`\bno\b[^.;]{0,80}\b(edits?|changes?)\b[^.;]{0,50}\b(made|needed|required)\b`,
    String.raw`\b(not|never)\s+(been\s+)?(edited|touched|modified|changed|updated)\b`,
    String.raw`\b(did|does|do|was|were)\s*(not|n't)\s+(edit|touch|modify|change|update)\b`,
    String.raw`\b(unchanged|untouched|as before|as is)\b`,
    String.raw`\bfor the (orchestrator|dispatcher)\b`,
  ].join("|"),
  "i",
);
/** "Carried forward", "carry the § text forward". */
const CARRIED = /\bcarr(y|ies|ied|ying)\b[^.]*\bforward\b/i;
/** What makes a "carried forward" sentence housekeeping rather than, say, a waiting-list rule. */
const CARRIED_FROM = /\b(implementer|verbatim|unchanged|as[- ]is|above|previous|earlier|original)\b/i;
const isCarried = (sentence) => CARRIED.test(sentence) && (LANDING_ARTIFACT.test(sentence) || CARRIED_FROM.test(sentence) || sentence.trim().length < 80);
/** A whole text that says nothing. */
const EMPTY_WORDS = /^[(\s]*(none|n\/a|unchanged|no (changes?|edits?|addendum)|nothing( (new|to add))?|same( as (above|before))?|—|-+)[.)\s]*$/i;

/**
 * A fixer's text without its housekeeping: the sentences that only say what was not written or
 * that the text was carried forward. Returns the text left and the sentences dropped.
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
      // A file name's dot ("DECISIONS.md") is not the end of a clause for NOT_WRITTEN.
      const plain = sentence.replace(/\.(md|mjs|js|ts)\b/g, "_$1");
      const housekeeping = isCarried(plain) || (LANDING_ARTIFACT.test(sentence) && NOT_WRITTEN.test(plain));
      if (housekeeping && sentence.trim()) dropped.push(sentence.trim());
      else out += sentence + separator;
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

  const fixers = [];
  if (chain.fixed?.committed) fixers.push({ who: "the chain's fixer", report: chain.fixed, text: chain.fixed.decisionsSection });
  rounds.forEach((result, i) => {
    const report = result?.fixed;
    if (isBlankFixReport(report)) refuse(`fix round ${i + 1}'s report is blank — no result, or no summary of what the fixer did`);
    if (!report.committed) {
      notes.push(`fix round ${i + 1} committed nothing: its text is not landed`);
      return;
    }
    fixers.push({ who: `fix round ${i + 1}`, report, text: report.decisionsAddendum, addendum: true });
  });

  let body = String(impl.decisionsSection ?? "").trim();
  let title = String(impl.decisionsTitle ?? "").trim();
  for (const { who, report, text, addendum } of fixers) {
    const { text: clean, dropped } = withoutHousekeeping(text);
    for (const sentence of dropped) notes.push(`dropped from ${who}: "${sentence.slice(0, 160)}"`);
    if (clean) body = addendum ? `${body}\n\n${clean}` : clean;
    if (!addendum && !blank(report.decisionsTitle) && !EMPTY_WORDS.test(report.decisionsTitle) && !CARRIED.test(report.decisionsTitle)) title = report.decisionsTitle.trim();
    if (!blank(report.changelogLine) && report.changelogLine.trim() !== String(impl.changelogLine ?? "").trim() && !CARRIED.test(report.changelogLine)) {
      notes.push(`${who} proposed another CHANGELOG bullet, not landed (set the item's "changelog" to use it): ${report.changelogLine.trim().slice(0, 160)}`);
    }
  }
  if (!blank(item.title)) title = item.title.trim();
  if (blank(title)) refuse("blank decisionsTitle — give the manifest item a \"title\"");
  if (blank(body)) refuse("no decisionsSection");

  const changelog = String(item.changelog ?? "").trim() || String(impl.changelogLine ?? "").trim();
  if (blank(changelog)) refuse("blank changelogLine — give the manifest item a \"changelog\"");

  // An empty criterion is dropped before the merge, so it cannot replace a real one for its requirement.
  const real = (list) =>
    (list ?? []).filter((c) => {
      const empty = blank(c.text) || EMPTY_WORDS.test(c.text.trim()) || isCarried(c.text);
      if (empty) notes.push(`dropped an empty SPECS criterion for ${c.requirement}: "${String(c.text ?? "").slice(0, 80)}"`);
      return !empty;
    });
  const criteria = mergeCriteria(real(impl.specsCriteria), ...fixers.map((f) => real(f.report.specsCriteria)));
  return { title, body, changelog, criteria, notes };
}
