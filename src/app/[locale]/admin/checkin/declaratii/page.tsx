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
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { typedStartOrNull } from "@/modules/events/domain/provisional-start";
import { shortTextHash } from "@/modules/legal-documents/domain/signed-text";
import { findDeclarationsEvent, readRaceDayDeclarations } from "@/modules/race-day/declarations";
import {
  countRealDeclarations,
  type DeclarationSectionKey,
  declarationNumberOf,
  declarationSearchOf,
  declarationSections,
  matchesDeclarationSearch,
  type RaceDayDeclarationRow,
  signedByTwo,
} from "@/modules/race-day/domain/declarations";
import { raceDayTabs } from "@/modules/race-day/ui/RaceDayTabs";
import { listEventsAcceptingRegistrations, listEventsForDesk } from "@/modules/registrations/admin-repository";
import { formatRaceNumber } from "@/modules/registrations/domain/race-number";
import { isTerminalStatus } from "@/modules/registrations/domain/state-machine";
import RegistrationStatusChip from "@/modules/registrations/ui/RegistrationStatusChip";
import TextHashTip from "@/modules/registrations/ui/TextHashTip";
import { canReadRaceDayDeclarations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isUuid } from "@/shared/ids";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import Panel from "@/shared/ui/Panel";
import type { PanelGlyphName } from "@/shared/ui/panel-glyphs";
import StatusChip from "@/shared/ui/StatusChip";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string; q?: string }>;
};

/** Reads the declarations as they stand at every visit. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Each fold's picture, by name (`panel-glyphs.ts`, §521) — the desk's own for the same state (§1002): the paper to sign again, the
 * address, the seat, the hourglass, the row that is over; and, for the confirmed, the person with the tick of a confirmed registration.
 */
const SECTION_GLYPH = {
  confirmed: { glyph: "registration" },
  unsigned: { glyph: "declaration" },
  addressUnconfirmed: { glyph: "email" },
  offered: { glyph: "placeOffered" },
  waitlisted: { glyph: "queue" },
  voided: { glyph: "cancelRegistration" },
} as const satisfies Record<DeclarationSectionKey, { glyph: PanelGlyphName }>;

/** The typed name as the registration's page draws a signature (§330): the handwriting face, a size up. */
const HAND_SX = { fontFamily: "var(--font-signature), cursive", fontSize: "1.375rem", lineHeight: 1.2 } as const;

/** A row: a hairline under it, its parts wrapping on a phone, never wider than the screen. */
const ROW_SX = { listStyle: "none", py: 1, borderBottom: 1, borderColor: "divider", minWidth: 0, overflowWrap: "anywhere" } as const;

/**
 * «Declarații» — «Ziua cursei»'s list of signed declarations (§1018), its last tab (`raceDayTabs`): for the chosen event, every
 * registration that holds a signed declaration, in «Prezența»'s folds by state — «Confirmați» first and open, then «De semnat din
 * nou», «Adresă neconfirmată», «Ofertă de loc deschisă», «Pe lista de așteptare» and «Anulate sau expirate», closed —, each fold
 * with how many real registrations it holds, and «N declarații semnate» above them all. A row: the race number as the desk writes it
 * (struck on a row that is over), the name, when it was signed, the signature as the registration's page draws it — the typed name in
 * the hand; a minor's two, the minor's and the parent's, each named —, the version, «pe hârtie, înregistrată de …» for one recorded
 * at the desk, the short fingerprint with the whole in its tip, «Declarația (PDF)» — the existing route, which asserts the reading
 * right and records every download (`registration.declaration_downloaded`) — and «Pagina înscrierii».
 *
 * A GET form — the event (the desk's own list, and an event the address names that is not on it, so the list is read the day after
 * too), a name or a race number — works before hydration, on a phone. One query for the event's rows (`race-day/declarations.ts`);
 * the folds, the order and the search are the pure half's (`race-day/domain/declarations.ts`).
 *
 * **No identity document is on this page**: it is opened at a race-day table people stand in front of. The document stays in the
 * PDF — opened one at a time, each download on the trail — and on the registration's own page; the read never selects it.
 *
 * The Organizer, the Administrator and the Superadministrator open it (`canReadRaceDayDeclarations`); every other role meets the 404
 * an unknown page gets and is drawn no tab (BR-REQ-060-01). Nothing on it changes anything; nothing on it is public.
 */
