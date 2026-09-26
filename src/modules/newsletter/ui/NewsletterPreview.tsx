"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Language = "ro" | "en";
type Result = { subject: string; html: string } | null;

type Props = {
  /** The server's render of the words as they stand (`previewNewsletterAction`); null when it cannot. */
  preview: (input: { language: Language; subjectRo: string; subjectEn: string; bodyRo: string; bodyEn: string }) => Promise<Result>;
  labels: { title: string; help: string; ro: string; en: string; loading: string; unavailable: string; subject: string };
};

/**
 * The composer's preview (§NNN, "previewed" in the brief): two buttons — the Romanian subscriber's
 * copy, the English one — that ask the server to render the four boxes as they stand through the
 * template the outbox sends with, and show it sandboxed like every `/admin/emails` preview (§91).
 * It reads the boxes of the form it sits in by name, so the composer stays a Server Component and
 * this island draws only itself. Answers that arrive out of order are dropped. Without JavaScript
 * there is no preview, and the form still sends.
 */
export default function NewsletterPreview({ preview, labels }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const asked = useRef(0);
  const [shown, setShown] = useState<{ state: "idle" | "loading" | "ready" | "unavailable"; result: Result }>({ state: "idle", result: null });

  const show = (language: Language) => {
    const form = root.current?.closest("form");
    const box = (name: string) => form?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value ?? "";
    const ticket = ++asked.current;
    setShown({ state: "loading", result: null });
    preview({ language, subjectRo: box("subjectRo"), subjectEn: box("subjectEn"), bodyRo: box("bodyRo"), bodyEn: box("bodyEn") })
      .then((result) => {
        if (ticket === asked.current) setShown(result ? { state: "ready", result } : { state: "unavailable", result: null });
      })
      .catch(() => {
        if (ticket === asked.current) setShown({ state: "unavailable", result: null });
      });
  };

  return (
    <Box ref={root} data-testid="newsletter-preview">
      <Typography variant="subtitle2" component="h4" sx={{ fontWeight: 600 }}>
        {labels.title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {labels.help}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
        <Button type="button" variant="outlined" onClick={() => show("ro")} sx={TAP_TARGET}>
          {labels.ro}
        </Button>
        <Button type="button" variant="outlined" onClick={() => show("en")} sx={TAP_TARGET}>
          {labels.en}
        </Button>
      </Stack>
      {shown.state === "loading" && (
        <Typography variant="body2" color="text.secondary">
          {labels.loading}
        </Typography>
      )}
      {shown.state === "unavailable" && <Alert severity="info">{labels.unavailable}</Alert>}
      {shown.result && (
        <>
          <Typography variant="body2" sx={{ mb: 1, wordBreak: "break-word" }} data-testid="newsletter-preview-subject">
            {labels.subject}: {shown.result.subject}
          </Typography>
          {/* Sandboxed: an email has its own `<html>` and styles and must not inherit the backoffice's (§91). */}
          <Box
            component="iframe"
            srcDoc={shown.result.html}
            sandbox=""
            title={labels.title}
            sx={{ width: "100%", height: 560, border: 1, borderColor: "divider", borderRadius: 1 }}
          />
        </>
      )}
    </Box>
  );
}
