# `.release/` — the release facts a branch carries

Every change that ships says three things besides its code: why (a `DECISIONS.md` section),
what a person sees (a `CHANGELOG.md` bullet) and what a test proves (`SPECS.md` criteria). A
branch never edits those files itself — several branches cannot share one tail of
`DECISIONS.md`, one open CHANGELOG section and one next number. Instead it commits **one JSON
file here**, named after the branch (`feat/night-pill` → `.release/feat-night-pill.json`), and
whoever lands the branch numbers it and moves its text into the documents:

- from a phone: add the label **`ship`** to the pull request into `qa` (or run the **release**
  workflow with its number) — `.github/workflows/release.yml` lands the entry, pushes the
  landing commit, and ships the release to production;
- on the PC: `yarn docs:land --tree` (a dry run; `--apply` writes), or a dispatcher's manifest,
  which lands the tree's entries after its own items.

The landing deletes the files it read, so an entry never lands twice.

What the branch writes itself, in the same commits as the code, because nobody is there to do it
at an unattended landing: a README index row for every new file under the root, `docs/`,
`scripts/`, `.github/` or `.githooks/` (`yarn docs:check` fails without it), the SETUP or
`docs/*.md` section the change needs, a line in CLAUDE.md's command list for a new `yarn`
command. What it never writes: `DECISIONS.md`, `CHANGELOG.md`, `SPECS.md`, a baseline marker,
CLAUDE.md's baseline line, `docs/QUEUE.md`'s Released rows — the landing does.

`yarn docs:check` checks every entry on the pull request — the fields, the file's name, and that
each criterion's requirement exists in `SPECS.md` — so a bad entry is red there, not at release
time. The release from the phone also stops on anything else a person would have to finish:
`docsNotes`, and a decision placeholder in a line no branch wrote (a merge resolved it).

## The fields

The same ones an implementer returns to the dispatcher (`.claude/workflows/br-chain.js`):

| Field | Required | What it holds |
| --- | --- | --- |
| `branch` | yes | the branch's name, exactly; the file's name is this with `/` as `-` |
| `decisionsTitle` | yes | the section's title, without a number |
| `decisionsSection` | yes | the section's Markdown body, without the `## N.` line; the owner's words, the decision, what was refused and why |
| `changelogLine` | yes | one English bullet with a bold lead, ending in `§NNN.` |
| `specsCriteria` | no | a list of `{ "requirement": "BR-REQ-041-01", "text": "…" }` — a full requirement id that exists in `SPECS.md`, and the criterion ending `(<date>, \`DECISIONS.md\` §NNN).` |
| `docsNotes` | no | leave it empty: text another document needs is written on the branch itself (below). Anything here is hand work — a PC landing prints it, `yarn docs:check` warns, and the release from the phone refuses it |
| `batchLine` | no | the short clause for the queue's Released row; the title when absent |

Cite the decision in the code and in these texts as `§NNN`: the landing replaces it with the
section's number, in the code by the commit that wrote the line.

## An example

```json
{
  "branch": "feat/night-pill",
  "decisionsTitle": "The night pill says «Noapte» with a crescent",
  "decisionsSection": "**The owner, from his phone:** \"…\"\n\n**Decision.** …",
  "changelogLine": "- **«Noapte» on the night pill** — a crescent and one word, the sunset in the tooltip. §NNN.",
  "specsCriteria": [
    { "requirement": "BR-REQ-041-01", "text": "A night event's pill reads «Noapte» with a crescent (2031-01-02, `DECISIONS.md` §NNN)." }
  ],
  "batchLine": "the night pill says «Noapte» with a crescent"
}
```

The repository is public: nothing here names a secret, a key, a token, a database URL, a personal
address, an account id or a local path.
