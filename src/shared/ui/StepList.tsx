import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/**
 * The house's list of steps: a numbered `ol`, each step a glyph in a round disc, a title and a few plain words under it
 * (`DECISIONS.md` §91, the registration's «Cum funcționează înscrierea»; §NNN, the volunteers' page draws the same list). One place
 * for the shape, so the registration form, its «Aproape gata» screen and the volunteers' page cannot drift apart: a reader who saw
 * the steps on the form recognises them on the screen after it.
 *
 * Server Components: the glyph is passed as a rendered element between two of them, never to a client island (`GlyphChip.tsx`
 * is for that). The disc is decoration (`aria-hidden`); the number is in the title, the words say the rest, so the state is
 * never in colour alone.
 */
export function StepList({ children }: { children: ReactNode }) {
  return (
    <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
      {children}
    </Stack>
  );
}

/**
 * One step. `tone="primary"` is a step on the way (the brand colour); `"quiet"` an aside beside it — the waiting list, a
 * family — or a step still ahead on the screen after the form.
 */
export function StepItem({
  icon,
  title,
  body,
  tone = "primary",
  testId,
}: {
  icon: ReactNode;
  title: ReactNode;
  body: ReactNode;
  tone?: "primary" | "quiet";
  testId?: string;
}) {
  return (
    <Box component="li" sx={{ display: "grid", gridTemplateColumns: "40px 1fr", columnGap: 1.5, alignItems: "start" }} data-testid={testId}>
      <Box
        aria-hidden="true"
        sx={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          bgcolor: tone === "primary" ? "primary.main" : "action.selected",
          color: tone === "primary" ? "primary.contrastText" : "text.primary",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {body}
        </Typography>
      </Box>
    </Box>
  );
}
