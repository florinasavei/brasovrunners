"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import { VALIDITY_PROXY_ATTRIBUTE } from "@/shared/forms/ValidityProxy";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import RunnerLoader from "@/shared/ui/RunnerLoader";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { THEN_FIELD, THEN_PUBLISH } from "../form-names";

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

/** One unmet publication requirement: the box's `name` and the words the sentence uses. */
type Gap = { name: string; label: string };

/**
 * What publication would refuse, read off the form as it stands — the same rule the server
 * applies (`missingPublicEventFields`, `REQUIRED_PUBLIC_TRANSLATION_FIELDS`): the meeting
 * point unless the place is to be announced, and a title, an address and a summary in every
 * language. In the order the sentence names them.
 */
function publicationGaps(form: HTMLFormElement, locales: Props["locales"], labels: Props["labels"]): Gap[] {
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

  const gaps: Gap[] = [];
  // No meeting point is a gap only while the place is announced (§328): with the switch on, the
  // server publishes without one and every surface says it is to be announced.
  const announcedLater = data.get("event.locationToBeAnnounced") === "on";
  if (!announcedLater && text("event.locationName") === "") gaps.push({ name: "event.locationName", label: labels.locationName });
  for (const { locale, name } of locales) {
    const field = (box: string) => `translations.${locale}.${box}`;
    if (text(field("title")) === "") gaps.push({ name: field("title"), label: `${name}: ${labels.title}` });
    if (text(field("slug")) === "") gaps.push({ name: field("slug"), label: `${name}: ${labels.slug}` });
    if (emptyDocument(field("excerptBody"))) gaps.push({ name: field("excerptBody"), label: `${name}: ${labels.excerpt}` });
  }
  return gaps;
}

/**
 * "Creează și publică" (`DECISIONS.md` §315; the owner: "ar trebui sa pot crea si publica
 * dintr-un foc!") — the second submit button of the create form, shown only to a role that may
 * publish, posting the same form with `then=publish` so the action creates the event and walks
 * the two transitions in the create's own transaction.
 *
 * **It says why it waits.** While a publication requirement is visibly unmet the button dims
 * and names the first one, re-read on every keystroke. It stays pressable, like `SubmitButton`:
 * the press is what produces the specific answer.
 *
 * **And the press is refused in the browser** where the browser can know. The title, the
 * address and the meeting point carry `required` already, so the browser stops the press on
 * them itself. The summary does not — a draft may be saved without one; it is publication that
 * needs it (§170, §260) — so on this button's press, and only this one, the summary's proxy
 * (`ValidityProxy`, beside the editor's hidden field) is made required for the one validation
 * pass the press starts, and the browser refuses with its own bubble at the fold, bringing the
 * language forward and opening it. The plain "Creează" beside it never meets that rule.
 *
 * Never the only guard: without JavaScript the press posts, and the server creates the draft,
 * walks the transitions, is refused by the same guard, and the editor names what is missing.
 * Inside its form and never beside it: a submit button outside its form drives no Server Action.
 */
export default function CreateAndPublishButton({ label, pendingLabel, notReadyHint, locales, labels }: Props) {
  const status = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;

    const measure = () => setMissing(publicationGaps(form, locales, labels)[0]?.label ?? null);
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
  // The publication verb's own glyph at rest, as on the editor's "Publică" (§318), and the
  // runner in its place while this press is in flight, at the size of the glyph it replaces.
  const PublishGlyph = ACTION_ICONS.publish;

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
        startIcon={pending ? <RunnerLoader size={20} color="inherit" /> : <PublishGlyph fontSize="small" />}
        sx={{ ...TAP_TARGET, ...(dimmed ? { opacity: 0.38, cursor: "not-allowed" } : {}) }}
        onClick={(event) => {
          if (status.pending) {
            event.preventDefault();
            return;
          }
          const form = ref.current?.form;
          if (!form) return;
          // The click runs before the browser validates the form it submits: a summary that is
          // empty is made required for exactly this pass, and let go of straight after it.
          for (const gap of publicationGaps(form, locales, labels)) {
            if (!gap.name.endsWith(".excerptBody")) continue;
            const proxy = form.querySelector<HTMLInputElement>(`[${VALIDITY_PROXY_ATTRIBUTE}="${gap.name}"]`);
            if (!proxy) continue;
            proxy.required = true;
            setTimeout(() => {
              proxy.required = false;
            }, 0);
          }
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
