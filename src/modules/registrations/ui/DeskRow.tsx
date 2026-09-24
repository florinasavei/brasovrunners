import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import type { DeskRegistration } from "@/modules/registrations/admin-repository";
import { identityDocumentsOf } from "@/modules/registrations/domain/identity-documents";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import { isTerminalStatus } from "@/modules/registrations/domain/state-machine";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphButton from "@/shared/ui/GlyphButton";
import {
  checkInAction,
  confirmRegistrationNowAction,
  promoteRegistrationAction,
  setBibNumberAction,
} from "@/app/[locale]/admin/registrations/actions";

/**
 * One runner as the desk sees them (BR-REQ-037-07, BR-REQ-037-08): name, state, number, and
 * the one or two buttons that get them their number whatever went wrong before. A Server
 * Component: every button is a form posting to a Server Action, so a volunteer's phone with a
 * flaky signal still submits, and nothing here needs JavaScript to be pressable.
 *
 * The verbs, by state — each one is refused again by the service if the state moved:
 *
 *   PENDING_EMAIL_CONFIRMATION, PENDING_DECLARATION, WAITLIST_OFFERED → "Confirm here"
 *       (address vouched for, declaration signed on the paper copy the desk holds)
 *   WAITLISTED → "Give a place" (only into a free one; the allocator refuses otherwise)
 *   CONFIRMED → the number (typed or cleared) and "Check in" / "Undo"
 *   CANCELLED, EXPIRED → no button at all, and a red line first (§311): the state, the date,
 *       and — when a bib with this number was printed — that it is in the pile and is not to be
 *       handed out. The person may well be standing there with the email; the desk is where
 *       that must not become a surprise. Every role sees it: a state and a number, never an
 *       address (`AGENTS.md` §15.11).
 *
 * `back` says where the buttons return to — this row inside the desk's search, or the page
 * one scanned code opened — and the hidden fields carry what that page needs to rebuild.
 */
/**
 * The bib box's refusal words (§315). A CONFLICT here is "that number is worn by somebody else",
 * not a colleague's save of the same form, so the sentence under it is the ordinary one — pick
 * another number and press again — and not "copy what you need, then reload".
 */
async function bibRefusalMessages(label: string) {
  const messages = await refusalMessages({ bibNumber: label });
  return { ...messages, keptConflict: messages.kept };
}

