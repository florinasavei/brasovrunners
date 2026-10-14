import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { routing } from "@/i18n/routing";
import RecallField from "@/shared/forms/recall";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import RadioField from "@/shared/ui/RadioField";
import { type BadgeDesign, badgePictureStamp } from "../badge-design";
import { badgeImageSize, badgePaper, badgeSheetGrid, badgeSizeMm } from "../badge-geometry";
import { badgePictureSrc } from "../badge-query";
import { BADGE_COUNT_MAX, BADGE_FROM_BOX, BADGE_TOTAL_MAX, type BadgeRole, badgePrintDefault, badgeRoleName, printBoxes } from "../badges";
import { badgeLabelIn } from "../badge-words";

/**
 * «Tipărire» (§764): the badges printed **per role**, never per person — for each role «Câte ecusoane»
 * (the people it needs, by default) and «În plus» (spares the club types), and «Ecusoane fără rol», the
 * badges with «VOLUNTAR» alone for whoever comes without one. The badges' language is chosen like the
 * bib's: the sheet prints in one.
 *
 * A plain GET form to the sheet's route — it works with scripts off and the browser handles the PDF as it
 * handles PDFs — under the picture of each role's badge as the saved design prints it (the same route as
 * the designer's preview, stamped with what it is drawn from: a saved change is a new picture). No
 * volunteer's name is in the file: the names are written by hand at the desk.
 */
export default async function BadgePrintPanel({
  eventId,
  locale,
  design,
  roles,
  eventTitle,
  refused = false,
}: {
  eventId: string;
  locale: Locale;
  design: BadgeDesign;
  roles: readonly BadgeRole[];
  /** The event's title in the page's language, part of each picture's stamp. */
  eventTitle: string;
  /** The page came back with the route's refusal of the numbers: the card opens, its boxes in view. */
  refused?: boolean;
}) {
  const t = await getTranslations("Admin");
  const grid = badgeSheetGrid(badgePaper(design));
  const { widthMm, heightMm } = badgeSizeMm(design);
  const image = badgeImageSize(design);
  const needed = roles.reduce((sum, role) => sum + role.needed, 0);
  // What the boxes start at, and so what a press without a change prints: a page whose defaults add up to
  // nothing (an event with no roles yet) says so, rather than offering a download of an empty sheet.
  const startsAt = roles.reduce((sum, role) => sum + badgePrintDefault(role), 0);
  // «VOLUNTAR» as the page's language prints it: the club's own word when it typed one.
  const label = await badgeLabelIn(design, locale);
  const pictureOf = (role: BadgeRole | null) =>
    badgePictureSrc({
      eventId,
      locale,
      role: role ? role.id : "none",
      stamp: badgePictureStamp([design, eventTitle, role ? [role.nameRo, role.nameEn, role.colour] : null]),
    });
  const numberBox = (name: string, label: string, value: number, testId: string) => (
    <RecallField
      name={name}
      type="number"
      label={label}
      defaultValue={String(value)}
      slotProps={{ htmlInput: { min: 0, max: BADGE_COUNT_MAX, step: 1, inputMode: "numeric", "data-testid": testId }, inputLabel: { shrink: true } }}
      sx={{ width: { xs: "100%", sm: 160 } }}
    />
  );
  /** One pile: its badge as it prints, and its numbers. */
  const pile = (role: BadgeRole | null) => (
    <Box component="li" key={role?.id ?? "none"} data-testid="badge-print-row" data-role-id={role?.id ?? "none"}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ alignItems: { md: "center" } }}>
        <Box component="figure" sx={{ m: 0, width: { xs: "100%", md: 300 }, flexShrink: 0 }}>
          <Box
            component="img"
            src={pictureOf(role)}
            alt={role ? t("badges.print.pictureAlt", { role: badgeRoleName(role, locale) }) : t("badges.print.pictureAltNone")}
            width={image.width}
            height={image.height}
            loading="lazy"
            sx={{ width: "100%", height: "auto", display: "block" }}
          />
        </Box>
        <Stack spacing={1} sx={{ minWidth: 0 }}>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {role ? badgeRoleName(role, locale) : t("badges.print.noRole")}
          </Typography>
          {role ? (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              {numberBox(printBoxes.count(role.id), t("badges.print.count"), badgePrintDefault(role), "badge-count")}
              {numberBox(printBoxes.spares(role.id), t("badges.print.spares"), 0, "badge-spares")}
            </Stack>
          ) : (
            numberBox(printBoxes.none, t("badges.print.noRoleCount"), 0, "badge-none")
          )}
          <Typography variant="caption" color="text.secondary">
            {role ? t("badges.print.countHelp", { needed: String(role.needed) }) : t("badges.print.noRoleHelp", { label })}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );

  return (
    <Panel
      glyph="print"
      collapsible
      openWhen={{ refused }}
      level={2}
      id="box-badge-print"
      title={t("badges.print.title")}
      aside={t("badges.print.aside", { perSheet: String(grid.perSheet), width: String(widthMm), height: String(heightMm) })}
      data-testid="badge-print"
    >
      <Box component="form" method="get" action={`/api/admin/events/${eventId}/badges`} data-testid="badge-print-form">
        {/* The page's language, so a refusal of the numbers comes back to this page and says why. */}
        <input type="hidden" name={BADGE_FROM_BOX} value={locale} />
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {t("badges.print.intro", { perSheet: String(grid.perSheet), needed: String(needed), max: String(BADGE_COUNT_MAX), total: String(BADGE_TOTAL_MAX) })}
            <QuietHelp text={t("badges.print.introMore")} />
          </Typography>
          <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid="badge-print-language">
            <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              {t("badges.print.language")}
            </Typography>
            <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2 }}>
              {routing.locales.map((language) => (
                <RadioField key={language} name="locale" value={language} defaultChecked={language === locale}>
                  {t(`badges.print.languages.${language}`)}
                </RadioField>
              ))}
            </Stack>
          </Box>
          <Stack spacing={2.5} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {roles.map((role) => pile(role))}
            {pile(null)}
          </Stack>
          {startsAt === 0 && (
            <Typography variant="body2" color="text.secondary" data-testid="badge-print-nothing">
              {t("badges.print.nothing")}
            </Typography>
          )}
          <Box>
            <GlyphButton icon="pdf" type="submit" variant="contained" sx={{ minHeight: 44 }} data-testid="badge-download">
              {t("badges.print.download")}
            </GlyphButton>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t("badges.print.savedOnly")}
          </Typography>
        </Stack>
      </Box>
    </Panel>
  );
}
