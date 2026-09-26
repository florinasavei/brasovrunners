"use client";

import { useEffect } from "react";
import { ACTION_FORM_ATTRIBUTE, describeSubmission, rememberSubmission } from "./save-fallback";

const isScripted = (value: string | null | undefined) => (value ?? "").startsWith("javascript:");
const isActionName = (value: string | null | undefined) => (value ?? "").startsWith("$ACTION_");

/**
 * Remembers the last press of a backoffice form that is not an `ActionForm` (§NNN), for the admin
 * error boundary: a plain `<form action={…}>` or a button with its own Server Action has no island
 * of its own, so its failure is thrown to the boundary — after React has taken the form off the
 * page. The boundary then offers this press back — sent as a plain POST (`replayNatively`) only
 * when the person presses «Trimite pe calea simplă», and only while the press is recent
 * (`RECENT_PRESS_MS`).
 *
 * A listener on the document in the capture phase, so it reads the form before anything else runs;
 * an `ActionForm` is skipped (it keeps its own), unless the pressed button has an action of its own,
 * which React runs outside the form's. Reading a small form's values is the whole cost of a press.
 * Draws nothing.
 */
export default function SaveFallbackGuard() {
  useEffect(() => {
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const submitter = event.submitter ?? null;
      const buttonAction = isScripted(submitter?.getAttribute("formaction")) || isActionName(submitter?.getAttribute("name"));
      if (form.hasAttribute(ACTION_FORM_ATTRIBUTE) && !buttonAction) return;
      // A Server Action form, drawn by the browser (a script address) or by the server (its fields).
      const serverAction = isScripted(form.getAttribute("action")) || form.querySelector('input[name^="$ACTION_"]') !== null;
      if (!serverAction && !buttonAction) return;
      rememberSubmission(describeSubmission(form, submitter));
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
  return null;
}
