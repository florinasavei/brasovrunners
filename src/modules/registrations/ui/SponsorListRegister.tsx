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
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import { ROW_SX } from "@/shared/ui/row-fold";
import { copyOverdue, type GivenSponsorList, SPONSOR_REGISTER_ANCHOR } from "../sponsor-register";

type Props = {
  locale: Locale;
  /** The door's lists, newest first (`readSponsorRegister`, which asserts the role). */
  lists: readonly GivenSponsorList[];
  /** The page's clock: a copy whose day has passed says so. */
  now: Date;
  /** The heading's level: 2 on a page, 3 inside a card. */
  level: 2 | 3;
  /** «Șterge» beside each list (§948); absent for a role that may not delete, and the register is then read-only. */
  removal?: SponsorListRemoval;
  /** The page came back from a delete of this register: the fold shows what is left. */
  saved?: boolean;
};

/**
 * «Șterge» on a row of the register (§948): the action, and the page the press comes back to — an event's
 * registrations list, by its event, or «Newsletter». Handed only to a role that may delete; the server asserts it
 * again (`sponsor-register.ts#deleteSponsorListRecord`).
 */
export type SponsorListRemoval = { action: ActionFormAction; door: "registrations" | "newsletter"; eventId?: string };

type Column = { key: string; label: string; align?: "right"; render: (list: GivenSponsorList) => ReactNode };

/**
 * «Liste date sponsorilor» (§929): every download of the list for sponsors — whom it was given to,
 * when, for which event, how many people it held, which file, who downloaded it and the day the
 * club's own copy must be gone by. Under the buttons on an event's registrations page — inside its
 * fold «Lista pentru sponsori» since §946 — and in the «Newsletter» fold; a fold, closed, its line
 * saying how many lists and the latest one. Nothing is drawn before the first list.
 *
 * A Server Component: the lists are audit rows, read by the caller. Never a participant's name — a row is a
 * list, not its people. Its one press is «Șterge» (§948; the owner, of a list downloaded by mistake: «vreau să
 * pot șterge (hard delete) și faza asta»), beside each list for the Administrator alone: asked first, by the
 * recipient and the day, with what goes besides the row — «Dată partenerilor» on each registration of the file —
 * and when it is right: for a list that reached nobody. One definition of the columns, two layouts,
 * as the backoffice's table does it: a table from `md` up, and below it a line per fact under the
 * recipient, since seven columns at 320 pixels is a sideways scroll. Not `AdminTable`: this is a
 * second table on a page whose address already pages and sorts the first.
 */
