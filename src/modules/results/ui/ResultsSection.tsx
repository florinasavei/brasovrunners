import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { PublicEvent } from "@/modules/events/repository";
import StartListSocials from "@/modules/events/ui/StartListSocials";
import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import { formatRaceNumber } from "@/modules/registrations/domain/race-number";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_INLINE_SX } from "@/shared/ui/disclosure";
import { SR_ONLY_SX } from "@/shared/ui/sr-only";
import { DENSITY } from "@/theme/density";
import { categoryLabeller } from "../category-labels";
import { resultsShownSince } from "../domain/from-start";
import { resultsLiveInstants, resultsLiveRefreshWindow } from "../domain/live-window";
import { anonymousResultLabel } from "../domain/public-name";
import { formatResultTime } from "../domain/result-time";
import { readEventResultsForPage, readResultsGates } from "../public-page";
import { categoriesPresent, categoryGlyphOf } from "./results-filter";
import ResultsSort from "./ResultsSort";
import ResultsFilter from "./ResultsFilter";
import ResultsLiveRefresh from "./ResultsLiveRefresh";

/** What the table's number and time cells say for a row with none: the backoffice's and the start list's own dash (§548). */
const NO_VALUE = "—";

/** The table's `id`: the filter island finds the rows to hide by it. */
const TABLE_ID = "results-table";

/** What the section reads of the event — all of it on the page's row and the listing's. */
type ResultsEvent = Pick<PublicEvent, "id" | "type" | "resultsPublished" | "resultsTicked" | "startsAt" | "endsAt" | "raceNumberFormat">;

/**
 * **«Clasament»** — a race's published results on its page, under `#clasament` (§809, race results part 2; the owner, 2026-10-17:
 * «Aș vrea să pot pune și clasament la final după cursă»). Drawn by `EventPageView` after the race's start list («Cine vine (N)», under the registration card) and «Condiții de participare»; only the two turn-up folds come after it, last on the page (§825 amended). A
 * native `<details>` in the same outlined shape, **open** on arrival — after a race the results are what a visitor came for.
 *
 * ## When there is nothing at all
 *
 * `readEventResultsForPage` answers `null` — not published, the privacy notice or the terms in force not describing the results, the
 * race not started, the public list's period over (§421) — and then this draws **nothing** to see: no heading, no «în curând» (on a
 * ticked race before its window's end, the silent clock alone — below). The page is
 * held until the race starts and until the period ends (`holdPageUntil`), so a static copy is made again then. While the database is
 * away the section is left out and the page stands, as the start list is (`readOrWhileAway`); like it, it is never served from a saved
 * copy: a stale ranking is a wrong place.
 *
 * ## What it shows, and whose name
 *
 * One row per result, in the sheet's order — the finishers by place, then those who did not finish, without a place and with their
 * word (`Event.results.status`). Ties share a place: the page prints what the ranking gives. **The name is never decided here**: the read
 * names a runner only by the public list's own rule — a confirmed registration whose owner ticked «Vreau să apar pe lista de participanți
 * & rezultate», made under a notice that described the results (§143, §396, §421, §743) — and every other row is «Participant #număr»
 * (`Event.results.anonymous`, the number written as the event writes it, §735). The section adds no name source and no condition of its own.
 *
 * ## The shape
 *
 * A table from the small breakpoint up — «Loc», «Nr.», «Nume», «Timp» (the chip time under it in a caption when there is one),
 * «Categorie» (the words of the club's statistics, §787, and «loc N» in it). At 320 pixels each row is a block (`EventCheckpoints`'
 * stack, tightened to three lines): the place at the left, the name over the number and the time, the category under them. The one
 * island, `ResultsFilter`, narrows the rows by category and by number; without a script everything shows.
 *
 * ## Public from the start, and live while the race runs (§985)
 *
 * The Administrator may tick the results public before the race; nothing above changes for that — the read is `null` until the start,
 * so the section is not drawn — and from the start the «Publicat …» line names the start, not the earlier tick (`resultsShownSince`).
 * While the race runs (`live-window.ts#resultsLiveAt`: from the start until its end, or six hours for a race saved without one) a
 * second island, `ResultsLiveRefresh`, refreshes the page every 30 seconds while it is open and visible, with one calm line saying so.
 * Whether it is drawn is read from the event's row alone — the tick as saved, a race, the window (`resultsLiveRefreshWindow`) — never
 * from a read that can fail: so while nothing else is drawn before the window's end (before the start, the sheet still empty before the
 * first finish, or the database away at that render) the island is drawn alone and silent in the section's place, and a page opened
 * then shows what the race brings, the first result, or the section back, at a later refresh. Drawn before the start, it is armed to
 * the start and asks nothing until then: it says no more than that the results are ticked, never a result. The page is held to the
 * window's start and end (`resultsLiveInstants`): a copy made before the race is made again at its start, and one made during it is
 * made again at its end, without the island.
 */
