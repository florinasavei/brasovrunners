import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { type CountForm } from "@/i18n/count-form";
import { formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import { ERASE_REASON_MAX } from "../domain";
import type { GroupRunDeclarationListRow } from "../repository";

/**
 * "Declarații semnate (alergare de grup)" on the event's backoffice page (§393, §336): the run's
 * signatures, not the date's (§523). Organizer and Administrator only (§289, BR-REQ-060-01); name and
 * moment only — the identity document and address stay in the PDF. The Administrator erases one or
 * several with a reason (§67, §88, §532).
 *
 * The ticks join the batch form by `form=`, since each row already holds its own form and forms
 * cannot nest; the dialog counts them at the press.
 */
export default async function GroupRunDeclarationsPanel({
  eventId,
  locale,
  timeZone,
  rows,
  mayErase,
  eraseAction,
  batchEraseAction,
  runTitle,
}: {
  eventId: string;
  locale: Locale;
  timeZone: string;
  rows: readonly GroupRunDeclarationListRow[];
  mayErase: boolean;
  eraseAction: ActionFormAction;
  batchEraseAction: ActionFormAction;
  /** The run's name, for the batch dialog: «… pentru «Alergarea de joi»?». */
  runTitle: string;
}) {
  const t = await getTranslations("Admin");
  const messages = mayErase ? await refusalMessages({ reason: t("groupRunDeclarations.reason") }) : null;
  // A set changed meanwhile says so, not "somebody else saved".
  const batchMessages =
    mayErase && rows.length > 0
      ? await refusalMessages({ reason: t("groupRunDeclarations.reason"), declarationIds: t("groupRunDeclarations.ticked") }).then((words) => ({
          ...words,
          errors: { ...words.errors, CONFLICT: t("groupRunDeclarations.batchChanged") },
        }))
      : null;
  const batchForm = `grd-batch-${eventId}`;
  // The three counted forms, with the run named now and `{count}` left for the press.
  const bodyForms = Object.fromEntries(
    Object.entries(t.raw("groupRunDeclarations.batchEraseBody") as Record<CountForm, string>).map(([form, words]) => [form, words.split("{run}").join(runTitle)]),
  ) as Record<CountForm, string>;
  const { cancel } = await confirmWords();
  return (
    <Panel glyph="declaration"
      collapsible
      level={3}
      id="box-group-run-declarations"
      title={t("groupRunDeclarations.title")}
      aside={t("groupRunDeclarations.count", { count: rows.length })}
    >
      <Stack spacing={2} data-testid="group-run-declarations">
        <Typography variant="body2" color="text.secondary">
          {t("groupRunDeclarations.help")}
          <QuietHelp text={t("groupRunDeclarations.helpMore")} />
        </Typography>
        {rows.length === 0 ? (
          <Typography variant="body2">{t("groupRunDeclarations.none")}</Typography>
        ) : (
          rows.map((row) => (
            <Box key={row.id} data-testid="group-run-declaration-row" sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, flexWrap: "wrap", rowGap: 1 }}>
                <Stack direction="row" sx={{ alignItems: "center", flex: 1, minWidth: 0 }}>
                  {/* The batch form's tick, on the `<input>` itself — a `form` on the Checkbox lands on MUI's span. */}
                  {mayErase && batchMessages && (
                    <Checkbox
                      name="declarationIds"
                      value={row.id}
                      slotProps={{ input: { form: batchForm, "aria-label": t("groupRunDeclarations.tick", { name: row.typedName }) } }}
                      sx={CHECKBOX_TAP_TARGET}
                      data-testid="group-run-declaration-tick"
                    />
                  )}
                  <Typography sx={{ fontWeight: 600 }}>{row.typedName}</Typography>
                </Stack>
                {row.series && <Chip size="small" variant="outlined" label={t("groupRunDeclarations.series")} sx={{ alignSelf: { xs: "flex-start", sm: "center" } }} data-testid="group-run-declaration-series" />}
                <Typography variant="body2" color="text.secondary">
                  {t("groupRunDeclarations.signedAt", {
                    when: formatDay(row.acceptedAt, { locale, timeZone, style: "short", withTime: true, position: "inline" }),
                    // §499.
                    version: row.version,
                  })}
                </Typography>
                <GlyphButton
                  icon="pdf"
                  // Under the date signed on; the route checks the pair (§523).
                  href={`/api/admin/events/${row.eventId}/group-run-declarations/${row.id}`}
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
        {mayErase && batchMessages && (
          <ActionForm
            id={batchForm}
            action={batchEraseAction}
            messages={batchMessages}
            confirm={{
              title: t("groupRunDeclarations.batchEraseTitle"),
              body: bodyForms.other,
              bodyCount: { field: "declarationIds", forms: bodyForms, locale },
              confirmLabel: t("groupRunDeclarations.batchErase"),
              cancelLabel: cancel,
              destructive: true,
            }}
            scope="grd-batch"
            data-testid="group-run-declarations-batch"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={eventId} />
            <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
              <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
                {t("groupRunDeclarations.batchTitle")}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t("groupRunDeclarations.batchHelp")}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
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
                  <GlyphButton icon="erase" type="submit" variant="contained" color="error" size="small" sx={{ minHeight: 44 }}>
                    {t("groupRunDeclarations.batchErase")}
                  </GlyphButton>
                </Box>
              </Stack>
            </Box>
          </ActionForm>
        )}
      </Stack>
    </Panel>
  );
}
