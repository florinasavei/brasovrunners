import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { ERASE_REASON_MAX, GROUP_RUN_DECLARATION_RETENTION_DAYS } from "../domain";
import type { GroupRunDeclarationListRow } from "../repository";

/**
 * "Declarații semnate (alergare de grup)" on the event's backoffice page (§NNN): who signed the
 * run's optional self-declaration, and when, with each one's PDF. A closed fold (§336).
 *
 * For whoever may read the registrations — the Organizer and the Administrator (§289); the page
 * draws it only for them, and the PDF route asserts it again (BR-REQ-060-01). The name and the
 * moment only: the identity document and the address are in the PDF, which the route writes to
 * the trail. The Administrator may erase one, with a reason (§67, §88): the service refuses anybody
 * else whatever this screen drew.
 */
export default async function GroupRunDeclarationsPanel({
  eventId,
  locale,
  timeZone,
  rows,
  mayErase,
  eraseAction,
}: {
  eventId: string;
  locale: Locale;
  timeZone: string;
  rows: readonly GroupRunDeclarationListRow[];
  mayErase: boolean;
  eraseAction: ActionFormAction;
}) {
  const t = await getTranslations("Admin");
  const messages = mayErase ? await refusalMessages({ reason: t("groupRunDeclarations.reason") }) : null;
  const { cancel } = await confirmWords();
  return (
    <Panel
      collapsible
      level={3}
      id="box-group-run-declarations"
      title={t("groupRunDeclarations.title")}
      aside={t("groupRunDeclarations.count", { count: rows.length })}
    >
      <Stack spacing={2} data-testid="group-run-declarations">
        <Typography variant="body2" color="text.secondary">
          {t("groupRunDeclarations.help", { days: durationPhrase(locale, GROUP_RUN_DECLARATION_RETENTION_DAYS, "days") })}
        </Typography>
        {rows.length === 0 ? (
          <Typography variant="body2">{t("groupRunDeclarations.none")}</Typography>
        ) : (
          rows.map((row) => (
            <Box key={row.id} data-testid="group-run-declaration-row" sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, flexWrap: "wrap", rowGap: 1 }}>
                <Typography sx={{ fontWeight: 600, flex: 1 }}>{row.typedName}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("groupRunDeclarations.signedAt", {
                    when: formatDay(row.acceptedAt, { locale, timeZone, style: "short", withTime: true, position: "inline" }),
                  })}
                </Typography>
                <GlyphButton
                  icon="pdf"
                  href={`/api/admin/events/${eventId}/group-run-declarations/${row.id}`}
                  variant="text"
                  size="small"
                  sx={{ minHeight: 44 }}
                >
                  {t("groupRunDeclarations.pdf")}
                </GlyphButton>
              </Stack>
              {mayErase && messages && (
                <ActionForm
                  action={eraseAction}
                  messages={messages}
                  // The one confirmation dialog (§384): destructive, as every erase is.
                  confirm={{ title: t("groupRunDeclarations.eraseTitle"), body: t("groupRunDeclarations.eraseBody"), confirmLabel: t("groupRunDeclarations.erase"), cancelLabel: cancel, destructive: true }}
                  scope={`grd-${row.id}`}
                  data-testid="group-run-declaration-erase"
                >
                  <input type="hidden" name="uiLocale" value={locale} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="declarationId" value={row.id} />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, mt: 1 }}>
                    <RecallField
                      name="reason"
                      label={t("groupRunDeclarations.reason")}
                      helperText={t("groupRunDeclarations.reasonHelp")}
                      required
                      size="small"
                      slotProps={{ htmlInput: { maxLength: ERASE_REASON_MAX } }}
                      sx={{ flex: 1 }}
                    />
                    <Box>
                      <GlyphButton icon="delete" type="submit" variant="outlined" color="error" size="small" sx={{ minHeight: 44 }}>
                        {t("groupRunDeclarations.erase")}
                      </GlyphButton>
                    </Box>
                  </Stack>
                </ActionForm>
              )}
            </Box>
          ))
        )}
      </Stack>
    </Panel>
  );
}