export default async function DeskRow({
  row,
  locale,
  back,
  eventId,
  q,
  showEvent = false,
  readOnly = false,
  minorSigns,
}: {
  row: DeskRegistration;
  locale: Locale;
  back: "desk" | "code";
  eventId?: string;
  q?: string;
  /** On the scanned-code page, where nothing else names the event. */
  showEvent?: boolean;
  /** A completed event (§82): the row reads, and offers no button. */
  readOnly?: boolean;
  /**
   * Whether the declaration in effect asks a minor to sign beside the parent, per language
   * (`declarationAsksMinorToSignByLocale`, §330): read once by the page, looked up here by the
   * row's own language — the translation "Confirmă pe hârtie" binds to.
   */
  minorSigns: Readonly<Record<Locale, boolean>>;
}) {
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const canConfirm =
    row.status === "PENDING_EMAIL_CONFIRMATION" ||
    row.status === "PENDING_DECLARATION" ||
    row.status === "WAITLIST_OFFERED";

  // Whichever number this runner has, and whether it is the settled one (§214). On race
  // morning most of them are provisional, and the desk has to show those or it shows a dash.
  const number = raceNumberOf(row);

  /*
    A registration that is over (§311). The state machine offers it nothing here — `canConfirm`
    and the two status checks below already withhold every button — so what this row has to do
    is say so before anything else on it is read. The date is the row's own pair for the state
    (`cancelled_at` or `expired_at`); the printed sentence only when a settled number was put on
    paper, because that is the case where a bib exists that must come out of the pile.
  */
  const terminal = isTerminalStatus(row.status);
  const voidedAt = row.status === "CANCELLED" ? row.cancelledAt : row.expiredAt;
  // Whose document is whose (§330): the minor's and the parent's on a minor's declaration.
  const documents = identityDocumentsOf(row);
  const printedVoid = terminal && row.bibPrintedAt !== null && row.bibNumber !== null;

  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="registrationId" value={row.id} />
      <input type="hidden" name="back" value={back} />
      {eventId && <input type="hidden" name="eventId" value={eventId} />}
      {q && <input type="hidden" name="q" value={q} />}
      {row.checkinCode && <input type="hidden" name="code" value={row.checkinCode} />}
    </>
  );

  return (
    <Box
      component="li"
      data-testid="desk-row"
      sx={{
        listStyle: "none",
        border: 1,
        borderColor: terminal ? "error.light" : row.checkedInAt ? "success.light" : "divider",
        borderRadius: 1,
        p: 1.5,
        bgcolor: row.checkedInAt ? "success.50" : "background.paper",
      }}
    >
      {/*
        First and loudest (§311): before the name, before the number, in the error colour. The
        volunteer has somebody in front of them holding the confirmation email, and the one
        thing the screen must not do is look like every other row with a slightly different chip.
      */}
      {terminal && (
        <Alert severity="error" data-testid="desk-void" sx={{ mb: 1.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t(row.status === "CANCELLED" ? "desk.voidCancelled" : "desk.voidExpired", {
              date: voidedAt ? format.dateTime(voidedAt, { dateStyle: "long" }) : "—",
            })}
          </Typography>
          {printedVoid && (
            <Typography variant="body2">{t("desk.voidPrinted", { number: row.bibNumber as number })}</Typography>
          )}
        </Alert>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.5 }}>
            {/*
              The number first and large: it is what the volunteer reaches for on the table.

              Digits alone, with no marker for a provisional one (§214) — unlike the
              registrations list, which is a planning screen and marks it. A volunteer at a desk
              with a queue in front of them reads a number off a screen and matches it to a
              number on a bib, and anything else in that field is something to decode. What
              tells them a number is not settled is the absence of the bib picture below, which
              is only ever drawn for a settled one; the tooltip says it in words.

              Struck through and dimmed on a row that is over (§311): the number is still this
              person's — it is never reused — and it is not a number to reach for.
            */}
            <Typography
              component="span"
              title={number && !number.settled ? t("desk.bibProvisional") : undefined}
              sx={{
                fontWeight: 700,
                fontSize: "1.25rem",
                minWidth: 48,
                color: number && !terminal ? "text.primary" : "text.disabled",
                textDecoration: terminal && number ? "line-through" : "none",
              }}
            >
              {number ? number.value : "—"}
            </Typography>
            <Typography component="span" sx={{ fontWeight: 600, fontSize: "1.05rem" }}>
              {row.registeredName}
            </Typography>
            {/* A minor: the kit goes to the parent named here (§108). */}
            {row.guardianName && (
              <Chip size="small" variant="outlined" label={t("desk.guardian", { name: row.guardianName })} />
            )}
            <Chip
              size="small"
              color={
                terminal ? "error" : row.status === "CONFIRMED" ? "success" : row.status === "WAITLISTED" ? "default" : "warning"
              }
              label={REGISTRATION_STATUS_LABEL[row.status]}
            />
            {row.kind === "TEST" && <Chip size="small" color="warning" label={t("registrations.testKind")} />}
            {/* The provider said no (§76): this is who to call before race day. */}
            {row.emailRejectedReason && (
              <Chip
                size="small"
                color="error"
                variant="outlined"
                label={t("registrations.emailRejected")}
                title={row.emailRejectedReason}
                data-testid="email-rejected"
              />
            )}
            {row.checkedInAt && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={t("desk.checkedInAt", {
                  time: format.dateTime(row.checkedInAt, { timeStyle: "short", hourCycle: "h23" }),
                  who: row.checkedInByName ?? t("desk.bySelf"),
                })}
              />
            )}
          </Stack>
          {showEvent && (
            <Typography variant="body2" color="text.secondary">
              {row.eventTitle ?? row.eventId} ·{" "}
              {format.dateTime(row.eventStartsAt, { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" })}
            </Typography>
          )}
          {/*
            The number as the paper shows it (§184). Folded, because the desk's own job is the
            large digits above and a picture would push the buttons off a phone; open, it is the
            same PNG the club previewed and printed from, so a volunteer holding an envelope can
            check the two against each other without leaving the row.

            Loaded only when the fold is opened — `<details>` does not fetch what it does not
            render — which matters on a phone at a start line.

            Not on a row that is over (§311): the picture is for matching a bib to a runner, and
            this runner gets none. The red line above already names the number to pull.
          */}
          {number !== null && number.settled && row.kind === "REAL" && !terminal && (
            <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 1 }}>
              <Typography component="summary" variant="body2" color="text.secondary">
                {t("desk.showBib")}
              </Typography>
              {/* eslint-disable-next-line @next/next/no-img-element -- our own PNG, drawn at a fixed size */}
              <img
                src={`/api/admin/events/${row.eventId}/bibs/preview?registration=${row.id}&locale=${locale}`}
                alt={t("desk.bibAlt", { number: number.value })}
                width={900}
                height={600}
                loading="lazy"
                decoding="async"
                style={{ display: "block", width: "100%", maxWidth: 360, height: "auto", border: "1px solid #ddd", borderRadius: 4 }}
              />
            </Box>
          )}
          {row.checkinCode && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
              {row.checkinCode}
            </Typography>
          )}
          {/*
            The document the kit is handed out against (§95): what the volunteer compares the card
            to. A minor's declaration carries two (§330) — the minor's and the parent's, to whom the
            kit goes (§108) — each shown the way one always was, and each labelled whose it is.
          */}
          {row.guardianName ? (
            <>
              {documents.participant && (
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t("desk.idDocumentMinor")}: {documents.participant}
                </Typography>
              )}
              {documents.guardian && (
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t("desk.idDocumentGuardian")}: {documents.guardian}
                </Typography>
              )}
            </>
          ) : (
            documents.participant && (
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t("desk.idDocument")}: {documents.participant}
              </Typography>
            )
          )}
        </Box>

        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          {!readOnly && canConfirm && (
            <form action={confirmRegistrationNowAction}>
              {hidden}
              <GlyphButton icon="confirm" type="submit" variant="contained" color="warning" size="small" sx={{ minHeight: 44 }}>
                {t("desk.confirmHere")}
              </GlyphButton>
            </form>
          )}
          {/*
            A minor's paper is signed by two (§330) where the declaration in effect asks the minor
            to sign: the minor and the parent or guardian, each with their own document. The press
            records exactly that — both names on the row, the volunteer as the one who saw the
            paper — so the row says it before the press, and offers the form with both lines for a
            runner who arrived without one. Under an older text the parent signs alone, on the
            ordinary form, and the row says nothing more than it always did.
          */}
          {!readOnly && canConfirm && row.guardianName && minorSigns[row.locale] && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ flexBasis: "100%" }}>
                {t("desk.confirmMinorNote", { guardian: row.guardianName })}
              </Typography>
              <GlyphButton
                icon="print"
                href={`/api/admin/events/${row.eventId}/declaration-form?locale=${locale}&for=minor`}
                variant="text"
                size="small"
                sx={{ minHeight: 44 }}
              >
                {t("desk.minorForm")}
              </GlyphButton>
            </>
          )}
          {!readOnly && row.status === "WAITLISTED" && (
            <form action={promoteRegistrationAction}>
              {hidden}
              <GlyphButton icon="place" type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                {t("desk.givePlace")}
              </GlyphButton>
            </form>
          )}
          {!readOnly && row.status === "CONFIRMED" && (
            <>
              {/*
                The field only where there is a number to give (§173; the owner: "nu ar trebui
                să mai pot schimba numărul de concurs odată confirmat!").

                A confirmed runner has the number in their inbox and possibly on a bib in an
                envelope, so the service refuses a change — and a box that always refuses is
                worse than no box: it invites the press, and the desk is the one screen where
                being told "ceva nu este valid" in front of a queue is expensive. What stays is
                filling a gap, which is the one case that still arises: a row confirmed before
                a number was drawn automatically. The number itself is already shown large at
                the head of the row.
              */}
              {/* A refused number — taken, retired, out of the band — is answered in this row with
                  the number still in its box (§315), not at the head of a page the volunteer has
                  to scroll back from. One form per row, so each carries its own scope. */}
              {number === null && (
                <ActionForm action={setBibNumberAction} messages={await bibRefusalMessages(t("desk.bibField"))} scope={`bib-${row.id}`}>
                  {hidden}
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                    <RecallField
                      name="bibNumber"
                      type="number"
                      size="small"
                      label={t("desk.bibField")}
                      slotProps={{ htmlInput: { min: 1, max: 99999 }, inputLabel: { shrink: true } }}
                      sx={{ width: 120 }}
                    />
                    <GlyphButton icon="number" type="submit" variant="text" size="small" sx={{ minHeight: 44 }}>
                      {t("desk.saveBib")}
                    </GlyphButton>
                  </Stack>
                </ActionForm>
              )}
              <form action={checkInAction}>
                {hidden}
                <input type="hidden" name="direction" value={row.checkedInAt ? "undo" : "in"} />
                <GlyphButton
                  icon={row.checkedInAt ? "undo" : "checkIn"}
                  type="submit"
                  variant={row.checkedInAt ? "text" : "contained"}
                  color={row.checkedInAt ? "inherit" : "success"}
                  size="small"
                  sx={{ minHeight: 44 }}
                >
                  {row.checkedInAt ? t("desk.undoCheckIn") : t("desk.checkIn")}
                </GlyphButton>
              </form>
            </>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
