import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { unsubscribeSubscriberAction } from "@/app/[locale]/admin/newsletter/actions";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  type ConfirmLinkState,
  MAX_SUBSCRIBER_QUERY_LENGTH,
  SUBSCRIBER_STATES,
  SUBSCRIBER_TABLE_LIMIT,
  type SubscriberListQuery,
  subscriberListInUse,
  subscriberListParams,
} from "../domain/subscriber-list";
import { NEWSLETTER_TOPICS } from "../domain/topics";
import type { NewsletterSubscriberList, NewsletterSubscriberRow } from "../subscribers";
import SubscriberListFields from "./SubscriberListFields";

type Props = {
  locale: Locale;
  query: SubscriberListQuery;
  list: NewsletterSubscriberList;
  /** The Administrator's and the Superadministrator's: «Dezabonează» on each row. */
  mayUnsubscribe: boolean;
  /** The row's unsubscribe just landed (`?saved=`): the fold shows its result (§336). */
  saved: boolean;
};

/** The id the fold, the filter's GET form and the unsubscribe's redirect all land on. */
export const SUBSCRIBERS_ANCHOR = "newsletter-subscribers";

/** A visible line between two rows (§453), none under the last; the theme's divider in both schemes. */
const ROW_SEPARATOR = { "& > td": { borderBottom: 1, borderColor: "divider", py: 1.25, verticalAlign: "top" } } as const;
const LAST_ROW = { "& > td": { borderBottom: 0, py: 1.25, verticalAlign: "top" } } as const;
const HEAD_RULE = { borderBottom: 2, borderColor: "text.secondary", fontWeight: 700, whiteSpace: "nowrap" } as const;

/**
 * «Abonați» / "Subscribers" on `/admin/newsletter` (§NNN, amending §445; the owner, 2026-09-28
 * 22:48: «în newsletter vreau să și văd abonații și mailurile lor»): every subscriber, newest first
 * — the address as typed, the language, the topics in the pop-up's words, the state with what its
 * confirmation link is doing, since when and confirmed on — with a search by address, a topic and a
 * state in the address bar, the CSV of the same filter, and the Administrator's «Dezabonează».
 *
 * A fold, closed by default (§336), whose closed line says the counts; it opens by itself while a
 * filter shapes it (`inUse`) or right after an unsubscribe (`saved`). A Server Component: the
 * addresses never reach a client island — the rows are server HTML, and each row's form carries the
 * subscriber's id alone. A table from `md` up and one block per row below it, as `AdminTable` draws
 * (no column is lost at 320 pixels, and nothing scrolls sideways).
 */
