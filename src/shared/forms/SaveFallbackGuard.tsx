"use client";

import { useEffect } from "react";
import { ACTION_FORM_ATTRIBUTE, describeSubmission, rememberSubmission } from "./save-fallback";

const isScripted = (value: string | null | undefined) => (value ?? "").startsWith("javascript:");
const isActionName = (value: string | null | undefined) => (value ?? "").startsWith("$ACTION_");

/**
 * Remembers the last press of a Server Action form that is not an `ActionForm` (§436), so the
 * admin error boundary can offer it back as a plain POST. Capture phase, so it reads the form
 * first; an `ActionForm` is skipped unless the pressed button has an action of its own.
 */
export default function SaveFallbackGuard() {
  useEffect(() => {
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const submitter = event.submitter ?? null;
      const buttonAction = isScripted(submitter?.getAttribute("formaction")) || isActionName(submitter?.getAttribute("name"));
      if (form.hasAttribute(ACTION_FORM_ATTRIBUTE) && !buttonAction) return;
      // Drawn by the browser (a script address) or by the server (its fields).
      const serverAction = isScripted(form.getAttribute("action")) || form.querySelector('input[name^="$ACTION_"]') !== null;
      if (!serverAction && !buttonAction) return;
      rememberSubmission(describeSubmission(form, submitter));
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
  return null;
}
