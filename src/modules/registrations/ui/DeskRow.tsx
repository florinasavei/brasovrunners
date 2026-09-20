import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import type { DeskRegistration } from "@/modules/registrations/admin-repository";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
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
 *
 * `back` says where the buttons return to — this row inside the desk's search, or the page
 * one scanned code opened — and the hidden fields carry what that page needs to rebuild.
 */
export default async function DeskRow({
  row,
  locale,
  back,
  eventId,
  q,
  showEvent = false,
  readOnly = false,
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
}) {
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const canConfirm =
    row.status === "PENDING_EMAIL_CONFIRMATION" ||
    row.status === "PENDING_DECLARATION" ||
    row.status === "WAITLIST_OFFERED";

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
        borderColor: row.checkedInAt ? "success.light" : "divider",
        borderRadius: 1,
        p: 1.5,
        bgcolor: row.checkedInAt ? "success.50" : "background.paper",
      }}
    >
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.5 }}>
            {/* The number first and large: it is what the volunteer reaches for on the table. */}
            <Typography
              component="span"
              sx={{ fontWeight: 700, fontSize: "1.25rem", minWidth: 48, color: row.bibNumber ? "text.primary" : "text.disabled" }}
            >
              {row.bibNumber ?? "—"}
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
              color={row.status === "CONFIRMED" ? "success" : row.status === "WAITLISTED" ? "default" : "warning"}
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
          */}
          {row.bibNumber !== null && row.kind === "REAL" && (
            <Box component="details" sx={{ mt: 1, "& > summary": { cursor: "pointer", minHeight: 44, py: 1 } }}>
              <Typography component="summary" variant="body2" color="text.secondary">
                {t("desk.showBib")}
              </Typography>
              {/* eslint-disable-next-line @next/next/no-img-element -- our own PNG, drawn at a fixed size */}
              <img
                src={`/api/admin/events/${row.eventId}/bibs/preview?registration=${row.id}&locale=${locale}`}
                alt={t("desk.bibAlt", { number: row.bibNumber })}
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
          {/* The document the kit is handed out against (§95): what the volunteer compares the card to. */}
          {row.idDocument && (
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t("desk.idDocument")}: {row.idDocument}
            </Typography>
          )}
        </Box>

        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          {!readOnly && canConfirm && (
            <form action={confirmRegistrationNowAction}>
              {hidden}
              <Button type="submit" variant="contained" color="warning" size="small" sx={{ minHeight: 44 }}>
                {t("desk.confirmHere")}
              </Button>
            </form>
          )}
          {!readOnly && row.status === "WAITLISTED" && (
            <form action={promoteRegistrationAction}>
              {hidden}
              <Button type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                {t("desk.givePlace")}
              </Button>
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
              {row.bibNumber === null && (
                <form action={setBibNumberAction}>
                  {hidden}
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                    <TextField
                      name="bibNumber"
                      type="number"
                      size="small"
                      label={t("desk.bibField")}
                      slotProps={{ htmlInput: { min: 1, max: 99999 }, inputLabel: { shrink: true } }}
                      sx={{ width: 120 }}
                    />
                    <Button type="submit" variant="text" size="small" sx={{ minHeight: 44 }}>
                      {t("desk.saveBib")}
                    </Button>
                  </Stack>
                </form>
              )}
              <form action={checkInAction}>
                {hidden}
                <input type="hidden" name="direction" value={row.checkedInAt ? "undo" : "in"} />
                <Button
                  type="submit"
                  variant={row.checkedInAt ? "text" : "contained"}
                  color={row.checkedInAt ? "inherit" : "success"}
                  size="small"
                  sx={{ minHeight: 44 }}
                >
                  {row.checkedInAt ? t("desk.undoCheckIn") : t("desk.checkIn")}
                </Button>
              </form>
            </>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
