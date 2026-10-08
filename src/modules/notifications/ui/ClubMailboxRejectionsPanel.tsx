import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import { type ClubMailboxGroup, clubMailboxesToFix } from "@/modules/notifications/domain/club-mailbox-rejections";
import { causeLabel, shortDay, shortEmailName } from "@/modules/registrations/ui/rejected-email-words";
import Panel from "@/shared/ui/Panel";

/**
 * «Adresele clubului care resping emailuri» (§671), on «Setări → Emailuri», beside «Copiile clubului»: the
 * club's own mailboxes that refused the archive copy, the confirmation notice or a copy of a participant's
 * message in the last thirty days — which no longer light a runner's «Email respins» (the data decision
 * „The runners' own emails tell the truth”) and would otherwise show nowhere. Per address — written only
 * while it is still in the club's settings, else the role's words alone — the role, the last refused
 * message, its day and cause, how many in the window, and the one thing to do.
 *
 * A Server Component, folded; it opens by itself and draws the amber border only while an address still in
 * the club's settings asks for something (`clubMailboxesToFix`) — an address already removed from them says
 * «nu mai e nimic de făcut» and asks for no attention. Drawn only for the roles
 * that read the registrations — the page asserts it on the server (`canReadRegistrations`) and does not draw
 * the panel when nothing was refused. Never a participant's, a subscriber's, an invitee's or a colleague's
 * address: only the club's audience and its copies are read (`listClubMailboxRejections`).
 */
export default async function ClubMailboxRejectionsPanel({ locale, groups }: { locale: Locale; groups: readonly ClubMailboxGroup[] }) {
  const t = await getTranslations("Admin");
  const toFix = clubMailboxesToFix(groups) > 0;
  return (
    <Panel
      glyph="notices"
      collapsible
      tone={toFix ? "risk" : "default"}
      title={t("emails.clubRejections.title")}
      intro={t("emails.clubRejections.intro")}
      aside={t(`emails.clubRejections.aside.${countForm(groups.length, locale)}`, { count: groups.length })}
      openWhen={{ attention: toFix }}
      id="club-mailbox-rejections"
      data-testid="club-mailbox-rejections"
    >
      <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }}>
        {groups.map((group, index) => {
          const role = t(`emails.clubRejections.role.${group.role}`);
          return (
            <Box component="li" key={index} data-testid="club-mailbox-rejection" data-todo={group.todo}>
              <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: "break-word" }}>
                {group.address ? `${group.address} · ${role}` : role}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("emails.clubRejections.last", {
                  message: shortEmailName(group.messageType, locale),
                  date: shortDay(group.at, locale),
                  label: causeLabel(group.cause, locale),
                })}
                {" · "}
                {t(`emails.clubRejections.count.${countForm(group.count, locale)}`, { count: group.count })}
              </Typography>
              <Typography variant="body2">{t(`emails.clubRejections.todo.${group.todo}`)}</Typography>
            </Box>
          );
        })}
      </Stack>
    </Panel>
  );
}