export default async function ResultsSection({ event }: { event: ResultsEvent }) {
  const now = new Date();
  const holds = resultsLiveInstants(event, now);
  if (holds.length > 0) await holdPageUntil(holds, now);
  const live = resultsLiveRefreshWindow(event, now);
  const section = await readOrWhileAway(() => resultsSectionOrThrow(event, now, live), null);
  if (section !== null || live === null) return section;
  // Before the window's end and nothing drawn: the clock alone, with no line — unless the texts in force no longer describe the results,
  // when no result saved could show. Read as the section reads them (cached); while the database is away, the clock stays.
  const gates = await readOrWhileAway(() => readResultsGates(now), null);
  if (gates !== null && !(gates.noticeDescribes && gates.termsDescribe)) return null;
  return <ResultsLiveRefresh from={live.from.getTime()} until={live.until.getTime()} line={null} />;
}

/** Seconds per kilometre of a finisher with a time and a distance (§1034), or null — what «după ritm mediu» orders by. */
function paceSeconds(row: { status: string; gunTimeMs: number | null; distanceMeters: number | null }): number | null {
  if (row.status !== "FINISHED" || row.gunTimeMs === null || row.distanceMeters === null || row.distanceMeters <= 0) return null;
  return Math.round(row.gunTimeMs / 1000 / (row.distanceMeters / 1000));
}

