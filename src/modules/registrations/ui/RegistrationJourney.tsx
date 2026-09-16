import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";

/**
 * Where a runner is in the registration journey, and what happens next.
 *
 * Registration is four states and three of them are things the *participant* has to do
 * (AGENTS.md §10.5). Until now each page said only what to do on that page, so somebody who
 * closed the tab after submitting had no way to know whether they had a place, whether
 * anything was expected of them, or whether the club had heard from them at all. This is the
 * one component every page in that journey renders, so the answer is the same wherever they
 * are standing.
 *
 * Hand-rolled rather than MUI's `Stepper`: this needs to be three list items and no
 * interaction, it is rendered on a Server Component with no client island (`AGENTS.md` §1.5),
 * and an ordered list with `aria-current="step"` is what a screen reader wants anyway.
 *
 * Deliberately not driven by `registrations.status`: these pages are reached with a token that
 * names one purpose, and the page already knows which step it is. Reading the row would mean a
 * query per page load to render a heading.
 */
export type JourneyStep = "details" | "confirm" | "declare" | "done";

const ORDER: readonly JourneyStep[] = ["details", "confirm", "declare"];

export default async function RegistrationJourney({ current }: { current: JourneyStep }) {
  const t = await getTranslations("Registration.journey");

  const currentIndex = current === "done" ? ORDER.length : ORDER.indexOf(current);

  return (
    <Box sx={{ mb: 3 }}>
      <Box
        component="ol"
        sx={{
          listStyle: "none",
          display: "flex",
          flexWrap: "wrap",
          gap: { xs: 1, sm: 2 },
          m: 0,
          p: 0,
        }}
      >
        {ORDER.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;

          return (
            <Box
              component="li"
              key={step}
              aria-current={active ? "step" : undefined}
              sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}
            >
              {/*
                The number is decorative: the label beside it already says what the step is, and
                a screen reader reading "1 2 3" before each name is noise. `aria-current` is what
                carries "you are here".
              */}
              <Box
                aria-hidden="true"
                sx={{
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  bgcolor: done || active ? "primary.main" : "action.disabledBackground",
                  color: done || active ? "primary.contrastText" : "text.disabled",
                }}
              >
                {done ? "✓" : index + 1}
              </Box>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: active ? 600 : 400,
                  color: active ? "text.primary" : "text.secondary",
                }}
              >
                {t(`steps.${step}`)}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/*
        What is happening now, in a sentence. On the confirmation step it carries the delivery
        expectation: the outbox is drained by a scheduler every five minutes (AGENTS.md §16.2),
        so a message that has not arrived after thirty seconds is not lost and the page should
        say so before somebody registers a second time.
      */}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        {t(`now.${current}`)}
      </Typography>
    </Box>
  );
}
