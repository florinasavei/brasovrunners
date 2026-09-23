"use client";

import MuiLink from "@mui/material/Link";
import TextField from "@mui/material/TextField";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { signatureNameMatches } from "../domain/signature-name";

/**
 * The signature box on the declaration: the name typed in a hand (§86), and — since §NNN — the
 * exact name the declaration expects, refused before the press when it is not.
 *
 * ## The browser refuses, the server decides
 *
 * The comparison is `signatureNameMatches`, imported from the domain rather than rewritten here,
 * so the live check and the service's check are one function and cannot disagree about a name.
 * A mismatch sets `setCustomValidity` (the pattern `PhoneField` set in §231): the **browser**
 * then stops the submission, points at this box and says the one sentence, in the reader's own
 * language, with the same machinery that already handles an empty required field. The service
 * refuses the same mismatch regardless (`signDeclaration`), which is what a form with JavaScript
 * off meets, and the page then shows why.
 *
 * ## When it speaks
 *
 * The bubble is armed from the first keystroke, because a press is the moment it is needed. The
 * red state under the box waits until the box has been **left** (or the browser has refused a
 * press): turning a signature red on its second letter is scolding somebody for typing, the rule
 * §198 set for every live check on these forms. A refusal the server already made is shown at
 * once, until the name is corrected.
 *
 * ## Uncontrolled, like every island on these forms (§211)
 *
 * The DOM owns the value — `defaultValue`, never `value` — and state only watches it, so a person
 * who starts typing before hydration keeps what they typed. Before hydration the box is the
 * server's plain required input; the check joins when the island does.
 *
 * Strings in, never functions or elements (`AGENTS.md` §14.1): the words are this island's own,
 * through `useTranslations`, so the bold name is in the catalogue (`t.rich`) and not assembled
 * here.
 */
export default function SignatureField({
  id,
  expectedName,
  participantName,
  contactHref,
  myRegistrationsHref,
  canReply,
  defaultValue,
  refused,
}: {
  id: string;
  /** The declarant's name (`expectedSignatureName`); null when there is none to compare with. */
  expectedName: string | null;
  /** The minor's own name when a parent signs for them (§108); null for an adult. */
  participantName: string | null;
  /** The club's contact page, for somebody whose registered name is itself wrong. */
  contactHref: string;
  /**
   * "Înscrierile mele", for a parent whose own name is the mistake: the club can correct the
   * participant's name but not the guardian's, so that registration is cancelled and made again.
   */
  myRegistrationsHref: string;
  /** Whether a reply to the club's emails reaches anybody (`EMAIL_REPLY_TO`). */
  canReply: boolean;
  /** What was typed before a refusal the server made, brought back by the page. */
  defaultValue?: string;
  /** The server refused this signature (`?invalid=name`). */
  refused?: boolean;
}) {
  const t = useTranslations("Registrations");
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue ?? "");
  const [touched, setTouched] = useState(false);

  const minor = participantName !== null;
  const mismatch =
    expectedName !== null && value.trim() !== "" && !signatureNameMatches(value, expectedName);
  const mismatchSentence =
    expectedName === null
      ? ""
      : minor
        ? t("declare.signatureMismatchForMinor", { name: expectedName })
        : t("declare.signatureMismatch", { name: expectedName });

  /*
    The refusal the browser enforces, judged on what the box actually holds — read from the DOM
    rather than from state, so a name typed before hydration is judged the moment the island
    arrives, not at the next keystroke. An empty box is left to `required`, whose own message is
    the right one for a box nobody has filled; the bold name under it already says what to type.
    Cleared the moment the name matches, or the control would stay refused for ever.
  */
  useEffect(() => {
    const input = inputRef.current;
    if (!input || expectedName === null) return;
    const wrong = input.value.trim() !== "" && !signatureNameMatches(input.value, expectedName);
    input.setCustomValidity(wrong ? mismatchSentence : "");
  }, [value, expectedName, mismatchSentence]);

  const showError = mismatch && (touched || Boolean(refused));

  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const contact = (chunks: ReactNode) => <MuiLink href={contactHref}>{chunks}</MuiLink>;
  const mine = (chunks: ReactNode) => <MuiLink href={myRegistrationsHref}>{chunks}</MuiLink>;
  /*
    What to do when the name the box wants is itself wrong (§NNN). An adult's registered name is
    one the club corrects ("Corectează numele") and the same link then signs; a guardian's is not
    — no staff verb edits it (`AGENTS.md` §15.11) — so the parent is told what actually works: cancel, and
    register the minor again with the right name.
  */
  const wrongNameSentence = minor
    ? t.rich(canReply ? "declare.signatureNameWrongForMinorReply" : "declare.signatureNameWrongForMinor", { contact, mine })
    : t.rich(canReply ? "declare.signatureNameWrongReply" : "declare.signatureNameWrong", { contact });

  const hint =
    expectedName === null
      ? t("declare.typedNameHelp")
      : minor
        ? t.rich("declare.typedNameHelpForMinor", { name: expectedName, participant: participantName, strong })
        : t.rich("declare.typedNameHelpWithName", { name: expectedName, strong });

  return (
    <TextField
      id={id}
      name="typedName"
      label={t("declare.typedName")}
      inputRef={inputRef}
      defaultValue={defaultValue ?? ""}
      onChange={(event) => setValue(event.target.value)}
      onBlur={(event) => {
        setValue(event.target.value);
        setTouched(true);
      }}
      error={showError}
      helperText={
        showError ? (
          <>
            {mismatchSentence} {wrongNameSentence}
          </>
        ) : (
          hint
        )
      }
      required
      /*
        Off: a phone offering a saved name here would be filled in by reflex, and this is the one
        field on the site where typing it is the act itself (BR-REQ-031-04 criterion 6).
      */
      autoComplete="off"
      slotProps={{
        htmlInput: {
          maxLength: 200,
          spellCheck: false,
          /*
            The browser refused a press on this box: the reason goes under it as well as in the
            bubble, which disappears the moment the person looks away. On the input itself —
            `invalid` does not bubble, so a handler on the TextField's wrapper would never hear it.
          */
          onInvalid: (event: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
            setValue(event.currentTarget.value);
            setTouched(true);
          },
        },
      }}
      sx={{ "& input": { fontFamily: "var(--font-signature), cursive", fontSize: "1.75rem", py: 1 } }}
    />
  );
}
