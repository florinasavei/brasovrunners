import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { updateNeonLimitsAction } from "@/app/[locale]/admin/tasks/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import {
  describeNeonLimits,
  NEON_ALWAYS_ON_ALLOWED,
  NEON_MAX_CU_STEPS,
  NEON_MIN_CU,
  NEON_SUSPEND_MODES,
  type NeonComputeSettings,
  type NeonLimitsReading,
  neonLimitsMoney,
  type NeonSuspendMode,
  offeredCeilings,
  quotaBoxValue,
  recommendedNeonQuotaCuHours,
} from "@/modules/diagnostics/domain/neon-limits";
import { NEON_PLANS, type NeonPlanId } from "@/modules/diagnostics/domain/neon-plan";
import type { NeonFailure } from "@/modules/diagnostics/neon";
import type { AppEnvironment } from "@/shared/config/env-enums";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";

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
  /** The heading's level: 2 on its own, 3 inside Costuri's «Baza de date» card (§479). */
  level?: 2 | 3;
};

/**
 * The sentence the confirmation adds for one choice of the compute's settings (§479): what the
 * change does to the month's bill at the plan Neon reports (Launch's rate in USD; on Free, that it
 * costs nothing until the plan's included hours are spent), or that it changes nothing. A plan the
 * page does not know is priced at Launch, the one that bills. Exported for the test that holds the
 * words to the money, per plan.
 */
