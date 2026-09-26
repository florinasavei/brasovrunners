import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { env } from "@/shared/config/env";
import type { FamilyStep } from "../domain/family-signing";

/**
 * The family's declarations as a stepper (§NNN): one line per person on the address, in the order
 * they are signed — a tick for a person signed, the person signed now in bold, the others after.
 *
 * Hand-rolled like `RegistrationJourney`, for its reasons: a list and no interaction, on a Server
 * Component with no client island, and an ordered list with `aria-current="step"` is what a screen
 * reader wants. Each line says its state in words too, never by the tick or the weight alone.
 *
 * `detailed` is the last screen (§NNN, found in review): under each name, what happens next for
 * that person — a confirmed person's desk code and QR (the same picture «Înscrierile mele» shows,
 * §77), the waiting list, or the link that still signs a person left for later.
 */
export default async function FamilySigningSteps({ steps, detailed = false }: { steps: readonly FamilyStep[]; detailed?: boolean }) {
  const t = await getTranslations("Registrations");

  const stateWords = (step: FamilyStep) =>
    step.state === "signed"
      ? step.status === "WAITLISTED"
        ? t("declare.family.state.waitlisted")
        : t("declare.family.state.signed")
      : t(`declare.family.state.${step.state}`);

  const whatNext = (step: FamilyStep) => {
    if (step.status === "CONFIRMED" && step.checkinCode) return t("declare.family.what.confirmed", { code: step.checkinCode });
    if (step.status === "WAITLISTED") return t("declare.family.what.waitlisted");
    if (step.state === "later") return t("declare.family.what.later");
    if (step.state === "closed") return t("declare.family.what.closed");
    return null;
  };

  return (
    <Box
      component="ol"
      aria-label={t("declare.family.stepsLabel")}
      data-testid="family-signing-steps"
      sx={{ listStyle: "none", m: 0, mb: 3, p: 0, display: "grid", gap: detailed ? 2 : 1 }}
    >
      {steps.map((step, index) => {
        const active = step.state === "current";
        const signed = step.state === "signed";
        const next = detailed ? whatNext(step) : null;
        const qr = detailed && step.status === "CONFIRMED" && step.checkinCode ? step.checkinCode : null;
        return (
          <Box component="li" key={step.id} aria-current={active ? "step" : undefined} data-state={step.state} sx={{ minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
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
                sx={{ fontWeight: active || detailed ? 600 : 400, color: active || detailed ? "text.primary" : "text.secondary", minWidth: 0, overflowWrap: "anywhere" }}
              >
                {step.registeredName} · {stateWords(step)}
              </Typography>
            </Box>
            {(next || qr) && (
              <Box sx={{ pl: 4, mt: 0.5, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 }}>
                {qr && (
                  <Box
                    component="img"
                    src={`${env.APP_BASE_URL}/api/registrations/qr/${qr}.png`}
                    alt={t("manage.qrAlt", { code: qr })}
                    width={96}
                    height={96}
                    loading="lazy"
                    sx={{ width: 96, height: 96, border: 1, borderColor: "divider", borderRadius: 1 }}
                  />
                )}
                {next && (
                  <Typography variant="body2" color="text.secondary" sx={{ flex: "1 1 12rem", minWidth: 0 }} data-testid="family-signing-next">
                    {next}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
