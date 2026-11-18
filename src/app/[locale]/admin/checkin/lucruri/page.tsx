import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay, formatTime } from "@/i18n/dates";
import { routing } from "@/i18n/routing";
import { typedStartOrNull } from "@/modules/events/domain/provisional-start";
import {
  listRaceDayItems,
  mayReadRaceDayItems,
  mayWriteRaceDayItems,
  RACE_DAY_ITEM_LABEL_MAX,
  RACE_DAY_ITEM_NOTE_MAX,
  type RaceDayItem,
} from "@/modules/race-day/items";
import { raceDayTabs } from "@/modules/race-day/ui/RaceDayTabs";
import { listEventsAcceptingRegistrations, listEventsForDesk } from "@/modules/registrations/admin-repository";
import { requireStaff } from "@/modules/staff-identity/session";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import { PANEL_GLYPHS } from "@/shared/ui/panel-glyphs";
import PrintButton from "@/shared/ui/PrintButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import { PENCIL_SX, ROW_SX, SUMMARY_SX } from "@/shared/ui/row-fold";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { VISUALLY_HIDDEN } from "@/shared/ui/visually-hidden";
import TickButton from "@/shared/ui/TickButton";
import { addRaceDayItemAction, editRaceDayItemAction, removeRaceDayItemAction, setRaceDayItemBroughtAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string; error?: string }>;
};

/** Reads the stored rows and is returned to right after every press. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The codes the page's alert says: a one-button press that has no boxes to keep redirects with `?error=`. */
const BANNER_ERRORS = ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"] as const;

/** The prefix of the ids the boxes of «Adaugă un lucru» carry, which its refusal's summary links to. */
const ADD_SCOPE = "race-day-add";

/** What the paper leaves out: the tabs, the select, the buttons and the boxes that build the list. */
const NOT_ON_PAPER = { "@media print": { display: "none" } } as const;
/** And what only the paper shows: the list as a checklist. */
const ONLY_ON_PAPER = { display: "none", "@media print": { display: "block" } } as const;

/** The pencil's glyph and the add fold's, drawn here on the server, never handed to an island. */
const EditIcon = ACTION_ICONS.edit;
const AddIcon = PANEL_GLYPHS.add;

/**
 * A row (§842's row fold, `shared/ui/row-fold.ts`): a hairline between rows, the tick first, then — for the Organizer and the
 * Administrators — the row's fold: its line is the note and who brought it, the pencil at its end, and open, the row's boxes
 * across the whole row. For everybody else the same words without the fold. Never a card.
 */
const ITEM_ROW_SX = { ...ROW_SX, display: "flex", flexWrap: "wrap", alignItems: "flex-start", columnGap: 1, py: 0.5, scrollMarginTop: 16 } as const;
const ITEM_FOLD_SX = { flex: "1 1 160px", minWidth: 0, "&[open]": { flexBasis: "100%" }, ...NOT_ON_PAPER } as const;
const ITEM_WORDS_SX = { gridArea: "words", minWidth: 0 } as const;

/**
 * «Lucruri de adus» (§979; the owner, 2026-11-18: «de asemenea un alt tab pentru ziua cursei unde sa bifam "lucruri de adus"
 * un fel de inventar, unde sa punem: prelungitoare, markere, etc»): one event's checklist of the things the organizers bring to
 * the race, the third tab of «Ziua cursei» (`raceDayTabs`).
 *
 * The desk's event select (a GET form, a native select, so it works before hydration on a phone with a flaky signal), the
 * counts, and a row a thing: a 44-pixel tick that posts the state it wants (`brought=1|0`, a plain form, so it works without
 * scripts), the note under it, and a brought row greyed with who ticked it and at what hour, in the club's time. Whoever works
 * the desk reads and ticks; the Organizer and the Administrators also get each row's pencil and «Șterge» (asked first,
 * naming the thing) and «Adaugă un lucru» — open by itself while the list is empty. Printed, it is the list as a checklist:
 * empty boxes for what is not brought, ticked ones ticked, no control.
 *
 * Every staff role that works the desk opens it (`mayReadRaceDayItems`); anybody else meets the 404 an unknown page gets
 * (BR-REQ-060-01), and every action and the service assert again. Nothing on it is public.
 */
