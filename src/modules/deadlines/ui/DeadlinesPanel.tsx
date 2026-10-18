import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { updateAddressCapAction, updateDeadlinesAction, updateDeliveryTimingAction } from "@/app/[locale]/admin/settings/deadlines/actions";
import { countForm } from "@/i18n/count-form";
import type { AddressCapState } from "@/modules/registrations/address-cap";
import type { DeliveryTimingState } from "@/modules/notifications/delivery-timing";
import { DELIVERY_TIMINGS } from "@/modules/notifications/domain/delivery-timing";
import { ADDRESS_CAP_RULE } from "@/modules/registrations/domain/address-cap";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import type { PanelGlyphName } from "@/shared/ui/panel-glyphs";
import type { DeadlinesState } from "../deadlines";
import { DEADLINE_GROUPS, DEADLINE_KEYS, DEADLINE_RULES, type DeadlineGroupKey, type DeadlineKey, type Deadlines, RECOMMENDED } from "../domain/deadlines";
import { deadlineDuration, deadlineWords, minutesPhrase } from "../domain/duration-words";
import FillRecommendedButton from "./FillRecommendedButton";

type Props = {
  locale: Locale;
  state: DeadlinesState;
  /**
   * Whether the reader may change them (§291's two gates): everybody who opens the page reads the
   * numbers in force; the form is the Administrator's, and `updateDeadlines` refuses anybody else.
   */
  mayEdit: boolean;
  /** Why the fold opens by itself: this panel's save just landed (§336). */
  openWhen?: FoldOpenWhen;
  /**
   * Which of the page's three saves just landed (`?saved=`): the two cards under the deadlines open
   * on their own save, so the number just stored is in front of the person who stored it (§336).
   * The deadlines' own folds stay closed: their closed lines already say the new numbers.
   */
  saved?: string;
  /**
   * "Maxim de înscrieri pe o adresă (pe eveniment)" (§389): a club setting of its own, in this card
   * because it is a limit a participant meets through the same messages — its own form and its own
   * save, so a refused number never costs the deadlines typed beside it.
   */
  addressCap?: AddressCapState;
  /**
   * «Când pleacă emailurile» (§513): on the scheduler's tick (the default) or right after the
   * request that queued them (§221). In this card because it is a wait every participant is told
   * about — its own form and its own save, like the address cap.
   */
  deliveryTiming?: DeliveryTimingState;
  /**
   * The most a message waits on the scheduled round on this deployment, by day and at night
   * (`notifications/outbox-delivery.ts`): the pinger's cadence, the minimum interval and the budget
   * governor's floor, so the words say this site's numbers and never a typed "15 minutes" (§513).
   */
  scheduledWait?: { day: number; night: number };
};

/**
 * Each fold's picture, by the name `panel-glyphs.ts` knows it by. Written as objects and spread
 * into the card (`{...GROUP_GLYPH[key]}`), which `Panel`'s type allows, so the glyph test that
 * looks for every table name written out as `glyph: "…"` still finds each one.
 */
const GROUP_GLYPH = {
  confirmation: { glyph: "confirmation" },
  hold: { glyph: "queue" },
  beforeStart: { glyph: "reminder" },
  afterEvent: { glyph: "history" },
  series: { glyph: "recurrence" },
  family: { glyph: "members" },
  outage: { glyph: "outage" },
} as const satisfies Record<DeadlineGroupKey, { glyph: PanelGlyphName }>;

type Translate = Awaited<ReturnType<typeof getTranslations>>;

/**
 * One fold's closed line (§377 amended): its deadlines' values in force in the house's words,
 * "link 48 de ore · retrimis după 20 de ore · retrimiteri: o dată", and — when any is off the
 * recommendation — how many, the chip beside the box saying which. The stored values, never the
 * typed ones, as the chip does (§456).
 */
