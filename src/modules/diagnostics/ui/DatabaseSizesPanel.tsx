import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { type DatabaseSizes, GROWTH_DAYS, PAST_EVENT_MONTHS, sizeMegabytes, tableRows } from "@/modules/diagnostics/domain/db-sizes";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";

type Props = {
  /** The reading (`readDatabaseSizesForPage`), or null when the database could not be asked. */
  sizes: DatabaseSizes | null;
};

/** The registration states the card words, in the order a registration goes through them. */
const STATES = ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED", "CONFIRMED", "CANCELLED", "EXPIRED"] as const;

/**
 * «Mărimea bazei de date» on `/devs` (§803; the owner, 2026-10-16: «cumva mă interesează să țin baza de
 * date light long term»): how big the database is, the eight largest tables and what each of the
 * tables that grow gained in thirty days — the numbers a retention period would be chosen on,
 * read from the database itself and measured only: nothing is deleted from here.
 *
 * A closed `Panel` with the size beside its title (the house's folds start closed and say what is
 * inside), a list of lines rather than a wide table, so it reads at 320 pixels; the words are
 * `Devs.dbSize.*` in both languages. A Server Component: the numbers arrive as data, nothing but
 * a string crosses into the «?».
 */
export default async function DatabaseSizesPanel({ sizes }: Props) {
  const t = await getTranslations("Devs");
  const format = await getFormatter();
  const number = (value: number) => format.number(value, { maximumFractionDigits: 0 });
  const mb = (bytes: number) => format.number(sizeMegabytes(bytes), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <Panel
      glyph="database"
      level={3}
      collapsible
      id="db-size"
      title={t("dbSize.title")}
      intro={t("dbSize.intro")}
      introMore={t("dbSize.introMore", { days: GROWTH_DAYS })}
      aside={sizes ? t("dbSize.aside", { size: mb(sizes.databaseBytes) }) : undefined}
      data-testid="db-size"
    >
      {sizes === null ? (
        <Alert severity="info" data-testid="db-size-unread">
          {t("dbSize.unread")}
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body1" sx={{ fontWeight: 600 }} data-testid="db-size-total">
            {t("dbSize.total", { size: mb(sizes.databaseBytes) })}
          </Typography>

          <Box component="section">
            <Typography variant="h4" sx={{ fontSize: "0.9375rem", fontWeight: 600, mb: 0.5 }}>
              {t("dbSize.tablesTitle")}
            </Typography>
            <Stack component="ul" spacing={1} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="db-size-tables">
              {sizes.tables.map((table) => {
                const rows = tableRows(table);
                const grown = sizes.growth.find((entry) => entry.table === table.name);
                return (
                  <Box component="li" key={table.name} data-testid={`db-size-table-${table.name}`}>
                    <Typography variant="body2" component="div">
                      <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                        {table.name}
                      </Box>{" "}
                      {t("dbSize.row", { total: mb(table.totalBytes), data: mb(table.tableBytes), indexes: mb(table.indexBytes) })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" component="div">
                      {rows === null ? t("dbSize.rowsUnknown") : t(rows.exact ? "dbSize.rowsExact" : "dbSize.rowsEstimated", { count: number(rows.value) })}
                      {grown ? ` · ${t("dbSize.gained", { count: number(grown.last30Days), days: GROWTH_DAYS })}` : ""}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          <Box component="section">
            <Typography variant="h4" sx={{ fontSize: "0.9375rem", fontWeight: 600, mb: 0.5 }}>
              {t("dbSize.growthTitle", { days: GROWTH_DAYS })}
            </Typography>
            <Stack component="ul" spacing={0.75} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="db-size-growth">
              {sizes.growth.map((entry) => (
                <Typography variant="body2" component="li" key={entry.table} data-testid={`db-size-growth-${entry.table}`}>
                  <strong>{t(`dbSize.growth.${entry.table}`)}</strong>
                  {": "}
                  {t("dbSize.growthLine", { recent: number(entry.last30Days), total: number(entry.total) })}
                  {entry.settled === null ? "" : ` · ${t("dbSize.settled", { count: number(entry.settled) })}`}
                </Typography>
              ))}
            </Stack>
          </Box>

          <Box component="section">
            <Typography variant="h4" sx={{ fontSize: "0.9375rem", fontWeight: 600, mb: 0.5 }}>
              {t("dbSize.registrationsTitle")}
              <QuietHelp text={t("dbSize.registrationsMore")} />
            </Typography>
            <Stack component="ul" spacing={0.75} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="db-size-registrations">
              {sizes.registrations.length === 0 ? (
                <Typography variant="body2" color="text.secondary" component="li">
                  {t("dbSize.registrationsNone")}
                </Typography>
              ) : (
                [...sizes.registrations]
                  .sort((a, b) => STATES.indexOf(a.status as (typeof STATES)[number]) - STATES.indexOf(b.status as (typeof STATES)[number]))
                  .map((entry) => (
                    <Typography variant="body2" component="li" key={entry.status} data-testid={`db-size-registrations-${entry.status}`}>
                      <strong>{(STATES as readonly string[]).includes(entry.status) ? t(`dbSize.status.${entry.status as (typeof STATES)[number]}`) : entry.status}</strong>
                      {": "}
                      {t("dbSize.registrationsLine", {
                        total: number(entry.total),
                        six: number(entry.pastSixMonths),
                        twelve: number(entry.pastTwelveMonths),
                        sixMonths: PAST_EVENT_MONTHS[0],
                        twelveMonths: PAST_EVENT_MONTHS[1],
                      })}
                    </Typography>
                  ))
              )}
            </Stack>
          </Box>

          <Typography variant="body2" sx={{ minHeight: 44, display: "flex", alignItems: "center" }}>
            <Link href={{ pathname: "/devs/docs/[name]", params: { name: "PLATFORM" } }} data-testid="db-size-plan-link">
              {t("dbSize.planLink")}
            </Link>
          </Typography>
        </Stack>
      )}
    </Panel>
  );
}
