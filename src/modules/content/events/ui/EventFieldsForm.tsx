import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { EVENT_KINDS } from "@/modules/events/domain/event-kind";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import {
  EVENT_STATUS_LABEL,
  REGISTRATION_MODE_LABEL,
} from "@/modules/staff-identity/domain/staff-labels";
import type { EditableEvent } from "../repository";

/**
 * Every column of `events` an organizer owns, as form inputs.
 *
 * One component for the create form and the edit form, so the two cannot drift in what they
 * post — `actions.ts#eventFieldsFrom` reads exactly these names, and a field renamed here and
 * not there would silently start saving "not stated".
 *
 * Every name is namespaced `event.<column>`. The editor is one form carrying the event row and
 * both languages at once, and `translations.ro.title` and `event.startsAtWallTime` cannot
 * collide when each says which half of the event it belongs to.
 *
 * It renders the inputs, not the `<form>`: `<Stack component="form" action={...}>` crashes in
 * MUI 9, so every caller wraps a plain `<form>` around this.
 */

const EVENT_STATUSES = ["SCHEDULED", "CANCELLED", "COMPLETED"] as const;
const REGISTRATION_MODES = ["NONE", "INTERNAL", "EXTERNAL"] as const;

/** The club's own zone. Offered as the default rather than the browser's, which on a phone in
 * an airport is not where the race is. */
const DEFAULT_TIMEZONE = "Europe/Bucharest";

export type DeclarationOption = { id: string; version: number; title: string };

