"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslations } from "next-intl";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * What a visitor sees when something under `[locale]` throws (AGENTS.md §14.3, `DECISIONS.md` §52).
 *
 * Until this existed there was no error boundary anywhere in the application, so any unhandled
 * throw — a database blip, a cold start, the pool's `statement_timeout` — gave a stranger Next's
 * default production page: "Application error: a server-side exception has occurred", unstyled,
 * in English, with no way back and no hint whether to try again.
 *
 * ## A Client Component, because Next requires it
 *
 * Not a choice (`AGENTS.md` §1.5 keeps islands rare). It is kept to what a boundary needs and
 * nothing follows it across: no data fetching, no repository, no `getDb`. An error page that
 * can itself throw is the one failure with no recovery left.
 *
 * ## Why it shows `digest` and generates no id of its own
 *
 * The decision recorded in §52 was whether to show a correlation id, and the answer is that one
 * already exists. Next hashes every server error into `digest`, logs it beside the stack, and
 * hands it here — so a runner can say "it said 2060393594" and the owner can find that line,
 * with no id generator, no new logging, and no chance of writing a participant's address into a
 * log to make it findable (§14.5). What it must never do is show the message or the stack: those
 * carry SQL, provider text and sometimes an address (§14.3).
 *
 * ## Why there is a retry
 *
 * Next hands a boundary `reset()`, and the failures this application will actually meet — a Neon
 * instance waking from scale-to-zero, a dropped connection — are the kind a second attempt
 * fixes. The button says "try again" rather than promising it will work.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Error");

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 4, sm: 8 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title")}
      </Typography>
      <Typography variant="body1" sx={{ mb: 3 }}>
        {t("body")}
      </Typography>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3 }}>
        <Button variant="contained" onClick={reset} sx={TAP_TARGET}>
          {t("retry")}
        </Button>
        {/*
          A plain anchor, not the locale-aware `Link`. This boundary can catch a failure in the
          very routing it would need to build a localized href, and the one thing this page must
          do is work. `/` is served by the proxy, which sends it to the reader's own locale.
        */}
        <Button component="a" href="/" variant="outlined" sx={TAP_TARGET}>
          {t("home")}
        </Button>
      </Stack>

      {/*
        The reference, and only when Next produced one. An empty "reference:" line teaches a
        visitor to quote nothing.
      */}
      {error.digest && (
        <Alert severity="info" icon={false}>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {t("reference")}
          </Typography>
          <Box component="code" sx={{ fontFamily: "monospace", fontSize: "1rem" }}>
            {error.digest}
          </Box>
        </Alert>
      )}
    </Container>
  );
}