function groupSummary(t: Translate, locale: Locale, fields: readonly DeadlineKey[], deadlines: Deadlines): string {
  const parts: string[] = fields.map((key) => {
    const value = deadlines[key];
    // Zero is "none" (or "race day only") for the six deadlines that allow it, said in words of their own.
    if (value === 0) return t(`emails.deadlines.shortZero.${key}`);
    const words =
      key === "verificationRetries"
        ? t(`emails.retryTimes.${countForm(value, locale)}`, { count: value })
        : (deadlineDuration(locale, key, value) ?? String(value));
    return t(`emails.deadlines.short.${key}`, { value: words });
  });
  const differing = fields.filter((key) => deadlines[key] !== RECOMMENDED[key]).length;
  if (differing > 0) parts.push(t(`emails.deadlines.differsCount.${countForm(differing, locale)}`, { count: differing }));
  return parts.join(" · ");
}

/**
 * "Termene" (§377): the club's deadlines — «Setări» → «Termene» since §516, one tab over from
 * «Emailuri», whose when-lines and previews state them. A Server Component with one form, the
 * Mailgun plan's shape (§100): every box a whole number with the bounds the service enforces
 * (`DEADLINE_RULES`), carried as `min`/`max` so the browser refuses "0 hours" before the server
 * does (§315).
 *
 * **Thirteen boxes in seven named folds** (the owner, 2026-10-18: «partea asta de termene trebuie
 * grupată mai bine»): `DEADLINE_GROUPS` says which box sits in which fold, and each fold is a nested
 * `Panel` — closed, a glyph, a closed line of its values and how many differ from the recommendation.
 * The form is still ONE, with one «Salvează termenele» and one «Completează valorile recomandate»
 * under the folds, outside them: a refused number in a closed fold never costs the others, and
 * `ActionForm` opens the folds around the box it refuses (§315). The two settings under it — the
 * limit per address and «Când pleacă emailurile» — are cards of their own, with their own saves.
 */
