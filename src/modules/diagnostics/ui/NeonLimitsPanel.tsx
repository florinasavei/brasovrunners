import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { updateNeonLimitsAction } from "@/app/[locale]/admin/tasks/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import {
  describeNeonLimits,
  NEON_MAX_CU_STEPS,
  NEON_MIN_CU,
  NEON_QUOTA_MARGIN_CU_HOURS,
  type NeonLimitsReading,
  offeredCeilings,
  quotaBoxValue,
  recommendedNeonQuotaCuHours,
} from "@/modules/diagnostics/domain/neon-limits";
import { NEON_PLANS } from "@/modules/diagnostics/domain/neon-plan";
import type { NeonFailure } from "@/modules/diagnostics/neon";
import type { AppEnvironment } from "@/shared/config/env-enums";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  /** What Neon said when the page asked (`readNeonLimits`), or why it said nothing usable. */
  reading: { ok: true; limits: NeonLimitsReading } | { ok: false; failure: NeonFailure };
  /**
   * Which limit the card recommends (`recommendedNeonQuotaCuHours`, `SETUP.md` §40), and whether a
   * new, changed or removed limit asks for the ticked confirmation — production's guard, because
   * reaching the limit suspends the site and removing it leaves production uncapped (§335, §327).
   */
  appEnv: AppEnvironment;
  /** The Administrator's form; `updateNeonLimits` refuses anybody else whatever this says (§291). */
  mayEdit: boolean;
};

/**
 * "Limitele bazei de date" — the two brakes on the Neon bill, beside the Neon plan (§335; the
 * owner, 2026-09-23: "I want toggles in my admin area, so I can throttle myself when needed").
 *
 * Three states, and only the last has a form: no key (what is missing, and where it goes), a read
 * that failed (one sentence, because a limit cannot be checked against usage nobody could read),
 * and the values Neon holds — the ceiling with its memory and its worst hour and month at
 * Launch's rate from the one catalogue, the limit, this period's hours — above the form that
 * changes them. Every figure is read from Neon on each render, so after a save the card shows
 * what Neon now says, never what was sent.
 *
 * A Server Component with one form, the Neon plan panel's shape: native selects, a plain box for
 * the number (a Romanian keyboard types a decimal comma, which `type="number"` refuses), and the
 * confirmation as a `CheckboxField` whose label is a string (the element made on the client side
 * of the boundary). The warning about the limit is not folded: it is the point of the form.
 */
