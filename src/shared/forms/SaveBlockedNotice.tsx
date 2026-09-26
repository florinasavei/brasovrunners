"use client";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * What a blocked save says (§436), in the order the person acts on it: what happened and what is
 * still here; when NOT to press (a save that already said "saved" is in — the version check does
 * not protect a cancel, an erase or a message sent twice); the one button that sends the form the
 * simple way; and the page that names what to ask the office's IT to let through.
 *
 * The button is the only thing that sends anything. `onSend` is the replay (`replayNatively`) with
 * the press it belongs to; while it leaves, the button says «Se trimite…» and the next page
 * replaces this one. When even that cannot be sent, the notice says so and points at the phone.
 * Drawn by `ActionFormIsland` inside the form, above its refusal summary, and by the admin error
 * boundary for a plain form — only in the browser, after a failure, so a page that never meets one
 * never loads a word of it.
 */
export default function SaveBlockedNotice({ kept = true, onSend }: { kept?: boolean; onSend: () => Promise<boolean> }) {
  const t = useTranslations("Network");
  const [phase, setPhase] = useState<"offer" | "sending" | "failed">("offer");

  const send = () => {
    if (phase !== "offer") return;
    setPhase("sending");
    void onSend().then(
      (left) => {
        if (!left) setPhase("failed");
      },
      () => setPhase("failed"),
    );
  };

  return (
    <Alert severity="warning" sx={{ mb: 3 }} data-testid="save-blocked">
      <AlertTitle>{t("blocked.title")}</AlertTitle>
      <Box component="p" sx={{ m: 0 }}>
        {kept ? t("blocked.kept") : t("blocked.notKept")}
      </Box>
      {phase === "failed" ? (
        <Box component="p" sx={{ m: 0, mt: 1 }} data-testid="save-blocked-failed">
          {t("blocked.failed")}
        </Box>
      ) : (
        <>
          <Box component="p" sx={{ m: 0, mt: 1, fontWeight: 600 }}>
            {t("blocked.already")}
          </Box>
          <GlyphButton
            icon="send"
            type="button"
            variant="outlined"
            color="inherit"
            onClick={send}
            disabled={phase === "sending"}
            sx={{ ...TAP_TARGET, mt: 1 }}
            data-testid="save-simple"
          >
            {phase === "sending" ? t("blocked.sending") : t("blocked.send")}
          </GlyphButton>
        </>
      )}
      <Box component="p" sx={{ m: 0, mt: 1 }}>
        <MuiLink component={Link} href="/admin/network" color="inherit" sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          {t("check")}
        </MuiLink>
      </Box>
    </Alert>
  );
}