export default async function DeadlinesPanel({ locale, state, mayEdit, openWhen, saved, addressCap, deliveryTiming, scheduledWait }: Props) {
  const t = await getTranslations("Admin");
  const confirmText = await confirmWords();
  const { deadlines, updatedAt } = state;
  // The scheduled round's wait in words (§513): "15 minute" by day, "o oră" at night on production.
  const waitWords = scheduledWait
    ? { day: minutesPhrase(locale, scheduledWait.day), night: minutesPhrase(locale, scheduledWait.night), wait: minutesPhrase(locale, Math.max(scheduledWait.day, scheduledWait.night)) }
    : null;
  const words = deadlineWords(locale, deadlines);
  const labels = Object.fromEntries(DEADLINE_KEYS.map((key) => [key, t(`emails.deadlines.fields.${key}`)]));

  /** One fold of the seven: its card, with its boxes (or, for a reader, their values) inside. */
  const group = (entry: (typeof DEADLINE_GROUPS)[number], body: (key: DeadlineKey) => ReactNode) => (
    <Panel
      key={entry.key}
      {...GROUP_GLYPH[entry.key]}
      level={3}
      collapsible
      title={t(`emails.deadlines.groups.${entry.key}.title`)}
      intro={t(`emails.deadlines.groups.${entry.key}.intro`)}
      aside={groupSummary(t, locale, entry.fields, deadlines)}
      id={`deadlines-${entry.key}`}
      data-testid={`deadline-group-${entry.key}`}
    >
      <Stack spacing={1.5}>{entry.fields.map((key) => body(key))}</Stack>
    </Panel>
  );

  return (
    <Panel glyph="deadlines"
      title={t("emails.deadlines.title")}
      intro={t("emails.deadlines.intro")}
      aside={t("emails.deadlines.aside", {
        confirmation: words.confirmation,
        hold: words.hold,
        offer: words.offer,
        reminder: words.reminder ?? t("emails.deadlines.reminderOff"),
      })}
      collapsible
      openWhen={openWhen}
      id="deadlines"
      data-testid="deadlines"
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("emails.deadlines.legal")}
      </Typography>
      {updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {t("emails.deadlines.updatedAt", {
            when: formatDay(updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
        {!mayEdit ? (
          <>
            {DEADLINE_GROUPS.map((entry) =>
              group(entry, (key) => (
                <Box key={key} sx={{ display: "flex", flexWrap: "wrap", columnGap: 1 }}>
                  <Typography component="span" variant="body2" color="text.secondary">
                    {labels[key]}:
                  </Typography>
                  <Typography component="span" variant="body2" sx={{ fontWeight: 600 }} data-testid={`deadline-${key}`}>
                    {deadlines[key]}
                  </Typography>
                </Box>
              )),
            )}
            <Typography variant="body2" color="text.secondary">
              {t("emails.deadlines.readOnly")}
            </Typography>
          </>
        ) : (
          /* A refused save comes back with every box as typed (§315); `scope` keeps its ids apart from the page's other forms. */
          /* Asks first (§384): the numbers every participant is given from now on change with it. */
          <ActionForm
            action={updateDeadlinesAction}
            messages={await refusalMessages(labels)}
            confirm={{ title: t("confirm.deadlinesTitle"), body: t("confirm.deadlinesBody"), confirmLabel: t("emails.deadlines.save"), cancelLabel: confirmText.cancel }}
            scope="deadlines"
            data-testid="deadlines-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5}>
              {DEADLINE_GROUPS.map((entry) =>
                group(entry, (key) => {
                  const rule = DEADLINE_RULES[key];
                  return (
                    <Box key={key}>
                      <RecallField
                        name={key}
                        type="number"
                        label={labels[key]}
                        defaultValue={deadlines[key]}
                        size="small"
                        required
                        helperText={`${t(`emails.deadlines.help.${key}`)} ${t("emails.deadlines.bounds", { min: rule.min, max: rule.max, recommended: RECOMMENDED[key] })}`}
                        slotProps={{ htmlInput: { min: rule.min, max: rule.max, step: 1, inputMode: "numeric" } }}
                      />
                      {/* §456: the value in force is not the recommended one — said by the stored value, not the typed one. */}
                      {deadlines[key] !== RECOMMENDED[key] && (
                        <Chip size="small" variant="outlined" color="warning" sx={{ mt: 0.5 }} label={t("emails.deadlines.differs")} data-testid={`deadline-${key}-differs`} />
                      )}
                    </Box>
                  );
                }),
              )}
              {/* One save for the thirteen, under the folds and outside them (§377 amended). */}
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                <GlyphSubmitButton label={t("emails.deadlines.save")} pendingLabel={t("emails.deadlines.saving")} icon="save" />
                {/* §456: fills the boxes, never saves — the save above does, after its question. */}
                <FillRecommendedButton values={RECOMMENDED} label={t("emails.deadlines.fillRecommended")} />
              </Box>
            </Stack>
          </ActionForm>
        )}

        {addressCap && (
          <Panel
            glyph="limits"
            level={3}
            collapsible
            title={t("emails.addressCap.title")}
            intro={t("emails.addressCap.intro")}
            aside={t("emails.addressCap.aside", { people: t(`emails.addressCap.people.${countForm(addressCap.cap.registrationsPerAddress, locale)}`, { count: addressCap.cap.registrationsPerAddress }) })}
            openWhen={{ saved: saved === "addressCap" }}
            id="address-cap"
            data-testid="address-cap"
          >
            {!mayEdit ? (
              <Typography variant="body2" data-testid="address-cap-value">
                {t("emails.addressCap.value", { people: t(`emails.addressCap.people.${countForm(addressCap.cap.registrationsPerAddress, locale)}`, { count: addressCap.cap.registrationsPerAddress }) })}
              </Typography>
            ) : (
              /* Asks first (§384): a limit every public submission meets from now on. */
              <ActionForm
                action={updateAddressCapAction}
                messages={await refusalMessages({ registrationsPerAddress: t("emails.addressCap.field") })}
                confirm={{ title: t("confirm.addressCapTitle"), body: t("confirm.addressCapBody"), confirmLabel: t("emails.addressCap.save"), cancelLabel: confirmText.cancel }}
                scope="address-cap"
                data-testid="address-cap-form"
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <Stack spacing={1.5}>
                  <RecallField
                    name="registrationsPerAddress"
                    type="number"
                    label={t("emails.addressCap.field")}
                    defaultValue={addressCap.cap.registrationsPerAddress}
                    size="small"
                    required
                    helperText={`${t("emails.addressCap.help")} ${t("emails.deadlines.bounds", { min: ADDRESS_CAP_RULE.min, max: ADDRESS_CAP_RULE.max, recommended: ADDRESS_CAP_RULE.default })}`}
                    slotProps={{ htmlInput: { min: ADDRESS_CAP_RULE.min, max: ADDRESS_CAP_RULE.max, step: 1, inputMode: "numeric" } }}
                  />
                  <Box>
                    <GlyphSubmitButton label={t("emails.addressCap.save")} pendingLabel={t("emails.deadlines.saving")} icon="save" />
                  </Box>
                </Stack>
              </ActionForm>
            )}
          </Panel>
        )}

        {deliveryTiming && waitWords && (
          <Panel
            glyph="forecast"
            level={3}
            collapsible
            title={t("emails.deliveryTiming.title")}
            intro={t("emails.deliveryTiming.intro", waitWords)}
            aside={t(`emails.deliveryTiming.aside.${deliveryTiming.timing}`, waitWords)}
            openWhen={{ saved: saved === "deliveryTiming" }}
            id="delivery-timing"
            data-testid="delivery-timing"
          >
            {/* The setting is for everything automatic; a backoffice resend may leave at once (§540) —
                said only under the scheduled pass, the one timing whose presses offer that choice. */}
            {deliveryTiming.timing === "scheduled" && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }} data-testid="delivery-timing-bypass">
                {t("emails.deliveryTiming.bypassHelp")}
              </Typography>
            )}
            {!mayEdit ? (
              <Typography variant="body2" data-testid="delivery-timing-value">
                {t(`emails.deliveryTiming.option.${deliveryTiming.timing}`, waitWords)}
              </Typography>
            ) : (
              /* Asks first (§384): every message the platform sends from now on leaves by it. */
              <ActionForm
                action={updateDeliveryTimingAction}
                messages={await refusalMessages({ timing: t("emails.deliveryTiming.field") })}
                confirm={{ title: t("confirm.deliveryTimingTitle"), body: t("confirm.deliveryTimingBody"), confirmLabel: t("emails.deliveryTiming.save"), cancelLabel: confirmText.cancel }}
                scope="delivery-timing"
                data-testid="delivery-timing-form"
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <Stack spacing={1.5}>
                  <RecallField
                    select
                    name="timing"
                    label={t("emails.deliveryTiming.field")}
                    defaultValue={deliveryTiming.timing}
                    size="small"
                    slotProps={{ select: { native: true } }}
                    helperText={t("emails.deliveryTiming.help")}
                  >
                    {DELIVERY_TIMINGS.map((timing) => (
                      <option key={timing} value={timing}>
                        {t(`emails.deliveryTiming.option.${timing}`, waitWords)}
                      </option>
                    ))}
                  </RecallField>
                  <Box>
                    <GlyphSubmitButton label={t("emails.deliveryTiming.save")} pendingLabel={t("emails.deadlines.saving")} icon="save" />
                  </Box>
                </Stack>
              </ActionForm>
            )}
          </Panel>
        )}
      </Stack>
    </Panel>
  );
}
