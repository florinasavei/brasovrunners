import Box from "@mui/material/Box";
import { readBibDesign } from "@/modules/registrations/bib-design";
import { MIN_PARTICIPANT_AGE } from "@/modules/registrations/domain/age";
import BibDesignPanel from "./BibDesignPanel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { EVENT_COST_TYPES } from "@/modules/events/domain/cost";
import { EVENT_SURFACES, EVENT_TYPES, hasProgramme, takesRegistrations } from "@/modules/events/domain/event-type";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { CO_HOST_LINK_KINDS, type CoHostLinkKind, readCoHosts } from "@/modules/events/domain/co-hosts";
import { EVENT_LINK_KINDS, type EventLinkKind, MAX_EVENT_LINKS, readEventLinks } from "@/modules/events/domain/links";
import { htmlConstraints, textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import { type EventFieldName, eventInputConstraints } from "../constraints";
import { coHostLinkRowSchema, eventLinkRowSchema } from "../fields";
import CoHostRowsEditor from "./CoHostRowsEditor";
import CostFields from "./CostFields";
import EditorPanel from "./EditorPanel";
import GlyphSelect from "./GlyphSelect";
import LinkRowsEditor from "./LinkRowsEditor";
import OnlyForType from "./OnlyForType";
import PlaceToBeAnnounced from "./PlaceToBeAnnounced";
import ScheduleRowsEditor from "./ScheduleRowsEditor";
import TypeNote from "./TypeNote";
import WallTimeField from "./WallTimeField";
import {
  EVENT_STATUS_LABEL,
  REGISTRATION_MODE_LABEL,
} from "@/modules/staff-identity/domain/staff-labels";
import type { EditableEvent } from "../repository";

/**
 * Every column of `events` an organizer owns, as form inputs, in four named panels.
 *
 * One component for the create form and the edit form, so the two cannot drift in what they
 * post — `actions.ts#eventFieldsFrom` reads exactly these names, and a field renamed here and
 * not there would silently start saving "not stated".
 *
 * Every name is namespaced `event.<column>`. The editor is one form carrying the event row and
 * both languages at once, and `translations.ro.title` and `event.startsAtWallTime` cannot
 * collide when each says which half of the event it belongs to.
 *
 * **The panels** (`DECISIONS.md` §170; the owner asked for "a WordPress-like editor"): forty
 * fields in one column was a list nobody could hold in their head, and the order was the order
 * the columns were added to the table. They are grouped by the question they answer now —
 * when and where, registration, route and details — each an open box. No field was renamed:
 * the same names post the same values, and every end-to-end locator still finds what it
 * looked for. One box is gone: the film. A YouTube link is a figure in the description now,
 * placed and sized like a picture with the rich text's own button (§266), and a second way
 * in — a box the action never even read — was a box that promised what nothing saved. The
 * column stays, and the public page still embeds the links older events carry.
 *
 * **Every box refuses first what the server would refuse** (§315; the owner: "nu ar trebui sa
 * pot crea evenimentul daca am campuri invalide"): `required`, `maxLength`, `type="url"` with
 * its pattern, `min`/`max` on a number — read off `fields.ts` through `eventInputConstraints`,
 * never typed here a second time. What the browser cannot know — one field against another,
 * the declaration an internal event needs — the server refuses, and the refusal comes back
 * with every box still filled: the fields are `RecallField`s, the ticks `CheckboxField`s.
 *
 * It renders the inputs, not the `<form>`: `<Stack component="form" action={...}>` crashes in
 * MUI 9, so every caller wraps a plain `<form>` around this.
 */

const EVENT_STATUSES = ["SCHEDULED", "CANCELLED", "COMPLETED"] as const;
const REGISTRATION_MODES = ["NONE", "INTERNAL", "EXTERNAL"] as const;

/**
 * The colours a race's numbers may print in (§173, §177): six that stay apart from each other
 * on paper and from the club's blue, which is the empty choice. Hex triplets, because that is
 * what `events.bib_colour` checks for and what the sheet paints.
 */
const BIB_COLOURS = [
  { key: "green", hex: "#1b8a3a" },
  { key: "red", hex: "#c62828" },
  { key: "orange", hex: "#ef6c00" },
  { key: "purple", hex: "#6a1b9a" },
  { key: "teal", hex: "#00838f" },
  { key: "black", hex: "#212121" },
] as const;

/** The club's own zone. Offered as the default rather than the browser's, which on a phone in
 * an airport is not where the race is. */
const DEFAULT_TIMEZONE = "Europe/Bucharest";

/**
 * The zones an organizer may pick (§153; the owner: "the timezone must be selectable, not free
 * text"): every IANA zone this runtime knows, the club's first, then Europe, then the rest —
 * a native select, because four hundred options in a MUI menu is a scroll nobody wants and a
 * native one is searchable by typing. A stored zone the runtime no longer lists is kept as an
 * option so an old event still saves.
 */
function timezoneOptions(current: string): readonly string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIMEZONE];
  const europe = known.filter((zone) => zone.startsWith("Europe/") && zone !== DEFAULT_TIMEZONE);
  const rest = known.filter((zone) => !zone.startsWith("Europe/"));
  const ordered = [DEFAULT_TIMEZONE, ...europe, ...rest];
  return ordered.includes(current) ? ordered : [current, ...ordered];
}