export default async function RaceDayItemsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!mayReadRaceDayItems(actor.role)) notFound();

  const { eventId: requestedEventId, error } = await searchParams;
  const t = await getTranslations("Admin");
  const db = getDb();
  const now = new Date();

  // The desk's own events (§67): today's first, else every event taking entries, so the list can be written a week early.
  let events = await listEventsForDesk(db, locale, now);
  if (events.length === 0) events = await listEventsAcceptingRegistrations(db, locale);
  const event = events.find((candidate) => candidate.id === requestedEventId) ?? events[0];
  const eventId = event?.id;

  const items = eventId ? await listRaceDayItems(db, actor, eventId) : [];
  const writer = mayWriteRaceDayItems(actor.role);
  const brought = items.filter((item) => item.brought).length;
  const errorCode = BANNER_ERRORS.find((code) => code === error);

  const counts = `${t(`raceDay.items.count.${countForm(items.length, locale)}`, { count: String(items.length) })} · ${t(`raceDay.items.brought.${countForm(brought, locale)}`, { count: String(brought) })}`;
  const broughtLine = (item: RaceDayItem) => {
    if (!item.broughtAt) return null;
    const time = formatTime(item.broughtAt, { locale, timeZone: CLUB_TIME_ZONE });
    return item.broughtByName ? t("raceDay.items.broughtBy", { name: item.broughtByName, time }) : t("raceDay.items.broughtAt", { time });
  };
  const eventLabel = (candidate: (typeof events)[number]) =>
    `${candidate.title ?? candidate.id} · ${typedStartOrNull(candidate) ? formatDay(candidate.startsAt, { locale, timeZone: candidate.timezone, style: "short" }) : t("editor.dateToBeAnnounced")}`;

  // What every form of a row posts besides its own boxes: the page's language and its event.
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId ?? ""} />
    </>
  );
  const addRefusal = await refusalMessages({ label: t("raceDay.items.label"), note: t("raceDay.items.note") });
  // Drawn anew whenever the list changes, so the boxes are empty for the next thing — a refusal, which changes nothing, keeps them.
  const addFormKey = items.map((item) => item.id).join(",");

  const words = (item: RaceDayItem) => {
    const line = broughtLine(item);
    return (
      <>
        {item.note && (
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }} data-testid="race-day-item-note">
            {item.note}
          </Typography>
        )}
        {line && (
          <Typography variant="body2" color="text.secondary" data-testid="race-day-item-brought">
            {line}
          </Typography>
        )}
      </>
    );
  };

  const row = (item: RaceDayItem) => (
    <Box
      component="li"
      key={item.id}
      id={`item-${item.id}`}
      data-testid="race-day-item"
      data-brought={item.brought ? "1" : "0"}
      sx={{ ...ITEM_ROW_SX, ...(item.brought ? { bgcolor: "action.hover" } : {}) }}
    >
      {/* The tick: the state it wants, never a toggle — a double press saves the same. A plain form: it works without scripts. */}
      <Box component="form" action={setRaceDayItemBroughtAction} sx={{ flex: "0 1 auto", minWidth: 0 }} data-testid="race-day-item-tick-form">
        {hidden}
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="brought" value={item.brought ? "0" : "1"} />
        <TickButton checked={item.brought} data-testid="race-day-item-tick">
          <Box component="span" sx={{ wordBreak: "break-word", ...(item.brought ? { color: "text.secondary" } : {}) }}>
            {item.label}
          </Box>
        </TickButton>
      </Box>
      {writer ? (
        <Box component="details" sx={ITEM_FOLD_SX} data-testid="race-day-item-edit">
          <Box component="summary" sx={SUMMARY_SX} title={t("raceDay.items.edit", { label: item.label })}>
            <Box sx={ITEM_WORDS_SX}>{words(item)}</Box>
            {/* The pencil says what the line opens; a screen reader hears it in words. */}
            <Box component="span" sx={VISUALLY_HIDDEN}>
              {t("raceDay.items.edit", { label: item.label })}
            </Box>
            <EditIcon fontSize="small" aria-hidden sx={PENCIL_SX} />
          </Box>
          <Box sx={{ maxWidth: 560, py: 1.5 }}>
            <Stack component="form" action={editRaceDayItemAction} spacing={2} sx={{ alignItems: "flex-start" }} data-testid="race-day-item-edit-form">
              {hidden}
              <input type="hidden" name="itemId" value={item.id} />
              <TextField
                name="label"
                label={t("raceDay.items.label")}
                defaultValue={item.label}
                required
                fullWidth
                size="small"
                slotProps={{ htmlInput: { maxLength: RACE_DAY_ITEM_LABEL_MAX } }}
              />
              <TextField
                name="note"
                label={t("raceDay.items.note")}
                helperText={t("raceDay.items.noteHelp")}
                defaultValue={item.note ?? ""}
                fullWidth
                size="small"
                slotProps={{ htmlInput: { maxLength: RACE_DAY_ITEM_NOTE_MAX } }}
              />
              <GlyphButton icon="save" type="submit" variant="outlined" size="small" sx={TAP_TARGET}>
                {t("raceDay.items.save")}
              </GlyphButton>
            </Stack>
            {/* «Șterge», last: it asks first, naming the thing. */}
            <Box component="form" action={removeRaceDayItemAction} sx={{ mt: 1.5 }} data-testid="race-day-item-remove-form">
              {hidden}
              <input type="hidden" name="itemId" value={item.id} />
              <ConfirmSubmitButton
                label={t("raceDay.items.remove")}
                ariaLabel={t("raceDay.items.removeFor", { label: item.label })}
                icon="delete"
                color="error"
                variant="text"
                size="medium"
                title={t("raceDay.items.removeTitle", { label: item.label })}
                body={t("raceDay.items.removeBody")}
                confirmLabel={t("raceDay.items.remove")}
                cancelLabel={t("confirm.cancel")}
              />
            </Box>
          </Box>
        </Box>
      ) : (
        <Box sx={{ flex: "1 1 160px", minWidth: 0, py: 0.5 }}>{words(item)}</Box>
      )}
    </Box>
  );

  return (
    <Stack spacing={3}>
      {await raceDayTabs({ locale, active: "items", eventId, actor })}
      <Typography variant="h2" sx={HEADING_SX.title} data-testid="race-day-items-title">
        {t("raceDay.items.title")}
      </Typography>
      {event && (
        <Typography variant="subtitle1" sx={ONLY_ON_PAPER}>
          {eventLabel(event)}
        </Typography>
      )}

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16, ...NOT_ON_PAPER }}>
        {errorCode && (
          <Alert severity="error" data-testid="race-day-items-error">
            {t(`raceDay.items.errors.${errorCode}`)}
          </Alert>
        )}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={NOT_ON_PAPER}>
        {t("raceDay.items.intro")} {writer ? null : t("raceDay.items.readOnly")}
      </Typography>

      {events.length === 0 ? (
        <Alert severity="warning">{t("desk.noEvents")}</Alert>
      ) : (
        <Box component="form" method="get" sx={NOT_ON_PAPER}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
            {/* A native select, as on the desk: it works before hydration, and the form is a GET anyway. */}
            <TextField
              select
              name="eventId"
              label={t("desk.event")}
              defaultValue={eventId}
              size="small"
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              sx={{ minWidth: 240 }}
            >
              {events.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {eventLabel(candidate)}
                </option>
              ))}
            </TextField>
            <GlyphButton icon="search" type="submit" variant="outlined" sx={{ minHeight: 44 }}>
              {t("raceDay.items.show")}
            </GlyphButton>
          </Stack>
        </Box>
      )}

      {eventId && (
        <>
          <Typography variant="body2" data-testid="race-day-items-counts">
            {counts}
          </Typography>

          {items.length === 0 ? (
            <Typography color="text.secondary" data-testid="race-day-items-empty">
              {t("raceDay.items.empty")} {writer ? t("raceDay.items.emptyAdd") : t("raceDay.items.emptyReadOnly")}
            </Typography>
          ) : (
            <>
              <Box component="ul" id="race-day-items" sx={{ m: 0, p: 0, listStyle: "none", scrollMarginTop: 16, ...NOT_ON_PAPER }} data-testid="race-day-items">
                {items.map(row)}
              </Box>
              {/* On paper: the list as a checklist — empty boxes for what is not brought, ticked ones ticked, no control. */}
              <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", ...ONLY_ON_PAPER }} data-testid="race-day-items-paper">
                {items.map((item) => (
                  <Box component="li" key={item.id} sx={{ py: 0.5, breakInside: "avoid" }}>
                    <Box component="span" aria-hidden sx={{ mr: 1 }}>
                      {item.brought ? "☑" : "☐"}
                    </Box>
                    {item.label}
                    {item.note ? ` — ${item.note}` : ""}
                    {item.brought && broughtLine(item) ? ` (${broughtLine(item)})` : ""}
                  </Box>
                ))}
              </Box>
              <Box sx={NOT_ON_PAPER}>
                <PrintButton label={t("raceDay.items.print")} />
              </Box>
            </>
          )}

          {writer && (
            <Box
              component="details"
              id="race-day-add"
              open={items.length === 0 || undefined}
              data-testid="race-day-items-add"
              sx={{ ...BOXED_DISCLOSURE_SX, ...NOT_ON_PAPER, scrollMarginTop: 16 }}
            >
              <Typography component="summary" variant="subtitle2">
                <AddIcon aria-hidden sx={FOLD_GLYPH_SX} />
                {t("raceDay.items.addTitle")}
              </Typography>
              <Box sx={{ mt: 1.5, maxWidth: 560 }}>
                <ActionForm key={addFormKey} action={addRaceDayItemAction} messages={addRefusal} scope={ADD_SCOPE} data-testid="race-day-items-add-form">
                  {hidden}
                  <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
                    <RecallField
                      name="label"
                      label={t("raceDay.items.label")}
                      helperText={t("raceDay.items.labelHelp")}
                      required
                      fullWidth
                      size="small"
                      slotProps={{ htmlInput: { maxLength: RACE_DAY_ITEM_LABEL_MAX, "data-testid": "race-day-items-add-label" } }}
                    />
                    <RecallField
                      name="note"
                      label={t("raceDay.items.note")}
                      helperText={t("raceDay.items.noteHelp")}
                      fullWidth
                      size="small"
                      slotProps={{ htmlInput: { maxLength: RACE_DAY_ITEM_NOTE_MAX, "data-testid": "race-day-items-add-note" } }}
                    />
                    <GlyphButton icon="add" type="submit" variant="contained" size="medium" sx={TAP_TARGET} data-testid="race-day-items-add-submit">
                      {t("raceDay.items.add")}
                    </GlyphButton>
                  </Stack>
                </ActionForm>
              </Box>
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}
