import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { formatDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import type { ClubMemberKind } from "@/modules/rsvp/domain/public-member";
import MemberChip from "@/modules/registrations/ui/MemberChip";
import Panel from "@/shared/ui/Panel";
import StatusChip from "@/shared/ui/StatusChip";
import { BoxNote } from "./box-kit";

/** One answer, as the fold lists it — what `listRsvpsForAdmin` reads (addresses: only for a role that reads the registrations). */
export type RsvpAnswerRow = { email: string; displayName: string | null; showName: boolean; clubMember?: ClubMemberKind | null; confirmedAt: Date | null; createdAt: Date };

/**
 * «Răspunsuri „Vin!” (N)» (§811, «Vin!» part 1): the event's answers, **read-only** — no CSV, no verb: a person takes their answer
 * back with their own «Nu mai vin» link, and the club has nothing to correct. The addresses are for the roles that read the
 * registrations (`canReadRegistrations`: the Organizer, the Administrator, the Superadministrator); every other role of the editor
 * sees only the count, and the rows never reach its page (`rows` is null — asserted by the page that loads them, BR-REQ-060-01).
 *
 * Drawn only when the event has answers; a fold closed by default with its summary line (the house's nested cards).
 *
 * **The member mark (§829, amending §796):** per row, the registrations' own chip (`MemberChip`, §662) — «Membru (declarat)» for the person's tick on a
 * «Vin!» answer, «Membru (verificat)» for an answer given from an account of the club (the account's role, set by the server) — and the line says how many
 * of the confirmed answers are a member's: «… · 2 membri confirmați». The chip is what the club knows; what the public sees is a separate rule (the notice's
 * version, `publicRsvpMember`).
 */
export default async function RsvpAnswersCard({
  counts,
  rows,
  locale,
  timeZone,
}: {
  counts: { confirmed: number; unconfirmed: number; members?: number };
  /** Every answer, for a role that may read addresses; null for the others, who see the counts. */
  rows: readonly RsvpAnswerRow[] | null;
  locale: string;
  timeZone: string;
}) {
  const t = await getTranslations("Admin");
  const total = counts.confirmed + counts.unconfirmed;
  if (total === 0) return null;
  // «1 membru confirmat» (§829): said only when there is one, after the counts, in the editor's own words.
  const members = counts.members ? t(`editor.rsvpAnswers.members.${countForm(counts.members, locale)}`, { count: counts.members }) : null;
  // The count line is a sentence and ends with a full stop (`countLine`): the members' words go before it, the aside's line has none.
  const withMembers = (line: string): string => (members === null ? line : line.endsWith(".") ? `${line.slice(0, -1)} · ${members}.` : `${line} · ${members}`);
  const when = (at: Date): string => formatDay(at, { locale: locale === "en" ? "en" : "ro", timeZone, withTime: true });
  const body: ReactNode =
    rows === null ? (
      <Typography variant="body2" data-testid="rsvp-answers-count-only">
        {t("editor.rsvpAnswers.countOnly")} {withMembers(t("editor.rsvpAnswers.countLine", counts))}
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
                <Box component="th" scope="col">{t("editor.rsvpAnswers.member")}</Box>
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
                    {/* The registrations' words (`registrations.member.*`): «declarat» is the person's tick, «verificat» an account's — never «verificat» for a tick. */}
                    {!row.clubMember ? (
                      "—"
                    ) : (
                      <MemberChip
                        membership={row.clubMember === "ACCOUNT" ? "verified" : "declared"}
                        label={t(`registrations.member.${row.clubMember === "ACCOUNT" ? "verified" : "declared"}`)}
                        hint={t(row.clubMember === "ACCOUNT" ? "editor.rsvpAnswers.memberAccountHint" : "editor.rsvpAnswers.memberDeclaredHint")}
                      />
                    )}
                  </Box>
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
      aside={withMembers(t("editor.rsvpAnswers.summary", counts))}
    >
      {body}
    </Panel>
  );
}
