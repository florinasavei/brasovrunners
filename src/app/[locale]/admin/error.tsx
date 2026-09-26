"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { replayNatively, takeSubmission, transportFailureOf } from "@/shared/forms/save-fallback";
import SaveBlockedNotice from "@/shared/forms/SaveBlockedNotice";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The backoffice's own boundary, for one kind of failure only: a save the network refused (§NNN).
 *
 * An `ActionForm` catches that itself and keeps its boxes. A plain `<form action={…}>` — sign
 * out, the pages' order, a cover, the printed-bib marks — or a button with a Server Action of its
 * own has nobody to catch it, so React throws it here, having taken the form off the page.
 * `SaveFallbackGuard` kept the press; it is sent again as a plain POST (`replayNatively`), and the
 * page it lands on says so. If it cannot be sent, the page says that instead, with the network
 * check and a way back.
 *
 * Every other error is thrown on, during render, to `[locale]/error.tsx` — the boundary the
 * backoffice always had, with its reference number (§52). Nothing about it changes.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("Network");
  const [phase, setPhase] = useState<"sending" | "blocked">("sending");
  // One replay per failure, even when a development build runs the effect twice.
  const started = useRef(false);
  const failure = transportFailureOf(error);

  useEffect(() => {
    if (!failure || started.current) return;
    started.current = true;
    const press = takeSubmission();
    void (press ? replayNatively(press) : Promise.resolve(false)).then((left) => {
      if (!left) setPhase("blocked");
    });
  }, [failure]);

  if (!failure) throw error;

  if (phase === "sending") {
    return (
      <Alert severity="info" role="status" data-testid="save-replaying">
        {t("replaying")}
      </Alert>
    );
  }
  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <SaveBlockedNotice kept={false} />
      <Button variant="outlined" onClick={reset} sx={TAP_TARGET}>
        {t("retry")}
      </Button>
    </Stack>
  );
}
