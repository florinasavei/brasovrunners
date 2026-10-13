import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { addGpxCheckpointsAction, saveCheckpointsAction } from "@/app/[locale]/admin/events/[id]/checkpoint-actions";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import {
  CHECKPOINT_KINDS,
  CHECKPOINT_NAME_MAX,
  CHECKPOINT_NOTE_MAX,
  CHECKPOINTS_MAX,
  type Checkpoint,
  checkpointBox,
} from "@/modules/event-checkpoints/domain/checkpoint";
import { type GpxProposal, MAX_OFF_TRACK_METERS } from "@/modules/event-checkpoints/domain/gpx-waypoints";
import ActionForm from "@/shared/forms/ActionForm";
import TimeField from "@/shared/forms/pickers/TimeField";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

/** The glyph before «Scoate»: the delete verb's, by name from the verbs' registry (§318). */
const RemoveGlyph = ACTION_ICONS.delete;

/** How many empty rows the card draws under the saved ones, for points to be typed in this sitting. */
const SPARE_ROWS = 3;

type Props = {
  locale: Locale;
  eventId: string;
  /** The saved checkpoints, by distance. */
  checkpoints: readonly Checkpoint[];
  /** `canEditCheckpoints` — the Organizer and the Administrators; `changeCheckpoints` asserts it again. */
  mayEdit: boolean;
  /** The route's length in kilometres (the distance typed, else the GPX's), or null while the event says none. */
  routeKm: number | null;
  /**
   * The route's GPX waypoints that can be placed on its track, or null while the file has none (or
   * is not readable): offers «Ia punctele din GPX». `key` is the file the preview is made from.
   */
  gpx: { key: string; offered: readonly GpxProposal[]; ignored: number; beyondRoute?: number } | null;
  /** The GPX's preview is open (`?checkpointsGpx=1`). */
  previewOpen: boolean;
};

/**
 * «Puncte de control» (§NNN; the owner, 2026-10-13: «other things for the route: I need to put
 * checkpoints and limit times»): the card of the event editor where the route's points are kept —
 * a name in both languages, the kilometre, what is there (water, food, first aid, timing), an
 * optional cut-off and an optional note — and, when the route's GPX has waypoints, the one press
 * that takes them («Ia punctele din GPX»: a preview first, then what the club ticks is added).
 *
 * It belongs to «Traseul» (the page's sections list it nested there, and «Traseul» links to it) and it sits **beside the editor's save form, never
 * inside it**: HTML forms cannot nest, and a refusal here (a kilometre beyond the route, a cut-off
 * before the start or after a later point's) must keep what was typed here and nothing of the
 * event's other boxes — the same shape as «De făcut pentru pagina evenimentului» (§749). Its own
 * forms are plain posts that work with scripts off, and their own save: «Salvează punctele».
 *
 * The list is in distance order — the club never orders it, it types the kilometre. A saved point is
 * removed by ticking «Scoate» on it; the rows left empty at the foot are for new ones.
 */
