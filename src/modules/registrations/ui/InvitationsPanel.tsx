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
    .select({ capacity: events.capacity, timezone: events.timezone, hiddenListEnabled: events.hiddenListEnabled })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return null;
  const invitations = await listEventInvitations(db, eventId);
  const pending = invitations.filter((row) => invitationState(row, now) === "sent").length;
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
      openWhen={{ inUse: pending > 0 }}
      id="registrations-invitations"
      data-testid="registrations-invitations"
    >
      <Stack spacing={3}>
        {form}
        {invitations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("invitations.empty")}
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="invitations-list">
            {invitations.map((row) => {
              const state = invitationState(row, now);
              /*
                A counted place while somebody waits: the deadline cannot move later (the server keeps it
                under the lock whatever is typed), so no days box and the dialog says so. The hidden list
                holds no counted place and keeps both.
              */
              const deadlineFixed = !row.outsideCapacity && waiting > 0;
              return (
                <Box component="li" key={row.id} sx={{ py: 1.5, borderTop: 1, borderColor: "divider" }} data-testid="invitation-row">
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 600 }}>{row.name}</Typography>
                    <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                      {row.email}
                    </Typography>
                    <Chip size="small" color={STATE_COLOR[state]} label={t(`invitations.state.${state}`)} />
                    {/* «Invitat special» (§649): the registrations' own chip, glyph and hint, not a bare word. */}
                    {row.outsideCapacity && <HiddenListChip label={t("registrations.outside.chip")} hint={t("registrations.outside.hint")} testId="invitation-outside-chip" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {state === "sent"
                      ? t("invitations.until", { deadline: deadline(row.expiresAt) })
                      : state === "accepted" && row.acceptedAt
                        ? t("invitations.acceptedAt", { at: deadline(row.acceptedAt) })
                        : state === "withdrawn" && row.withdrawnAt
                          ? t("invitations.withdrawnAt", { at: deadline(row.withdrawnAt) })
                          : t("invitations.expiredAt", { at: deadline(row.expiredAt ?? row.expiresAt) })}
                    {" · "}
                    {t("invitations.by", { name: row.invitedByName ?? t("invitations.byNobody") })}
                    {row.resendCount > 0 && ` · ${t(`invitations.resent.${countForm(row.resendCount, locale)}`, { count: row.resendCount })}`}
                    {row.supplementaryRaise && ` · ${t("invitations.raised")}`}
                  </Typography>
                  {state === "accepted" && row.acceptedRegistrationId && (
                    <Link href={getPathname({ locale, href: { pathname: "/admin/registrations/[id]", params: { id: row.acceptedRegistrationId } } })} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                      {t("invitations.openRegistration")}
                    </Link>
                  )}
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
                </Box>
              );
            })}
          </Box>
        )}
      </Stack>
    </Panel>
  );
}