export default async function RaceDayDeclarationsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadRaceDayDeclarations(actor.role)) notFound();

  const query = await searchParams;
  const t = await getTranslations("Admin");
  const db = getDb();
  const now = new Date();

  // The desk's own events (§67): today's first, else every event taking entries — and an event the address names all the same, when it
  // exists (a declaration is looked up the day after too, once the race is closed).
  let events = await listEventsForDesk(db, locale, now);
  if (events.length === 0) events = await listEventsAcceptingRegistrations(db, locale);
  const requested = typeof query.eventId === "string" && isUuid(query.eventId) ? await findDeclarationsEvent(db, query.eventId, locale) : null;
  const event = requested ?? (events[0] ? await findDeclarationsEvent(db, events[0].id, locale) : null);
  const options = event && !events.some((candidate) => candidate.id === event.id) ? [event, ...events] : events;
  const eventLabel = (candidate: { id: string; title: string | null; startsAt: Date; timezone: string }) =>
    `${candidate.title ?? candidate.id} · ${typedStartOrNull(candidate) ? formatDay(candidate.startsAt, { locale, timeZone: candidate.timezone, style: "short" }) : t("editor.dateToBeAnnounced")}`;

  const q = typeof query.q === "string" ? query.q : "";
  const search = declarationSearchOf(q);
  const rows = event ? await readRaceDayDeclarations(db, actor, event.id) : [];
  const sections = declarationSections(
    rows.filter((row) => matchesDeclarationSearch(row, search)),
    { searching: search.kind !== "none" },
  );
  // Every real registration's signed declaration of the event, the search apart (§30: a test registration is never counted).
  const signed = countRealDeclarations(rows);

  const row = (entry: RaceDayDeclarationRow) => {
    const number = declarationNumberOf(entry);
    const over = isTerminalStatus(entry.status);
    const when = event ? formatDay(entry.acceptedAt, { locale, timeZone: event.timezone, style: "short", withTime: true, position: "inline" }) : "";
    const registrationHref = getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: entry.registrationId } } });
    return (
      <Box component="li" key={entry.registrationId} sx={ROW_SX} data-testid="race-day-declaration" data-registration={entry.registrationId}>
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: 0.5 }}>
          {/*
            The number first and large, as the desk writes it (§548, §735): «—» until the registration is confirmed, and struck through
            and dimmed on a row that is over (§311) — still this person's, never a number to reach for.
          */}
          <Typography
            component="span"
            data-testid="race-day-declaration-number"
            sx={{
              fontWeight: 700,
              fontSize: "1.25rem",
              minWidth: 48,
              fontVariantNumeric: "tabular-nums",
              color: number !== null && !over ? "text.primary" : "text.disabled",
              textDecoration: over && number !== null ? "line-through" : "none",
            }}
          >
            {number !== null ? formatRaceNumber(number, event?.raceNumberFormat) : "—"}
          </Typography>
          <Typography component="span" sx={{ fontWeight: 600, fontSize: "1.05rem" }} data-testid="race-day-declaration-name">
            {entry.registeredName}
          </Typography>
          {/* «Anulate sau expirate» holds two states: the row says which. Every other fold is one state, its title the word. */}
          {over && <RegistrationStatusChip status={entry.status} testId="race-day-declaration-status" />}
          {entry.kind === "TEST" && <StatusChip glyph="test" color="warning" label={t("registrations.testKind")} testId="race-day-declaration-test" />}
        </Stack>
        {/* When, and the signature as the registration's page draws it: a minor's declaration is signed by two (§330), each named. */}
        <Typography variant="body2" data-testid="race-day-declaration-signature">
          {t("raceDay.declarations.signedAt", { when })}
          {" — "}
          {signedByTwo(entry) ? (
            <>
              <Box component="span" sx={HAND_SX} data-testid="race-day-declaration-hand">
                {entry.minorTypedName}
              </Box>{" "}
              ({t("registrations.signedByMinor")}) ·{" "}
              <Box component="span" sx={HAND_SX} data-testid="race-day-declaration-hand">
                {entry.typedName}
              </Box>{" "}
              ({t("registrations.signedByGuardian")})
            </>
          ) : (
            <Box component="span" sx={HAND_SX} data-testid="race-day-declaration-hand">
              {entry.typedName}
            </Box>
          )}
        </Typography>
        {/* The version, who recorded a paper one at the desk (BR-REQ-037-07), and the proof of signing (§556): twelve characters, the whole in a tip. */}
        <Typography variant="body2" color="text.secondary" data-testid="race-day-declaration-facts">
          {t("raceDay.declarations.version", { version: entry.declarationVersion })}
          {entry.method === "PAPER" && (
            <Box component="span" data-testid="race-day-declaration-paper">
              {` · ${t("registrations.declarationPaper", { who: entry.recordedByName ?? t("registrations.auditActorRemoved") })}`}
            </Box>
          )}
          {entry.textHash && (
            <>
              {" · "}
              <TextHashTip label={t("declarationHold.textHash")} hash={entry.textHash} short={shortTextHash(entry.textHash)} />
            </>
          )}
        </Typography>
        <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 1, mt: 0.5 }}>
          {/* The route the registration's page links: it asserts the reading right again and records every download (§324). */}
          <GlyphButton
            icon="pdf"
            href={`/api/admin/registrations/${entry.registrationId}/declaration`}
            target="_blank"
            rel="noopener"
            variant="outlined"
            size="small"
            sx={TAP_TARGET}
            data-testid="race-day-declaration-pdf"
          >
            {t("raceDay.declarations.pdf")}
          </GlyphButton>
          {/* A plain link, never prefetched: three hundred rows in view would each wake a page nobody opened. */}
          <GlyphButton icon="goTo" href={registrationHref} variant="text" size="small" sx={TAP_TARGET} data-testid="race-day-declaration-registration">
            {t("raceDay.declarations.registration")}
          </GlyphButton>
        </Stack>
      </Box>
    );
  };

  return (
    <Stack spacing={3}>
      {await raceDayTabs({ locale, active: "declarations", eventId: event?.id, actor })}
      <Typography variant="h2" sx={HEADING_SX.title} data-testid="race-day-declarations-title">
        {t("raceDay.declarations.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("raceDay.declarations.intro")}
      </Typography>

      {options.length === 0 || !event ? (
        <Alert severity="warning">{t("desk.noEvents")}</Alert>
      ) : (
        <>
          <Box component="form" method="get" data-testid="race-day-declarations-filters">
            <Stack spacing={1}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
                {/* Native, as on the desk: it works before hydration, and the form is a GET anyway. */}
                <TextField
                  select
                  name="eventId"
                  label={t("desk.event")}
                  defaultValue={event.id}
                  size="small"
                  slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                  sx={{ minWidth: 240 }}
                >
                  {options.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {eventLabel(candidate)}
                    </option>
                  ))}
                </TextField>
                <TextField name="q" label={t("raceDay.declarations.search")} defaultValue={q} size="small" autoComplete="off" sx={{ flex: 1 }} />
                <GlyphButton icon="search" type="submit" variant="outlined" sx={TAP_TARGET}>
                  {t("desk.find")}
                </GlyphButton>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t("raceDay.declarations.searchHelp")}
              </Typography>
            </Stack>
          </Box>

          <Typography sx={{ fontWeight: 600 }} data-testid="race-day-declarations-count">
            {t(`raceDay.declarations.count.${countForm(signed, locale)}`, { count: signed })}
          </Typography>

          {rows.length === 0 ? (
            <Typography color="text.secondary" data-testid="race-day-declarations-empty">
              {t("raceDay.declarations.empty")}
            </Typography>
          ) : sections.length === 0 ? (
            <Typography color="text.secondary" data-testid="race-day-declarations-nobody">
              {t("desk.nobody")}
            </Typography>
          ) : (
            <Stack spacing={1.5} data-testid="race-day-declarations-sections">
              {sections.map((section) => (
                <Panel
                  key={section.key}
                  collapsible
                  level={3}
                  glyph={SECTION_GLYPH[section.key].glyph}
                  title={t(`raceDay.declarations.sections.${section.key}`, { n: section.count })}
                  openWhen={section.openWhen}
                  id={`race-day-declarations-${section.key}`}
                  data-testid={`race-day-declarations-section-${section.key}`}
                >
                  <Box component="ul" sx={{ m: 0, p: 0 }}>
                    {section.rows.map(row)}
                  </Box>
                </Panel>
              ))}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
