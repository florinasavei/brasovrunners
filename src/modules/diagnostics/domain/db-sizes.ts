/**
 * How big the database is and where it grows — the queries and their reading, as plain data (§NNN).
 *
 * The owner, 2026-10-16: «cumva mă interesează să țin baza de date light long term». Before a
 * retention period is chosen (`docs/PLATFORM.md` § Keeping Neon and Vercel light, long term) the
 * club needs the numbers it would be chosen on: what the eight largest tables weigh, how many rows
 * each of the tables that grow gained in the last thirty days, and how many registrations belong
 * to events long past. This reads them and deletes nothing.
 *
 * **One module, two callers.** `/devs` asks through the application's own `Database`
 * (`../db-sizes.ts`) and `yarn db:sizes` through a bare `pg` connection (`scripts/db-sizes.mjs`);
 * both hand the same SQL text to `readDatabaseSizes` as a `run` function, so the page and the
 * script cannot disagree about a query. No import here: the script loads this file through `tsx`
 * and must not pull in `drizzle`, `next` or the environment.
 *
 * A figure that could not be read is `null`, never zero (§1.2): a table nobody could count is
 * "not counted", and an unanalysed table's row estimate (`reltuples` is -1 on PostgreSQL 14+) is
 * replaced by an exact count while the table is small enough for one to cost nothing.
 */

/** One row of a result, driver-neutral: `pg` and PGlite both give column → value. */
export type SqlRow = Record<string, unknown>;

/** Runs one statement and gives its rows. */
export type RunSql = (text: string) => Promise<SqlRow[]>;

/** How many tables the card lists. */
export const LARGEST_TABLES = 8;

/** Under this many estimated rows a table is counted exactly: a scan of a few thousand rows costs nothing. */
export const EXACT_COUNT_BELOW_ROWS = 20_000;

/** The window the growth counts look back over. */
export const GROWTH_DAYS = 30;

/** The two ages of «events long past» the registrations are counted by, in months. */
export const PAST_EVENT_MONTHS = [6, 12] as const;

export type TableSize = {
  name: string;
  /** Table, its indexes and its TOAST, in bytes (`pg_total_relation_size`). */
  totalBytes: number;
  /** The table and its TOAST (`pg_table_size`). */
  tableBytes: number;
  /** Every index of it (`pg_indexes_size`). */
  indexBytes: number;
  /** The planner's estimate (`pg_class.reltuples`); null when the table was never analysed. */
  estimatedRows: number | null;
  /** An exact count, taken only for a small table; null otherwise. */
  rows: number | null;
};

/** The tables whose rows pile up, by name — the ones a retention period would be chosen for. */
export const GROWTH_TABLES = [
  "audit_logs",
  "email_outbox",
  "email_action_tokens",
  "family_place_holds",
  "registration_notes",
  "event_volunteers",
  "registrations",
  "declaration_acceptances",
  "group_run_declarations",
] as const;
export type GrowthTable = (typeof GROWTH_TABLES)[number];

export type Growth = {
  table: GrowthTable;
  /** Every row. */
  total: number;
  /** Rows created in the last `GROWTH_DAYS` days. */
  last30Days: number;
  /**
   * Rows that can never be used again: a token spent, withdrawn or expired; a family's hold
   * expired. Null for a table with no such state.
   */
  settled: number | null;
};

export type PastEventRegistrations = {
  /** `registration_status`'s value as stored. */
  status: string;
  total: number;
  /** Registrations whose event started more than six months ago. */
  pastSixMonths: number;
  /** … more than twelve months ago. */
  pastTwelveMonths: number;
};

export type DatabaseSizes = {
  /** `pg_database_size`, bytes. */
  databaseBytes: number;
  /** The eight largest, biggest first. */
  tables: TableSize[];
  growth: Growth[];
  /** Per registration state, including test rows: this is storage, not a count the club is given (§12.6). */
  registrations: PastEventRegistrations[];
  measuredAt: Date;
};

