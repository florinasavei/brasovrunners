"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import RunnerLoader from "@/shared/ui/RunnerLoader";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/** The marker the create action reads: this press asks for publication too. */
export const THEN_FIELD = "then";
export const THEN_PUBLISH = "publish";

type Props = {
  label: string;
  pendingLabel: string;
  /** "Cannot publish yet — missing: {field}", with the placeholder. */
  notReadyHint: string;
  /** The languages the public page needs, each with its own name. */
  locales: readonly { locale: string; name: string }[];
  /** The labels of the four things publication requires, as the editor's alert names them. */
  labels: { title: string; slug: string; excerpt: string; locationName: string };
};

/**
 * "Creează și publică" (`DECISIONS.md` §305; the owner: "ar trebui sa pot crea si publica
 * dintr-un foc!") — the second submit button of the create form, shown only to a role that may
 * publish, posting the same form with `then=publish` so the action creates the event and walks
 * the two transitions in one transaction.
 *
 * While a publication requirement is visibly unmet — a title, an address or a summary in either
 * language, the meeting point — the button dims and says which one, computed from the same
 * rule the server applies (`REQUIRED_PUBLIC_TRANSLATION_FIELDS`, `missingPublicEventFields`),
 * read off the form's own fields on every keystroke. It stays pressable, like `SubmitButton`:
 * the press is what produces the specific answer, and the server refuses regardless — the
 * event is created as a draft and the editor says what was missing. Never the only guard.
 *
 * A summary is a rich text carried by a hidden field, so its emptiness is read from the
 * document, not from a `required` attribute a hidden input cannot honour. Inside its form and
 * never beside it: a submit button outside its form drives no Server Action.
 */
export default function CreateAndPublishButton({ label, pendingLabel, notReadyHint, locales, labels }: Props) {
  const status = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;

    const measure = () => {
      const data = new FormData(form);
      const text = (name: string) => String(data.get(name) ?? "").trim();
      const emptyDocument = (name: string) => {
        const raw = text(name);
        if (raw === "") return true;
        try {
          return isRichTextEmpty(readRichText(JSON.parse(raw)));
        } catch {
          return true;
        }
      };
      let first: string | null = null;
      if (text("event.locationName") === "") first = labels.locationName;
      for (const { locale, name } of locales) {
        if (first) break;
        if (text(`translations.${locale}.title`) === "") first = `${name}: ${labels.title}`;
        else if (text(`translations.${locale}.slug`) === "") first = `${name}: ${labels.slug}`;
        else if (emptyDocument(`translations.${locale}.excerptBody`)) first = `${name}: ${labels.excerpt}`;
      }
      setMissing(first);
    };
    // The editor writes its document into a hidden field after the keystroke it answers, so the
    // measure is deferred a tick; the observer catches the write itself, whichever comes first.
    const deferred = () => setTimeout(measure, 0);
    measure();
    form.addEventListener("input", deferred);
    form.addEventListener("change", deferred);
    const observer = new MutationObserver(deferred);
    observer.observe(form, { subtree: true, childList: true, attributes: true, attributeFilter: ["value"] });
    return () => {
      form.removeEventListener("input", deferred);
      form.removeEventListener("change", deferred);
      observer.disconnect();
    };
  }, [locales, labels]);

  // Only this button's own press: the plain create beside it shares the form's status.
  const pending = status.pending && status.data?.get(THEN_FIELD) === THEN_PUBLISH;
  const dimmed = missing !== null && !status.pending;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Button
        ref={ref}
        type="submit"
        name={THEN_FIELD}
        value={THEN_PUBLISH}
        variant="outlined"
        size="medium"
        aria-disabled={status.pending}
        aria-busy={pending}
        aria-describedby={dimmed ? "publish-not-ready" : undefined}
        startIcon={pending ? <RunnerLoader size={18} color="inherit" /> : undefined}
        sx={{ ...TAP_TARGET, ...(dimmed ? { opacity: 0.38, cursor: "not-allowed" } : {}) }}
        onClick={(event) => {
          if (status.pending) event.preventDefault();
        }}
        data-testid="create-and-publish"
      >
        {pending ? pendingLabel : label}
      </Button>
      {dimmed && (
        <Typography id="publish-not-ready" variant="body2" color="text.secondary" role="status">
          {notReadyHint.replace("{field}", missing)}
        </Typography>
      )}
    </Box>
  );
}
