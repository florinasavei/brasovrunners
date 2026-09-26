import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { FamilyStep } from "../domain/family-signing";

/**
 * The family's declarations as a stepper (§NNN): one line per person on the address, in the order
 * they are signed — a tick for a person signed, the person signed now in bold, the others after.
 *
 * Hand-rolled like `RegistrationJourney`, for its reasons: a list and no interaction, on a Server
 * Component with no client island, and an ordered list with `aria-current="step"` is what a screen
 * reader wants. Each line says its state in words too, never by the tick or the weight alone.
 */
export default async function FamilySigningSteps({ steps }: { steps: readonly FamilyStep[] }) {
  const t = await getTranslations("Registrations");

  const stateWords = (step: FamilyStep) =>
    step.state === "signed"
      ? step.status === "WAITLISTED"
        ? t("declare.family.state.waitlisted")
        : t("declare.family.state.signed")
      : t(`declare.family.state.${step.state}`);

  return (
    <Box
      component="ol"
      aria-label={t("declare.family.stepsLabel")}
      data-testid="family-signing-steps"
      sx={{ listStyle: "none", m: 0, mb: 3, p: 0, display: "grid", gap: 1 }}
    >
      {steps.map((step, index) => {
        const active = step.state === "current";
        const signed = step.state === "signed";
        return (
          <Box
            component="li"
            key={step.id}
            aria-current={active ? "step" : undefined}
            data-state={step.state}
            sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}
          >
            {/* Decorative: the words beside it say the state (see the component's note). */}
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
                bgcolor: signed || active ? "primary.main" : "action.disabledBackground",
                color: signed || active ? "primary.contrastText" : "text.disabled",
              }}
            >
              {signed ? "✓" : index + 1}
            </Box>
            <Typography
              variant="body2"
              sx={{ fontWeight: active ? 600 : 400, color: active ? "text.primary" : "text.secondary", minWidth: 0, overflowWrap: "anywhere" }}
            >
              {step.registeredName} · {stateWords(step)}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
