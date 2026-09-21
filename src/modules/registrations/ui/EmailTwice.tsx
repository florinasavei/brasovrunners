"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useCallback, useState, useSyncExternalStore } from "react";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";

/**
 * The address, twice, typed by hand, checked as it is typed (`DECISIONS.md` §206).
 *
 * The owner: "în formularul de înscriere și de contact, pune oamenii să reintroducă mailul de
 * mână, fără auto-complete, și fă verificarea live ca mailurile să se potrivească."
 *
 * ## The evidence for it
 *
 * QA's outbox holds three BOUNCED messages to `…@gmail.con`. One letter, and the person is gone:
 * the confirmation link is sent into nothing, the screen tells them to check their inbox, and the
 * club never learns they tried. A resend does not help — it resends to the same wrong address —
 * and neither does a better bounce report, because by then they have given up. The only place
 * this is cheap to catch is the moment it is typed.
 *
 * ## Why the comparison is the canonicalizer's and not `===`
 *
 * `canonicalizeEmail` is what the platform uses to decide whether two addresses are the same
 * person (`AGENTS.md` §10.4, BR-REQ-032-*). Comparing the raw strings here would refuse
 * `Ana@Gmail.com` against `ana@gmail.com` — the same mailbox, and the same row once stored — and
 * would accept a Gmail address that differs only in dots, which the club treats as two people
 * (§74). The field asks the question the system actually asks.
 *
 * Both are `autoComplete="off"`: the point of the second box is a second act of typing, and a
 * browser that fills it from the first defeats the whole exercise.
 *
 * ## Paste is refused in the second box, and §206 said the opposite (§227)
 *
 * §206 left paste alone, reasoning that a password manager holds the address people use
 * everywhere and that refusing it pushes somebody to type from memory. The owner reversed it —
 * "în căsuța de reconfirmare mail nu ar trebui să pot face copy-paste, trebe să scriu de mână!"
 * — and the reversal is right for a reason §206 did not weigh: the paste that matters is not
 * from a password manager, it is **from the first box**. Copy, paste, done, and the second box
 * has confirmed nothing at all. That is the cheapest possible way to defeat the check and the
 * one every hurried person reaches for.
 *
 * **"dar să fie safe"**, which is the same instruction §195 got about the rules gate, and it is
 * handled the same way: the block is an enhancement with a door in it. A refused paste says why
 * — never a silent no-op (§217) — and offers "paste it anyway", which lets it through for that
 * field. Somebody using voice input, an assistive tool or a keyboard that only pastes is not
 * locked out of registering, and the person copying from the box above still has to stop and
 * read a sentence that tells them why not to.
 *
 * Only the **second** box refuses. The first is where a password manager legitimately fills in
 * the address somebody uses everywhere, and §206 was right about that half.
 *
 * ## Uncontrolled inputs, and why that is not a detail (§211)
 *
 * The boxes keep `defaultValue` and never `value`. Written as controlled inputs they wiped what
 * somebody had already typed: the server's HTML carries the fields, a person starts typing
 * immediately, React hydrates a moment later, and a controlled input rendered from state that
 * began at "" replaces their text with nothing. It is invisible in development, where hydration
 * is instant, and it is exactly what happens to the first person on a cold edge.
 *
 * The e2e suite found it by behaving like that person — filling the form the instant the page
 * arrives — and the submission then failed native validation on boxes that looked filled.
 *
 * So the DOM owns the value and this island only *watches* it: state exists for the comparison
 * and for nothing else, which is why it can never contradict what is on screen.
 *
 * ## Before hydration, and with JavaScript off
 *
 * The two fields and their `type="email"` validation are the server's markup; the live verdict is
 * consulted only once hydrated. And the match is **checked again on the server**, because a
 * comparison that only ever ran in a browser is a decoration (`assertEmailTypedTwice`, called by
 * the public action — §206 records why it is not in the service's schema).
 */
