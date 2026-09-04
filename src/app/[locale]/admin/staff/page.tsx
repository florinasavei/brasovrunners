import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { canManageStaff, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { listStaff } from "@/modules/staff-identity/service";
import { changeStaffRoleAction, inviteStaffAction, revokeStaffAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
};

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

  const { error, saved } = await searchParams;

  const t = await getTranslations("Admin");
  const staff = await listStaff(getDb(), actor);

  return (
    <Stack spacing={4}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("staff.title")}
      </Typography>

      {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      {saved && <Alert severity="success">{t("saved")}</Alert>}

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
                  {t(`roles.${role}`)}
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

      <Stack component="ul" spacing={2} sx={{ listStyle: "none", p: 0, m: 0 }}>
        {staff.map((member) => (
          <Card key={member.id} component="li" variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                <Chip size="small" label={t(`roles.${member.role}`)} />
                {member.firstSignedInAt === null && (
                  <Chip size="small" variant="outlined" label={t("staff.pending")} />
                )}
                {member.id === actor.id && (
                  <Chip size="small" color="primary" variant="outlined" label={t("staff.you")} />
                )}
              </Stack>

              <Typography variant="body1">{member.displayName}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {member.email}
              </Typography>

              {/* Neither control is offered for the acting Administrator: changing your own
                  role or removing your own access is refused by the service, and the usual
                  way a club ends up locked out is someone tidying up their own account. */}
              {member.id !== actor.id && (
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <form action={changeStaffRoleAction}>
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="staffUserId" value={member.id} />
                    <Stack direction="row" spacing={1}>
                      <TextField
                        name="role"
                        label={t("staff.role")}
                        defaultValue={member.role}
                        select
                        size="small"
                        sx={{ minWidth: 160 }}
                      >
                        {STAFF_ROLES.map((role) => (
                          <MenuItem key={role} value={role}>
                            {t(`roles.${role}`)}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Button type="submit" size="small" variant="outlined">
                        {t("staff.changeRole")}
                      </Button>
                    </Stack>
                  </form>

                  <form action={revokeStaffAction}>
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="staffUserId" value={member.id} />
                    <Button type="submit" size="small" color="error" variant="outlined">
                      {t("staff.revoke")}
                    </Button>
                  </form>
                </Stack>
              )}
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