export default async function SponsorListRegister({ locale, lists, now, level, removal, saved = false }: Props) {
  if (lists.length === 0) return null;
  const t = await getTranslations("Admin");
  const dialog = removal ? await confirmWords() : null;
  const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", position: "inline" });
  const dayTime = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
  const title = t("sponsors.given.title");
  const counted = t(`registrations.partnerShares.count.${countForm(lists.length, locale)}`, { count: lists.length });
  const unnamed = t("registrations.partnerShares.noRecipient");
  const [latest] = lists;

  const columns: readonly Column[] = [
    {
      key: "recipient",
      label: t("sponsors.given.columns.recipient"),
      render: (list) =>
        list.recipient ? (
          <Box component="span" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
            {list.recipient}
          </Box>
        ) : (
          <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>
            {unnamed}
          </Box>
        ),
    },
    { key: "at", label: t("sponsors.given.columns.at"), render: (list) => dayTime(list.at) },
    {
      key: "event",
      label: t("sponsors.given.columns.event"),
      render: (list) => (list.eventId === null ? t("sponsors.given.everyEvent") : (list.eventTitle ?? "—")),
    },
    { key: "count", label: t("sponsors.given.columns.count"), align: "right", render: (list) => list.count },
    { key: "file", label: t("sponsors.given.columns.file"), render: (list) => t(`sponsors.given.formats.${list.format}`) },
    { key: "actor", label: t("sponsors.given.columns.actor"), render: (list) => list.actorName ?? t("registrations.auditActorRemoved") },
    {
      key: "deleteBy",
      label: t("sponsors.given.columns.deleteBy"),
      render: (list) =>
        // By the day the cell names, on the club's clock: never «termen trecut» during that day itself.
        copyOverdue(list.deleteBy, now, CLUB_TIME_ZONE) ? (
          <>
            {day(list.deleteBy)} ·{" "}
            <Box component="span" sx={{ fontWeight: 700 }} data-testid="sponsor-register-overdue">
              {t("sponsors.given.overdue")}
            </Box>
          </>
        ) : (
          day(list.deleteBy)
        ),
    },
  ];
  const [headline, ...facts] = columns;

  /** «Șterge» for one list: its own form, asked first. The same form in the table's last cell and under the phone's lines. */
  const removeForm = (list: GivenSponsorList, layout: "table" | "lines") => {
    if (!removal || !dialog) return null;
    const recipient = list.recipient ?? unnamed;
    return (
      <ActionForm
        action={removal.action}
        confirm={{
          title: t("sponsors.given.remove.title"),
          body: t("sponsors.given.remove.body", { recipient, date: day(list.at) }),
          // Nobody is written to — not the people of the file, not whoever it named; and the line that says when to press.
          ...dialog.noMail(recipient, [{ text: t("sponsors.given.remove.onlyMistake") }]),
          destructive: true,
          confirmLabel: t("sponsors.given.remove.button"),
          cancelLabel: dialog.cancel,
        }}
        data-testid={`sponsor-register-remove-form-${layout}`}
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="listId" value={list.id} />
        <input type="hidden" name="door" value={removal.door} />
        {removal.eventId && <input type="hidden" name="eventId" value={removal.eventId} />}
        <GlyphSubmitButton
          icon="delete"
          label={t("sponsors.given.remove.button")}
          pendingLabel={t("sponsors.given.remove.pending")}
          ariaLabel={t("sponsors.given.remove.named", { recipient, date: day(list.at) })}
          variant="text"
          color="error"
          size="small"
        />
      </ActionForm>
    );
  };

  return (
    <Panel
      glyph="partners"
      level={level}
      collapsible
      title={title}
      intro={t("sponsors.given.intro")}
      // The latest recipient is free text: an address with no space in it wraps here too, as in its cell, or the page scrolls sideways on a phone.
      aside={
        <Box component="span" sx={{ overflowWrap: "anywhere" }}>
          {t("sponsors.given.aside", { lists: counted, recipient: latest.recipient ?? unnamed, date: day(latest.at) })}
        </Box>
      }
      id={SPONSOR_REGISTER_ANCHOR}
      openWhen={{ saved }}
      data-testid="sponsor-register"
    >
      <Box sx={{ display: { xs: "none", md: "block" }, border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
        <Table size="small" aria-label={title} data-testid="sponsor-register-table">
          <TableHead>
            <TableRow sx={{ bgcolor: "action.hover" }}>
              {columns.map((column) => (
                <TableCell key={column.key} align={column.align} sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                  {column.label}
                </TableCell>
              ))}
              {/* The press's column: no words to read above one button, a name for whoever cannot see it. */}
              {removal && <TableCell aria-label={t("sponsors.given.columns.remove")} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {lists.map((list) => (
              <TableRow key={list.id} data-testid="sponsor-register-row">
                {columns.map((column) => (
                  <TableCell key={column.key} align={column.align} data-column={column.key}>
                    {column.render(list)}
                  </TableCell>
                ))}
                {removal && (
                  <TableCell align="right" data-column="remove">
                    {removeForm(list, "table")}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>

      <Stack component="ul" sx={{ display: { xs: "flex", md: "none" }, listStyle: "none", p: 0, m: 0 }} data-testid="sponsor-register-lines">
        {lists.map((list) => (
          <Box key={list.id} component="li" sx={{ ...ROW_SX, py: 1 }}>
            <Typography component="div">{headline.render(list)}</Typography>
            {facts.map((column) => (
              <Stack key={column.key} direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline", gap: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {column.label}
                </Typography>
                <Typography variant="body2" component="span" sx={{ textAlign: "right", minWidth: 0 }}>
                  {column.render(list)}
                </Typography>
              </Stack>
            ))}
            {removal && <Box sx={{ display: "flex", justifyContent: "flex-end", pt: 0.5 }}>{removeForm(list, "lines")}</Box>}
          </Box>
        ))}
      </Stack>
    </Panel>
  );
}
