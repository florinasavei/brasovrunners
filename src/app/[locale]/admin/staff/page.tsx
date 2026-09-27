import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";
import { staffInviteConstraints } from "@/modules/staff-identity/constraints";
import { textFieldConstraints } from "@/shared/forms/constraints";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { assignableRoles, canManageMember, canManageStaff } from "@/modules/staff-identity/domain/roles";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { listStaff } from "@/modules/staff-identity/service";
import { pageCount, parseListQuery } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import RowMenu from "@/shared/ui/RowMenu";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import {
  changeStaffRoleAction,
  inviteMembersAction,
  inviteStaffAction,
  resendStaffInviteAction,
  revokeStaffAction,
  sendStaffPasswordResetAction,
  setStaffAccountActiveAction,
} from "../actions";
import { isZitadelInviteConfigured } from "@/modules/staff-identity/zitadel-users";
import { checkInviteKey, hasNoAccount } from "@/modules/diagnostics/invite-key";
import { env } from "@/shared/config/env";
import { findAuditEvent } from "@/modules/audit/repository";
import { MEMBER_ROWS_MAX } from "@/modules/staff-identity/domain/member-rows";
import type { MemberAccountLine } from "@/modules/staff-identity/member-accounts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

type StaffRow = Awaited<ReturnType<typeof listStaff>>[number];

export const dynamic = "force-dynamic";

/**
 * Who may sign in, and as what (AGENTS.md §10.2, BR-REQ-060-01).
 *
 * Administrators only, asserted twice: the role check below, and again inside every action and
 * service call behind it. An Editor who guesses this URL gets a 404, the same answer a route
 * that does not exist gives.
 *
 * There is no invitation email — delivery to a real person waits on the club's sending domain,
 * and AGENTS.md §1.2 forbids inventing a message the club has not approved. The row is the
 * invitation: it is the allowlist, and the first sign-in from that address binds the identity
 * provider's subject to it.
 */
