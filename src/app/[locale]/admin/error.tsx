"use client";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { boundaryFailureOf, forgetSubmission, recentSubmission, replayNatively, type Submission } from "@/shared/forms/save-fallback";
import SaveBlockedNotice from "@/shared/forms/SaveBlockedNotice";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The backoffice's own boundary, for one kind of failure only: a save the network refused (§NNN).
 *
 * An `ActionForm` catches that itself and keeps its boxes. A plain `<form action={…}>` inside a
 * page — the pages' order, a cover, the printed-bib marks — or a button with a Server Action of
 * its own has nobody to catch it, so React throws it here, having taken the form off the page.
 * `SaveFallbackGuard` kept the press; this offers it back as one button, «Trimite pe calea
 * simplă», which sends it as a plain POST (`replayNatively`) only when pressed — never on its own,
 * because the server may already have run it (`save-fallback.ts`).
 *
 * Sign-out is not among them: its form lives in the admin layout, and a segment's `error.tsx`
 * never catches its own layout's errors — a blocked sign-out goes to `[locale]/error.tsx`.
 *
 * This boundary sees every client render error in the backoffice, so an error is taken for a
 * blocked save only when both hold (`boundaryFailureOf`): the guard remembered a press within the
 * last few seconds, and the error is the transport's own — the browser's fetch-failure words or
 * Next's E394, never a generic `TypeError`. Every other error is thrown on, during render, to
 * `[locale]/error.tsx` — the boundary the backoffice always had, with its reference number (§52).
 */
function judge(error: unknown): { error: unknown; press: Submission | null } {
  const press = recentSubmission();
  return { error, press: boundaryFailureOf(error, press) ? press : null };
}

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("Network");
  // Judged once per error, when it first draws — a later re-render must not change its mind as the
  // press ages: the press this failure followed, if the failure is one.
  const [judged, setJudged] = useState(() => judge(error));
  const current = judged.error === error ? judged : judge(error);
  if (current !== judged) setJudged(current);
  const press = current.press;

  if (!press) throw error;

  const sendSimple = () => {
    forgetSubmission();
    return replayNatively(press);
  };

  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <SaveBlockedNotice kept={false} onSend={sendSimple} />
      <Button variant="outlined" onClick={reset} sx={TAP_TARGET}>
        {t("retry")}
      </Button>
    </Stack>
  );
}