export default function EmailTwice({
  name,
  confirmName,
  label,
  confirmLabel,
  mismatchLabel,
  noPasteLabel,
  allowPasteLabel,
  help,
  fieldId,
  confirmFieldId,
  defaultValue,
  defaultConfirmValue,
  error,
  helperText,
}: {
  name: string;
  confirmName: string;
  label: string;
  confirmLabel: string;
  /** "The two addresses do not match" — shown under the second box as it is typed. */
  mismatchLabel: string;
  /** Why a paste was refused (§227) — said the moment it happens, never a silent no-op. */
  noPasteLabel: string;
  /** The door out of it, for somebody who cannot type the address by hand. */
  allowPasteLabel: string;
  help?: string;
  fieldId: string;
  confirmFieldId: string;
  defaultValue?: string;
  defaultConfirmValue?: string;
  /** The server's own rejection of the first field, which still wins. */
  error?: boolean;
  helperText?: string;
}) {
  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );

  const [first, setFirst] = useState(defaultValue ?? "");
  const [second, setSecond] = useState(defaultConfirmValue ?? "");

  /**
   * Silent until the second box has something in it that looks finished. Telling somebody the
   * addresses do not match while they are on the third character of the second one is telling
   * them off for typing.
   */
  const sameAddress = (a: string, b: string): boolean => {
    try {
      return canonicalizeEmail(a).canonicalEmail === canonicalizeEmail(b).canonicalEmail;
    } catch {
      // Not yet a valid address: nothing to compare, so nothing to complain about.
      return true;
    }
  };

  const mismatch = hydrated && second.trim() !== "" && !sameAddress(first, second);

  /**
   * The paste block, and the door in it (§227).
   *
   * `blocked` is whether a paste has just been refused — what puts the sentence on screen, so
   * the refusal is never silent. `allowPaste` is the door: once somebody says they cannot type
   * it, this field stops refusing for the rest of the visit. It is deliberately not persisted
   * anywhere; the next form asks again, and the cost of saying so twice is one press.
   */
  const [blocked, setBlocked] = useState(false);
  const [allowPaste, setAllowPaste] = useState(false);

  const refusePaste = (event: { preventDefault: () => void }) => {
    if (allowPaste) return;
    event.preventDefault();
    setBlocked(true);
  };

  return (
    <Stack spacing={2}>
      <TextField
        id={fieldId}
        name={name}
        type="email"
        label={label}
        defaultValue={defaultValue ?? ""}
        onChange={(event) => setFirst(event.target.value)}
        required
        fullWidth
        autoComplete="off"
        error={error}
        helperText={helperText ?? help}
        slotProps={{ htmlInput: { maxLength: 320, spellCheck: false } }}
      />
      <TextField
        id={confirmFieldId}
        name={confirmName}
        type="email"
        label={confirmLabel}
        defaultValue={defaultConfirmValue ?? ""}
        onChange={(event) => {
          setSecond(event.target.value);
          // Typing is what the block is for; once they are typing, stop nagging about it.
          if (blocked) setBlocked(false);
        }}
        /*
          Both events, because both put somebody else's text in the box without typing it:
          `paste` is the keyboard and the context menu, `drop` is dragging the address in from
          the box above or from another window.
        */
        onPaste={refusePaste}
        onDrop={refusePaste}
        required
        fullWidth
        autoComplete="off"
        error={mismatch}
        helperText={mismatch ? mismatchLabel : blocked ? noPasteLabel : undefined}
        slotProps={{ htmlInput: { maxLength: 320, spellCheck: false } }}
      />
      {/*
        The door (§227, and §195's "fă safe"). Shown only once a paste has actually been
        refused, so nobody who is happily typing ever sees an invitation to stop.

        A button rather than a link: it performs something on this page. `type="button"`
        because it lives inside a form and must never submit it.
      */}
      {blocked && !allowPaste && (
        <Box>
          <Button type="button" size="small" onClick={() => setAllowPaste(true)} sx={{ minHeight: 44 }}>
            {allowPasteLabel}
          </Button>
        </Box>
      )}
    </Stack>
  );
}
