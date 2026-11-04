import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import Panel from "@/shared/ui/Panel";
import type { EliteEntryRow } from "../elite-list";
import type { EliteMarkedRow } from "../elite-mark";
import RegistrationStatusChip from "./RegistrationStatusChip";

/**
 * «Elite» on one event's registrations list (the owner, 2026-11-04, who looked here for an elite on the race's separate
 * list and did not find her: that list lived only in the event's editor). A closed fold, its line «N pe lista separată ·
 * M înscriși marcați», holding both kinds of elite, read-only:
 *
 * - the separate list (§895): names, not registrations — each name, with its number when it has one;
 * - the registrations marked «Elită» (§897), in every state: each name a link to the registration's page, with its state
 *   chip and its number when it has one.
 *
 * The lists change where they always did — the separate one on the editor's elite card, the mark on a row's «⋮» — so the
 * fold ends with a link to that card (`/admin/events/[id]#bib-elite`, a plain anchor, so the editor's fold opens on it):
 * «Gestionează lista de elite» for the Administrator, who adds and deletes there, «Vezi lista de elite în editor» for
 * the Organizer, who reads it. Presentation only: the page reads the rows, through readers that assert the role again.
 */
export default async function ElitePanel({
  locale,
  entries,
  marked,
  cardHref,
  registrationHref,
  mayManage,
}: {
  locale: string;
  /** The event's separate elite list, in the order the club typed it (`elite-list.ts#listEliteEntries`). */
  entries: readonly EliteEntryRow[];
  /** The event's registrations marked «Elită» (`elite-mark.ts#listEliteMarkedRegistrations`). */
  marked: readonly EliteMarkedRow[];
  /** The editor's elite card. */
  cardHref: string;
  /** A registration's own page. */
  registrationHref: (registrationId: string) => string;
  /** The Administrator's words on the link; the Organizer's say he reads. */
  mayManage: boolean;
}) {
  const t = await getTranslations("Admin");
  const aside = `${t("registrations.elite.separate", { count: entries.length })} · ${t(`registrations.elite.marked.${countForm(marked.length, locale)}`, { count: marked.length })}`;
  return (
    <Panel glyph="elite" collapsible title={t("registrations.elite.panelTitle")} intro={t("registrations.elite.panelIntro")} aside={aside} id="registrations-elite" data-testid="registrations-elite">
      <Stack spacing={2}>
        <Box component="section" aria-label={t("registrations.elite.separateTitle")} data-testid="registrations-elite-separate">
          <Typography variant="h3" sx={{ ...HEADING_SX[3], mb: 0.5 }}>
            {t("registrations.elite.separateTitle")}
          </Typography>
          {entries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("registrations.elite.separateEmpty")}
            </Typography>
          ) : (
            <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 3 }}>
              {entries.map((entry) => (
                <Box key={entry.id} component="li" data-testid="registrations-elite-entry">
                  <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1 }}>
                    <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{entry.name}</Typography>
                    {entry.bibNumber !== null && (
                      <Typography variant="body2" color="text.secondary">
                        {t("bibs.eliteNumberShown", { number: entry.bibNumber })}
                      </Typography>
                    )}
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
        <Box component="section" aria-label={t("registrations.elite.markedTitle")} data-testid="registrations-elite-marked">
          <Typography variant="h3" sx={{ ...HEADING_SX[3], mb: 0.5 }}>
            {t("registrations.elite.markedTitle")}
          </Typography>
          {marked.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("registrations.elite.markedEmpty")}
            </Typography>
          ) : (
            <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 3 }}>
              {marked.map((row) => (
                <Box key={row.id} component="li" data-testid="registrations-elite-registration">
                  <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1 }}>
                    {/* A list's link: a thumb's height (44 px), the name its words. */}
                    <Box
                      component="a"
                      href={registrationHref(row.id)}
                      sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontWeight: 600, color: "primary.main", overflowWrap: "anywhere" }}
                    >
                      {row.name}
                    </Box>
                    <RegistrationStatusChip status={row.status} testId="registrations-elite-status" />
                    {row.bibNumber !== null && (
                      <Typography variant="body2" color="text.secondary">
                        {t("bibs.eliteNumberShown", { number: row.bibNumber })}
                      </Typography>
                    )}
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
        <GlyphButton
          icon="elite"
          href={cardHref}
          variant="outlined"
          size="small"
          sx={{ minHeight: 44, alignSelf: "flex-start" }}
          data-testid="registrations-elite-card"
        >
          {mayManage ? t("registrations.elite.manage") : t("registrations.elite.seeCard")}
        </GlyphButton>
      </Stack>
    </Panel>
  );
}
