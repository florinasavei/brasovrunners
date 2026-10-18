import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { formatDay } from "@/i18n/dates";
import Panel from "@/shared/ui/Panel";
import StatusChip from "@/shared/ui/StatusChip";
import { BoxNote } from "./box-kit";

/** One answer, as the fold lists it — what `listRsvpsForAdmin` reads (addresses: only for a role that reads the registrations). */
export type RsvpAnswerRow = { email: string; displayName: string | null; showName: boolean; confirmedAt: Date | null; createdAt: Date };

/**
 * «Răspunsuri „Vin!” (N)» (§811, «Vin!» part 1): the event's answers, **read-only** — no CSV, no verb: a person takes their answer
 * back with their own «Nu mai vin» link, and the club has nothing to correct. The addresses are for the roles that read the
 * registrations (`canReadRegistrations`: the Organizer, the Administrator, the Superadministrator); every other role of the editor
 * sees only the count, and the rows never reach its page (`rows` is null — asserted by the page that loads them, BR-REQ-060-01).
 *
 * Drawn only when the event has answers; a fold closed by default with its summary line (the house's nested cards).
 */
export default async function RsvpAnswersCard({
  counts,
  rows,
  locale,
  timeZone,
}: {
  counts: { confirmed: number; unconfirmed: number };
  /** Every answer, for a role that may read addresses; null for the others, who see the counts. */
  rows: readonly RsvpAnswerRow[] | null;
  locale: string;
  timeZone: string;
}) {
  const t = await getTranslations("Admin");
  const total = counts.confirmed + counts.unconfirmed;
  if (total === 0) return null;
  const when = (at: Date): string => formatDay(at, { locale: locale === "en" ? "en" : "ro", timeZone, withTime: true });
  const body: ReactNode =
    rows === null ? (
      <Typography variant="body2" data-testid="rsvp-answers-count-only">
        {t("editor.rsvpAnswers.countOnly")} {t("editor.rsvpAnswers.countLine", counts)}
      </Typography>
    ) : (
      <>
        <Box sx={{ maxWidth: "100%", overflowX: "auto" }}>
          <Box
            component="table"
            data-testid="rsvp-answers"
            sx={{ width: "100%", borderCollapse: "collapse", "& th, & td": { textAlign: "left", py: 0.75, px: 1, borderBottom: 1, borderColor: "divider", verticalAlign: "top" }, "& th": { fontWeight: 600, whiteSpace: "nowrap" } }}
          >
            <Box component="thead">
              <Box component="tr">
                <Box component="th" scope="col">{t("editor.rsvpAnswers.email")}</Box>
                <Box component="th" scope="col">{t("editor.rsvpAnswers.name")}</Box>
                <Box component="th" scope="col">{t("editor.rsvpAnswers.withName")}</Box>
                <Box component="th" scope="col">{t("editor.rsvpAnswers.state")}</Box>
                <Box component="th" scope="col">{t("editor.rsvpAnswers.when")}</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, index) => (
                <Box component="tr" key={`${index}-${row.email}`} data-testid="rsvp-answer-row">
                  <Box component="td" sx={{ overflowWrap: "anywhere" }}>{row.email}</Box>
                  <Box component="td">{row.displayName ?? "—"}</Box>
                  <Box component="td">{row.showName ? t("editor.rsvpAnswers.yes") : t("editor.rsvpAnswers.no")}</Box>
                  <Box component="td">
                    {/* Stated in words and a glyph, never by colour alone. */}
                    <StatusChip color={row.confirmedAt ? "success" : "default"} glyph={row.confirmedAt ? "done" : "open"} label={row.confirmedAt ? t("editor.rsvpAnswers.confirmed") : t("editor.rsvpAnswers.unconfirmed")} />
                  </Box>
                  <Box component="td" sx={{ whiteSpace: "nowrap" }}>{when(row.confirmedAt ?? row.createdAt)}</Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
        <BoxNote>{t("editor.rsvpAnswers.note")}</BoxNote>
      </>
    );

  return (
    <Panel
      glyph="rsvp"
      collapsible
      level={3}
      id="box-rsvp-answers"
      data-testid="rsvp-answers-card"
      title={t("editor.rsvpAnswers.title", { count: total })}
      aside={t("editor.rsvpAnswers.summary", counts)}
    >
      {body}
    </Panel>
  );
}
