import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { PublicEvent } from "@/modules/events/repository";
import { formatRaceNumber } from "@/modules/registrations/domain/race-number";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_INLINE_SX } from "@/shared/ui/disclosure";
import { SR_ONLY_SX } from "@/shared/ui/sr-only";
import { DENSITY } from "@/theme/density";
import { categoryLabeller } from "../category-labels";
import { anonymousResultLabel } from "../domain/public-name";
import { formatResultTime } from "../domain/result-time";
import { readEventResultsForPage } from "../public-page";
import { categoriesPresent, categoryGlyphOf } from "./results-filter";
import ResultsFilter from "./ResultsFilter";

/** What the table's number and time cells say for a row with none: the backoffice's and the start list's own dash (§548). */
const NO_VALUE = "—";

/** The table's `id`: the filter island finds the rows to hide by it. */
const TABLE_ID = "results-table";

/** What the section reads of the event — all of it on the page's row and the listing's. */
type ResultsEvent = Pick<PublicEvent, "id" | "type" | "resultsPublished" | "startsAt" | "endsAt" | "raceNumberFormat">;

/**
 * **«Clasament»** — a race's published results on its page, under `#clasament` (§809, race results part 2; the owner, 2026-10-17:
 * «Aș vrea să pot pune și clasament la final după cursă»). Drawn by `EventPageView` after the race's start list («Cine vine (N)», under the registration card) and «Condiții de participare»; only the two turn-up folds come after it, last on the page (§825 amended). A
 * native `<details>` in the same outlined shape, **open** on arrival — after a race the results are what a visitor came for.
 *
 * ## When there is nothing at all
 *
 * `readEventResultsForPage` answers `null` — not published, the privacy notice or the terms in force not describing the results, the
 * race not started, the public list's period over (§421) — and then this draws **nothing**: no heading, no «în curând». The page is
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
 */
export default async function ResultsSection(props: { event: ResultsEvent }) {
  return readOrWhileAway(() => resultsSectionOrThrow(props), null);
}

async function resultsSectionOrThrow({ event }: { event: ResultsEvent }) {
  const now = new Date();
  const results = await readEventResultsForPage(event, now);
  if (!results || results.rows.length === 0) return null;

  const locale = await getLocale();
  const t = await getTranslations("Event");
  // The category words are the club's statistics' (§787): the same «Feminin, 30-39 ani» in the Excel, the CSV and here.
  const categoryLabel = await categoryLabeller(locale);

  const { rows } = results;
  const categories = categoriesPresent(rows.map((row) => row.categoryKey)).map((key) => ({ key, label: categoryLabel(key), glyph: categoryGlyphOf(key) }));
  const day = (date: Date, withTime: boolean) => formatDay(date, { locale, timeZone: CLUB_TIME_ZONE, style: "short", position: "inline", withTime });
  const line = results.publishedAt
    ? t("results.published", { published: day(results.publishedAt, true), until: day(results.closesAt, true) })
    : t("results.until", { until: day(results.closesAt, true) });
  const numberOf = (bibNumber: number) => formatRaceNumber(bibNumber, event.raceNumberFormat);

  return (
    // Google honours `data-nosnippet` only on span, div and section elements: the wrapper carries it, as the start list's does, so
    // names stay out of search snippets (§421); the page itself stays indexed.
    <Box component="section" id="clasament" data-nosnippet="" data-testid="results-section" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 }, scrollMarginTop: 16 }}>
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
          <Typography component="h2" id="results-title" variant="h2" sx={{ fontSize: "1.25rem" }}>
            <LeaderboardIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
            {t("results.title")}
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" data-testid="results-published" sx={{ pb: 1 }}>
          {line}
        </Typography>

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

        <Box
          component="table"
          id={TABLE_ID}
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
              gridTemplateColumns: { xs: "2.5rem max-content 1fr", sm: "none" },
              gridTemplateAreas: { xs: '"place name name" "place number time" "place category category"', sm: "none" },
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
            "& td[data-col='name']": { gridArea: "name", overflowWrap: "anywhere" },
            "& td[data-col='number']": { gridArea: "number", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textAlign: { sm: "right" }, width: { sm: "1%" } },
            "& td[data-col='time']": { gridArea: "time", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
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
              <th scope="col" data-col="place">
                {t("results.columnPlace")}
              </th>
              <th scope="col" data-col="number" aria-label={t("startList.columnNumberFull")}>
                <Box component="abbr" title={t("startList.columnNumberFull")} sx={{ textDecoration: "none" }}>
                  {t("startList.columnNumber")}
                </Box>
              </th>
              <th scope="col" data-col="name">
                {t("results.columnName")}
              </th>
              <th scope="col" data-col="time">
                {t("results.columnTime")}
              </th>
              <th scope="col" data-col="category">
                {t("results.columnCategory")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const finished = row.status === "FINISHED";
              return (
                <tr key={row.bibNumber} data-testid="result-row" data-bib={row.bibNumber} data-category={row.categoryKey ?? ""} data-status={row.status}>
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
                  <td data-col="name" data-testid="result-name">
                    {row.name !== null ? (
                      row.name
                    ) : (
                      <Box component="span" sx={{ color: "text.secondary", fontStyle: "italic" }}>
                        {anonymousResultLabel(locale, row.bibNumber, event.raceNumberFormat)}
                      </Box>
                    )}
                  </td>
                  <td data-col="number" data-label={t("startList.columnNumber")} data-testid="result-number">
                    {numberOf(row.bibNumber)}
                  </td>
                  {/* A runner who did not finish has a word in this cell, not a time: the phone must not print «Timp» before «Abandon». */}
                  <td data-col="time" data-label={finished ? t("results.columnTime") : undefined} data-testid="result-time">
                    {finished ? (
                      <>
                        <span>{row.gunTimeMs !== null ? formatResultTime(row.gunTimeMs) : NO_VALUE}</span>
                        {row.chipTimeMs !== null && (
                          <Typography component="span" variant="caption" color="text.secondary" data-testid="result-chip-time" sx={{ display: "block", fontWeight: 400 }}>
                            {t("results.chipTime", { time: formatResultTime(row.chipTimeMs) })}
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

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t("results.note")}
        </Typography>
      </Box>
    </Box>
  );
}
