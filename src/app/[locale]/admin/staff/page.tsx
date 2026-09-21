import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { canManageStaff, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { listStaff } from "@/modules/staff-identity/service";
import { pageCount, parseListQuery } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import RowMenu from "@/shared/ui/RowMenu";
import SubmitButton from "@/shared/ui/SubmitButton";
import {
  changeStaffRoleAction,
  inviteStaffAction,
  resendStaffInviteAction,
  revokeStaffAction,
  sendStaffPasswordResetAction,
  setStaffAccountActiveAction,
} from "../actions";
import { isZitadelInviteConfigured } from "@/modules/staff-identity/zitadel-users";
import { env } from "@/shared/config/env";

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

  const current = await searchParams;
  const { error, saved, invite, reason, account } = current;
  /** Whichever of the three account verbs was pressed (§171) — they share their four answers. */
  const accountVerb = saved === "passwordReset" || saved === "accountDeactivated" || saved === "accountReactivated";
  // Whether "Add" also creates the Zitadel account and sends the invitation (§123).
  const invitesSend = env.STAFF_AUTH_MODE === "provider" && isZitadelInviteConfigured();

  const t = await getTranslations("Admin");
  const staff = await listStaff(getDb(), actor);

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
        {saved && saved !== "invited" && saved !== "reinvited" && <Alert severity="success">{t("saved")}</Alert>}
      </Box>

      <Box component="section">
        <Typography variant="h3" sx={{ fontSize: "1rem", mb: 2 }}>
          {t("staff.inviteTitle")}
        </Typography>

        <form action={inviteStaffAction}>
          <input type="hidden" name="uiLocale" value={locale} />
          <Stack spacing={2}>
            <TextField name="email" type="email" label={t("staff.email")} required />
            <TextField name="displayName" label={t("staff.name")} required />
            <TextField
              name="role"
              label={t("staff.role")}
              defaultValue="CONTRIBUTOR"
              select
              required
              helperText={t("staff.roleHelp")}
            >
              {STAFF_ROLES.map((role) => (
                <MenuItem key={role} value={role}>
                  {STAFF_ROLE_LABEL[role]} — {t(`staff.roles.${role}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField name="preferredLocale" label={t("staff.preferredLocale")} defaultValue="ro" select>
              {routing.locales.map((value) => (
                <MenuItem key={value} value={value}>
                  {value.toUpperCase()}
                </MenuItem>
              ))}
            </TextField>
            <Box>
              <Button type="submit" variant="contained">
                {t("staff.invite")}
              </Button>
            </Box>
          </Stack>
        </form>

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
      </Box>

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
          member.id === actor.id ? null : (
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ justifyContent: "flex-end", alignItems: { sm: "center" }, gap: 1 }}
            >
              <Box component="form" action={changeStaffRoleAction}>
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
                    {STAFF_ROLES.map((role) => (
                      <MenuItem key={role} value={role}>
                        {STAFF_ROLE_LABEL[role]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <SubmitButton
                    label={t("staff.changeRole")}
                    pendingLabel={t("staff.changeRolePending")}
                    variant="outlined"
                  />
                </Stack>
              </Box>

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
              <form id={`invite-${member.id}`} action={resendStaffInviteAction} hidden>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="email" value={member.email} />
              </form>
              <form id={`password-${member.id}`} action={sendStaffPasswordResetAction} hidden>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="email" value={member.email} />
              </form>
              <form id={`deactivate-${member.id}`} action={setStaffAccountActiveAction} hidden>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="email" value={member.email} />
                <input type="hidden" name="active" value="0" />
              </form>
              <form id={`revoke-${member.id}`} action={revokeStaffAction} hidden>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="staffUserId" value={member.id} />
              </form>
              <RowMenu
                ariaLabel={t("staff.rowActions", { name: member.displayName })}
                cancelLabel={t("confirm.cancel")}
                items={[
                  member.firstSignedInAt
                    ? {
                        kind: "submit" as const,
                        label: t("staff.passwordReset"),
                        icon: "invite" as const,
                        formId: `password-${member.id}`,
                        confirm: {
                          title: t("staff.passwordResetTitle"),
                          body: t("staff.passwordResetBody", { email: member.email }),
                          confirmLabel: t("staff.passwordReset"),
                        },
                      }
                    : {
                        kind: "submit" as const,
                        label: t("staff.resendInvite"),
                        icon: "invite" as const,
                        formId: `invite-${member.id}`,
                        confirm: {
                          title: t("staff.resendInviteTitle"),
                          body: t("staff.resendInviteBody", { email: member.email }),
                          confirmLabel: t("staff.resendInvite"),
                        },
                      },
                  {
                    kind: "submit" as const,
                    label: t("staff.deactivateAccount"),
                    icon: "revoke" as const,
                    formId: `deactivate-${member.id}`,
                    color: "warning" as const,
                    confirm: {
                      title: t("staff.deactivateAccountTitle"),
                      body: t("staff.deactivateAccountBody", { name: member.displayName }),
                      confirmLabel: t("staff.deactivateAccount"),
                    },
                  },
                  {
                    kind: "submit" as const,
                    label: t("staff.revoke"),
                    icon: "delete" as const,
                    formId: `revoke-${member.id}`,
                    color: "error" as const,
                    confirm: {
                      title: t("staff.revokeTitle"),
                      body: t("staff.revokeBody", { name: member.displayName }),
                      confirmLabel: t("staff.revoke"),
                    },
                  },
                ]}
              />
            </Stack>
          )
        }
      />

    </Stack>
  );
}
