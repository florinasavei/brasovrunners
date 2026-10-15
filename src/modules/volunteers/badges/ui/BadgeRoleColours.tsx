import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { saveBadgeRoleColoursAction } from "@/app/[locale]/admin/events/[id]/badges/actions";
import type { Locale } from "@/i18n/routing";
import ActionForm from "@/shared/forms/ActionForm";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import type { BadgeDesign } from "../badge-design";
import { badgeLabelIn } from "../badge-words";
import { type BadgeRole, badgeRoleLabel, roleColourBoxes } from "../badges";
import RoleColourFields from "./RoleColourFields";
import RoleColourSample from "./RoleColourSample";

/**
 * «Culorile rolurilor» (§764): each role's band colour on the badge — used only while the badge is per role (§NNN: the one badge for everyone has the colour of its own, in «Cum arată ecusonul») —«Portocaliul clubului» (the kit's
 * orange), one of the bib's palette, or a colour typed in «Culoarea scrisă» and refused when its words
 * would not read at AA. A new colour typed there is the one kept even when the select still shows the saved
 * choice (`badges.ts#saveBadgeRoleColours`), so nobody types a colour and saves the old one. The same colour
 * boxes (`RoleColourFields`) are in each role's own form in the «Voluntari» card; this card is every role's
 * colour on one page, beside the badge it is for.
 *
 * Every role shows its band as saved — a sample of the colour with «VOLUNTAR» in the text colour the
 * badge prints on it, the colour's name and its contrast in words — so the state is never told by colour
 * alone. One form, one press: «Salvează culorile» (`ActionForm`).
 */
export default async function BadgeRoleColours({
  eventId,
  locale,
  roles,
  design,
}: {
  eventId: string;
  locale: Locale;
  roles: readonly BadgeRole[];
  /** The saved design: its «VOLUNTAR» is the word the sample band shows. */
  design: BadgeDesign;
}) {
  const t = await getTranslations("Admin");
  const label = await badgeLabelIn(design, locale);
  const fields: Record<string, string> = {};
  for (const role of roles) {
    const boxes = roleColourBoxes(role.id);
    fields[boxes.choice] = t("badges.colours.choiceOf", { role: badgeRoleLabel(role, locale) });
    fields[boxes.typed] = t("badges.colours.typedOf", { role: badgeRoleLabel(role, locale) });
  }
  const messages = await refusalMessages(fields);
  // With the one badge for everyone chosen (§NNN) these colours print nowhere: the closed line says so, the colours stay kept for the day the badges go per role.
  const aside =
    design.mode === "single"
      ? t("badges.colours.asideSingle")
      : roles.length === 0
        ? t("badges.colours.none")
        : t("badges.colours.aside", { count: String(roles.filter((role) => role.colour).length), total: String(roles.length) });

  return (
    <Panel glyph="appearance" collapsible level={2} id="box-badge-colours" title={t("badges.colours.title")} aside={aside} data-testid="badge-colours">
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t("badges.colours.intro")}
        </Typography>
        {roles.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="badge-colours-empty">
            {t("badges.colours.empty")}
          </Typography>
        ) : (
          <ActionForm action={saveBadgeRoleColoursAction} scope="badge-colours" messages={messages} data-testid="badge-colours-form">
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={eventId} />
            <Stack spacing={2} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {roles.map((role) => (
                <Box component="li" key={role.id} data-testid="badge-colour-row" data-role-id={role.id}>
                  <input type="hidden" name="roleId" value={role.id} />
                  <Stack spacing={1}>
                    <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        {badgeRoleLabel(role, locale)}
                      </Typography>
                    </Stack>
                    {/* The band as it prints: the colour, the word in the ink the badge sets on it, and the colour in words. */}
                    <RoleColourSample colour={role.colour} label={label} locale={locale} />
                    <RoleColourFields names={roleColourBoxes(role.id)} colour={role.colour} perRoleHelp={false} />
                  </Stack>
                </Box>
              ))}
            </Stack>
            <Box sx={{ mt: 2 }}>
              <GlyphSubmitButton label={t("badges.colours.save")} pendingLabel={t("badges.colours.saving")} icon="save" />
            </Box>
          </ActionForm>
        )}
      </Stack>
    </Panel>
  );
}
