import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { JOURNEY_STEPS, type Journey, type JourneyStep } from "@/modules/registrations/domain/journey";
import { JOURNEY_STEP_LABEL } from "@/modules/staff-identity/domain/staff-labels";

/**
 * One registration's journey, for the backoffice (`DECISIONS.md` §145): the six steps of
 * `domain/journey.ts` as a list on the registration's page, or as one short cell in the
 * registrations list — "3/6 · Loc rezervat".
 *
 * Modelled on `RegistrationJourney.tsx`, the participant's own: a hand-rolled `<ol>` with
 * `aria-current="step"`, not MUI's `Stepper`, rendered on the server with no client island.
 * Where that one is told its step by the page, this one is handed the derived journey, so the
 * list and the page read the same row the same way.
 *
 * The six step names are names for the lifecycle's states, like the status chip beside them,
 * so they live in `staff-labels.ts` in Romanian, once (§35). The sentences around them — the
 * deadline, the number, "urmează: …", how the row ended — are chrome, and stay in both
 * catalogues.
 */
type Props = {
  journey: Journey;
  /** The race number, for "nr. 42" and "a ridicat nr. 42". */
  bibNumber: number | null;
  variant: "full" | "compact";
};

const DATE = { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" } as const;

export default async function StaffJourney({ journey, bibNumber, variant }: Props) {
  const t = await getTranslations("Admin");
  const format = await getFormatter();

  const label = JOURNEY_STEP_LABEL;
  const when = (value: Date | null | undefined) => (value ? format.dateTime(value, DATE) : null);

  /** The words a step adds beside its name; null when it has nothing to add. */
  const detailOf = (step: JourneyStep): string | null => {
    switch (step.detail) {
      case "held":
        return step.until ? t("registrations.journey.held", { until: when(step.until) ?? "" }) : null;
      case "offered":
        return step.until ? t("registrations.journey.offered", { until: when(step.until) ?? "" }) : null;
      case "waitlisted":
        return t("registrations.journey.waitlisted");
      case "bib":
        return bibNumber !== null ? t("registrations.journey.bib", { number: bibNumber }) : null;
      case "pickedUp":
        return bibNumber !== null ? t("registrations.journey.pickedUp", { number: bibNumber }) : null;
      default:
        return null;
    }
  };

  const outcome =
    journey.outcome === "cancelled"
      ? t("registrations.journey.cancelledAt", { date: when(journey.outcomeAt) ?? "" })
      : journey.outcome === "expired"
        ? t("registrations.journey.expiredAt", { date: when(journey.outcomeAt) ?? "" })
        : null;

  if (variant === "compact") {
    const total = JOURNEY_STEPS.length;
    const last = journey.steps[journey.steps.length - 1];
    // What the cell says after the count is the last step that is *done* — always a fact,
    // where naming the step being waited on would read as its opposite ("Declarație semnată"
    // on a row that is waiting for exactly that). When every step is done, the number that was
    // picked up. How the row ended is the status chip's job; the hover title repeats it, and
    // says what comes next.
    const word = journey.done === total ? (detailOf(last) ?? label[last.key]) : label[journey.reached];
    const title = journey.outcome
      ? `${t("registrations.journey.progress", { done: journey.done, total })} · ${outcome}`
      : journey.current
        ? `${t("registrations.journey.progress", { done: journey.done, total })} · ${t("registrations.journey.next", { step: label[journey.current] })}`
        : t("registrations.journey.complete");

    return (
      <Box component="span" title={title} sx={{ whiteSpace: "nowrap", color: journey.outcome ? "text.secondary" : "text.primary" }}>
        {journey.done}/{total} · {word}
      </Box>
    );
  }

  return (
    <Box component="section" aria-label={t("registrations.journey.title")}>
      <Box
        component="ol"
        sx={{
          listStyle: "none",
          display: "flex",
          flexWrap: "wrap",
          gap: { xs: 1.5, sm: 2.5 },
          m: 0,
          p: 0,
        }}
      >
        {journey.steps.map((step, index) => {
          const done = step.state === "done";
          const active = step.state === "current";
          const skipped = step.state === "skipped";
          const detail = detailOf(step);
          const date = done || active ? when(step.at) : null;
          const caption = [date, detail].filter((part) => part !== null).join(" · ");

          return (
            <Box
              component="li"
              key={step.key}
              aria-current={active ? "step" : undefined}
              sx={{ display: "flex", alignItems: "flex-start", gap: 1, minWidth: 0 }}
            >
              {/* Decorative, as on the participant's journey: the label says what the step is
                  and `aria-current` says where the person is. */}
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
                {done ? "✓" : skipped ? "–" : index + 1}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: active ? 600 : 400,
                    color: active || done ? "text.primary" : skipped ? "text.disabled" : "text.secondary",
                    textDecoration: skipped ? "line-through" : "none",
                  }}
                >
                  {label[step.key]}
                </Typography>
                {caption && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {caption}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
      {outcome && (
        <Typography variant="body2" sx={{ mt: 1, color: "error.main", fontWeight: 600 }}>
          {outcome}
        </Typography>
      )}
    </Box>
  );
}
