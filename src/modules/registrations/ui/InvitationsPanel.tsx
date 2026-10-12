import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { events } from "@/db/schema/events";
import type { Database } from "@/db/types";
import { countForm } from "@/i18n/count-form";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { listStaffUsers } from "@/modules/staff-identity/repository";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import type { FormOutcome } from "@/shared/forms/outcome";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import { readInvitationForecast } from "../admin-service";
import { HIDDEN_LIST_OFF } from "../domain/hidden-list";
import { INVITATION_DAYS_DEFAULT, INVITATION_DAYS_MAX, INVITATION_REFUSALS, invitationState } from "../domain/invitations";
import { listEventInvitations } from "../invitation-repository";
import HiddenListChip from "./HiddenListChip";
import InviteForm, { type InviteFormState, type InviteFormWords } from "./InviteForm";

type RowAction = (state: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>;

const STATE_COLOR = { sent: "info", accepted: "success", expired: "default", withdrawn: "default" } as const;
/** The states in the order the counts above the table name them. */
const INVITATION_STATES = ["sent", "accepted", "expired", "withdrawn"] as const;

/**
 * «Invitații» (§647) on an event's registrations list: who the club invited, where each invitation
 * stands — sent and waiting, accepted (a link to the registration it became), expired, withdrawn — its
 * deadline and who sent it; and, for the Administrator, the send («Trimite invitații») and each open
 * invitation's «Retrimite» and «Retrage». The Organizer reads the list and is offered no verb (§289);
 * every verb asserts the role on the server whatever this draws.
 *
 * The send's forecast — how many places are free for invitations — is the allocator's count
 * (`countOccupied` → `computeOccupied`) against the capacity, less everyone eligible who waits, as the
 * server counts it under the lock (`readInvitationForecast`); the dialog names the capacity a raise
 * would make, and the server adds exactly that or refuses.
 */
export default async function InvitationsPanel<T extends Record<string, unknown>>({
  db,
  locale,
  eventId,
  mayManage,
  sendAction,
  resendAction,
  withdrawAction,
  now,
}: {
  db: Database<T>;
  locale: Locale;
  eventId: string;
  mayManage: boolean;
  sendAction: (state: InviteFormState, form: FormData) => Promise<InviteFormState>;
  resendAction: RowAction;
  withdrawAction: RowAction;
  now: Date;
}) {
  const t = await getTranslations("Admin");
  const dialog = await confirmWords();
  const [event] = await db
    .select({ capacity: events.capacity, timezone: events.timezone, hiddenListEnabled: events.hiddenListEnabled, startsAt: events.startsAt, eventStatus: events.eventStatus })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return null;
  const invitations = await listEventInvitations(db, eventId);
  const byState = { sent: 0, accepted: 0, expired: 0, withdrawn: 0 };
  for (const row of invitations) byState[invitationState(row, now)] += 1;
  const pending = byState.sent;
  // An unanswered, expired invitation is for the club to re-invite only while the event can still be invited to.
  const upcoming = event.eventStatus === "SCHEDULED" && event.startsAt.getTime() > now.getTime();
  const deadline = (at: Date) => formatDay(at, { locale, timeZone: event.timezone, style: "short", withTime: true });

  let form: ReactNode = null;
  // Everyone eligible who waits: while it is not 0, «Retrimite» keeps a counted invitation's deadline (§10.6).
  let waiting = 0;
  if (mayManage) {
    // The waiting always subtracted, as the server does under the lock — whatever the auto-offer setting or the close.
    const [members, forecast] = await Promise.all([listStaffUsers(db), readInvitationForecast(db, eventId, now)]);
    const free = forecast?.free ?? null;
    waiting = forecast?.waiting ?? 0;
    const counted = (key: string) => ({ one: t.raw(`${key}.one`) as string, few: t.raw(`${key}.few`) as string, other: t.raw(`${key}.other`) as string });
    const words: InviteFormWords = {
      membersLegend: t("invitations.membersLegend"),
      membersSearch: t("invitations.membersSearch"),
      membersNone: t("invitations.membersNone"),
      typedLabel: t("invitations.typedLabel"),
      typedHelp: t("invitations.typedHelp"),
      nameLabel: t("invitations.nameLabel"),
      emailLabel: t("invitations.emailLabel"),
      removeRow: t.raw("invitations.removeRow") as string,
      removeShort: t("invitations.removeShort"),
      addRow: t("invitations.addRow"),
      daysLabel: t("invitations.daysLabel"),
      daysHelp: t("invitations.daysHelp", { max: INVITATION_DAYS_MAX }),
      outsideLabel: t("invitations.outsideLabel"),
      outsideHelp: t("invitations.outsideHelp"),
      localeLegend: t("invitations.localeLegend"),
      localeRo: t("invitations.localeRo"),
      localeEn: t("invitations.localeEn"),
      localeHelp: t("invitations.localeHelp"),
      submit: t("invitations.submit"),
      dialogTitle: t("invitations.dialog.title"),
      dialogCount: counted("invitations.dialog.count"),
      dialogFree: t.raw("invitations.dialog.free") as string,
      dialogRaise: counted("invitations.dialog.raise"),
      dialogNoRaise: t("invitations.dialog.noRaise"),
      dialogOutside: t("invitations.dialog.outside"),
      dialogDays: counted("invitations.dialog.days"),
      dialogLocale: t.raw("invitations.dialog.locale") as string,
      dialogEmail: counted("confirm.email"),
      confirmRaise: counted("invitations.dialog.confirmRaise"),
      confirm: t("invitations.dialog.confirm"),
      cancel: dialog.cancel,
      nobody: t("invitations.errors.INVITATION_NOBODY"),
      errors: {
        ...Object.fromEntries([...INVITATION_REFUSALS, "SUPPLEMENTARY_PLACE_UNCONFIRMED", "FORBIDDEN", "NOT_FOUND"].map((code) => [code, t.raw(`invitations.errors.${code}`) as string])),
        // The switch turned off after the page was drawn: the registration page's own sentence (§648; the send obeys the switch, §647).
        [HIDDEN_LIST_OFF]: t("errors.HIDDEN_LIST_OFF"),
      },
      errorGeneric: t("invitations.errors.generic"),
    };
    form = (
      <InviteForm
        action={sendAction}
        locale={locale}
        eventId={eventId}
        members={members.map((member) => ({ id: member.id, name: member.displayName, email: member.email })).sort((a, b) => a.name.localeCompare(b.name, locale))}
        capacity={event.capacity}
        free={free}
        daysDefault={INVITATION_DAYS_DEFAULT}
        daysMax={INVITATION_DAYS_MAX}
        hiddenListEnabled={event.hiddenListEnabled}
        words={words}
      />
    );
  }

  return (
    <Panel
      glyph="invite"
      title={t("invitations.title")}
      intro={t("invitations.intro")}
      aside={t(`invitations.aside.${countForm(pending, locale)}`, { count: pending })}
      collapsible
      // Open while any invitation still needs the Administrator's eye (§NNN): one sent and waiting, or — while the event is still to come — one that ran out unanswered.
      openWhen={{ attention: byState.sent + (upcoming ? byState.expired : 0) > 0 }}
      id="registrations-invitations"
      data-testid="registrations-invitations"
    >
      <Stack spacing={3}>
        {/* Who was invited first (§737; the owner: «I need to see the people that were added via manual
            invitations»), then the form that sends more, under a heading of its own. */}
        {invitations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("invitations.empty")}
          </Typography>
        ) : (
          <>
            {/* How many in each state, at a glance (§737): the list below names every one. */}
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }} data-testid="invitations-counts">
              {INVITATION_STATES.map((one) => {
                const count = byState[one];
                return count > 0 ? <Chip key={one} size="small" variant="outlined" color={STATE_COLOR[one]} label={`${t(`invitations.state.${one}`)}: ${count}`} /> : null;
              })}
            </Stack>
            <Box
              component="table"
              aria-label={t("invitations.tableCaption")}
              data-testid="invitations-list"
              sx={{
                width: "100%",
                borderCollapse: "collapse",
                "& th": { textAlign: "left", fontSize: "0.8125rem", fontWeight: 600, color: "text.secondary", py: 1, pr: 2, borderBottom: 1, borderColor: "divider" },
                "& td": { verticalAlign: "top", py: 1.5, pr: 2, borderTop: 1, borderColor: "divider" },
                // A phone reads each person as a block, the columns one under another (no sideways scroll).
                "& thead": { display: { xs: "none", sm: "table-header-group" } },
                "& tr, & td": { display: { xs: "block", sm: "revert" } },
                // Only the width changes on a phone: the shorthand would reset the colour to the text's.
                "& td + td": { borderTopWidth: { xs: 0, sm: "1px" }, pt: { xs: 0.5, sm: 1.5 } },
              }}
            >
              <thead>
                <tr>
                  <th scope="col">{t("invitations.columns.person")}</th>
                  <th scope="col">{t("invitations.columns.state")}</th>
                  <th scope="col">{t("invitations.columns.by")}</th>
                  {mayManage && <th scope="col">{t("invitations.columns.actions")}</th>}
                </tr>
              </thead>
              <tbody>
            {invitations.map((row) => {
              const state = invitationState(row, now);
              /*
                A counted place while somebody waits: the deadline cannot move later (the server keeps it
                under the lock whatever is typed), so no days box and the dialog says so. The hidden list
                holds no counted place and keeps both.
              */
              const deadlineFixed = !row.outsideCapacity && waiting > 0;
              return (
                <tr key={row.id} data-testid="invitation-row">
                  <td>
                    <Typography sx={{ fontWeight: 600 }}>{row.name}</Typography>
                    <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                      {row.email}
                    </Typography>
                    {/* Whom the club picked from its members, and whom it typed by hand (§737). */}
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", rowGap: 0.5 }}>
                      <Chip size="small" variant="outlined" label={t(row.memberStaffUserId ? "invitations.origin.member" : "invitations.origin.typed")} data-testid="invitation-origin" />
                      {/* «Invitat special» (§649): the registrations' own chip, glyph and hint, not a bare word. */}
                      {row.outsideCapacity && <HiddenListChip label={t("registrations.outside.chip")} hint={t("registrations.outside.hint")} testId="invitation-outside-chip" />}
                    </Stack>
                  </td>
                  <td>
                    <Chip size="small" color={STATE_COLOR[state]} label={t(`invitations.state.${state}`)} />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {state === "sent"
                        ? t("invitations.until", { deadline: deadline(row.expiresAt) })
                        : state === "accepted" && row.acceptedAt
                          ? t("invitations.acceptedAt", { at: deadline(row.acceptedAt) })
                          : state === "withdrawn" && row.withdrawnAt
                            ? t("invitations.withdrawnAt", { at: deadline(row.withdrawnAt) })
                            : t("invitations.expiredAt", { at: deadline(row.expiredAt ?? row.expiresAt) })}
                      {row.resendCount > 0 && ` · ${t(`invitations.resent.${countForm(row.resendCount, locale)}`, { count: row.resendCount })}`}
                      {row.supplementaryRaise && ` · ${t("invitations.raised")}`}
                    </Typography>
                    {state === "accepted" && row.acceptedRegistrationId && (
                      <Link href={getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: row.acceptedRegistrationId } } })} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                        {t("invitations.openRegistration")}
                      </Link>
                    )}
                  </td>
                  <td>
                    {/* The column's heading says «Trimisă de»; a phone, which hides it, reads the sentence. */}
                    <Typography variant="body2" sx={{ display: { xs: "none", sm: "block" } }}>
                      {row.invitedByName ?? t("invitations.byNobody")}
                    </Typography>
                    <Typography variant="body2" sx={{ display: { xs: "block", sm: "none" } }}>
                      {t("invitations.by", { name: row.invitedByName ?? t("invitations.byNobody") })}
                    </Typography>
                  </td>
                  {mayManage && (
                    <td>
                  {mayManage && state === "sent" && (
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1, alignItems: { sm: "flex-end" } }}>
                          <ActionForm
                            action={resendAction}
                            confirm={deadlineFixed ? {
                              title: t("invitations.resendTitle"),
                              body: t("invitations.resendBodyWaiting", { name: row.name }),
                              email: dialog.email(1),
                              confirmLabel: t("invitations.resend"),
                              cancelLabel: dialog.cancel,
                            } : [
                              // The box left empty keeps the deadline: only a number typed in it moves it, and the dialog says which.
                              {
                                title: t("invitations.resendTitle"),
                                body: t("invitations.resendBodyKept", { name: row.name }),
                                when: [{ field: "days", equals: "" }],
                                email: dialog.email(1),
                                confirmLabel: t("invitations.resend"),
                                cancelLabel: dialog.cancel,
                              },
                              {
                                title: t("invitations.resendTitle"),
                                body: t.raw("invitations.resendBody").replace("{name}", row.name) as string,
                                fillFrom: ["days"],
                                email: dialog.email(1),
                                confirmLabel: t("invitations.resend"),
                                cancelLabel: dialog.cancel,
                              },
                            ]}
                            data-testid="invitation-resend-form"
                          >
                            <input type="hidden" name="uiLocale" value={locale} />
                            <input type="hidden" name="eventId" value={eventId} />
                            <input type="hidden" name="invitationId" value={row.id} />
                            <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
                              {!deadlineFixed && <TextField
                                name="days"
                                label={t("invitations.resendDays")}
                                type="number"
                                size="small"
                                slotProps={{ htmlInput: { min: 1, max: INVITATION_DAYS_MAX, step: 1, inputMode: "numeric" } }}
                                sx={{ width: 150 }}
                              />}
                              <GlyphSubmitButton icon="resend" label={t("invitations.resend")} pendingLabel={t("invitations.resending")} variant="outlined" size="small" />
                            </Stack>
                          </ActionForm>
                          <ActionForm
                            action={withdrawAction}
                            confirm={{
                              title: t("invitations.withdrawTitle"),
                              body: t("invitations.withdrawBody", { name: row.name }),
                              destructive: true,
                              confirmLabel: t("invitations.withdraw"),
                              cancelLabel: dialog.cancel,
                            }}
                            data-testid="invitation-withdraw-form"
                          >
                            <input type="hidden" name="uiLocale" value={locale} />
                            <input type="hidden" name="eventId" value={eventId} />
                            <input type="hidden" name="invitationId" value={row.id} />
                            <GlyphSubmitButton icon="revoke" label={t("invitations.withdraw")} pendingLabel={t("invitations.withdrawing")} variant="text" color="error" size="small" />
                          </ActionForm>
                        </Stack>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
              </tbody>
            </Box>
          </>
        )}
        {form && (
          <Box component="section" aria-labelledby="invitations-send-title" sx={{ pt: 2, borderTop: 1, borderColor: "divider" }}>
            <Typography id="invitations-send-title" component="h3" variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
              {t("invitations.sendTitle")}
            </Typography>
            {form}
          </Box>
        )}
      </Stack>
    </Panel>
  );
}