/** The box's own constraints, read off `fields.ts`, as `TextField` takes them (§315). */
function box(field: EventFieldName, extra: Record<string, unknown> = {}) {
  return textFieldConstraints(eventInputConstraints(field), extra);
}

export type DeclarationOption = { id: string; version: number; title: string };

export default async function EventFieldsForm({
  event,
  declarations,
  waiting = 0,
}: {
  /** The event being edited, or null on the create form. */
  event: EditableEvent | null;
  declarations: readonly DeclarationOption[];
  /** How many wait for a place (§147); the create form has nobody. */
  waiting?: number;
}) {
  const t = await getTranslations("Admin");
  // The type and surface labels already exist for the public pages, and they read the same to
  // an organizer as to a visitor. Two catalogues of the same eight words would drift.
  const tEvent = await getTranslations("Event");
  const zone = event?.timezone ?? DEFAULT_TIMEZONE;
  const initialType = event?.type ?? "GROUP_RUN";
  // The programme's rows as wall-clock boxes in the event's zone (§117).
  const scheduleRows = readScheduleItems(event?.scheduleItems ?? null).map((item) => {
    const start = toWallTimeInput(new Date(item.startsAt), zone);
    const end = item.endsAt ? toWallTimeInput(new Date(item.endsAt), zone) : "";
    return { date: start.slice(0, 10), time: start.slice(11, 16), endTime: end.slice(11, 16), ro: item.label.ro, en: item.label.en, place: item.place ?? "" };
  });

  /**
   * The partners as cards (§168, §NNN), read through the one function that decides which shape
   * a row means — its list of links, its one legacy link, or the two columns before the list —
   * so an event saved by any earlier release opens with the partner it has, and the first save
   * writes it as the new shape.
   */
  const coHostRows = readCoHosts(event ?? { coHosts: null, coHostName: null, coHostUrl: null }).map((host) => ({
    name: host.name,
    links: host.links.map((link) => ({ kind: link.kind, url: link.url, labelRo: link.labelRo ?? "", labelEn: link.labelEn ?? "" })),
  }));

  /** The links as boxes (§332), read through the one function that decides what a stored row means. */
  const linkRows = readEventLinks(event?.links ?? null).map((link) => ({
    kind: link.kind,
    url: link.url,
    labelRo: link.labelRo ?? "",
    labelEn: link.labelEn ?? "",
  }));

  /** One sentence per type, for the note under the select (§170). */
  const typeNotes = Object.fromEntries(EVENT_TYPES.map((type) => [type, t(`editor.typeNotes.${type}`)]));

  return (
    <Stack spacing={3}>
      <EditorPanel title={t("editor.panels.when")} headingId="panel-when">
        <Stack spacing={2}>
          {/*
            Two questions where there was one (`DECISIONS.md` §61): what the event is, then what
            it is run on. The surface has an empty option and the type does not — a coffee is run
            on nothing, but every event is one of the seven types.
          */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            {/* The closed sets with their glyphs (§121), the same the public pages show (§112). */}
            <GlyphSelect
              name="event.type"
              label={t("editor.type")}
              defaultValue={initialType}
              options={EVENT_TYPES.map((type) => ({ value: type, label: tEvent(`type.${type}`), glyph: `type:${type}` as const }))}
              sx={{ flex: 1 }}
              required={eventInputConstraints("type").required}
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
            <RecallField
              select
              name="event.eventStatus"
              label={t("editor.eventStatus")}
              defaultValue={event?.eventStatus ?? "SCHEDULED"}
              sx={{ flex: 1 }}
              required={eventInputConstraints("eventStatus").required}
            >
              {EVENT_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {EVENT_STATUS_LABEL[status]}
                </MenuItem>
              ))}
            </RecallField>
          </Stack>

          {/* What the chosen type means, in one line; the comparison of all seven folded beside
              it (§170) — it used to be six lines under the select, whichever type was chosen. */}
          <TypeNote selectName="event.type" initialType={initialType} notes={typeNotes} />
          <Box component="details" sx={BOXED_DISCLOSURE_SX}>
            <Typography component="summary" variant="body2">
              {t("editor.typeHelpSummary")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("editor.typeHelp")}
            </Typography>
          </Box>

          <RecallField
            select
            name="event.timezone"
            label={t("editor.timezone")}
            helperText={t("editor.timezoneHelp")}
            defaultValue={zone}
            required={eventInputConstraints("timezone").required}
            slotProps={{ select: { native: true } }}
          >
            {timezoneOptions(zone).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </RecallField>

          {/* A date and a 24-hour time each, whatever clock the browser speaks (§70). */}
          <WallTimeField
            name="event.startsAt"
            label={t("editor.startsAt")}
            timeLabel={t("editor.timeOfDay")}
            helperText={t("editor.startsAtHelp", { timezone: zone })}
            value={event?.startsAt ?? null}
            zone={zone}
            required={eventInputConstraints("startsAtWallTime").required}
          />
          {/* Only a race has a gun time apart from the meeting time (§71); the field follows the
              type select and is empty — and ignored — for anything else. */}
          <OnlyForType type="RACE" selectName="event.type" initialType={initialType}>
            <WallTimeField
              name="event.raceStartsAt"
              label={t("editor.raceStartsAt")}
              timeLabel={t("editor.timeOfDay")}
              helperText={t("editor.raceStartsAtHelp")}
              value={event?.raceStartsAt ?? null}
              zone={zone}
              required={eventInputConstraints("raceStartsAtWallTime").required}
            />
          </OnlyForType>
          {/* How long, not when it ends: the end is derived (§71). */}
          <RecallField
            name="event.durationMinutes"
            label={t("editor.durationMinutes")}
            helperText={t("editor.durationMinutesHelp")}
            defaultValue={
              event?.endsAt && event.startsAt
                ? Math.round((event.endsAt.getTime() - event.startsAt.getTime()) / 60_000)
                : ""
            }
            // `step` is measured from `min`, so `min: 1, step: 5` made 120 invalid ("the two
            // nearest valid values are 116 and 121"). Any whole minute is a duration — the
            // schema says so, and the box reads it off the schema.
            {...box("durationMinutes", { inputMode: "numeric" })}
            sx={{ width: 220 }}
          />

          {/*
            The place, and the two facts about taking part, once (`DECISIONS.md` §36).
            These used to sit in each language's panel and be typed twice — and the second copy
            was never a translation, it was the same answer again.

            One field for the place (the owner, 2026-09-18: "meeting point and address are a bit
            redundant"): a name, a street, or both, as one would tell a friend. The column the
            second box wrote, `location_address`, stays for the rows that have one and is shown
            where it exists; nothing writes it any more.

            Above it, whether the place is announced at all (§328; the owner: "I want to be able
            to set the location as TBD, and to not announce it yet"). The switch is the island;
            the box's constraints are still read here, off the schema, and handed to it as data
            — the island only takes `required` away while the switch is on.
          */}
          <PlaceToBeAnnounced
            defaultChecked={event?.locationToBeAnnounced ?? false}
            labels={{
              toggle: t("editor.placeToBeAnnounced"),
              toggleHelp: t("editor.placeToBeAnnouncedHelp"),
              locationName: t("editor.fields.locationName"),
              locationHelp: t("editor.locationHelp"),
              unpublished: t("editor.placeUnpublished"),
            }}
            locationName={{
              defaultValue: [event?.locationName, event?.locationAddress].filter(Boolean).join(", "),
              box: box("locationName"),
            }}
          >
            {/* Where to meet, as one pasted link. Coordinates were asked for here until
                `DECISIONS.md` §61: two decimal numbers to produce a link the organizer could
                paste in one move. Kept, and not shown, while the place is to be announced. */}
            <RecallField
              name="event.mapUrl"
              label={t("editor.mapUrl")}
              helperText={t("editor.mapUrlHelp")}
              defaultValue={event?.mapUrl ?? ""}
              {...box("mapUrl", { inputMode: "url" })}
            />
          </PlaceToBeAnnounced>

          {/* The programme as rows (§117) — not on a group run (§111), like the registration
              block. The caption under the rows names the notes fold in the language panels, so
              the two are read as one programme and its notes, not two programmes. */}
          <OnlyForType type={EVENT_TYPES.filter(hasProgramme)} selectName="event.type" initialType={initialType}>
            <Stack spacing={1}>
              <Typography variant="h3" sx={{ fontSize: "1rem", pt: 1 }}>
                {t("editor.programmeSection")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("editor.programmeHelp")}
              </Typography>
              {/* The rows follow the start date: `WallTimeField` posts `event.startsAt` as
                  `event.startsAtDate` and `event.startsAtTime`, and the rows island listens to
                  the date box by that name, the way `OnlyForType` reads the type select. */}
              <ScheduleRowsEditor
                initial={scheduleRows}
                startDateName="event.startsAtDate"
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
              <Typography variant="caption" color="text.secondary">
                {t("editor.programmeNotesHint", { panel: t("editor.contentSection"), fold: t("editor.fields.scheduleNotes") })}
              </Typography>
            </Stack>
          </OnlyForType>
        </Stack>
      </EditorPanel>

      {/* The registration block. The database refuses the combinations that do not go
          together, and the service says which one in words before it gets there. Not on a
          group run (§111): the whole panel follows the type select, and the service writes
          NONE for one whatever the hidden fields still post. */}
      <OnlyForType type={EVENT_TYPES.filter(takesRegistrations)} selectName="event.type" initialType={initialType}>
        <EditorPanel title={t("editor.panels.registration")} headingId="panel-registration">
          <Stack spacing={2}>
            <RecallField
              select
              name="event.registrationMode"
              label={t("editor.registrationMode")}
              helperText={t("editor.registrationModeHelp")}
              defaultValue={event?.registrationMode ?? "NONE"}
              required={eventInputConstraints("registrationMode").required}
            >
              {REGISTRATION_MODES.map((mode) => (
                <MenuItem key={mode} value={mode}>
                  {REGISTRATION_MODE_LABEL[mode]}
                </MenuItem>
              ))}
            </RecallField>

            <RecallField
              name="event.capacity"
              label={t("editor.capacity")}
              helperText={waiting > 0 ? `${t("editor.capacityHelp")} ${t("editor.capacityWaiting", { waiting })}` : t("editor.capacityHelp")}
              defaultValue={event?.capacity ?? ""}
              {...box("capacity", { inputMode: "numeric" })}
            />

            {/* Who may enter (§329, amending §321: "actually this min age must be set at event
                level!"): years reached by the event's day, fourteen unless the organizer says
                otherwise, zero for none. In this panel, so a group run — which takes nobody's
                registration (§111) — never shows it. The bounds are the schema's (§315). */}
            <RecallField
              name="event.minAge"
              label={t("editor.minAge")}
              helperText={t("editor.minAgeHelp")}
              defaultValue={event?.minAge ?? MIN_PARTICIPANT_AGE}
              {...box("minAge", { inputMode: "numeric" })}
              sx={{ width: { sm: 220 } }}
            />

            {/*
              Two windows, two groups (the owner, of the sentence that stood between them:
              "partea asta nu e prea clară"). Each help sentence is a child of the group it
              describes rather than a sibling of both, because a caption sitting *between* two
              pairs of inputs reads as a heading for the pair below it — which is how "leave
              the opening empty and registration starts at publication" came to look like a
              rule about the participation window. The names are untouched: this is a box
              around fields that already posted these names.
            */}
            <Box>
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
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {t("editor.registrationWindowHelp")}
              </Typography>
            </Box>

            {/* The participation window (§104): asked a week before, owed two days before. Its
                own heading, so the two numbers are visibly a second question rather than more
                of the first — the panel's title is an `h2`, so this is the `h3` under it. */}
            <Box>
              <Typography component="h3" sx={{ fontSize: "0.95rem", fontWeight: 600, mb: 1 }}>
                {t("editor.confirmationWindowTitle")}
              </Typography>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <RecallField
                  name="event.confirmationOpensDaysBefore"
                  label={t("editor.confirmationOpensDaysBefore")}
                  defaultValue={event?.confirmationOpensDaysBefore ?? 7}
                  {...box("confirmationOpensDaysBefore", { inputMode: "numeric" })}
                  fullWidth
                />
                <RecallField
                  name="event.confirmationDeadlineDaysBefore"
                  label={t("editor.confirmationDeadlineDaysBefore")}
                  defaultValue={event?.confirmationDeadlineDaysBefore ?? 2}
                  {...box("confirmationDeadlineDaysBefore", { inputMode: "numeric" })}
                  fullWidth
                />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {t("editor.confirmationWindowHelp")}
              </Typography>
            </Box>

            {/* The race's own band of numbers (§173): where they start and what colour the
                sheet prints behind them. A club that runs a 5 km from 100 and a 10 km from
                500 can tell two envelopes apart across a table without reading a name. */}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <RecallField
                name="event.bibStartNumber"
                label={t("editor.bibStartNumber")}
                helperText={t("editor.bibStartNumberHelp")}
                defaultValue={event?.bibStartNumber ?? 1}
                {...box("bibStartNumber", { inputMode: "numeric" })}
                sx={{ width: { sm: 220 } }}
              />
              {/*
                A palette, not a colour picker (§177). `<input type="color">` has no empty state,
                so every save would have written a colour whether or not the organizer touched
                it, and "the club's own" — §173's meaning of null — became unreachable. Six
                print-safe colours a race director actually uses to tell distances apart, and
                the club's own as the empty choice. A stored colour outside the palette (set by
                hand, or by a later release) is kept as its own option so the save does not
                silently change it.
              */}
              <RecallField
                select
                name="event.bibColour"
                label={t("editor.bibColour")}
                helperText={t("editor.bibColourHelp")}
                defaultValue={event?.bibColour ?? ""}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ width: { sm: 220 } }}
              >
                <option value="">{t("editor.bibColours.club")}</option>
                {BIB_COLOURS.map((choice) => (
                  <option key={choice.hex} value={choice.hex}>
                    {t(`editor.bibColours.${choice.key}`)}
                  </option>
                ))}
                {event?.bibColour && !BIB_COLOURS.some((choice) => choice.hex === event.bibColour) && (
                  <option value={event.bibColour}>{event.bibColour}</option>
                )}
              </RecallField>
            </Stack>

            {/* The rest of the bib (§249): what is printed, the number's size, where the name
                sits, a picture instead of the band, a sponsors' strip, cut marks. Only on an
                event that exists — the create form asks for a date and a title, not a design. */}
            {event && (
              <BibDesignPanel
                eventId={event.id}
                design={readBibDesign(event.bibDesign)}
                bibStartNumber={event.bibStartNumber}
                bibColour={event.bibColour}
              />
            )}

            {/*
              A choice among approved versions, never an editor. AGENTS.md §11.1 keeps legal text
              out of the CMS entirely: this select can point an event at a version, and nothing
              anywhere in the backoffice can change a word of one.
            */}
            <RecallField
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
            </RecallField>

            {/*
              The start list, off unless somebody deliberately turns it on (BR-REQ-039-01).

              A checkbox rather than a select, because there are two values and one of them is a
              disclosure: an unchecked box is `HIDDEN`, which is what an absent field must mean.
              The help text says what turning it on actually publishes, in the words a
              participant would read, because that is the decision being made here.
            */}
            <CheckboxField name="event.participantListVisibility" defaultChecked={event?.participantListVisibility === "NAMES"}>
              {t("editor.participantList")}
            </CheckboxField>
            <Typography variant="body2" color="text.secondary">
              {t("editor.participantListHelp")}
            </Typography>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <RecallField
                name="event.externalProvider"
                label={t("editor.externalProvider")}
                defaultValue={event?.externalProvider ?? ""}
                {...box("externalProvider")}
                sx={{ flex: 1 }}
              />
              <RecallField
                name="event.externalRegistrationUrl"
                label={t("editor.externalRegistrationUrl")}
                defaultValue={event?.externalRegistrationUrl ?? ""}
                {...box("externalRegistrationUrl", { inputMode: "url" })}
                sx={{ flex: 1 }}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t("editor.externalHelp")}
            </Typography>
          </Stack>
        </EditorPanel>
      </OnlyForType>

      <EditorPanel title={t("editor.panels.details")} headingId="panel-details">
        <Stack spacing={2}>
          {/*
            Closed sets since migration `0018`, so the organizer picks rather than types — which
            is what lets the public page render each in the reader's own language instead of in
            the words whoever filled the form was thinking in.

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
                ...EVENT_COST_TYPES.map((value) => ({ value, label: t(`editor.costValues.${value}`), glyph: `cost:${value}` as const })),
              ]}
              sx={{ flex: 1 }}
            />
          </Stack>

          {/*
            "Suma" and "Unde se plătește" for a paid event, "Link pentru donație" and "Suma
            sugerată" for a donation (§NNN; the owner: "Cu taxă" showed no box for the money, and
            usually nothing is paid — the exception is Wings for Life, where a donation is made
            on another site). One pair of columns, relabelled by `CostFields` rather than posted
            twice; shown only while the chosen kind needs one of them, values kept otherwise.
          */}
          <CostFields
            initialCostType={event?.costType ?? ""}
            costAmount={{ defaultValue: event?.costAmount ?? "", box: box("costAmount") }}
            costUrl={{ defaultValue: event?.costUrl ?? "", box: box("costUrl", { inputMode: "url" }) }}
            labels={{
              paidAmount: t("editor.costAmount"),
              paidAmountHelp: t("editor.costAmountHelp"),
              paidUrl: t("editor.costPaidUrl"),
              paidUrlHelp: t("editor.costPaidUrlHelp"),
              donationUrl: t("editor.costDonationUrl"),
              donationUrlHelp: t("editor.costDonationUrlHelp"),
              donationAmount: t("editor.costDonationAmount"),
              donationAmountHelp: t("editor.costDonationAmountHelp"),
            }}
          />

          {/*
            The course, and a separate question from the meeting point above: where a runner
            turns up and where they then run are two different pages on two different services
            more often than they are one (`DECISIONS.md` §49).
          */}
          <RecallField
            name="event.routeUrl"
            label={t("editor.routeUrl")}
            helperText={t("editor.routeUrlHelp")}
            defaultValue={event?.routeUrl ?? ""}
            {...box("routeUrl", { inputMode: "url" })}
          />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <RecallField
              name="event.distanceMeters"
              label={t("editor.distanceMeters")}
              helperText={t("editor.distanceMetersHelp")}
              defaultValue={event?.distanceMeters ?? ""}
              {...box("distanceMeters", { inputMode: "numeric" })}
              sx={{ flex: 1 }}
            />
            <RecallField
              name="event.elevationGainMeters"
              label={t("editor.elevationGainMeters")}
              defaultValue={event?.elevationGainMeters ?? ""}
              {...box("elevationGainMeters", { inputMode: "numeric" })}
              sx={{ flex: 1 }}
            />
          </Stack>

          {/* "Linkuri și fișiere" (§332), beside the route because that is what most of them
              are — the GPX on Google Drive, the map on a platform — and then the rest: a PDF,
              the album, the results. Links, never an upload (`AGENTS.md` §17). */}
          <Stack spacing={1}>
            <Typography variant="h3" sx={{ fontSize: "1rem", pt: 1 }}>
              {t("editor.linksSection")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("editor.linksHelp", { max: MAX_EVENT_LINKS })}
            </Typography>
            <LinkRowsEditor
              initial={linkRows}
              kindLabels={Object.fromEntries(EVENT_LINK_KINDS.map((kind) => [kind, tEvent(`links.kinds.${kind}`)])) as Record<EventLinkKind, string>}
              constraints={{
                url: htmlConstraints(eventLinkRowSchema.shape.url),
                label: htmlConstraints(eventLinkRowSchema.shape.labelRo),
              }}
              labels={{
                kind: t("editor.linkRows.kind"),
                url: t("editor.linkRows.url"),
                labelRo: t("editor.linkRows.labelRo"),
                labelEn: t("editor.linkRows.labelEn"),
                add: t("editor.linkRows.add"),
                remove: t("editor.linkRows.remove"),
                moveUp: t("editor.linkRows.moveUp"),
                moveDown: t("editor.linkRows.moveDown"),
                row: t("editor.linkRows.row"),
              }}
            />
          </Stack>

          {/* The club's Strava group event for this occurrence (criterion 10). */}
          <RecallField
            name="event.stravaEventUrl"
            label={t("editor.stravaEventUrl")}
            helperText={t("editor.stravaEventUrlHelp")}
            defaultValue={event?.stravaEventUrl ?? ""}
            {...box("stravaEventUrl", { inputMode: "url" })}
          />

          {/* The Facebook event for this occurrence (§144). */}
          <RecallField
            name="event.facebookEventUrl"
            label={t("editor.facebookEventUrl")}
            helperText={t("editor.facebookEventUrlHelp")}
            defaultValue={event?.facebookEventUrl ?? ""}
            {...box("facebookEventUrl", { inputMode: "url" })}
          />

          {/* The organizations the event is held with (§168), each a card of its own links
              (§NNN): its site, its event, registering with it, its socials. An event saved
              before the card existed opens with the partner its earlier shape holds, and the
              first save writes it as a card. */}
          <Stack spacing={1}>
            <Typography variant="h3" sx={{ fontSize: "1rem", pt: 1 }}>
              {t("editor.coHostSection")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("editor.coHostHelp")}
            </Typography>
            <CoHostRowsEditor
              initial={coHostRows}
              kindLabels={Object.fromEntries(CO_HOST_LINK_KINDS.map((kind) => [kind, tEvent(`coHostLinks.kinds.${kind}`)])) as Record<CoHostLinkKind, string>}
              constraints={{
                url: htmlConstraints(coHostLinkRowSchema.shape.url),
                label: htmlConstraints(coHostLinkRowSchema.shape.labelRo),
              }}
              labels={{
                add: t("editor.coHostRows.add"),
                remove: t("editor.coHostRows.remove"),
                moveUp: t("editor.coHostRows.moveUp"),
                moveDown: t("editor.coHostRows.moveDown"),
                partnerNew: t("editor.coHostRows.partnerNew"),
                name: t("editor.coHostRows.name"),
                kind: t("editor.coHostRows.kind"),
                url: t("editor.coHostRows.url"),
                labelRo: t("editor.coHostRows.labelRo"),
                labelEn: t("editor.coHostRows.labelEn"),
                addLink: t("editor.coHostRows.addLink"),
                removeLink: t("editor.coHostRows.removeLink"),
                moveLinkUp: t("editor.coHostRows.moveLinkUp"),
                moveLinkDown: t("editor.coHostRows.moveLinkDown"),
                link: t("editor.coHostRows.link"),
              }}
            />
          </Stack>

          {/* The two marks, together and last: what makes this event stand out on the site.
              Only one event may be the site's lead; any number may be special, including one
              date of a series. */}
          <Box>
            <CheckboxField name="event.featured" defaultChecked={event?.featured ?? false}>
              {t("editor.featured")}
            </CheckboxField>
            <Typography variant="body2" color="text.secondary">
              {t("editor.featuredHelp")}
            </Typography>
          </Box>

          {/* A special edition (§168) — beside the lead-event box because that is where an
              organizer looks for "this one is different", and unlike it in the one way that
              matters: any number of events may carry it, including one date of a series. */}
          <Box>
            <CheckboxField name="event.isSpecial" defaultChecked={event?.isSpecial ?? false}>
              {t("editor.special")}
            </CheckboxField>
            <Typography variant="body2" color="text.secondary">
              {t("editor.specialHelp")}
            </Typography>
          </Box>
        </Stack>
      </EditorPanel>
    </Stack>
  );
}
