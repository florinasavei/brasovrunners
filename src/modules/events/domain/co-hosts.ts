import { z } from "zod";

/**
 * The organizations an event is held with (`DECISIONS.md` §168; the owner: "any number of
 * partners on one event, each with a name and an optional link").
 *
 * The row used to carry one partner in two columns, `co_host_name` and `co_host_url` (§121).
 * It carries a list now, in `co_hosts`, and those two columns stay in place, unread, until a
 * later contraction drops them (`AGENTS.md` §7.6). This file is the only place that decides
 * which of the two a row is read from, so the page, the card, the calendar, the structured
 * data and the editor cannot disagree about what a row means.
 */

/** Eight is more partners than the club has ever had, and few enough to read on a card. */
export const MAX_CO_HOSTS = 8;

/** A partner's page: https, like every other link an organizer pastes (`AGENTS.md` §8). */
export const isCoHostUrl = (value: string) => /^https:\/\/\S+$/i.test(value);

/**
 * A stored partner, read leniently on purpose (§169).
 *
 * Not `.strict()`: an unknown key is stripped, never a reason to drop the partner. The day a
 * later release adds one — a logo, an id — every instance still running today's code (the
 * other deployment mid-release) would otherwise read those rows as having no partners at all,
 * which is a worse answer than ignoring a key it does not know.
 *
 * And a page that is not https falls back to `null` rather than taking the name down with it,
 * so the column's failure mode matches the two old columns' (`readCoHosts` below, which has
 * always kept the name and dropped the link): the club loses the link, never the partner. A
 * name is still required — a partner without one is nothing to render.
 */
export const coHostSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine(isCoHostUrl, { message: "a partner's page must start with https://" })
    .nullable()
    .optional()
    .transform((value) => value ?? null)
    .catch(null),
});

export type CoHost = z.infer<typeof coHostSchema>;

/** What a row has to carry to be read: the column, and the two columns it replaced. */
export type CoHostSource = {
  coHosts: unknown;
  coHostName: string | null;
  coHostUrl: string | null;
};

/**
 * The event's partners, in the order the club listed them.
 *
 * A row saved since the column exists answers with the column — **including when the answer
 * is none**: an empty array is the club having removed every partner, and falling back to the
 * old columns there would bring back a name somebody deleted. So anything that is an array is
 * the answer, and only a null column (a row nobody has saved since) reads the two old columns
 * as the one co-host they always were. A partner without a name is dropped rather
 * than rendered — the rule `readScheduleItems` follows (§117); one whose page is not https
 * keeps its name and loses the link, exactly as the two old columns do (§169).
 */
export function readCoHosts(row: CoHostSource): CoHost[] {
  if (Array.isArray(row.coHosts)) {
    return row.coHosts
      .flatMap((entry) => {
        const parsed = coHostSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
      .slice(0, MAX_CO_HOSTS);
  }
  if (row.coHostName) {
    return [{ name: row.coHostName, url: row.coHostUrl && isCoHostUrl(row.coHostUrl) ? row.coHostUrl : null }];
  }
  return [];
}