export default async function EventFieldsForm({
  event,
  declarations,
}: {
  /** The event being edited, or null on the create form. */
  event: EditableEvent | null;
  declarations: readonly DeclarationOption[];
}) {
  const t = await getTranslations("Admin");
  // The kind labels already exist for the public pages, and an event kind reads the same to an
  // organizer as to a visitor. Two catalogues of the same seven words would drift.
  const tEvent = await getTranslations("Event");
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          select
          name="event.kind"
          label={t("editor.kind")}
          defaultValue={event?.kind ?? "COMMUNITY_RUN"}
          sx={{ flex: 1 }}
          required
        >
          {EVENT_KINDS.map((kind) => (
            <MenuItem key={kind} value={kind}>
              {tEvent(`kind.${kind}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          name="event.eventStatus"
          label={t("editor.eventStatus")}
          defaultValue={event?.eventStatus ?? "SCHEDULED"}
          sx={{ flex: 1 }}
          required
        >
          {EVENT_STATUSES.map((status) => (
            <MenuItem key={status} value={status}>
              {EVENT_STATUS_LABEL[status]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <TextField
        name="event.timezone"
        label={t("editor.timezone")}
        helperText={t("editor.timezoneHelp")}
        defaultValue={zone}
        required
      />

      <TextField
        name="event.startsAtWallTime"
        type="datetime-local"
        label={t("editor.startsAt")}
        helperText={t("editor.startsAtHelp", { timezone: zone })}
        defaultValue={toWallTimeInput(event?.startsAt ?? null, zone)}
        slotProps={{ inputLabel: { shrink: true } }}
        required
      />
      <TextField
        name="event.raceStartsAtWallTime"
        type="datetime-local"
        label={t("editor.raceStartsAt")}
        helperText={t("editor.raceStartsAtHelp")}
        defaultValue={toWallTimeInput(event?.raceStartsAt ?? null, zone)}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        name="event.endsAtWallTime"
        type="datetime-local"
        label={t("editor.endsAt")}
        helperText={t("editor.endsAtHelp")}
        defaultValue={toWallTimeInput(event?.endsAt ?? null, zone)}
        slotProps={{ inputLabel: { shrink: true } }}
      />

      {/*
        The place, and the two facts about taking part, once (`DECISIONS.md` §36).
        These used to sit in each language's panel and be typed twice — and the second copy was
        never a translation, it was the same answer again.
      */}
      <TextField
        name="event.locationName"
        label={t("editor.fields.locationName")}
        helperText={t("editor.sharedFieldHelp")}
        defaultValue={event?.locationName ?? ""}
        required
      />
      <TextField
        name="event.locationAddress"
        label={t("editor.fields.locationAddress")}
        defaultValue={event?.locationAddress ?? ""}
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          name="event.difficultyLabel"
          label={t("editor.fields.difficultyLabel")}
          defaultValue={event?.difficultyLabel ?? ""}
          sx={{ flex: 1 }}
        />
        <TextField
          name="event.costText"
          label={t("editor.fields.costText")}
          helperText={t("editor.costHelp")}
          defaultValue={event?.costText ?? ""}
          sx={{ flex: 1 }}
        />
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          name="event.latitude"
          label={t("editor.latitude")}
          defaultValue={event?.latitude ?? ""}
          inputMode="decimal"
          sx={{ flex: 1 }}
        />
        <TextField
          name="event.longitude"
          label={t("editor.longitude")}
          defaultValue={event?.longitude ?? ""}
          inputMode="decimal"
          sx={{ flex: 1 }}
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {t("editor.coordinatesHelp")}
      </Typography>

      <TextField
        name="event.mapUrl"
        type="url"
        label={t("editor.mapUrl")}
        helperText={t("editor.mapUrlHelp")}
        defaultValue={event?.mapUrl ?? ""}
        inputMode="url"
      />

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          name="event.distanceMeters"
          label={t("editor.distanceMeters")}
          helperText={t("editor.distanceMetersHelp")}
          defaultValue={event?.distanceMeters ?? ""}
          inputMode="numeric"
          sx={{ flex: 1 }}
        />
        <TextField
          name="event.elevationGainMeters"
          label={t("editor.elevationGainMeters")}
          defaultValue={event?.elevationGainMeters ?? ""}
          inputMode="numeric"
          sx={{ flex: 1 }}
        />
      </Stack>

      <FormControlLabel
        control={<Checkbox name="event.featured" defaultChecked={event?.featured ?? false} />}
        label={t("editor.featured")}
      />
      <Typography variant="body2" color="text.secondary">
        {t("editor.featuredHelp")}
      </Typography>

      {/* The registration block. The database refuses the combinations that do not go
          together, and the service says which one in words before it gets there. */}
      <Typography variant="h3" sx={{ fontSize: "1rem", pt: 1 }}>
        {t("editor.registrationSection")}
      </Typography>

      <TextField
        select
        name="event.registrationMode"
        label={t("editor.registrationMode")}
        helperText={t("editor.registrationModeHelp")}
        defaultValue={event?.registrationMode ?? "NONE"}
        required
      >
        {REGISTRATION_MODES.map((mode) => (
          <MenuItem key={mode} value={mode}>
            {REGISTRATION_MODE_LABEL[mode]}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        name="event.capacity"
        label={t("editor.capacity")}
        helperText={t("editor.capacityHelp")}
        defaultValue={event?.capacity ?? ""}
        inputMode="numeric"
      />

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          name="event.registrationOpensAtWallTime"
          type="datetime-local"
          label={t("editor.registrationOpensAt")}
          defaultValue={toWallTimeInput(event?.registrationOpensAt ?? null, zone)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ flex: 1 }}
        />
        <TextField
          name="event.registrationClosesAtWallTime"
          type="datetime-local"
          label={t("editor.registrationClosesAt")}
          defaultValue={toWallTimeInput(event?.registrationClosesAt ?? null, zone)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ flex: 1 }}
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {t("editor.registrationWindowHelp")}
      </Typography>

      {/*
        A choice among approved versions, never an editor. AGENTS.md §11.1 keeps legal text out
        of the CMS entirely: this select can point an event at a version, and nothing anywhere
        in the backoffice can change a word of one.
      */}
      <TextField
        select
        name="event.declarationDocumentId"
        label={t("editor.declarationDocument")}
        helperText={
          declarations.length === 0
            ? t("editor.declarationNone")
            : t("editor.declarationDocumentHelp")
        }
        defaultValue={event?.declarationDocumentId ?? ""}
      >
        <MenuItem value="">{t("editor.declarationUnset")}</MenuItem>
        {declarations.map((document) => (
          <MenuItem key={document.id} value={document.id}>
            v{document.version} · {document.title}
          </MenuItem>
        ))}
      </TextField>

      {/*
        The start list, off unless somebody deliberately turns it on (BR-REQ-039-01).

        A checkbox rather than a select, because there are two values and one of them is a
        disclosure: an unchecked box is `HIDDEN`, which is what an absent field must mean. The
        help text says what turning it on actually publishes, in the words a participant would
        read, because that is the decision being made here.
      */}
      <FormControlLabel
        control={
          <Checkbox
            name="event.participantListVisibility"
            defaultChecked={event?.participantListVisibility === "NAMES"}
          />
        }
        label={t("editor.participantList")}
      />
      <Typography variant="body2" color="text.secondary">
        {t("editor.participantListHelp")}
      </Typography>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          name="event.externalProvider"
          label={t("editor.externalProvider")}
          defaultValue={event?.externalProvider ?? ""}
          sx={{ flex: 1 }}
        />
        <TextField
          name="event.externalRegistrationUrl"
          type="url"
          label={t("editor.externalRegistrationUrl")}
          defaultValue={event?.externalRegistrationUrl ?? ""}
          inputMode="url"
          sx={{ flex: 1 }}
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {t("editor.externalHelp")}
      </Typography>
    </Stack>
  );
}