/** Minutes and seconds per kilometre, `5:07` (§1034): the time over the distance, rounded to the second. */
function formatPace(gunTimeMs: number, meters: number): string {
  const secondsPerKm = Math.round(gunTimeMs / 1000 / (meters / 1000));
  return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, "0")}`;
}

/** A distance in kilometres in the reader's language, one decimal at most: `11`, `8,8`. */
function formatKm(meters: number, locale: string): string {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "ro-RO", { maximumFractionDigits: 1 }).format(meters / 1000);
}

async function resultsSectionOrThrow(event: ResultsEvent, now: Date, live: { from: Date; until: Date } | null) {
  const results = await readEventResultsForPage(event, now);
  if (!results || results.rows.length === 0) return null;

  const locale = await getLocale();
  const t = await getTranslations("Event");
  // The category words are the club's statistics' (§787), under the race's own bands (§850): the same «Feminin, 30-39 ani» in the Excel, the CSV and here.
  const categoryLabel = await categoryLabeller(locale, results.ageBandStarts);

  const { rows } = results;
  // The filter's chips: «Feminin» and «Masculin» alone — the owner, race day 2026-11-21: «vreau doar feminin și masculin, atât!» (§1033).
  const categories = categoriesPresent(rows.map((row) => row.sex)).map((key) => ({ key, label: key === "FEMALE" ? t("results.sexFemale") : t("results.sexMale"), glyph: categoryGlyphOf(key) }));
  const day = (date: Date, withTime: boolean) => formatDay(date, { locale, timeZone: CLUB_TIME_ZONE, style: "short", position: "inline", withTime });
  // Ticked before the race (§985), the results have been on the page since its start, not since the tick.
  const shownSince = resultsShownSince(results.publishedAt, event.startsAt);
  const line = shownSince
    ? t("results.published", { published: day(shownSince, true), until: day(results.closesAt, true) })
    : t("results.until", { until: day(results.closesAt, true) });
  const numberOf = (bibNumber: number) => formatRaceNumber(bibNumber, event.raceNumberFormat);

  // «Clasament elite» has no «Loc» column (the owner, 2026-11-22: «nu mai afișa coloana de „Loc” pentru elite»): `withPlace` false.
  // «Timp (orientativ)» while the times were noted by hand (§1044 — the owner: «la timp, în paranteză, „(orientativ)”»).
  const timeWord = results.manualTime ? t("results.columnTimeIndicative") : t("results.columnTime");
  const tableOf = (list: typeof rows, tableId: string, rowTestId: string, withPlace = true) => (
  <Box
    component="table"
    id={tableId}
    sx={{
      width: "100%",
      borderCollapse: "collapse",
      // Phone: every row a block of three lines, the place at the left (the checkpoints' stack, tightened).
      display: { xs: "block", sm: "table" },
      "& thead": { display: { xs: "block", sm: "table-header-group" } },
      // Hidden from the eye on a phone, read by a screen reader: the cells carry their own words there.
      "& thead tr": {
        position: { xs: "absolute", sm: "static" },
        width: { xs: "1px", sm: "auto" },
        height: { xs: "1px", sm: "auto" },
        overflow: { xs: "hidden", sm: "visible" },
        clipPath: { xs: "inset(50%)", sm: "none" },
      },
      "& tbody": { display: { xs: "block", sm: "table-row-group" } },
      "& tbody tr": {
        display: { xs: "grid", sm: "table-row" },
        // `minmax(0, 1fr)` and `minWidth: 0` below: a long comment or pace line wraps inside the phone's width, never past its edge (§1038).
        gridTemplateColumns: { xs: withPlace ? "2.5rem max-content minmax(0, 1fr)" : "max-content minmax(0, 1fr)", sm: "none" },
        gridTemplateAreas: {
          xs: withPlace ? '"place name name" "place number time" "place category category"' : '"name name" "number time" "category category"',
          sm: "none",
        },
        columnGap: { xs: 1, sm: 0 },
        borderBottom: 1,
        borderColor: "divider",
        py: { xs: 1, sm: 0 },
      },
      // The filter hides a row with the `hidden` attribute; the display above would otherwise win over the browser's own rule.
      "& tbody tr[hidden]": { display: "none" },
      "& th": { textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "text.secondary", whiteSpace: "nowrap", py: 1, px: 1, borderBottom: 1, borderColor: "divider" },
      "& td": { textAlign: "left", verticalAlign: "top", fontSize: "0.9375rem", py: { xs: 0, sm: 1 }, px: { xs: 0, sm: 1 } },
      "& td[data-col='place']": { gridArea: "place", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "text.secondary", width: { sm: "3rem" } },
      "& td[data-col='name']": { gridArea: "name", overflowWrap: "anywhere", minWidth: 0 },
      "& td[data-col='number']": { gridArea: "number", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textAlign: { sm: "right" }, width: { sm: "1%" } },
      "& td[data-col='time']": { gridArea: "time", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", minWidth: 0 },
      "& td[data-col='category']": { gridArea: "category", color: "text.secondary" },
      // The column's word before the cell on a phone, where there is no header to read it from.
      "& td[data-label]::before": { content: "attr(data-label) ' '", display: { xs: "inline", sm: "none" }, fontSize: "0.8125rem", fontWeight: 600, color: "text.secondary" },
    }}
  >
    <Box component="caption" sx={SR_ONLY_SX}>
      {t("results.caption")}
    </Box>
    <thead>
      <tr>
        {withPlace && (
          <th scope="col" data-col="place">
            {t("results.columnPlace")}
          </th>
        )}
        {/* In the cells' own order — place, name, number (§1035: the owner, «ai încurcat bib cu nume»): a header over its own column. */}
        <th scope="col" data-col="name">
          {t("results.columnName")}
        </th>
        <th scope="col" data-col="number" aria-label={t("startList.columnNumberFull")}>
          <Box component="abbr" title={t("startList.columnNumberFull")} sx={{ textDecoration: "none" }}>
            {t("startList.columnNumber")}
          </Box>
        </th>
        <th scope="col" data-col="time">
          {timeWord}
        </th>
        <th scope="col" data-col="category">
          {t("results.columnCategory")}
        </th>
      </tr>
    </thead>
    <tbody>
      {list.map((row, index) => {
        const finished = row.status === "FINISHED";
        return (
          <tr key={row.bibNumber} data-testid={rowTestId} data-bib={row.bibNumber} data-category={row.sex ?? ""} data-status={row.status} data-order={index} data-pace={paceSeconds(row) ?? undefined}>
            {withPlace && (
              <td data-col="place" data-testid="result-place">
                {finished && row.positionOverall !== null ? (
                  row.positionOverall
                ) : (
                  <>
                    <span aria-hidden="true">{NO_VALUE}</span>
                    <Box component="span" sx={SR_ONLY_SX}>
                      {t("results.noPlace")}
                    </Box>
                  </>
                )}
              </td>
            )}
            <td data-col="name" data-testid="result-name">
              {row.name !== null ? (
                <>
                  {row.name}
                  {/* «Activitatea ta pe Strava» (§1048): the runner's own link, beside a name the page prints — the read gives it only there. */}
                  <StartListSocials stravaActivity={row.stravaActivityUrl} stravaLabel={t("results.stravaActivity", { name: row.name })} />
                </>
              ) : (
                <Box component="span" sx={{ color: "text.secondary", fontStyle: "italic" }}>
                  {anonymousResultLabel(locale, row.bibNumber, event.raceNumberFormat)}
                </Box>
              )}
              {/* «Comentariu public» (§1031): the Administrator's line, an asterisk after the name and the words under it. */}
              {row.publicNote !== null && (
                <>
                  {" *"}
                  <Box component="span" data-testid="result-public-note" sx={{ display: "block", typography: "body2", color: "text.secondary", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                    {`* ${row.publicNote}`}
                  </Box>
                </>
              )}
            </td>
            <td data-col="number" data-label={t("startList.columnNumber")} data-testid="result-number">
              {numberOf(row.bibNumber)}
            </td>
            {/* A runner who did not finish has a word in this cell, not a time: the phone must not print «Timp» before «Abandon». */}
            <td data-col="time" data-label={finished ? timeWord : undefined} data-testid="result-time">
              {finished ? (
                <>
                  <span>{row.gunTimeMs !== null ? formatResultTime(row.gunTimeMs) : NO_VALUE}</span>
                  {row.chipTimeMs !== null && (
                    <Typography component="span" variant="caption" color="text.secondary" data-testid="result-chip-time" sx={{ display: "block", fontWeight: 400 }}>
                      {t("results.chipTime", { time: formatResultTime(row.chipTimeMs) })}
                    </Typography>
                  )}
                  {/* «Ritm mediu» (§1034): the gun time over the distance covered — the race's, or the runner's own when an Administrator set one. */}
                  {row.gunTimeMs !== null && row.distanceMeters !== null && row.distanceMeters > 0 && (
                    <Typography component="span" variant="caption" color="text.secondary" data-testid="result-pace" sx={{ display: "block", fontWeight: 400, whiteSpace: "normal" }}>
                      {t("results.pace", { pace: formatPace(row.gunTimeMs, row.distanceMeters) })}
                      {row.ownDistance ? ` · ${t("results.ownDistance", { km: formatKm(row.distanceMeters, locale) })}` : null}
                    </Typography>
                  )}
                </>
              ) : (
                // A runner who did not finish has no time to read: the word says how the race ended, in text, never a colour alone.
                <span data-testid="result-status">{t(`results.status.${row.status}`)}</span>
              )}
            </td>
            <td data-col="category" data-testid="result-category">
              {row.categoryKey ? (
                <>
                  {categoryLabel(row.categoryKey)}
                  {finished && row.positionCategory !== null ? ` · ${t("results.categoryPlace", { position: row.positionCategory })}` : null}
                </>
              ) : row.sex !== null ? (
                // The sex alone, no band and no place by category, when the birth date is missing (§1037 — the owner: «doar zi sexul măcar»).
                <span data-testid="result-category-sex">{row.sex === "FEMALE" ? t("results.sexFemale") : t("results.sexMale")}</span>
              ) : (
                <>
                  <span aria-hidden="true">{NO_VALUE}</span>
                  <Box component="span" sx={SR_ONLY_SX}>
                    {t("results.noCategory")}
                  </Box>
                </>
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
  </Box>
  );

  // With the elites apart, both tables sit in one «Clasament» fold and their own headings step down to h3 (§1042).
  const wrapped = (results.separateRows ?? []).length > 0;

  // «Clasament elite» (§1031), a section of its own, FIRST, above the open one — «vreau să fie TOP!» — the owner, race day: «nu e clară secțiunea … trebuie pus separat».
  const elitesFold = wrapped && (
        <Box
          component="details"
          open
          aria-labelledby="results-elite-title"
          data-testid="results-elite-section"
          sx={{
            mb: { xs: DENSITY.sectionGap, sm: 4 },
            border: 2,
            borderColor: "secondary.main",
            borderRadius: 2,
            px: 2,
            "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5 },
            ...DISCLOSURE_OPEN_ARROW,
            "&[open]": { pb: 2 },
          }}
        >
          <Box component="summary">
            <Typography component="h3" id="results-elite-title" variant="h2" data-testid="results-elite-title" sx={{ fontSize: "1.25rem" }}>
              <LeaderboardIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
              {t("results.eliteTitle")}
            </Typography>
          </Box>
          {(results.separateRows ?? []).some((row) => paceSeconds(row) !== null) && <ResultsSort tableId={`${TABLE_ID}-elite`} words={{ label: t("results.sort.label"), time: t("results.sort.time"), pace: t("results.sort.pace") }} />}
          {tableOf(results.separateRows ?? [], `${TABLE_ID}-elite`, "result-elite-row", false)}
        </Box>
  );

  const openFold = (
      <Box
        component="details"
        open
        aria-labelledby="results-title"
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          px: 2,
          "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5 },
          ...DISCLOSURE_OPEN_ARROW,
          "&[open]": { pb: 2 },
        }}
      >
        {/* A real `h2` inside the summary, so the heading stays in a screen reader's list while the fold is shut (§336, the rules' fold). */}
        <Box component="summary">
          <Typography component={wrapped ? "h3" : "h2"} id="results-title" variant="h2" sx={{ fontSize: "1.25rem" }}>
            <LeaderboardIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
            {results.manualTime ? t("results.titleNoChip") : t("results.title")}
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" data-testid="results-published" sx={{ pb: 1 }}>
          {line}
        </Typography>

        {results.manualTime && (
          <Typography variant="body2" color="text.secondary" data-testid="results-manual-time" sx={{ pb: 1 }}>
            {t("results.manualTime")}
          </Typography>
        )}

        {/* While the race runs (§985): the clock, with its line, under «Publicat …». */}
        {live && <ResultsLiveRefresh from={live.from.getTime()} until={live.until.getTime()} line={t("results.live")} />}

        {rows.length > 1 && (
          <ResultsFilter
            tableId={TABLE_ID}
            categories={categories}
            words={{
              label: t("results.filter.label"),
              category: t("results.filter.category"),
              all: t("results.filter.all"),
              search: t("results.filter.search"),
              none: t("results.filter.none"),
            }}
          />
        )}

        {rows.some((row) => paceSeconds(row) !== null) && <ResultsSort tableId={TABLE_ID} words={{ label: t("results.sort.label"), time: t("results.sort.time"), pace: t("results.sort.pace") }} />}
        {tableOf(rows, TABLE_ID, "result-row")}


        {/* The note about the tick (§808) says who is named — untrue while «Toate numele» names everybody, so it is not drawn then (§1036: the owner, «partea asta nu mai are sens»). */}
        {!results.manualTime && (
          <Typography variant="body2" color="text.secondary" data-testid="results-note" sx={{ mt: 2 }}>
            {t("results.note")}
          </Typography>
        )}
      </Box>
  );

  return (
    // Google honours `data-nosnippet` only on span, div and section elements: the wrapper carries it, as the start list's does, so
    // names stay out of search snippets (§421); the page itself stays indexed.
    <Box component="section" id="clasament" data-nosnippet="" data-testid="results-section" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 }, scrollMarginTop: 16 }}>
      {wrapped ? (
        // The whole «Clasament» one fold, open on arrival (§1042 — the owner, 2026-11-22: «toată secțiunea de „Clasament” trebuie să fie
        // collapsible», «așa e greu de urmărit și de dat scroll pe toată pagina»). No frame of its own: the tables keep a phone's width.
        <Box component="details" open aria-labelledby="results-all-title" data-testid="results-fold" sx={{ "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5 }, ...DISCLOSURE_OPEN_ARROW }}>
          <Box component="summary">
            <Typography component="h2" id="results-all-title" variant="h2" data-testid="results-all-title" sx={{ fontSize: "1.375rem" }}>
              <LeaderboardIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
              {t("results.title")}
            </Typography>
          </Box>
          {elitesFold}
          {openFold}
        </Box>
      ) : (
        openFold
      )}
    </Box>
  );
}
