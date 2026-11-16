import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import type { AmbassadorMarkedRow } from "../ambassador-mark";
import RegistrationStatusChip from "./RegistrationStatusChip";

/**
 * «Ambasadori» on one event's registrations list (§NNN; the owner, 2026-11-14: «pe lângă Elite, adaugă și categoria de
 * „Ambasadori" ca să putem decide pe cine premiem și pe cine nu»): a closed fold beside «Elite», its line «N ambasadori»,
 * holding every registration marked «Ambasador» in one numbered list — the name a link to the registration's page, its
 * state chip, its number when it has one, «și elită» when it wears both marks, and what the club's two ticks hide of it:
 * «în afara clasamentului» (so not at «Premii») and «nu apare pe site».
 *
 * The mark changes where it always does — a row's «⋮», which also holds the two ticks — and, for the Administrator, a
 * one-press «Nu mai e ambasador» beside every line, posting to the row menu's own action with the row menu's own hidden
 * fields (`unmark`): it asks nothing, the same menu's «Marchează ca ambasador» undoes it, the Organizer is offered none
 * and the server refuses a forged post (`ambassador-mark.ts`). Presentation only: the page reads the rows, through a
 * reader that asserts the role again.
 */
export default async function AmbassadorPanel({
  locale,
  marked,
  registrationHref,
  unmark,
}: {
  locale: string;
  /** The event's registrations marked «Ambasador» (`ambassador-mark.ts#listAmbassadorMarkedRegistrations`). */
  marked: readonly AmbassadorMarkedRow[];
  /** A registration's own page. */
  registrationHref: (registrationId: string) => string;
  /**
   * The one-press «Nu mai e ambasador» beside each line: the row menu's action (`setRegistrationAmbassadorAction`) and
   * the list's return query. Given only to a role that may change registrations; absent, the panel is read-only.
   */
  unmark?: { action: ActionFormAction; listQuery: string };
}) {
  const t = await getTranslations("Admin");
  const aside = t(`registrations.ambassador.count.${countForm(marked.length, locale)}`, { count: marked.length });
  const quiet = (words: string, testId: string) => (
    <Typography variant="body2" color="text.secondary" data-testid={testId}>
      {words}
    </Typography>
  );
  return (
    <Panel
      glyph="ambassador"
      collapsible
      title={t("registrations.ambassador.panelTitle")}
      intro={t("registrations.ambassador.panelIntro")}
      aside={aside}
      id="registrations-ambassadors"
      data-testid="registrations-ambassadors"
    >
      {marked.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-ambassadors-empty">
          {t("registrations.ambassador.empty")}
        </Typography>
      ) : (
        <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 3 }} data-testid="registrations-ambassadors-list">
          {marked.map((row) => (
            <Box key={row.id} component="li" data-testid="registrations-ambassador">
              <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1 }}>
                {/* A list's link: a thumb's height (44 px), the name its words. */}
                <Box
                  component="a"
                  href={registrationHref(row.id)}
                  sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontWeight: 600, color: "primary.main", overflowWrap: "anywhere" }}
                >
                  {row.name}
                </Box>
                <RegistrationStatusChip status={row.status} testId="registrations-ambassador-status" />
                {row.bibNumber !== null && quiet(t("bibs.eliteNumberShown", { number: row.bibNumber }), "registrations-ambassador-number")}
                {row.elite && quiet(t("registrations.ambassador.alsoElite"), "registrations-ambassador-elite")}
                {/* What the club's two ticks hide of this runner (§910): said here, so «Premii» holds no surprise. */}
                {!row.inResults && quiet(t("registrations.ambassador.outOfResults"), "registrations-ambassador-out")}
                {!row.onSite && quiet(t("registrations.ambassador.offSite"), "registrations-ambassador-off-site")}
                {unmark && (
                  <ActionForm action={unmark.action} data-testid="registrations-ambassador-unmark-form">
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="registrationId" value={row.id} />
                    <input type="hidden" name="ambassador" value="0" />
                    <input type="hidden" name="listQuery" value={unmark.listQuery} />
                    <GlyphButton
                      icon="ambassador"
                      type="submit"
                      variant="outlined"
                      size="small"
                      sx={{ minHeight: 44, minWidth: 44 }}
                      aria-label={t("registrations.ambassador.unmarkNamed", { name: row.name })}
                      data-testid="registrations-ambassador-unmark"
                    >
                      {t("registrations.ambassador.unmark")}
                    </GlyphButton>
                  </ActionForm>
                )}
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Panel>
  );
}
