"use client";

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
 * browser that fills it from the first defeats the whole exercise. Paste is left alone — a
 * password manager holds the address people use everywhere, and refusing it would push somebody
 * to type from memory, which is worse than a paste of the right thing.
 *
 * ## Before hydration, and with JavaScript off
 *
 * The two fields and their `type="email"` validation are the server's markup; the live verdict is
 * consulted only once hydrated. And the match is **checked again on the server**, because a
 * comparison that only ever ran in a browser is a decoration (the schema's own `superRefine`).
 */
export default function EmailTwice({
  name,
  confirmName,
  label,
  confirmLabel,
  mismatchLabel,
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

  return (
    <Stack spacing={2}>
      <TextField
        id={fieldId}
        name={name}
        type="email"
        label={label}
        value={first}
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
        value={second}
        onChange={(event) => setSecond(event.target.value)}
        required
        fullWidth
        autoComplete="off"
        error={mismatch}
        helperText={mismatch ? mismatchLabel : undefined}
        slotProps={{ htmlInput: { maxLength: 320, spellCheck: false } }}
      />
    </Stack>
  );
}
