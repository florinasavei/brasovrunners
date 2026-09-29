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
import { shortTextHash } from "@/modules/legal-documents/domain/signed-text";
import DeclarationHoldForm from "@/modules/registrations/ui/DeclarationHoldForm";
import TextHashTip from "@/modules/registrations/ui/TextHashTip";
import { ERASE_REASON_MAX } from "../domain";
import type { GroupRunDeclarationListRow } from "../repository";

/**
 * "Declarații semnate (alergare de grup)" on the event's backoffice page (§393): who signed the
 * run's optional self-declaration, and when, with each one's PDF. A closed fold (§336). The run's,
 * not the date's (§523): one signature covers every date of a repeated run, so every date's page
 * lists the same people, one row each.
 *
 * For whoever may read the registrations — the Organizer and the Administrator (§289); the page
 * draws it only for them, and the PDF route asserts it again (BR-REQ-060-01). The name and the
 * moment only: the identity document and the address are in the PDF, which the route writes to
 * the trail. The Administrator may erase one, with a reason (§67, §88): the service refuses anybody
 * else whatever this screen drew.
 *
 * Or several (§532; the owner, 2026-09-28: «batch delete și la declarații, cu confirmarea numărului
 * șters»): a tick per row, one reason, «Șterge cele bifate». The ticks belong to the batch form
 * below the list by `form=` — each row already holds its own erase form, and forms cannot nest —
 * and the dialog counts them at the press («Ștergi 2 declarații semnate pentru «…»?»). What is
 * posted is the ids counted; the service refuses the whole press if that set is no longer the run's.
 */
export default async function GroupRunDeclarationsPanel({
  eventId,
  locale,
  timeZone,
  rows,
  mayErase,
  eraseAction,
  batchEraseAction,
  holdAction,
  runTitle,
}: {
  eventId: string;
  locale: Locale;
  timeZone: string;
  rows: readonly GroupRunDeclarationListRow[];
  mayErase: boolean;
  eraseAction: ActionFormAction;
  batchEraseAction: ActionFormAction;
  /** «Păstrează: reclamație / litigiu în curs» and its release (§556), the Administrator's. */
  holdAction: ActionFormAction;
  /** The run's name, for the batch dialog: «… pentru «Alergarea de joi»?». */
  runTitle: string;
}) {
  const t = await getTranslations("Admin");
  // A held declaration refuses the erase with its own code, DECLARATION_HELD (§556), which `Admin.errors` words.
  const messages = mayErase ? await refusalMessages({ reason: t("groupRunDeclarations.reason") }) : null;
  // The batch form's refusals: a set that changed meanwhile says so, not "somebody else saved".
  const batchMessages =
    mayErase && rows.length > 0
      ? await refusalMessages({ reason: t("groupRunDeclarations.reason"), declarationIds: t("groupRunDeclarations.ticked") }).then((words) => ({
          ...words,
          // A set that changed meanwhile: nothing was erased. A held one among the ticked is DECLARATION_HELD (§556).
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
                {/* Signed for the whole series (§523): the one signature every date of the run lists. */}
                {row.series && <Chip size="small" variant="outlined" label={t("groupRunDeclarations.series")} sx={{ alignSelf: { xs: "flex-start", sm: "center" } }} data-testid="group-run-declaration-series" />}
                <Typography variant="body2" color="text.secondary">
                  {t("groupRunDeclarations.signedAt", {
                    when: formatDay(row.acceptedAt, { locale, timeZone, style: "short", withTime: true, position: "inline" }),
                    // The version signed (§499), in the shape the registration's page gives a declaration's.
                    version: row.version,
                  })}
                </Typography>
                {/* The proof of signing (§556): the signed text's fingerprint, twelve characters and the whole in a tooltip. */}
                {row.textHash && (
                  <Typography variant="body2" color="text.secondary">
                    <TextHashTip label={t("declarationHold.textHash")} hash={row.textHash} short={shortTextHash(row.textHash)} />
                  </Typography>
                )}
                <GlyphButton
                  icon="pdf"
                  // Under the date it was signed on (§523): the list is the run's, the route checks the pair.
                  href={`/api/admin/events/${row.eventId}/group-run-declarations/${row.id}`}
                  variant="text"
                  size="small"
                  sx={{ minHeight: 44 }}
                >
                  {t("groupRunDeclarations.pdf")}
                </GlyphButton>
              </Stack>
              {/* «Păstrează: reclamație / litigiu în curs» (§556): the line for every reader, the form for the Administrator. */}
              <DeclarationHoldForm
                groupRunAction={holdAction}
                hidden={{ uiLocale: locale, eventId, declarationId: row.id }}
                held={
                  row.retentionHold
                    ? {
                        when: row.retentionHoldAt ? formatDay(row.retentionHoldAt, { locale, timeZone, style: "short", withTime: true, position: "inline" }) : "—",
                        who: row.retentionHoldByName,
                        reason: row.retentionHoldReason ?? "",
                      }
                    : null
                }
                mayManage={mayErase}
                scope={`grd-hold-${row.id}`}
              />
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
        {mayErase && batchMessages && (
          <ActionForm
            id={batchForm}
            action={batchEraseAction}
            messages={batchMessages}
            // The one dialog (§384), its body counted from the ticks at the press (`bodyCount`).
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