export default async function StaffPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  // A page an Editor may not see answers 404, the same as a route that does not exist: telling
  // them the staff list is there and refused invites a second attempt. The refusal that
  // matters is in the actions and in `listStaff` below, which assert the role again.
  if (!canManageStaff(actor.role)) notFound();
  /*
    The roles this reader may give (§450): every one for a Superadministrator, every one but the
    Superadministrator for an Administrator. The service refuses the rest whatever a form posts;
    this is so the select never offers a choice that ends in a refusal.
  */
  const offered = assignableRoles(actor.role);

  const current = await searchParams;
  const { error, saved, invite, reason, account, count, failed, retried, report } = current;
  /** Whichever of the three account verbs was pressed (§171) — they share their four answers. */
  const accountVerb = saved === "passwordReset" || saved === "accountDeactivated" || saved === "accountReactivated";
  // Whether "Add" also creates the Zitadel account and sends the invitation (§123).
  const invitesSend = env.STAFF_AUTH_MODE === "provider" && isZitadelInviteConfigured();

  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const staff = await listStaff(getDb(), actor);
  /**
   * Which of these rows has no sign-in account (§288). For two days every "Add" wrote the row
   * and created no account, and the page said so once, in a banner gone at the next click; the
   * colleague learnt it at the sign-in page. So the fact is on the row now, for as long as it is
   * true. One call for the whole list, this request only, bounded inside — and read with the
   * reader as the control: a listing without the person looking at it is a key that cannot see
   * accounts, and then nothing below claims anything about anybody.
   */
  const accounts = await checkInviteKey({ authMode: env.STAFF_AUTH_MODE, readerEmail: actor.email });
  /**
   * «Adaugă mai mulți membri» (§NNN): the press's report, read back from its own audit row — one
   * line per member, by row id, named here from the list above. A row withdrawn since is left out.
   */
  const reportRow = saved === "membersInvited" && report && UUID.test(report) ? await findAuditEvent(getDb(), report, "staff.members_invited") : undefined;
  const reportLines = ((reportRow?.metadataJson as { accounts?: MemberAccountLine[] } | undefined)?.accounts ?? []).flatMap((line) => {
    const member = staff.find((row) => row.id === line.staffUserId);
    return member ? [{ ...line, email: member.email }] : [];
  });

  const query = parseListQuery(current, {
    // `listStaff` returns the club's whole team — a handful of accounts, in its own order.
    // Nothing here needs sorting or paging, and the shared table is used anyway so the five
    // lists look and behave like one console.
    sortable: [],
    defaultSort: "name",
    defaultPerPage: 100,
  });

  const columns: readonly AdminColumn<StaffRow>[] = [
    {
      key: "name",
      label: t("staff.columnName"),
      primary: true,
      render: (member) => (
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.5 }}>
          <span>{member.displayName}</span>
          {member.id === actor.id && (
            <Chip size="small" color="primary" variant="outlined" label={t("staff.you")} />
          )}
          {/* In the name cell, not the status column: that one hides below `lg`, and this is
              the fact the row exists to carry until it stops being true (§288). */}
          {hasNoAccount(accounts, member.email) && (
            <Chip size="small" color="warning" label={t("staff.noAccount")} data-testid="staff-no-account" />
          )}
        </Stack>
      ),
    },
    {
      key: "email",
      label: t("staff.columnEmail"),
      render: (member) => (
        <Box component="span" sx={{ wordBreak: "break-all" }}>
          {member.email}
        </Box>
      ),
    },
    {
      key: "role",
      label: t("staff.columnRole"),
      render: (member) => <Chip size="small" label={STAFF_ROLE_LABEL[member.role]} />,
    },
    {
      key: "status",
      label: t("staff.columnStatus"),
      hideBelow: "lg",
      render: (member) =>
        member.firstSignedInAt === null ? (
          <Chip size="small" variant="outlined" label={t("staff.pending")} />
        ) : null,
    },
  ];

  return (
    <Stack spacing={4}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("staff.title")}
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved === "invited" && invite === "invited" && <Alert severity="success">{t("staff.inviteSent")}</Alert>}
        {saved === "invited" && invite === "exists" && <Alert severity="success">{t("staff.inviteExists")}</Alert>}
        {saved === "invited" && invite === "unconfigured" && <Alert severity="success">{t("staff.inviteManual")}</Alert>}
        {/* Two different failures, and they were wearing one sentence (§170): adding says the
            row is on the list and the account was refused; resending says the row is on the
            list and there is no account to send to. "A refuzat să creeze contul" under a
            person who has been on the list for a week explains nothing. */}
        {saved === "invited" && invite === "failed" && (
          <Alert severity="warning">{t("staff.inviteFailed", { reason: reason ?? "" })}</Alert>
        )}
        {saved === "reinvited" && invite === "failed" && (
          <Alert severity="warning">{t("staff.resendFailed", { reason: reason ?? "" })}</Alert>
        )}
        {saved === "reinvited" && invite === "invited" && <Alert severity="success">{t("staff.inviteSent")}</Alert>}
        {saved === "reinvited" && invite === "unconfigured" && <Alert severity="info">{t("staff.inviteManual")}</Alert>}
        {/* The two account verbs (§171). `missing` is its own answer: there is nothing to act
            on, which is not a failure and not a success. */}
        {saved === "passwordReset" && account === "done" && <Alert severity="success">{t("staff.passwordResetSent")}</Alert>}
        {saved === "accountDeactivated" && account === "done" && <Alert severity="success">{t("staff.accountDeactivated")}</Alert>}
        {saved === "accountReactivated" && account === "done" && <Alert severity="success">{t("staff.accountReactivated")}</Alert>}
        {accountVerb && account === "missing" && <Alert severity="warning">{t("staff.accountMissing")}</Alert>}
        {accountVerb && account === "unconfigured" && <Alert severity="info">{t("staff.accountUnconfigured")}</Alert>}
        {accountVerb && account === "failed" && (
          <Alert severity="warning">{t("staff.accountFailed", { reason: reason ?? "" })}</Alert>
        )}
        {/* «Adaugă mai mulți membri» (§NNN): how many, and how many accounts the provider refused. */}
        {saved === "membersInvited" && (
          <Alert severity={failed ? "warning" : "success"} data-testid="staff-members-report">
            {failed ? t("staff.membersInviteFailed", { count: count ?? "0", failed }) : t("staff.membersInvited", { count: count ?? "0" })}
            {retried && ` ${t("staff.membersRetried", { retried })}`}
            {reportLines.length > 0 && (
              <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                {reportLines.map((line) => (
                  <li key={line.staffUserId}>
                    <Box component="span" sx={{ wordBreak: "break-all" }}>
                      {line.email}
                    </Box>
                    {" — "}
                    {t(`staff.membersOutcome.${line.outcome}`, { reason: line.reason ?? "" })}
                  </li>
                ))}
              </Box>
            )}
          </Alert>
        )}
        {saved && saved !== "invited" && saved !== "reinvited" && saved !== "membersInvited" && <Alert severity="success">{t("saved")}</Alert>}
      </Box>

      {/*
        Adding a colleague is a nine-field form and a rare act — twice a season — above the list
        that is read every time. It is a panel of its own (§269), and since §336 it starts closed
        like every backoffice fold: its heading is a real `h2` in the summary, which a screen
        reader finds while the fold is shut. A refused add keeps the fold the person opened
        (§315); a successful one is shown in the list below and in the banner, so it does not
        reopen an empty form.
      */}
      <Panel glyph="invite"
        title={t("staff.inviteTitle")}
        // What "Add" does, readable while the fold is shut, like every other fold's aside (§336,
        // folds start closed): the account too when the Zitadel key can make it (§123).
        aside={invitesSend ? t("staff.inviteAsideSends") : t("staff.inviteAsideManual")}
        collapsible
        id="staff-invite"
        data-testid="staff-invite"
      >
        {/* A refused address or name comes back in its box, named in the summary (§315); the
            browser refuses first what the schema would (`staffInviteConstraints`). */}
        <ActionForm
          action={inviteStaffAction}
          messages={await refusalMessages({
            email: t("staff.email"),
            displayName: t("staff.name"),
            role: t("staff.role"),
            preferredLocale: t("staff.preferredLocale"),
          })}
          confirm={{ title: t("confirm.inviteStaffTitle"), body: t("confirm.inviteStaffBody"), confirmLabel: t("staff.invite"), cancelLabel: words.cancel }}
          data-testid="staff-invite-form"
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <Stack spacing={2}>
            <RecallField
              name="email"
              label={t("staff.email")}
              {...textFieldConstraints(staffInviteConstraints("email"))}
            />
            <RecallField
              name="displayName"
              label={t("staff.name")}
              {...textFieldConstraints(staffInviteConstraints("displayName"))}
            />
            <RecallField
              name="role"
              label={t("staff.role")}
              defaultValue="CONTRIBUTOR"
              select
              required={staffInviteConstraints("role").required}
              helperText={t("staff.roleHelp")}
            >
              {offered.map((role) => (
                <MenuItem key={role} value={role}>
                  {STAFF_ROLE_LABEL[role]} — {t(`staff.roles.${role}`)}
                </MenuItem>
              ))}
            </RecallField>
            <RecallField name="preferredLocale" label={t("staff.preferredLocale")} defaultValue="ro" select>
              {routing.locales.map((value) => (
                <MenuItem key={value} value={value}>
                  {value.toUpperCase()}
                </MenuItem>
              ))}
            </RecallField>
            <Box>
              <GlyphSubmitButton
                label={t("staff.invite")}
                pendingLabel={t("staff.inviting")}
                icon="addPerson"
                incompleteHintNamed={t.raw("forms.incompleteFirst") as string}
                size="medium"
              />
            </Box>
          </Stack>
        </ActionForm>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {invitesSend ? t("staff.inviteHelpSends") : t("staff.inviteHelp")}
        </Typography>
        {/*
          Without the key, "Adaugă" cannot create the account — and the sentence above used to
          tell the invitee to make one themselves on the sign-in page (§176; the owner: "that
          invitation email code does not work, I am still asked to sign in but I don't have the
          option to create an account").
          They cannot: the sign-in page is one button that hands off to the provider, and the
          provider's own login offers no self-registration for this organization. The row said
          something impossible, so the page says the real step instead — loudly, because until
          it is done nobody new can get in at all.
        */}
        {!invitesSend && env.STAFF_AUTH_MODE === "provider" && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t("staff.inviteKeyMissing")}
          </Alert>
        )}
      </Panel>

      {/*
        «Adaugă mai mulți membri» (§NNN): the club's members, one per row, all as «Membru» — a list
        pasted from the club's own records rather than nine fields per person. The whole list or
        nobody (§457): a row that is not an address, or an address already on the team, adds no one
        and names the rows. A fold of its own, closed like every fold (§336).
      */}
      <Panel glyph="members" title={t("staff.membersTitle")} aside={t("staff.membersAside")} collapsible id="staff-members" data-testid="staff-members">
        <ActionForm
          action={inviteMembersAction}
          messages={await refusalMessages({ members: t("staff.membersRows"), preferredLocale: t("staff.preferredLocale") })}
          confirm={{ title: t("confirm.inviteMembersTitle"), body: t("confirm.inviteMembersBody"), confirmLabel: t("staff.membersInvite"), cancelLabel: words.cancel }}
          data-testid="staff-members-form"
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <Stack spacing={2}>
            <RecallField
              name="members"
              label={t("staff.membersRows")}
              helperText={t("staff.membersRowsHelp", { max: MEMBER_ROWS_MAX })}
              multiline
              minRows={4}
              required
            />
            <RecallField name="preferredLocale" label={t("staff.preferredLocale")} defaultValue="ro" select>
              {routing.locales.map((value) => (
                <MenuItem key={value} value={value}>
                  {value.toUpperCase()}
                </MenuItem>
              ))}
            </RecallField>
            <Box>
              <GlyphSubmitButton
                label={t("staff.membersInvite")}
                pendingLabel={t("staff.membersInviting")}
                icon="addPerson"
                incompleteHintNamed={t.raw("forms.incompleteFirst") as string}
                size="medium"
              />
            </Box>
          </Stack>
        </ActionForm>
      </Panel>

      {/*
        The accounts could not be checked, and why, in the provider's words (§288). Never a
        guess in either direction: no row below says "no account" after this, and none is
        presumed to have one. A missing key is not repeated here — the warning above says it.
      */}
      {accounts.kind === "blind" && (
        <Alert severity="warning" data-testid="staff-accounts-blind">
          {t("staff.accountsBlind", { seen: accounts.seen })}
        </Alert>
      )}
      {(accounts.kind === "refused" || accounts.kind === "unreachable") && (
        <Alert severity="warning" data-testid="staff-accounts-unchecked">
          {t("staff.accountsUnchecked", { reason: accounts.reason })}
        </Alert>
      )}

      <AdminTable
        caption={t("staff.tableCaption")}
        columns={columns}
        rows={staff}
        rowKey={(member) => member.id}
        basePath={getPathname({ locale, href: "/admin/staff" })}
        currentParams={{}}
        query={query}
        total={staff.length}
        labels={{
          results: t("list.results", { count: staff.length }),
          page: t("list.page", { page: query.page, pages: pageCount(staff.length, query.perPage) }),
          previous: t("list.previous"),
          next: t("list.next"),
          perPage: t("list.perPage"),
          actions: t("list.actions"),
          sortBy: (column) => t("list.sortBy", { column }),
        }}
        empty={<Typography variant="body1">{t("staff.empty")}</Typography>}
        rowActions={(member) =>
          /* Neither control is offered for the acting Administrator: changing your own role or
             removing your own access is refused by the service, and the usual way a club ends
             up locked out is somebody tidying up their own account. */
          member.id === actor.id ? null : !canManageMember(actor.role, member.role) ? (
            /* A Superadministrator's row, read by an Administrator (§450): no verb, and a line that
               says whose it is — a row with no controls and no reason reads as a broken page. */
            <Typography variant="body2" color="text.secondary" data-testid="staff-superadmin-row">
              {t("staff.superadminRow")}
            </Typography>
          ) : (
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ justifyContent: "flex-end", alignItems: { sm: "center" }, gap: 1 }}
            >
              <ActionForm
                action={changeStaffRoleAction}
                confirm={{ title: t("confirm.changeRoleTitle"), body: t("confirm.changeRoleBody", { name: member.displayName }), confirmLabel: t("staff.changeRole"), cancelLabel: words.cancel }}
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="staffUserId" value={member.id} />
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <TextField
                    name="role"
                    label={t("staff.role")}
                    defaultValue={member.role}
                    select
                    size="small"
                    sx={{ minWidth: 150 }}
                  >
                    {offered.map((role) => (
                      <MenuItem key={role} value={role}>
                        {STAFF_ROLE_LABEL[role]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <GlyphSubmitButton
                    label={t("staff.changeRole")}
                    pendingLabel={t("staff.changeRolePending")}
                    icon="role"
                    variant="outlined"
                  />
                </Stack>
              </ActionForm>

              {/*
                The four verbs, in the same ⋮ every other list uses (§256), each asking before
                it acts — four bare buttons in a row asked nothing, and two of them end
                somebody's access. On a phone the row was five stacked forms tall.

                The invitation again while they have not signed in (§123), offered whether or
                not the key is set: without it the answer names the key, which is better than a
                control that is not there. The password reset only once they *have* signed in —
                before that the invitation is the right email and it sets the first password
                anyway (§171). Zitadel sends both and owns the code; nothing here touches a
                password.

                The last two are different verbs, which is why both exist (§171): "retrage
                accesul" removes the allowlist row, which is what stops the backoffice letting
                somebody in, while switching the account off happens at the provider and
                outlives the row.
              */}
              {/* Each verb's form asks its own question (§384); the menu only submits it. */}
              <ActionForm
                id={`invite-${member.id}`}
                action={resendStaffInviteAction}
                hidden
                confirm={{ title: t("staff.resendInviteTitle"), body: t("staff.resendInviteBody", { email: member.email }), confirmLabel: t("staff.resendInvite"), cancelLabel: words.cancel }}
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="email" value={member.email} />
              </ActionForm>
              <ActionForm
                id={`password-${member.id}`}
                action={sendStaffPasswordResetAction}
                hidden
                confirm={{ title: t("staff.passwordResetTitle"), body: t("staff.passwordResetBody", { email: member.email }), confirmLabel: t("staff.passwordReset"), cancelLabel: words.cancel }}
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="email" value={member.email} />
              </ActionForm>
              <ActionForm
                id={`deactivate-${member.id}`}
                action={setStaffAccountActiveAction}
                hidden
                confirm={{ title: t("staff.deactivateAccountTitle"), body: t("staff.deactivateAccountBody", { name: member.displayName }), confirmLabel: t("staff.deactivateAccount"), cancelLabel: words.cancel, destructive: true }}
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="email" value={member.email} />
                <input type="hidden" name="active" value="0" />
              </ActionForm>
              <ActionForm
                id={`revoke-${member.id}`}
                action={revokeStaffAction}
                hidden
                confirm={{ title: t("staff.revokeTitle"), body: t("staff.revokeBody", { name: member.displayName }), confirmLabel: t("staff.revoke"), cancelLabel: words.cancel, destructive: true }}
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="staffUserId" value={member.id} />
              </ActionForm>
              <RowMenu
                ariaLabel={t("staff.rowActions", { name: member.displayName })}
                items={[
                  member.firstSignedInAt
                    ? {
                        kind: "submit" as const,
                        label: t("staff.passwordReset"),
                        icon: "resend" as const,
                        formId: `password-${member.id}`,
                      }
                    : {
                        kind: "submit" as const,
                        label: t("staff.resendInvite"),
                        icon: "resend" as const,
                        formId: `invite-${member.id}`,
                      },
                  {
                    kind: "submit" as const,
                    label: t("staff.deactivateAccount"),
                    icon: "revoke" as const,
                    formId: `deactivate-${member.id}`,
                    color: "warning" as const,
                  },
                  {
                    kind: "submit" as const,
                    label: t("staff.revoke"),
                    icon: "delete" as const,
                    formId: `revoke-${member.id}`,
                    color: "error" as const,
                  },
                ]}
              />
            </Stack>
          )
        }
      />

      {/* What the mark means and what to do about it, once, under the list: a mark with no
          remedy beside it is a worry, not a fact (§288). */}
      {staff.some((member) => hasNoAccount(accounts, member.email)) && (
        <Typography variant="body2" color="text.secondary" data-testid="staff-no-account-help">
          {t("staff.noAccountHelp")}
        </Typography>
      )}
    </Stack>
  );
}
