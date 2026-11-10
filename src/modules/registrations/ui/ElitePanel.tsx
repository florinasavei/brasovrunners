import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import type { EliteEntryRow } from "../elite-list";
import type { EliteMarkedRow } from "../elite-mark";
import RegistrationStatusChip from "./RegistrationStatusChip";

/**
 * «Elite» on one event's registrations list (the owner, 2026-11-04, who looked here for an elite on the race's separate
 * list and did not find her: that list lived only in the event's editor; then, of two sub-lists counted apart, «ce
 * înseamnă asta? nu înțeleg, sunt 2 elite»). A closed fold, its line «N elite», holding every elite of the event in one
 * numbered list, read-only, each line saying which kind it is:
 *
 * - a name on the separate list (§895), not a registration: «fără înscriere — doar numele pe BIB», with its number when
 *   it has one;
 * - a registration marked «Elită» (§897), in every state: «cu înscriere», the name a link to the registration's page,
 *   its state chip and its number when it has one.
 *
 * The lists change where they always did — the separate one on the editor's elite card, the mark on a row's «⋮» — so the
 * fold ends with a link to that card (`/admin/events/[id]#bib-elite`, a plain anchor: the editor scrolls to the card, closed):
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
  const total = entries.length + marked.length;
  const aside = t(`registrations.elite.count.${countForm(total, locale)}`, { count: total });
  const number = (bibNumber: number | null) =>
    bibNumber === null ? null : (
      <Typography variant="body2" color="text.secondary">
        {t("bibs.eliteNumberShown", { number: bibNumber })}
      </Typography>
    );
  return (
    <Panel glyph="elite" collapsible title={t("registrations.elite.panelTitle")} intro={t("registrations.elite.panelIntro")} aside={aside} id="registrations-elite" data-testid="registrations-elite">
      <Stack spacing={2}>
        {total === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("registrations.elite.empty")}
          </Typography>
        ) : (
          <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 3 }} data-testid="registrations-elite-list">
            {entries.map((entry) => (
              <Box key={entry.id} component="li" data-testid="registrations-elite-entry">
                <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1, minHeight: 44 }}>
                  <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{entry.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("registrations.elite.nameOnly")}
                  </Typography>
                  {number(entry.bibNumber)}
                </Stack>
              </Box>
            ))}
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
                  <Typography variant="body2" color="text.secondary">
                    {t("registrations.elite.registered")}
                  </Typography>
                  <RegistrationStatusChip status={row.status} testId="registrations-elite-status" />
                  {number(row.bibNumber)}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
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
