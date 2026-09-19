import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { EVENT_SURFACES, EVENT_TYPES, hasProgramme, takesRegistrations } from "@/modules/events/domain/event-type";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import GlyphSelect from "./GlyphSelect";
import OnlyForType from "./OnlyForType";
import ScheduleRowsEditor from "./ScheduleRowsEditor";
import WallTimeField from "./WallTimeField";
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
  // The type and surface labels already exist for the public pages, and they read the same to
  // an organizer as to a visitor. Two catalogues of the same eight words would drift.
  const tEvent = await getTranslations("Event");
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;
  // The programme's rows as wall-clock boxes in the event's zone (§117).
  const scheduleRows = readScheduleItems(event?.scheduleItems ?? null).map((item) => {
    const start = toWallTimeInput(new Date(item.startsAt), zone);
    const end = item.endsAt ? toWallTimeInput(new Date(item.endsAt), zone) : "";
    return { date: start.slice(0, 10), time: start.slice(11, 16), endTime: end.slice(11, 16), ro: item.label.ro, en: item.label.en, place: item.place ?? "" };
  });

  return (
    <Stack spacing={2}>
      {/*
        Two questions where there was one (`DECISIONS.md` §61): what the event is, then what it
        is run on. The surface has an empty option and the type does not — a coffee is run on
        nothing, but every event is one of the five types.
      */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        {/* The closed sets with their glyphs (§121), the same the public pages show (§112). */}
        <GlyphSelect
          name="event.type"
          label={t("editor.type")}
          helperText={t("editor.typeHelp")}
          defaultValue={event?.type ?? "GROUP_RUN"}
          options={EVENT_TYPES.map((type) => ({ value: type, label: tEvent(`type.${type}`), glyph: `type:${type}` as const }))}
          sx={{ flex: 1 }}
          required
        />
        <GlyphSelect
          name="event.surface"
          label={t("editor.surface")}
          defaultValue={event?.surface ?? ""}
          options={[
            { value: "", label: t("editor.notStated") },
            ...EVENT_SURFACES.map((surface) => ({ value: surface, label: tEvent(`surface.${surface}`), glyph: `surface:${surface}` as const })),
          ]}
          sx={{ flex: 1 }}
        />
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

      {/* A date and a 24-hour time each, whatever clock the browser speaks (§70). */}
      <WallTimeField
        name="event.startsAt"
        label={t("editor.startsAt")}
        timeLabel={t("editor.timeOfDay")}
        helperText={t("editor.startsAtHelp", { timezone: zone })}
        value={event?.startsAt ?? null}
        zone={zone}
        required
      />
      {/* Only a race has a gun time apart from the meeting time (§71); the field follows the
          type select and is empty — and ignored — for anything else. */}
      <OnlyForType type="RACE" selectName="event.type" initialType={event?.type ?? "GROUP_RUN"}>
        <WallTimeField
          name="event.raceStartsAt"
          label={t("editor.raceStartsAt")}
          timeLabel={t("editor.timeOfDay")}
          helperText={t("editor.raceStartsAtHelp")}
          value={event?.raceStartsAt ?? null}
          zone={zone}
        />
      </OnlyForType>
      {/* How long, not when it ends: the end is derived (§71). */}
      <TextField
        name="event.durationMinutes"
        type="number"
        label={t("editor.durationMinutes")}
        helperText={t("editor.durationMinutesHelp")}
        defaultValue={
          event?.endsAt && event.startsAt
            ? Math.round((event.endsAt.getTime() - event.startsAt.getTime()) / 60_000)
            : ""
        }
        // `step` is measured from `min`, so `min: 1, step: 5` made 120 invalid ("the two
        // nearest valid values are 116 and 121"). Any whole minute is a duration.
        slotProps={{ htmlInput: { min: 1, max: 7 * 24 * 60, step: 1 } }}
        inputMode="numeric"
        sx={{ width: 220 }}
      />

      {/* The programme as rows (§117) — not on a group run (§111), like the registration block. */}
      <OnlyForType type={EVENT_TYPES.filter(hasProgramme)} selectName="event.type" initialType={event?.type ?? "GROUP_RUN"}>
        <Stack spacing={1}>
          <Typography variant="h3" sx={{ fontSize: "1rem", pt: 1 }}>
            {t("editor.programmeSection")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("editor.programmeHelp")}
          </Typography>
          <ScheduleRowsEditor
            initial={scheduleRows}
            labels={{
              date: t("editor.programmeRows.date"),
              time: t("editor.programmeRows.time"),
              endTime: t("editor.programmeRows.endTime"),
              ro: t("editor.programmeRows.ro"),
              en: t("editor.programmeRows.en"),
              place: t("editor.programmeRows.place"),
              add: t("editor.programmeRows.add"),
              remove: t("editor.programmeRows.remove"),
              empty: t("editor.programmeRows.empty"),
            }}
          />
        </Stack>
      </OnlyForType>

      {/*
        The place, and the two facts about taking part, once (`DECISIONS.md` §36).
        These used to sit in each language's panel and be typed twice — and the second copy was
        never a translation, it was the same answer again.
      */}
      {/*
        One field for the place (the owner, 2026-09-18: "meeting point and address are a bit
        redundant"): a name, a street, or both, as one would tell a friend. The column the
        second box wrote, `location_address`, stays for the rows that have one and is shown
        where it exists; nothing writes it any more.
      */}
      <TextField
        name="event.locationName"
        label={t("editor.fields.locationName")}
        helperText={t("editor.locationHelp")}
        defaultValue={[event?.locationName, event?.locationAddress].filter(Boolean).join(", ")}
        required
      />
      {/*
        Closed sets since migration `0018`, so the organizer picks rather than types — which is
        what lets the public page render each in the reader's own language instead of in the
        words whoever filled the form was thinking in.

        The empty option is deliberate and first: "not stated" is a real answer, and the page
        omits the row entirely rather than guessing that an event with no stated cost is free.
      */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <GlyphSelect
          name="event.difficulty"
          label={t("editor.fields.difficulty")}
          defaultValue={event?.difficulty ?? ""}
          options={[
            { value: "", label: t("editor.notStated") },
            ...(["EASY", "MODERATE", "HARD"] as const).map((value) => ({ value, label: t(`editor.difficultyValues.${value}`), glyph: `difficulty:${value}` as const })),
          ]}
          sx={{ flex: 1 }}
        />
        <GlyphSelect
          name="event.costType"
          label={t("editor.fields.costType")}
          helperText={t("editor.costHelp")}
          defaultValue={event?.costType ?? ""}
          options={[
            { value: "", label: t("editor.notStated") },
            ...(["FREE", "PAID"] as const).map((value) => ({ value, label: t(`editor.costValues.${value}`), glyph: `cost:${value}` as const })),
          ]}
          sx={{ flex: 1 }}
        />
      </Stack>

      {/* Where to meet, as one pasted link. Coordinates were asked for here until `DECISIONS.md`
          §61: two decimal numbers to produce a link the organizer could paste in one move. */}
      <TextField
        name="event.mapUrl"
        type="url"
        label={t("editor.mapUrl")}
        helperText={t("editor.mapUrlHelp")}
        defaultValue={event?.mapUrl ?? ""}
        inputMode="url"
      />

      {/*
        The course, and a separate question from the one above: where a runner turns up and
        where they then run are two different pages on two different services more often than
        they are one (`DECISIONS.md` §49).
      */}
      <TextField
        name="event.routeUrl"
        type="url"
        label={t("editor.routeUrl")}
        helperText={t("editor.routeUrlHelp")}
        defaultValue={event?.routeUrl ?? ""}
        inputMode="url"
      />

      {/* The club's Strava group event for this occurrence (criterion 10). */}
      <TextField
        name="event.stravaEventUrl"
        type="url"
        label={t("editor.stravaEventUrl")}
        helperText={t("editor.stravaEventUrlHelp")}
        defaultValue={event?.stravaEventUrl ?? ""}
        inputMode="url"
      />

      {/* The Facebook event for this occurrence (§144). */}
      <TextField
        name="event.facebookEventUrl"
        type="url"
        label={t("editor.facebookEventUrl")}
        helperText={t("editor.facebookEventUrlHelp")}
        defaultValue={event?.facebookEventUrl ?? ""}
        inputMode="url"
      />

      {/* The other organization the event is held with (§121): a name, and its page. */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          name="event.coHostName"
          label={t("editor.coHostName")}
          defaultValue={event?.coHostName ?? ""}
          slotProps={{ htmlInput: { maxLength: 200 } }}
          sx={{ flex: 1 }}
        />
        <TextField
          name="event.coHostUrl"
          type="url"
          label={t("editor.coHostUrl")}
          defaultValue={event?.coHostUrl ?? ""}
          inputMode="url"
          sx={{ flex: 1 }}
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {t("editor.coHostHelp")}
      </Typography>

      {/* A film of the event — a YouTube link, embedded on the page (criterion 9). */}
      <TextField
        name="event.videoUrl"
        type="url"
        label={t("editor.videoUrl")}
        helperText={t("editor.videoUrlHelp")}
        defaultValue={event?.videoUrl ?? ""}
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
          together, and the service says which one in words before it gets there. Not on a
          group run (§111): the whole block follows the type select, and the service writes
          NONE for one whatever the hidden fields still post. */}
      <OnlyForType type={EVENT_TYPES.filter(takesRegistrations)} selectName="event.type" initialType={event?.type ?? "GROUP_RUN"}>
        <Stack spacing={2}>
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

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <WallTimeField
              name="event.registrationOpensAt"
              label={t("editor.registrationOpensAt")}
              timeLabel={t("editor.timeOfDay")}
              value={event?.registrationOpensAt ?? null}
              zone={zone}
            />
            <WallTimeField
              name="event.registrationClosesAt"
              label={t("editor.registrationClosesAt")}
              timeLabel={t("editor.timeOfDay")}
              value={event?.registrationClosesAt ?? null}
              zone={zone}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t("editor.registrationWindowHelp")}
          </Typography>

          {/* The participation window (§104): asked a week before, owed two days before. */}
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField
              name="event.confirmationOpensDaysBefore"
              label={t("editor.confirmationOpensDaysBefore")}
              defaultValue={event?.confirmationOpensDaysBefore ?? 7}
              inputMode="numeric"
              fullWidth
            />
            <TextField
              name="event.confirmationDeadlineDaysBefore"
              label={t("editor.confirmationDeadlineDaysBefore")}
              defaultValue={event?.confirmationDeadlineDaysBefore ?? 2}
              inputMode="numeric"
              fullWidth
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t("editor.confirmationWindowHelp")}
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
      </OnlyForType>
    </Stack>
  );
}
