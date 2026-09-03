## What and why

<!-- One paragraph. Link the requirement IDs this implements, e.g. BR-REQ-034-01. -->

Requirements:

## Checks

- [ ] `yarn check` passes locally (includes `docs:check`).
- [ ] Tests cover the acceptance criteria of every requirement listed above.
- [ ] No hostname literal, secret, or participant data added to the repository.

## Documentation synchronization

Only if this pull request changes a documented rule. See the change-type matrix in
`AGENTS.md` §1.4.

- [ ] Every document in the matching matrix row was updated.
- [ ] `PROJECT_BASELINE` bumped identically in all six root documents.
- [ ] `CHANGELOG.md` entry added with the new baseline as its heading.
- [ ] `MANIFEST.txt` updated if this is a headline decision.
- [ ] Rationale appended to `DECISIONS.md` without rewriting existing history.
- [ ] No rule now exists in exactly one document.
- [ ] Any new documentation or configuration file is linked from `README.md`.

## Risk

- [ ] Migration included and reversible, or not applicable.
- [ ] Capacity, waiting-list, or declaration behavior unaffected, or covered by a
      concurrency test.
- [ ] Security, privacy, or token impact considered.