/** A number from a driver that may hand a `bigint` back as a string; null for anything else. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An ISO instant, digits and `T:.-Z` only — safe to put between quotes, because it is built here from a `Date`. */
function instant(date: Date): string {
  return date.toISOString();
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/** The statements, built for one instant. Nothing in them comes from a user. */
export function sizeQueries(now: Date) {
  const since = instant(daysBefore(now, GROWTH_DAYS));
  const at = instant(now);
  // Months are subtracted in SQL, which clamps to the month's last day (31 October minus six months is 30 April), as setUTCMonth does not.
  const monthsAgo = (months: number) => `('${at}'::timestamptz AT TIME ZONE 'UTC' - interval '${Math.trunc(months)} months') AT TIME ZONE 'UTC'`;
  const sixMonths = monthsAgo(PAST_EVENT_MONTHS[0]);
  const twelveMonths = monthsAgo(PAST_EVENT_MONTHS[1]);
  const last = (column = "created_at") => `count(*) FILTER (WHERE ${column} >= '${since}'::timestamptz)::bigint`;

  return {
    database: `SELECT pg_database_size(current_database())::bigint AS bytes`,
    tables: `
      SELECT c.relname AS name,
             pg_total_relation_size(c.oid)::bigint AS total_bytes,
             pg_table_size(c.oid)::bigint AS table_bytes,
             pg_indexes_size(c.oid)::bigint AS index_bytes,
             c.reltuples::bigint AS estimated_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r' AND n.nspname = 'public'
       ORDER BY pg_total_relation_size(c.oid) DESC, c.relname
       LIMIT ${LARGEST_TABLES}`,
    /** Every public table, by name: a database one release behind the code lacks some of `GROWTH_TABLES`, and a missing table must not abort the rest. */
    existing: `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = 'public'`,
    /** One statement over the growth tables that exist; null when none does. */
    growth(existing: ReadonlySet<string>): string | null {
      const part = (table: GrowthTable, settled: string) =>
        `SELECT '${table}' AS table_name, count(*)::bigint AS total, ${last()} AS last_30, ${settled} AS settled FROM ${table}`;
      const settledWhen = (condition: string) => `count(*) FILTER (WHERE ${condition})::bigint`;
      const parts: Record<GrowthTable, string> = {
        audit_logs: part("audit_logs", "NULL::bigint"),
        email_outbox: part("email_outbox", "NULL::bigint"),
        email_action_tokens: part("email_action_tokens", settledWhen(`used_at IS NOT NULL OR invalidated_at IS NOT NULL OR expires_at < '${at}'::timestamptz`)),
        family_place_holds: part("family_place_holds", settledWhen(`expires_at < '${at}'::timestamptz`)),
        registration_notes: part("registration_notes", "NULL::bigint"),
        event_volunteers: part("event_volunteers", "NULL::bigint"),
        registrations: part("registrations", "NULL::bigint"),
        declaration_acceptances: part("declaration_acceptances", "NULL::bigint"),
        group_run_declarations: part("group_run_declarations", "NULL::bigint"),
      };
      const present = GROWTH_TABLES.filter((table) => existing.has(table));
      return present.length === 0 ? null : present.map((table) => parts[table]).join("\n      UNION ALL ");
    },
    registrations: `
      SELECT r.status::text AS status,
             count(*)::bigint AS total,
             count(*) FILTER (WHERE e.starts_at < ${sixMonths})::bigint AS past_six,
             count(*) FILTER (WHERE e.starts_at < ${twelveMonths})::bigint AS past_twelve
        FROM registrations r
        JOIN events e ON e.id = r.event_id
       GROUP BY r.status
       ORDER BY r.status::text`,
    /** An exact count of one table the catalogue named; refuses a name that is not a plain identifier. */
    count(name: string) {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("not a table name");
      return `SELECT count(*)::bigint AS n FROM "${name}"`;
    },
  };
}

/**
 * Reads everything the card and the script show, in one batch of statements through `run`.
 * Throws what `run` throws — the caller decides whether the database being away is a sentence
 * or a failure.
 */
export async function readDatabaseSizes(run: RunSql, now: Date): Promise<DatabaseSizes> {
  const q = sizeQueries(now);
  // One after the other: a script holds one connection, and four short statements cost nothing.
  const databaseRows = await run(q.database);
  const sizeRows = await run(q.tables);
  const existing = new Set((await run(q.existing)).map((row) => String(row.name)));
  const growthSql = q.growth(existing);
  const growthRows = growthSql ? await run(growthSql) : [];
  const registrationRows = existing.has("registrations") && existing.has("events") ? await run(q.registrations) : [];

  const tables: TableSize[] = [];
  for (const row of sizeRows) {
    const name = String(row.name);
    // reltuples is -1 on a table never analysed: not an estimate, "unknown".
    const estimate = toNumber(row.estimated_rows);
    const estimatedRows = estimate !== null && estimate >= 0 ? estimate : null;
    let rows: number | null = null;
    if (estimatedRows === null || estimatedRows < EXACT_COUNT_BELOW_ROWS) {
      try {
        rows = toNumber((await run(q.count(name)))[0]?.n);
      } catch {
        rows = null;
      }
    }
    tables.push({
      name,
      totalBytes: toNumber(row.total_bytes) ?? 0,
      tableBytes: toNumber(row.table_bytes) ?? 0,
      indexBytes: toNumber(row.index_bytes) ?? 0,
      estimatedRows,
      rows,
    });
  }

  const growth: Growth[] = [];
  for (const row of growthRows) {
    const table = String(row.table_name) as GrowthTable;
    if (!GROWTH_TABLES.includes(table)) continue;
    growth.push({ table, total: toNumber(row.total) ?? 0, last30Days: toNumber(row.last_30) ?? 0, settled: toNumber(row.settled) });
  }

  return {
    databaseBytes: toNumber(databaseRows[0]?.bytes) ?? 0,
    tables,
    growth,
    registrations: registrationRows.map((row) => ({
      status: String(row.status),
      total: toNumber(row.total) ?? 0,
      pastSixMonths: toNumber(row.past_six) ?? 0,
      pastTwelveMonths: toNumber(row.past_twelve) ?? 0,
    })),
    measuredAt: now,
  };
}

/** The rows a table is said to have: the exact count when there is one, else the estimate. */
export function tableRows(table: TableSize): { value: number; exact: boolean } | null {
  if (table.rows !== null) return { value: table.rows, exact: true };
  if (table.estimatedRows !== null) return { value: table.estimatedRows, exact: false };
  return null;
}

/** Megabytes to one decimal, as `database-size.ts` writes them. */
export function sizeMegabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
