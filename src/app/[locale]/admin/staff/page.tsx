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
import SubmitButton from "@/shared/ui/SubmitButton";
import { changeStaffRoleAction, inviteStaffAction, revokeStaffAction } from "../actions";

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
  const { error, saved } = current;

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
        {saved && <Alert severity="success">{t("saved")}</Alert>}
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
            <TextField name="role" label={t("staff.role")} defaultValue="AUTHOR" select required>
              {STAFF_ROLES.map((role) => (
                <MenuItem key={role} value={role}>
                  {STAFF_ROLE_LABEL[role]}
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
          {t("staff.inviteHelp")}
        </Typography>
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

              <Box component="form" action={revokeStaffAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="staffUserId" value={member.id} />
                <SubmitButton
                  label={t("staff.revoke")}
                  pendingLabel={t("staff.revokePending")}
                  color="error"
                  variant="outlined"
                />
              </Box>
            </Stack>
          )
        }
      />

    </Stack>
  );
}
