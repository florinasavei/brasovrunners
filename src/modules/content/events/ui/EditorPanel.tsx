import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/**
 * One boxed, open section of the editor (`DECISIONS.md` §170).
 *
 * The editor was a single column of forty fields under two headings, and the owner asked for
 * "a WordPress-like editor": the words first, the settings after them in named panels, and
 * publication in its own column. This is the panel — a border, a title, an optional sentence,
 * and nothing else.
 *
 * **Open, not folded.** A `<details>` would hide a required field from somebody who has never
 * seen this screen, and the one thing a publication refusal must never be is a field nobody
 * knew was there. The fold is for what is genuinely optional (SEO), and it is written as a
 * `<details>` where it is used rather than offered here.
 *
 * A Server Component: it holds no state, so it costs the client nothing.
 */
export default function EditorPanel({
  title,
  help,
  children,
  headingId,
}: {
  title: string;
  /** One sentence under the title, when the panel needs one. */
  help?: string;
  children: ReactNode;
  headingId?: string;
}) {
  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        p: { xs: 2, sm: 2.5 },
        bgcolor: "background.paper",
      }}
    >
      <Typography id={headingId} variant="h2" sx={{ fontSize: "1.05rem", mb: help ? 0.5 : 2 }}>
        {title}
      </Typography>
      {help && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {help}
        </Typography>
      )}
      {children}
    </Box>
  );
}
