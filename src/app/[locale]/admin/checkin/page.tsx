import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { noFreePlaceValues, type PlacesTaken } from "@/modules/registrations/domain/capacity";
import { typedStartOrNull } from "@/modules/events/domain/provisional-start";
import { formatDay } from "@/i18n/dates";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  countDesk,
  type DeskRegistration,
  findRegistrationByCheckinCode,
  isEventCompleted,
  listDeskRegistrations,
  listEventsAcceptingRegistrations,
  listEventsForDesk,
} from "@/modules/registrations/admin-repository";
import { type DeskSectionKey, deskSections, returnedRowOf } from "@/modules/registrations/domain/desk-sections";
import { declarationAsksMinorToSignByLocale } from "@/modules/legal-documents/repository";
import { spareStates } from "@/modules/registrations/bibs";
import { isCheckinCode, normalizeCheckinCode } from "@/modules/registrations/checkin-code";
import DeskRow from "@/modules/registrations/ui/DeskRow";
import PaperConfirmationTip from "@/modules/registrations/ui/PaperConfirmationTip";
import SparesTip from "@/modules/registrations/ui/SparesTip";
import { familyOf } from "@/modules/registrations/family-marker";
import QrScanButton from "@/modules/registrations/ui/QrScanButton";
import { readSpareLines, spareLineWords } from "@/modules/registrations/spare-line";
import { raceDayTabs } from "@/modules/race-day/ui/RaceDayTabs";
import { canEnterAtDesk, canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { formatRaceNumber, raceNumberOf } from "@/modules/registrations/domain/race-number";
import { type RaffleLine, readRaffleDeskLines } from "@/modules/volunteers/raffle-roster";
import { raffleDeskLine } from "@/modules/volunteers/ui/RaffleLines";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import type { PanelGlyphName } from "@/shared/ui/panel-glyphs";
import { raffleDeskExclusionAction } from "./raffle-actions";
import { raffleDeskSignUpAction } from "./tombola/actions";

type Props = {
  params: Promise<{ locale: string }>;
  /** `row`: the registration the last press on the list named (§1002), whose section the page draws open. */
  searchParams: Promise<{ eventId?: string; q?: string; saved?: string; error?: string; row?: string } & Partial<Record<keyof PlacesTaken, string>>>;
};

export const dynamic = "force-dynamic";

/**
 * Each section's glyph, by name (`panel-glyphs.ts`, §521): the picture of what its rows share — the bib still to hand, the paper
 * to sign, the person-with-tick of «Marchează prezent», the address, the seat and the hourglass their state's chip wears, the row
 * that is over — so a column of closed sections is read by picture as well as by words.
 */
const SECTION_GLYPH = {
  toPickUp: { glyph: "bibs" },
  unsigned: { glyph: "declaration" },
  // «Prezenți»: the runners checked in — named `checkedIn`, the registration's own word, never a volunteer's «Prezent» (§983).
  checkedIn: { glyph: "registration" },
  addressUnconfirmed: { glyph: "email" },
  offered: { glyph: "placeOffered" },
  waitlisted: { glyph: "queue" },
  voided: { glyph: "cancelRegistration" },
} as const satisfies Record<DeskSectionKey, { glyph: PanelGlyphName }>;

/**
 * The race-day desk (BR-REQ-037-07, BR-REQ-037-08; `DECISIONS.md` §67).
 *
 * One page, for the volunteer with the box of numbers: pick today's event, scan a QR or type a
 * code, a name or a number, and press the one button the row offers. Every staff role may open
 * it, because the desk is where a volunteer works, and it shows what a desk needs — a name, a
 * state, a number — and never an address. The steps of the whole process are on the page
 * itself, folded, so a volunteer who was handed a phone at 7am can read what to do.
 *
 * A GET reads and never writes: the search is a form with method="get", and every button on a
 * row is its own POST.
 *
 * The list folds by state (§1002; the owner, 2026-11-19: «Pe ziua cursei trebuie să fac secțiuni collapsible în funcție de
 * status»): one section per state in the table's working order — «De ridicat numărul», «Fără declarație semnată», «Prezenți»,
 * «Adresă neconfirmată», «Ofertă de loc deschisă», «Pe lista de așteptare», and «Anulate sau expirate» when a number found such
 * a row — each a level-3 `Panel` whose summary says its words and the count of its rows, the empty ones not drawn
 * (`domain/desk-sections.ts` decides which open). A search opens every section it found somebody in; a press on a row comes back
 * with the row (`row=`) and its section open; a typed code draws its one runner alone, as before. Server Components only:
 * every section is a `<details>`, so it folds before hydration and with JavaScript off.
 */
export default async function DeskPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canWorkTheDesk(actor.role)) notFound();

  const query = await searchParams;
  const { eventId: requestedEventId, q = "", saved, error } = query;
  const t = await getTranslations("Admin");
  const db = getDb();
  const now = new Date();

  // Today's events first; when nothing is within the window, every event taking entries, so
  // the desk can still be rehearsed a month early.
  let events = await listEventsForDesk(db, locale, now);
  if (events.length === 0) events = await listEventsAcceptingRegistrations(db, locale);
  const eventId = events.some((event) => event.id === requestedEventId)
    ? (requestedEventId as string)
    : events[0]?.id;

  // A code finds one runner at any event; anything else searches the chosen event.
  const code = normalizeCheckinCode(q);
  const byCode = isCheckinCode(code) ? await findRegistrationByCheckinCode(db, code, locale) : undefined;
  const rows = byCode ? [byCode] : eventId ? await listDeskRegistrations(db, { eventId, query: q, locale }) : [];
  const counts = eventId ? await countDesk(db, eventId) : null;
  // The race is over (§82): the rows still read, the buttons are gone, and the service refuses
  // a check-in anyway.
  const closed = eventId ? await isEventCompleted(db, eventId) : false;
  // Whether a minor's paper carries the minor's signature too (§330): the declaration in effect,
  // per language, read once for every row rather than once per row.
  const minorSigns = rows.length > 0 ? await declarationAsksMinorToSignByLocale(db, now, rows[0].eventId) : { ro: false, en: false };
  // The next free desk spare of each event on the page (§444) — one, or two when a code found a
  // runner of another event — read once for every row.
  const spares = rows.length > 0 ? await spareStates(db, rows.map((row) => row.eventId)) : {};
  // Who came with whom (§543): the other people on each row's address, names only, one query.
  const family = await familyOf(db, rows);
  // The raffle (§984): every row says whether its person takes part — a search by name or number, or a typed code, lands here and
  // not on the scanned person's view — and, in the open sign-up mode, offers the desk's «Înscrie la tombolă». One read for every row.
  // Since §1020 every desk role also takes a runner off the raffle or puts them back from the line, asked first with their number.
  const raffleLines = rows.length > 0 ? await readRaffleDeskLines(db, rows, now) : new Map<string, RaffleLine>();
  const raffleOf = new Map(
    await Promise.all(
      rows.map(async (row) => {
        const line = raffleLines.get(row.id);
        const number = raceNumberOf(row);
        const drawn = line
          ? await raffleDeskLine({
              line,
              locale,
              back: { to: "desk", eventId, q },
              registrationId: row.id,
              name: row.registeredName,
              number: number === null ? null : formatRaceNumber(number, row.raceNumberFormat),
              action: raffleDeskSignUpAction,
              exclusionAction: raffleDeskExclusionAction,
              // The race is over (§82): the row reads, and the line offers no press either.
              readOnly: closed,
            })
          : null;
        return [row.id, drawn] as const;
      }),
    ),
  );

  const codeHrefTemplate = getPathname({
    locale,
    href: { pathname: "/admin/checkin/[code]", params: { code: "__CODE__" } },
  });
  // The chosen event's free desk spares (§444), in one line beside the counts (§979): what «Adaugă pe cineva» picks from.
  const spareLine = eventId ? await spareLineWords((await readSpareLines(db, [eventId]))[eventId] ?? { kind: "none" }, locale) : null;
  // «Adaugă pe cineva» is the organizers' (§NNN, `canEnterAtDesk`): every other desk role reads, in its place, that an organizer adds them.
  const mayEnter = canEnterAtDesk(actor);
  const walkInHref = eventId && mayEnter
    ? `${getPathname({ locale, href: "/admin/registrations/new" })}?eventId=${eventId}&back=desk`
    : null;

  // The desk's list in sections, one per state (§1002): a search (a name fragment or a number) opens each section it found somebody
  // in, and the row a press came back with (`row=`) opens the section that holds it now. A typed code draws its runner alone.
  const returnedRow = returnedRowOf(query.row);
  const sections = byCode
    ? []
    : deskSections(rows, { searching: q.trim() !== "", returned: returnedRow ? { id: returnedRow, refused: Boolean(error) } : null });
  // One runner's row, wherever the page draws it: the code's one row, or a row of a section.
  const deskRow = (row: DeskRegistration) => (
    <DeskRow
      key={row.id}
      row={row}
      locale={locale}
      back="desk"
      eventId={eventId}
      q={q}
      showEvent={Boolean(byCode)}
      readOnly={closed}
      minorSigns={minorSigns}
      spare={spares[row.eventId]}
      family={(family.get(row.id) ?? []).map((member) => member.name)}
      role={actor.role}
    >
      {raffleOf.get(row.id)}
    </DeskRow>
  );

  return (
    <Stack spacing={3}>
      {/* «Ziua cursei»'s tabs (§979): this page is «Prezența»; the title under them is the desk's, as it was. */}
      {await raceDayTabs({ locale, active: "desk", eventId, actor })}
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("desk.title")}
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`, noFreePlaceValues(error, query))}</Alert>}
        {saved && <Alert severity="success">{t(`desk.saved.${saved}`)}</Alert>}
      </Box>

      {/* The whole process, on the page, folded: what happens before, at the table, and after. */}
      <Box component="details" sx={BOXED_DISCLOSURE_SX}>
        <Typography component="summary" variant="subtitle2">
          <HelpOutlineIcon aria-hidden sx={FOLD_GLYPH_SX} />
          {t("desk.howTitle")}
        </Typography>
        <Box component="ol" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.75 } }}>
          {(t.raw("desk.how") as string[]).map((step, index) => (
            <Typography component="li" variant="body2" key={index}>
              {step}
            </Typography>
          ))}
        </Box>
      </Box>

      {events.length === 0 ? (
        <Alert severity="warning">{t("desk.noEvents")}</Alert>
      ) : (
        <form method="get">
          <Stack spacing={1.5}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
              {/* A native select: it works before hydration and on a phone with a flaky
                  signal, which is the desk's whole situation — the form is a GET anyway. */}
              <TextField
                select
                name="eventId"
                label={t("desk.event")}
                defaultValue={eventId}
                size="small"
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ minWidth: 240 }}
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title ?? event.id} ·{" "}
                    {typedStartOrNull(event) ? formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "short" }) : t("editor.dateToBeAnnounced")}
                  </option>
                ))}
              </TextField>
              <TextField
                name="q"
                label={t("desk.search")}
                defaultValue={q}
                size="small"
                autoComplete="off"
                sx={{ flex: 1 }}
              />
              <GlyphButton icon="search" type="submit" variant="outlined" sx={{ minHeight: 44 }}>
                {t("desk.find")}
              </GlyphButton>
              <QrScanButton
                hrefTemplate={codeHrefTemplate}
                label={t("desk.scan")}
                closeLabel={t("confirm.cancel")}
                hint={t("desk.scanHint")}
                unreadableHint={t("desk.scanUnreadable")}
                switchLabel={t("desk.scanSwitch")}
                cameraLabel={t("desk.scanCamera", { n: "{n}", total: "{total}" })}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t("desk.searchHelp")}
            </Typography>
          </Stack>
        </form>
      )}

      {counts && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          <Chip label={t("desk.counts.confirmed", { n: counts.confirmed })} />
          <Chip
            color="success"
            variant={counts.checkedIn > 0 ? "filled" : "outlined"}
            label={t("desk.counts.checkedIn", { n: counts.checkedIn })}
          />
          {counts.withoutBib > 0 && (
            <Chip color="warning" variant="outlined" label={t("desk.counts.withoutBib", { n: counts.withoutBib })} />
          )}
          {counts.pending > 0 && (
            <Chip color="warning" variant="outlined" label={t("desk.counts.pending", { n: counts.pending })} />
          )}
          {walkInHref && (
            <GlyphButton icon="addPerson" href={walkInHref} variant="text" size="small" sx={{ minHeight: 44 }}>
              {t("desk.walkIn")}
            </GlyphButton>
          )}
          {!mayEnter && (
            <Typography variant="body2" color="text.secondary" data-testid="desk-walk-in-call">
              {t("desk.walkInCall")}
            </Typography>
          )}
        </Stack>
      )}
      {/* The free spares (§979, §444): the blank bibs a walk-in is handed, as ranges — or why there are none — and beside them an
          «i» that says how a spare is given, in the words of the reader's role (§NNN). */}
      {counts && spareLine && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary" data-testid="desk-spares">
            {spareLine}
          </Typography>
          <Box data-testid="desk-spares-tip" sx={{ flexShrink: 0 }}>
            <SparesTip role={actor.role} />
          </Box>
        </Stack>
      )}

      {/* What the buttons on a row do, in one line, always visible (the owner: "I do not
          understand what to do here"). The folded steps above are the long version. */}
      {counts && !closed && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {t("desk.rowHelp")}
          </Typography>
          {/* What the paper confirmation does, once for every row rather than an «i» on each (§640). */}
          <PaperConfirmationTip />
        </Stack>
      )}
      {closed && <Alert severity="info">{t("desk.closed")}</Alert>}
      {byCode && <Alert severity="info">{t("desk.foundByCode")}</Alert>}
      {rows.length === 0 && eventId ? (
        <Typography color="text.secondary">
          {isCheckinCode(code) ? t("desk.unknownCode") : t("desk.nobody")}
        </Typography>
      ) : byCode ? (
        <Stack component="ul" spacing={1} sx={{ m: 0, p: 0 }}>
          {deskRow(byCode)}
        </Stack>
      ) : (
        sections.length > 0 && (
          <Stack spacing={1.5} data-testid="desk-sections">
            {sections.map((section) => (
              <Panel
                key={section.key}
                collapsible
                level={3}
                glyph={SECTION_GLYPH[section.key].glyph}
                title={t(`desk.sections.${section.key}`, { n: section.count })}
                openWhen={section.openWhen}
                id={`desk-section-${section.key}`}
                data-testid={`desk-section-${section.key}`}
              >
                <Stack component="ul" spacing={1} sx={{ m: 0, p: 0 }}>
                  {section.rows.map((row) => deskRow(row))}
                </Stack>
              </Panel>
            ))}
          </Stack>
        )
      )}
    </Stack>
  );
}
