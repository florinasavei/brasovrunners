import UnsubscribeIcon from "@mui/icons-material/Unsubscribe";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { RejectedEmailWords } from "./rejected-email-words";

/** The ink of each tone: red for an address that refuses mail, amber for an email owed, grey for one that waits. */
const TONE_COLOR: Record<RejectedEmailWords["tone"], string> = {
  error: "error.main",
  warning: "warning.dark",
  info: "text.secondary",
};

/**
 * The registration's email state in one line under the name (§NNN; the owner, 2026-10-07: «Cum e posibil
 * să fie email respins dar și confirmat? Am nevoie de mai multe info in app»): «Adresa nu există ·
 * Confirmarea cu QR · 3 oct.», itself a link to the registration's «Emailuri», where the whole story is.
 *
 * It replaced «Email respins» and its tooltip island on the list: one plain link per flagged row, a Server
 * Component with nothing to hydrate, which a keyboard reaches and a touch follows. The glyph is the filter's
 * («Doar cu un email respins»). `flexBasis: 100%` puts it under the name in the name cell's wrapping row,
 * not among the chips, and its weight is the body's — the cell is a bold heading on a phone's card. The
 * link is at least 44 pixels tall (BR-REQ-041-01 criterion 6); each part of the line is unbreakable, so it
 * wraps only between two parts, never inside one: the common line takes one line at 400 pixels, the longest
 * two at most at 360 and at 400.
 */
export default function EmailStateLine({ href, words, testId = "email-state-line" }: { href: string; words: Pick<RejectedEmailWords, "line" | "tone">; testId?: string }) {
  return (
    <Box
      component="a"
      href={href}
      data-testid={testId}
      data-tone={words.tone}
      sx={{
        flexBasis: "100%",
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        minHeight: 44,
        color: TONE_COLOR[words.tone],
        textDecoration: "none",
        "&:hover, &:focus-visible": { textDecoration: "underline" },
      }}
    >
      <UnsubscribeIcon aria-hidden fontSize="small" sx={{ flexShrink: 0 }} />
      <Typography component="span" variant="body2" sx={{ fontWeight: 400, color: "inherit" }}>
        {words.line}
      </Typography>
    </Box>
  );
}