export default async function NewsletterSubscribers({ locale, query, list, mayUnsubscribe, saved }: Props) {
  const t = await getTranslations("Admin");
  const tn = await getTranslations("Newsletter");
  const words = await confirmWords();
  const messages = mayUnsubscribe ? await refusalMessages({}) : undefined;
  const path = getPathname({ locale, href: "/admin/newsletter" });
  const inUse = subscriberListInUse(query);
  const listParams = subscriberListParams(query);
  const csvParams = new URLSearchParams(listParams);
  csvParams.set("lang", locale);
  const csvHref = `/api/admin/newsletter/subscribers?${csvParams.toString()}`;
  const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short" });
  const dayTime = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });

  const confirmedLine = t(`newsletter.subscribers.confirmedCount.${countForm(list.confirmed, locale)}`, { count: list.confirmed });
  const pendingLine = t("newsletter.subscribers.pendingCount", { count: String(list.pending) });
  const counts = t("newsletter.subscribers.counts", { confirmed: confirmedLine, pending: pendingLine });

  const linkWords = (link: ConfirmLinkState): string | null => {
    if (link.kind === "live") return t("newsletter.subscribers.link.live", { when: dayTime(link.expiresAt) });
    if (link.kind === "sending") return t("newsletter.subscribers.link.sending");
    if (link.kind === "expired") return t("newsletter.subscribers.link.expired");
    return null;
  };

  const columns: { key: string; label: string; render: (row: NewsletterSubscriberRow) => ReactNode }[] = [
    {
      key: "email",
      label: t("newsletter.subscribers.columns.email"),
      render: (row) => (
        <Box component="span" sx={{ wordBreak: "break-all", fontWeight: 500 }} data-testid="newsletter-subscriber-email">
          {row.email}
        </Box>
      ),
    },
    { key: "language", label: t("newsletter.subscribers.columns.language"), render: (row) => row.locale.toUpperCase() },
    { key: "topics", label: t("newsletter.subscribers.columns.topics"), render: (row) => row.topics.map((topic) => tn(`topics.${topic}`)).join(", ") },
    {
      key: "state",
      label: t("newsletter.subscribers.columns.state"),
      render: (row) => {
        const link = linkWords(row.link);
        return (
          <Box component="span" data-testid="newsletter-subscriber-state" data-state={row.link.kind}>
            <Box component="span" sx={{ display: "block", fontWeight: 500, color: row.confirmedAt ? "success.main" : "warning.main" }}>
              {t(row.confirmedAt ? "newsletter.subscribers.states.confirmed" : "newsletter.subscribers.states.pending")}
            </Box>
            {link && (
              <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block" }}>
                {link}
              </Typography>
            )}
          </Box>
        );
      },
    },
    { key: "since", label: t("newsletter.subscribers.columns.since"), render: (row) => day(row.createdAt) },
    { key: "confirmedOn", label: t("newsletter.subscribers.columns.confirmedOn"), render: (row) => (row.confirmedAt ? day(row.confirmedAt) : "—") },
  ];

  // Drawn twice per row — the table's cell and the phone's block, one hidden by CSS, as `AdminTable`
  // draws its row actions — so each form has its own scope.
  const unsubscribe = (row: NewsletterSubscriberRow, where: "table" | "block") =>
    mayUnsubscribe ? (
      <ActionForm
        action={unsubscribeSubscriberAction}
        messages={messages}
        scope={`unsubscribe-${where}-${row.id}`}
        confirm={{
          title: t("newsletter.subscribers.unsubscribeTitle", { email: row.email }),
          body: t("newsletter.subscribers.unsubscribeBody"),
          confirmLabel: t("newsletter.subscribers.unsubscribe"),
          cancelLabel: words.cancel,
          destructive: true,
        }}
        data-testid="newsletter-subscriber-unsubscribe"
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="subscriberId" value={row.id} />
        <input type="hidden" name="listQ" value={query.q} />
        <input type="hidden" name="listTopic" value={query.topic ?? ""} />
        <input type="hidden" name="listState" value={query.state ?? ""} />
        <GlyphSubmitButton
          label={t("newsletter.subscribers.unsubscribe")}
          pendingLabel={t("newsletter.subscribers.unsubscribing")}
          icon="revoke"
          color="error"
          variant="outlined"
          size="small"
        />
      </ActionForm>
    ) : null;

  return (
    <Panel
      glyph="contacts"
      collapsible
      openWhen={{ inUse, saved }}
      title={t("newsletter.subscribers.title")}
      intro={t("newsletter.subscribers.intro")}
      aside={counts}
      id={SUBSCRIBERS_ANCHOR}
      data-testid="newsletter-subscribers"
    >
      <Stack spacing={2}>
        {/*
          The filter (§527's shape): a plain GET form whose state is the address — bookmarked, kept
          across the unsubscribe's redirect, and working with JavaScript off. The fragment brings the
          reader back to this fold, which opens by itself while a filter is in use.
        */}
        <Box component="form" method="get" action={`${path}#${SUBSCRIBERS_ANCHOR}`} role="search" aria-label={t("newsletter.subscribers.filterLabel")} data-testid="newsletter-subscribers-filters">
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
            <SubscriberListFields
              search={{
                label: t("newsletter.subscribers.search"),
                placeholder: t("newsletter.subscribers.searchHelp"),
                value: query.q,
                maxLength: MAX_SUBSCRIBER_QUERY_LENGTH,
              }}
              topic={{
                label: t("newsletter.subscribers.topic"),
                value: query.topic ?? "",
                options: [{ value: "", label: t("newsletter.subscribers.topicAll") }, ...NEWSLETTER_TOPICS.map((topic) => ({ value: topic, label: tn(`topics.${topic}`) }))],
              }}
              state={{
                label: t("newsletter.subscribers.state"),
                value: query.state ?? "",
                options: [
                  { value: "", label: t("newsletter.subscribers.stateAll") },
                  ...SUBSCRIBER_STATES.map((state) => ({ value: state, label: t(`newsletter.subscribers.stateOptions.${state}`) })),
                ],
              }}
            />
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
              <GlyphButton icon="filter" type="submit" variant="contained" sx={TAP_TARGET}>
                {t("newsletter.subscribers.apply")}
              </GlyphButton>
              {inUse && (
                <GlyphButton icon="clearFilter" href={`${path}#${SUBSCRIBERS_ANCHOR}`} variant="outlined" sx={TAP_TARGET}>
                  {t("newsletter.subscribers.clear")}
                </GlyphButton>
              )}
            </Stack>
          </Stack>
        </Box>

        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="newsletter-subscribers-counts">
            {counts}
          </Typography>
          <GlyphButton icon="download" href={csvHref} variant="outlined" sx={TAP_TARGET} data-testid="newsletter-subscribers-csv">
            {t("newsletter.subscribers.csv")}
          </GlyphButton>
        </Stack>
        {list.truncated && (
          <Typography variant="body2" color="text.secondary">
            {t("newsletter.subscribers.truncated", { count: String(SUBSCRIBER_TABLE_LIMIT) })}
          </Typography>
        )}

        {list.rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="newsletter-subscribers-empty">
            {t(inUse ? "newsletter.subscribers.noMatch" : "newsletter.subscribers.empty")}
          </Typography>
        ) : (
          <>
            <Box sx={{ display: { xs: "none", md: "block" }, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
              <Table size="small" aria-label={t("newsletter.subscribers.title")} data-testid="newsletter-subscribers-table">
                <TableHead>
                  <TableRow sx={{ bgcolor: "action.hover" }}>
                    {columns.map((column) => (
                      <TableCell key={column.key} sx={HEAD_RULE}>
                        {column.label}
                      </TableCell>
                    ))}
                    {mayUnsubscribe && (
                      <TableCell align="right" sx={HEAD_RULE}>
                        {t("newsletter.subscribers.columns.actions")}
                      </TableCell>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {list.rows.map((row, index) => (
                    <TableRow
                      key={row.id}
                      hover
                      data-testid="newsletter-subscriber-row"
                      data-row-separator={index === list.rows.length - 1 ? "none" : "line"}
                      sx={index === list.rows.length - 1 ? LAST_ROW : ROW_SEPARATOR}
                    >
                      {columns.map((column) => (
                        <TableCell key={column.key}>{column.render(row)}</TableCell>
                      ))}
                      {mayUnsubscribe && <TableCell align="right">{unsubscribe(row, "table")}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            {/* The phone's blocks (§18.5): the address as the row's headline, every other column labelled under it. */}
            <Stack component="ul" spacing={1.5} sx={{ display: { xs: "flex", md: "none" }, listStyle: "none", p: 0, m: 0 }}>
              {list.rows.map((row) => (
                <Box key={row.id} component="li" sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }} data-testid="newsletter-subscriber-block">
                  <Typography component="div" sx={{ fontWeight: 700, fontSize: "1rem", mb: 1 }}>
                    {columns[0].render(row)}
                  </Typography>
                  <Stack spacing={0.5}>
                    {columns.slice(1).map((column) => (
                      <Stack key={column.key} direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline", gap: 1 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                          {column.label}
                        </Typography>
                        <Box sx={{ textAlign: "right", minWidth: 0 }}>{column.render(row)}</Box>
                      </Stack>
                    ))}
                  </Stack>
                  {mayUnsubscribe && <Box sx={{ mt: 1.5 }}>{unsubscribe(row, "block")}</Box>}
                </Box>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Panel>
  );
}