export function moneySentence(
  t: (key: string, values?: Record<string, string>) => string,
  format: { number: (value: number, options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }) => string },
  before: NeonComputeSettings,
  after: NeonComputeSettings,
  plan: NeonPlanId | null,
): string {
  const money = neonLimitsMoney(before, after, plan);
  const cu = (value: number) => format.number(Math.abs(value), { maximumFractionDigits: 2 });
  const usd = (value: number) => format.number(Math.abs(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const changes = money.ceiling.deltaCu !== 0 || money.floor.deltaCu !== 0 || before.suspendMode !== after.suspendMode;
  if (money.plan === "FREE") {
    return changes
      ? t("tasks.neonLimits.money.free", { hours: format.number(NEON_PLANS.FREE.cuHoursPerMonth ?? 0, { maximumFractionDigits: 0 }) })
      : t("tasks.neonLimits.money.same");
  }
  const parts: string[] = [];
  if (money.ceiling.deltaCu !== 0) {
    parts.push(
      t(money.ceiling.deltaCu > 0 ? "tasks.neonLimits.money.ceilingUp" : "tasks.neonLimits.money.ceilingDown", {
        cu: cu(money.ceiling.deltaCu),
        usd: usd(money.ceiling.deltaUsdPerMonth),
      }),
    );
  }
  if (money.floor.deltaCu !== 0) {
    parts.push(
      t(money.floor.deltaCu > 0 ? "tasks.neonLimits.money.floorUp" : "tasks.neonLimits.money.floorDown", {
        cu: cu(money.floor.deltaCu),
        usd: usd(money.floor.deltaUsdPerMonth),
      }),
    );
  }
  if (after.suspendMode === "never") {
    parts.push(t("tasks.neonLimits.money.alwaysOn", { usd: usd(money.idleMonth.afterUsd), min: cu(after.minCu) }));
  } else if (before.suspendMode === "never") {
    parts.push(t("tasks.neonLimits.money.sleepsAgain", { usd: usd(money.idleMonth.beforeUsd) }));
  }
  return parts.length > 0 ? parts.join(" ") : t("tasks.neonLimits.money.same");
}

/**
 * "Limitele bazei de date" — the two brakes on the Neon bill, beside the Neon plan (§335; the
 * owner, 2026-09-23: "I want toggles in my admin area, so I can throttle myself when needed").
 * Since §479 also the compute's floor and scale to zero, with the confirmation naming what the
 * chosen settings do to the month's bill before anything is sent.
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
 * of the boundary). The limit's part is the owner's four things and nothing else (§NNN): the
 * label, «Fără limită / Cu limită», the number and one sentence; what else it could say is a «?».
 */
export default async function NeonLimitsPanel({ locale, reading, appEnv, mayEdit, level = 2 }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const format = await getFormatter();
  const cu = (value: number) => format.number(value, { maximumFractionDigits: 2 });
  const hours = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  const usd = (value: number) => format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usdPerHour = (value: number) => format.number(value, { maximumFractionDigits: 3 });
  // The period's end, with its weekday, inside the sentence ("până luni, 12 oct. 2026", §452), in
  // the club's zone (§350 weekday on every date).
  const day = (value: Date) => formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" });
  const production = appEnv === "production";
  const rate = NEON_PLANS.LAUNCH.usdPerCuHour;

  if (!reading.ok) {
    const { failure } = reading;
    return (
      <Panel
        level={level}
        title={t("tasks.neonLimits.title")}
        intro={t("tasks.neonLimits.intro")}
        introMore={t("tasks.neonLimits.introMore")}
        data-testid="neon-limits"
      >
        {failure.kind === "unconfigured" ? (
          <Typography variant="body2" data-testid="neon-limits-unconfigured">
            {t("tasks.neonLimits.unconfigured", { missing: failure.missing.join(", ") })}
            <QuietHelp text={t("tasks.neonLimits.unconfiguredMore")} />
          </Typography>
        ) : (
          <Typography variant="body2" data-testid="neon-limits-failed">
            {t(`tasks.neonLimits.failure.${failure.kind}`, { status: "status" in failure ? failure.status : "" })}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("tasks.neonLimits.keyNeeded")}
          <QuietHelp text={t("tasks.neonLimits.keyNeededMore")} />
        </Typography>
      </Panel>
    );
  }

  const limits = reading.limits;
  const model = describeNeonLimits(limits);
  const ceilings = offeredCeilings(limits.reportedPlan);
  const currentIsOffered = model.maxCu !== null && ceilings.some((ceiling) => ceiling.cu === model.maxCu);
  const currentMin = model.minCu ?? NEON_MIN_CU;
  const minIsOffered = ceilings.some((ceiling) => ceiling.cu === currentMin);
  const alwaysOnAllowed = limits.reportedPlan === null || NEON_ALWAYS_ON_ALLOWED[limits.reportedPlan];
  const suspendModes: readonly NeonSuspendMode[] = alwaysOnAllowed || model.suspendMode === "never" ? NEON_SUSPEND_MODES : ["auto"];
  const periodEnd = day(model.periodEnd);

  /*
    The confirmation (§384) with the money in it (§479): one dialog per combination of the three
    selects and the limit's choice the form can post, each naming what that combination does to
    the month's bill against what Neon holds now — the dialog reads the form as it stands at the
    press. The limit is said first, in the owner's words (§NNN): «Limita nouă: 100 ore-CU.», the
    number filled from the box at the press (`fillFrom`). A combination the form cannot post (a
    ceiling not offered, a floor above the ceiling) falls through to the plain dialogs at the end.
  */
  const before: NeonComputeSettings = { minCu: currentMin, maxCu: model.maxCu ?? currentMin, suspendMode: model.suspendMode };
  const baseConfirm = {
    title: t("confirm.neonLimitsTitle"),
    confirmLabel: t("tasks.neonLimits.save"),
    cancelLabel: words.cancel,
    destructive: true,
  };
  // The limit's sentence per choice; `{quotaCuHours}` stays literal here and is filled in the browser.
  const quotaSentence = {
    limit: t("tasks.neonLimits.confirmLimit", { hours: "{quotaCuHours}" }),
    none: t("tasks.neonLimits.confirmNone"),
  } as const;
  const quotaModes = ["limit", "none"] as const;
  const translate = (key: string, values?: Record<string, string>) => t(key as "tasks.neonLimits.save", values);
  const numbers = { number: (value: number, options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }) => format.number(value, options) };
  const confirms: ConfirmSpec[] = [
    ...ceilings.flatMap((ceiling) =>
      ceilings
        .filter((floor) => floor.cu <= ceiling.cu)
        .flatMap((floor) =>
          suspendModes.flatMap((mode) =>
            quotaModes.map((quotaMode) => ({
              ...baseConfirm,
              body: `${quotaSentence[quotaMode]} ${moneySentence(translate, numbers, before, { minCu: floor.cu, maxCu: ceiling.cu, suspendMode: mode }, limits.reportedPlan)}`,
              fillFrom: quotaMode === "limit" ? ["quotaCuHours"] : undefined,
              when: [
                { field: "maxCu", equals: String(ceiling.cu) },
                { field: "minCu", equals: String(floor.cu) },
                { field: "suspendMode", equals: mode },
                { field: "quotaMode", equals: quotaMode },
              ],
            })),
          ),
        ),
    ),
    { ...baseConfirm, body: quotaSentence.limit, fillFrom: ["quotaCuHours"], when: [{ field: "quotaMode", equals: "limit" }] },
    { ...baseConfirm, body: quotaSentence.none },
  ];

  return (
    <Panel
      level={level}
      title={t("tasks.neonLimits.title")}
      intro={t("tasks.neonLimits.intro")}
      introMore={t("tasks.neonLimits.introMore")}
      data-testid="neon-limits"
    >
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
      <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="neon-limits-usage">
        {t("tasks.neonLimits.usage", { used: hours(model.usedCuHours), active: hours(model.activeHours), end: periodEnd })}
      </Typography>
      {model.computeCount > 1 && (
        <Typography variant="caption" color="text.secondary" component="div">
          {t("tasks.neonLimits.manyComputes", { count: model.computeCount })}
        </Typography>
      )}
      <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="neon-limits-compute">
        {t("tasks.neonLimits.computeReadout", {
          min: cu(currentMin),
          suspend: t(`tasks.neonLimits.suspend.${model.suspendMode}`),
        })}
        {/* What a compute created anew would get — a detail, behind the «?» (§NNN). */}
        <QuietHelp
          text={
            model.defaults.maxCu === null
              ? t("tasks.neonLimits.defaultsUnset")
              : t("tasks.neonLimits.defaults", { min: cu(model.defaults.minCu ?? NEON_MIN_CU), max: cu(model.defaults.maxCu) })
          }
        />
      </Typography>

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
                minCu: t("tasks.neonLimits.minCu"),
                suspendMode: t("tasks.neonLimits.suspendMode"),
                quotaMode: t("tasks.neonLimits.quotaMode"),
                quotaCuHours: t("tasks.neonLimits.quotaCuHours"),
                confirmSuspension: t("tasks.neonLimits.confirmField"),
              },
              { confirmation: production },
            )}
            confirm={confirms}
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
                helperText={t("tasks.neonLimits.maxCuHelp")}
                helpMore={t("tasks.neonLimits.maxCuHelpMore", { min: cu(NEON_MIN_CU) })}
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

              {/* The floor (§479): the compute's size from the first query after a wake, paid every hour awake. */}
              <RecallField
                select
                name="minCu"
                label={t("tasks.neonLimits.minCu")}
                defaultValue={minIsOffered ? String(currentMin) : ""}
                slotProps={{ select: { native: true } }}
                helperText={t("tasks.neonLimits.minCuHelp", { min: cu(NEON_MIN_CU) })}
                helpMore={t("tasks.neonLimits.minCuHelpMore")}
              >
                {!minIsOffered && <option value="">{t("tasks.neonLimits.choose")}</option>}
                {ceilings.map((floor) => (
                  <option key={floor.cu} value={String(floor.cu)}>
                    {t("tasks.neonLimits.minOption", { cu: cu(floor.cu), perHour: usdPerHour(floor.usdPerHour) })}
                  </option>
                ))}
              </RecallField>

              {/* Scale to zero (§479): Neon's five idle minutes, or never — Launch only, and it bills the floor every hour. */}
              <RecallField
                select
                name="suspendMode"
                label={t("tasks.neonLimits.suspendMode")}
                defaultValue={model.suspendMode}
                slotProps={{ select: { native: true } }}
                helperText={t(alwaysOnAllowed ? "tasks.neonLimits.suspendHelp" : "tasks.neonLimits.suspendHelpFree")}
                helpMore={alwaysOnAllowed ? t("tasks.neonLimits.suspendHelpMore", { rate: usdPerHour(rate) }) : undefined}
              >
                {suspendModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`tasks.neonLimits.suspend.${mode}`)}
                  </option>
                ))}
              </RecallField>

              {/*
                The monthly limit, exactly as the owner asked (§NNN, 2026-09-27: «prea multe
                detalii»): the label, «Fără limită / Cu limită», the number and one sentence with
                the recommendation. The smallest limit Neon accepts now is the «?»; production's
                confirmation box is its guard on the click (§327), not advice against a limit.
              */}
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
                helperText={t("tasks.neonLimits.quotaCuHoursHelp", { hours: hours(recommendedNeonQuotaCuHours(appEnv)) })}
                helpMore={t("tasks.neonLimits.floor", { used: hours(model.usedCuHours), smallest: hours(model.smallestQuotaCuHours) })}
              />
              {production && <CheckboxField name="confirmSuspension">{t("tasks.neonLimits.confirm")}</CheckboxField>}

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