export default async function CheckpointsCard({ locale, eventId, checkpoints, mayEdit, routeKm, gpx, previewOpen }: Props) {
  const t = await getTranslations("Admin");
  const count = checkpoints.length;
  const km = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);

  const boxMessages = await refusalMessages({
    "cp[].nameRo": t("checkpoints.field.nameRo"),
    "cp[].nameEn": t("checkpoints.field.nameEn"),
    "cp[].km": t("checkpoints.field.km"),
    "cp[].kinds": t("checkpoints.field.kinds"),
    "cp[].cutoff": t("checkpoints.field.cutoff"),
    "cp[].noteRo": t("checkpoints.field.noteRo"),
    "cp[].noteEn": t("checkpoints.field.noteEn"),
  });

  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
    </>
  );

  /** One point's boxes: a saved row (with «Scoate») or a spare one. */
  const rowFields = (index: number, saved: Checkpoint | null) => (
    <Stack spacing={1.5} data-testid={saved ? "checkpoint-edit-row" : "checkpoint-new-row"}>
      <input type="hidden" name={checkpointBox(index, "id")} value={saved?.id ?? ""} />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <RecallField
          name={checkpointBox(index, "km")}
          label={t("checkpoints.field.km")}
          helperText={saved ? undefined : routeKm !== null ? t("checkpoints.field.kmHelp", { max: km(routeKm) }) : t("checkpoints.field.kmHelpNoRoute")}
          defaultValue={saved ? String(saved.km) : ""}
          size="small"
          sx={{ flex: { sm: "0 0 160px" } }}
          slotProps={{ htmlInput: { inputMode: "decimal", maxLength: 8, autoComplete: "off" } }}
        />
        <RecallField
          name={checkpointBox(index, "nameRo")}
          label={t("checkpoints.field.nameRo")}
          defaultValue={saved?.nameRo ?? ""}
          size="small"
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { maxLength: CHECKPOINT_NAME_MAX } }}
        />
        <RecallField
          name={checkpointBox(index, "nameEn")}
          label={t("checkpoints.field.nameEn")}
          defaultValue={saved?.nameEn ?? ""}
          size="small"
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { maxLength: CHECKPOINT_NAME_MAX } }}
        />
      </Stack>
      <Box>
        <Typography variant="caption" component="p" color="text.secondary" sx={{ m: 0 }}>
          {t("checkpoints.field.kinds")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 2 }}>
          {CHECKPOINT_KINDS.map((kind) => (
            <CheckboxField key={kind} name={checkpointBox(index, "kinds")} value={kind} defaultChecked={saved?.kinds.includes(kind) ?? false}>
              {t(`checkpoints.kinds.${kind}`)}
            </CheckboxField>
          ))}
        </Box>
      </Box>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TimeField
          name={checkpointBox(index, "cutoff")}
          label={t("checkpoints.field.cutoff")}
          helperText={t("checkpoints.field.cutoffHelp")}
          defaultValue={saved?.cutoff ?? ""}
          size="small"
          sx={{ flex: { sm: "0 0 160px" } }}
        />
        <RecallField
          name={checkpointBox(index, "noteRo")}
          label={t("checkpoints.field.noteRo")}
          helperText={t("checkpoints.field.noteHelp", { max: String(CHECKPOINT_NOTE_MAX) })}
          defaultValue={saved?.noteRo ?? ""}
          size="small"
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { maxLength: CHECKPOINT_NOTE_MAX } }}
        />
        <RecallField
          name={checkpointBox(index, "noteEn")}
          label={t("checkpoints.field.noteEn")}
          defaultValue={saved?.noteEn ?? ""}
          size="small"
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { maxLength: CHECKPOINT_NOTE_MAX } }}
        />
      </Stack>
      {saved && (
        <CheckboxField name={checkpointBox(index, "remove")} help={t("checkpoints.removeHelp")}>
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
            <RemoveGlyph aria-hidden fontSize="small" />
            {t("checkpoints.remove")}
          </Box>
        </CheckboxField>
      )}
    </Stack>
  );

  const summary =
    count === 0 ? t("checkpoints.summaryNone") : t(`checkpoints.summary.${countForm(count, locale)}`, { count });

  /** What a role that may only read sees: the list, as words. */
  const readOnly = (
    <Stack spacing={1}>
      <Alert severity="info">{t("checkpoints.readOnly")}</Alert>
      {count === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("checkpoints.empty")}
        </Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }} data-testid="checkpoints-read-only">
          {checkpoints.map((row) => (
            <li key={row.id}>
              {/* Only what the point has: no bare dash for no kinds, and «fără oră limită» as the public table says it. */}
              {[
                t("checkpoints.rowTitle", { km: km(row.km), name: locale === "ro" ? row.nameRo : row.nameEn }),
                row.kinds.map((kind) => t(`checkpoints.kinds.${kind}`)).join(", "),
                row.cutoff ? t("checkpoints.cutoffAside", { time: row.cutoff }) : t("checkpoints.noCutoff"),
              ]
                .filter((part) => part !== "")
                .join(" · ")}
            </li>
          ))}
        </Box>
      )}
    </Stack>
  );

  const alreadyThere = (proposal: GpxProposal) => checkpoints.some((row) => row.km === proposal.km && (row.nameRo === proposal.name || row.nameEn === proposal.name));

  /** «Ia punctele din GPX»: the file's waypoints placed on its track, each to be ticked before it is added. */
  const gpxOffer =
    gpx &&
    (previewOpen ? (
      <Panel glyph="checkpoints" collapsible level={3} id="box-checkpoints-gpx" title={t("checkpoints.gpx.title")} openWhen={{ primary: true }} data-testid="checkpoints-gpx-preview">
        <ActionForm action={addGpxCheckpointsAction} scope="checkpoints-gpx" messages={boxMessages}>
          {hidden}
          <input type="hidden" name="gpxKey" value={gpx.key} />
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {t("checkpoints.gpx.intro")}
            </Typography>
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {gpx.offered.map((proposal, at) => (
                <Box component="li" key={`${proposal.km}-${proposal.name}`} data-testid="checkpoints-gpx-row" sx={{ py: 0.5 }}>
                  {alreadyThere(proposal) ? (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1.25 }}>
                      {t("checkpoints.gpx.already", { km: km(proposal.km), name: proposal.name })}
                    </Typography>
                  ) : (
                    <Stack spacing={1}>
                      <CheckboxField name="pick" value={String(at)} defaultChecked>
                        {t("checkpoints.gpx.row", {
                          km: km(proposal.km),
                          name: proposal.name,
                          kinds: proposal.kinds.map((kind) => t(`checkpoints.kinds.${kind}`)).join(", ") || t("checkpoints.gpx.noKinds"),
                        })}
                      </CheckboxField>
                      {/* A name in each language (§352): the file's one name goes in the Romanian box, the English one is the club's to write. */}
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ pl: { sm: 4 } }}>
                        <RecallField
                          name={checkpointBox(at, "nameRo")}
                          label={t("checkpoints.field.nameRo")}
                          defaultValue={proposal.name}
                          size="small"
                          sx={{ flex: 1 }}
                          slotProps={{ htmlInput: { maxLength: CHECKPOINT_NAME_MAX } }}
                        />
                        <RecallField
                          name={checkpointBox(at, "nameEn")}
                          label={t("checkpoints.field.nameEn")}
                          defaultValue=""
                          size="small"
                          sx={{ flex: 1 }}
                          slotProps={{ htmlInput: { maxLength: CHECKPOINT_NAME_MAX } }}
                        />
                      </Stack>
                    </Stack>
                  )}
                </Box>
              ))}
            </Box>
            {gpx.ignored > 0 && (
              <Typography variant="caption" color="text.secondary">
                {t(`checkpoints.gpx.ignored.${countForm(gpx.ignored, locale)}`, { count: gpx.ignored, meters: MAX_OFF_TRACK_METERS })}
              </Typography>
            )}
            {(gpx.beyondRoute ?? 0) > 0 && routeKm !== null && (
              <Typography variant="caption" color="text.secondary" data-testid="checkpoints-gpx-beyond">
                {t(`checkpoints.gpx.beyond.${countForm(gpx.beyondRoute ?? 0, locale)}`, { count: gpx.beyondRoute ?? 0, km: km(routeKm) })}
              </Typography>
            )}
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
              <GlyphSubmitButton label={t("checkpoints.gpx.add")} pendingLabel={t("checkpoints.gpx.adding")} icon="add" />
              <GlyphButtonLink
                icon="dismiss"
                href={{ pathname: "/admin/events/[id]", params: { id: eventId }, hash: "box-checkpoints" }}
                variant="outlined"
                size="small"
                sx={{ minHeight: 44 }}
              >
                {t("checkpoints.gpx.close")}
              </GlyphButtonLink>
            </Stack>
          </Stack>
        </ActionForm>
      </Panel>
    ) : (
      <Box>
        <GlyphButtonLink
          icon="template"
          href={{ pathname: "/admin/events/[id]", params: { id: eventId }, query: { checkpointsGpx: "1" }, hash: "box-checkpoints-gpx" }}
          variant="outlined"
          size="small"
          sx={{ minHeight: 44 }}
          data-testid="checkpoints-gpx-offer"
        >
          {t("checkpoints.gpx.take", { count: gpx.offered.length })}
        </GlyphButtonLink>
      </Box>
    ));

  return (
    <Panel glyph="checkpoints" collapsible id="box-checkpoints" title={t("checkpoints.title")} aside={summary} openWhen={{ primary: count === 0 && mayEdit }} data-testid="event-checkpoints-card">
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {t("checkpoints.intro")}
        </Typography>
        {routeKm !== null && (
          <Typography variant="body2" data-testid="checkpoints-route-length">
            {t("checkpoints.routeLength", { km: km(routeKm) })}
          </Typography>
        )}
        {!mayEdit ? (
          readOnly
        ) : (
          <>
            {gpxOffer}
            <ActionForm action={saveCheckpointsAction} scope="checkpoints" messages={boxMessages} data-testid="checkpoints-form">
              {hidden}
              <Stack spacing={2}>
                {checkpoints.map((row, index) => (
                  <Panel
                    key={row.id}
                    glyph="checkpoints"
                    collapsible
                    level={3}
                    title={t("checkpoints.rowTitle", { km: km(row.km), name: locale === "ro" ? row.nameRo : row.nameEn })}
                    aside={row.cutoff ? t("checkpoints.cutoffAside", { time: row.cutoff }) : undefined}
                    data-testid="checkpoint-card"
                  >
                    {rowFields(index, row)}
                  </Panel>
                ))}
                {count < CHECKPOINTS_MAX ? (
                  <Panel glyph="add" collapsible level={3} title={t("checkpoints.add.title")} openWhen={{ primary: count === 0 }} data-testid="checkpoint-add">
                    <Stack spacing={2.5}>
                      {Array.from({ length: Math.min(SPARE_ROWS, CHECKPOINTS_MAX - count) }, (_, spare) => (
                        <Box key={spare} sx={{ borderTop: spare > 0 ? 1 : 0, borderColor: "divider", pt: spare > 0 ? 2 : 0 }}>
                          {rowFields(count + spare, null)}
                        </Box>
                      ))}
                    </Stack>
                  </Panel>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t("checkpoints.full", { max: String(CHECKPOINTS_MAX) })}
                  </Typography>
                )}
                <Box>
                  <GlyphSubmitButton label={t("checkpoints.save")} pendingLabel={t("checkpoints.saving")} icon="save" />
                </Box>
              </Stack>
            </ActionForm>
          </>
        )}
      </Stack>
    </Panel>
  );
}