export default async function NeonLimitsPanel({ locale, reading, appEnv, mayEdit }: Props) {
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const cu = (value: number) => format.number(value, { maximumFractionDigits: 2 });
  const hours = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  const usd = (value: number) => format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usdPerHour = (value: number) => format.number(value, { maximumFractionDigits: 3 });
  // The period's end, with its weekday, inside the sentence ("până pe luni, 12 oct. 2026"), in
  // the club's zone (§NNN weekday on every date).
  const day = (value: Date) => formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" });
  const production = appEnv === "production";
  const rate = NEON_PLANS.LAUNCH.usdPerCuHour;

  if (!reading.ok) {
    const { failure } = reading;
    return (
      <Panel title={t("tasks.neonLimits.title")} intro={t("tasks.neonLimits.intro")} data-testid="neon-limits">
        {failure.kind === "unconfigured" ? (
          <Typography variant="body2" data-testid="neon-limits-unconfigured">
            {t("tasks.neonLimits.unconfigured", { missing: failure.missing.join(", ") })}
          </Typography>
        ) : (
          <Typography variant="body2" data-testid="neon-limits-failed">
            {t(`tasks.neonLimits.failure.${failure.kind}`, { status: "status" in failure ? failure.status : "" })}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("tasks.neonLimits.keyNeeded")}
        </Typography>
      </Panel>
    );
  }

  const limits = reading.limits;
  const model = describeNeonLimits(limits);
  const ceilings = offeredCeilings(limits.reportedPlan);
  const currentIsOffered = model.maxCu !== null && ceilings.some((ceiling) => ceiling.cu === model.maxCu);
  const periodEnd = day(model.periodEnd);

  return (
    <Panel title={t("tasks.neonLimits.title")} intro={t("tasks.neonLimits.intro")} data-testid="neon-limits">
      {/* What Neon holds now, in words: the ceiling and its memory, and the limit. */}
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="neon-limits-readout">
        {t("tasks.neonLimits.readout", {
          size:
            model.price === null
              ? t("tasks.neonLimits.sizeUnknown")
              : t("tasks.neonLimits.size", { cu: cu(model.price.cu), ram: cu(model.price.ramGb) }),
          quota: model.quotaCuHours === null ? t("tasks.neonLimits.quotaNone") : t("tasks.neonLimits.quotaSet", { hours: hours(model.quotaCuHours) }),
        })}
      </Typography>
      {model.price && (
        <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="neon-limits-price">
          {t("tasks.neonLimits.price", { rate: usdPerHour(rate), perHour: usdPerHour(model.price.usdPerHour), perMonth: usd(model.price.usdPerMonth) })}
        </Typography>
      )}
      <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="neon-limits-usage">
        {t("tasks.neonLimits.usage", { used: hours(model.usedCuHours), active: hours(model.activeHours), end: periodEnd })}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }} data-testid="neon-limits-defaults">
        {model.defaults.maxCu === null
          ? t("tasks.neonLimits.defaultsUnset")
          : t("tasks.neonLimits.defaults", { min: cu(model.defaults.minCu ?? NEON_MIN_CU), max: cu(model.defaults.maxCu) })}
        {model.computeCount > 1 && ` ${t("tasks.neonLimits.manyComputes", { count: model.computeCount })}`}
      </Typography>
      {model.quotaCuHours !== null && (
        <Alert severity="warning" sx={{ mt: 1 }} data-testid="neon-limits-quota-active">
          {t("tasks.neonLimits.quotaActive", { hours: hours(model.quotaCuHours), used: hours(model.usedCuHours), end: periodEnd })}
        </Alert>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("tasks.neonLimits.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateNeonLimitsAction}
            messages={await refusalMessages(
              {
                maxCu: t("tasks.neonLimits.maxCu"),
                quotaMode: t("tasks.neonLimits.quotaMode"),
                quotaCuHours: t("tasks.neonLimits.quotaCuHours"),
                confirmSuspension: t("tasks.neonLimits.confirmField"),
              },
              { confirmation: production },
            )}
            scope="neonLimits"
            data-testid="neon-limits-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
              <RecallField
                select
                name="maxCu"
                label={t("tasks.neonLimits.maxCu")}
                defaultValue={currentIsOffered ? String(model.maxCu) : ""}
                slotProps={{ select: { native: true } }}
                helperText={t("tasks.neonLimits.maxCuHelp", { min: cu(NEON_MIN_CU) })}
              >
                {/* A ceiling Neon holds that is not one of the six is not silently replaced by the first. */}
                {!currentIsOffered && <option value="">{t("tasks.neonLimits.choose")}</option>}
                {ceilings.map((ceiling) => (
                  <option key={ceiling.cu} value={String(ceiling.cu)}>
                    {t("tasks.neonLimits.option", {
                      cu: cu(ceiling.cu),
                      ram: cu(ceiling.ramGb),
                      perHour: usdPerHour(ceiling.usdPerHour),
                      perMonth: usd(ceiling.usdPerMonth),
                    })}
                  </option>
                ))}
              </RecallField>
              {ceilings.length < NEON_MAX_CU_STEPS.length && (
                <Typography variant="caption" color="text.secondary">
                  {t("tasks.neonLimits.planCeiling", { max: cu(ceilings[ceilings.length - 1]?.cu ?? NEON_MIN_CU) })}
                </Typography>
              )}

              {/* The warning is the form's reason to exist: never folded, above the box it is about. */}
              <Alert severity="error" data-testid="neon-limits-warning">
                <AlertTitle>{t("tasks.neonLimits.warningTitle")}</AlertTitle>
                {t("tasks.neonLimits.warning", { end: periodEnd })}
              </Alert>
              {/*
                The advice is a limit with room plus Neon's spending notification, on every
                environment (the owner, 2026-09-23: production capped too; `SETUP.md` §40). The
                confirmation sentence is production's guard on the click, not advice against it.
              */}
              <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="neon-limits-recommendation">
                {t("tasks.neonLimits.recommend", { hours: hours(recommendedNeonQuotaCuHours(appEnv)) })}
                {production && ` ${t("tasks.neonLimits.recommendConfirm")}`}
              </Typography>

              <RecallField
                select
                name="quotaMode"
                label={t("tasks.neonLimits.quotaMode")}
                defaultValue={model.quotaCuHours === null ? "none" : "limit"}
                slotProps={{ select: { native: true } }}
              >
                <option value="none">{t("tasks.neonLimits.quotaModeNone")}</option>
                <option value="limit">{t("tasks.neonLimits.quotaModeLimit")}</option>
              </RecallField>
              <RecallField
                name="quotaCuHours"
                label={t("tasks.neonLimits.quotaCuHours")}
                // To the second Neon holds, so a save that changes only the size sends the limit back
                // unchanged — and `writeNeonLimits` then sends no quota at all.
                defaultValue={quotaBoxValue(model.quotaCuHours)}
                slotProps={{ htmlInput: { inputMode: "decimal", autoComplete: "off" } }}
                helperText={t("tasks.neonLimits.quotaCuHoursHelp", { smallest: hours(model.smallestQuotaCuHours) })}
              />
              {/* Outside the helper text on purpose: a refusal replaces that with "check this field", and this is the sentence that says why. */}
              <Typography variant="body2" color="text.secondary" data-testid="neon-limits-floor">
                {t("tasks.neonLimits.floor", {
                  used: hours(model.usedCuHours),
                  smallest: hours(model.smallestQuotaCuHours),
                  margin: NEON_QUOTA_MARGIN_CU_HOURS,
                })}
              </Typography>
              {production && (
                <CheckboxField name="confirmSuspension">{t("tasks.neonLimits.confirm", { end: periodEnd })}</CheckboxField>
              )}

              <Typography variant="caption" color="text.secondary">
                {t("tasks.neonLimits.writeNote")}
              </Typography>
              <Box>
                <GlyphSubmitButton label={t("tasks.neonLimits.save")} pendingLabel={t("tasks.neonLimits.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
