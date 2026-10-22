import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";
import StatusChip from "@/shared/ui/StatusChip";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { FACTS_SX, LINE_SX, PENCIL_SX, ROW_SX, SUMMARY_SX } from "@/shared/ui/row-fold";
import { staffInviteConstraints } from "@/modules/staff-identity/constraints";
import { textFieldConstraints } from "@/shared/forms/constraints";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { assignableRoles, canGrantPermission, canHoldMemberTier, canManageMember, canManageStaff, holdsGrant, impliesPermission } from "@/modules/staff-identity/domain/roles";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { listStaff } from "@/modules/staff-identity/service";
import { confirmWords } from "@/shared/feedback/confirm-words";
import { withSendNowChoice } from "@/modules/notifications/domain/send-at-once";
import { sendNowChoiceFor } from "@/modules/notifications/send-now-choice";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import {
  changeStaffRoleAction,
  inviteMembersAction,
  inviteStaffAction,
  resendStaffInviteAction,
  revokeStaffAction,
  sendStaffPasswordResetAction,
  setMemberTierAction,
  setStaffAccountActiveAction,
  setStaffPermissionAction,
} from "../actions";
import GlyphButton from "@/shared/ui/GlyphButton";
import TickButton from "@/shared/ui/TickButton";
import { isZitadelInviteConfigured } from "@/modules/staff-identity/zitadel-users";
import { checkInviteKey, hasNoAccount } from "@/modules/diagnostics/invite-key";
import { refusedInvitations } from "@/modules/notifications/delivery-evidence";
import { causeLabel } from "@/modules/registrations/ui/rejected-email-words";
import { env } from "@/shared/config/env";
import { findAuditEvent } from "@/modules/audit/repository";
import { listAllMemberTiers, tierViewOf } from "@/modules/content/member-tiers/repository";
import MemberTierSelect from "@/modules/content/member-tiers/ui/MemberTierSelect";
import TierBadge from "@/modules/content/member-tiers/ui/TierBadge";
import OnlyForType from "@/modules/content/events/ui/OnlyForType";
import { MEMBER_ROWS_MAX } from "@/modules/staff-identity/domain/member-rows";
import type { MemberAccountLine } from "@/modules/staff-identity/member-accounts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The glyph drawn here as a component, by name from the verbs' registry (§318): a Server Component may render one, never pass one. */
const PencilIcon = ACTION_ICONS.edit;

/** A line nobody here may change: the words and the facts, no pencil — nothing on it is a control. */
const READ_LINE_SX = { ...LINE_SX, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto" }, gridTemplateAreas: { xs: '"words" "facts"', sm: '"words facts"' } } as const;

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
 *
 * The team is a list of row folds (§842, amending §256): one line per person, the controls behind
 * the pencil; «Adaugă o persoană» and «Adaugă mai mulți membri» are folds after it.
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
  // The levels the club named (§811), in its order and this language: the select of a member's row and of «Adaugă mai mulți membri». Hidden ones are no longer given.
  const tiers = (await listAllMemberTiers(getDb())).map((tier) => ({ ...tierViewOf(tier, locale), hidden: tier.hidden }));
  const givableTiers = tiers.filter((tier) => !tier.hidden);
  const tierBoxes = await refusalMessages({ tierId: t("staff.memberTier") });
  const hiddenTierLabel = (name: string) => t("staff.memberTierHiddenOption", { name });
  const tierOf = (id: string | null) => (id === null ? undefined : tiers.find((tier) => tier.id === id));
  // «Retrimite invitația» asks «Trimite acum» or «Pune la coadă» (§540), under the scheduled timing only.
  const sendNow = await sendNowChoiceFor(getDb(), locale);
  /**
   * Which of these rows has no sign-in account (§288). For two days every "Add" wrote the row
   * and created no account, and the page said so once, in a banner gone at the next click; the
   * colleague learnt it at the sign-in page. So the fact is on the row now, for as long as it is
   * true. One call for the whole list, this request only, bounded inside — and read with the
   * reader as the control: a listing without the person looking at it is a key that cannot see
   * accounts, and then nothing below claims anything about anybody.
   */
  const accounts = await checkInviteKey({ authMode: env.STAFF_AUTH_MODE, readerEmail: actor.email });
  // Whose newest invitation email was refused (§671): one read of the window's invitations, for the rows' mark.
  const invitationRefusals = await refusedInvitations(getDb(), new Date());
  /**
   * «Adaugă mai mulți membri» (§524): the press's report, read back from its own audit row — one
   * line per member, by row id, named here from the list above. A row withdrawn since is left out.
   */
  const reportRow = saved === "membersInvited" && report && UUID.test(report) ? await findAuditEvent(getDb(), report, "staff.members_invited") : undefined;
  const reportLines = ((reportRow?.metadataJson as { accounts?: MemberAccountLine[] } | undefined)?.accounts ?? []).flatMap((line) => {
    const member = staff.find((row) => row.id === line.staffUserId);
    return member ? [{ ...line, email: member.email }] : [];
  });

  /*
    The two «Adaugă…» folds open by themselves only while there is nobody to edit (§842): the list
    is never empty to the person reading it — their own row is on it — so «the list is empty» is
    «the team is the reader alone».
  */
  const alone = staff.every((member) => member.id === actor.id);

  /**
   * One person of the team as the house's row fold (§842, `shared/ui/row-fold.ts`; amends §256,
   * which kept the role select and a ⋮ on a table row): the line says who in words — the name and
   * the address — then the facts as chips (the role, a club member's level, «Magazin», «Tu», «Nu
   * s-a autentificat încă», no sign-in account, a refused invitation) and the pencil. A press on the
   * line opens the controls in place: the role, the level, «Gestionează magazinul», the invitation
   * again or the password, switching the account off, and «Retrage accesul» last. Each control is
   * its own form and asks before it acts (§256, §384); the fold only gathers them.
   *
   * Two rows have no control, so no pencil and no fold (a fold that opens onto nothing is a control
   * that lies): the reader's own — changing your own role or removing your own access is refused by
   * the service, and the usual way a club ends up locked out is somebody tidying up their own
   * account — and a Superadministrator's, read by an Administrator (§450), whose line says whose it
   * is: a row with no controls and no reason reads as a broken page.
   *
   * The fold is keyed on what its line says, so a new role, level or shop draws it closed on its
   * new line.
   */
  const staffRowOf = (member: StaffRow) => {
    const own = member.id === actor.id;
    const locked = !own && !canManageMember(actor.role, member.role);
    const shop = holdsGrant(member, "shop.manage");
    const level = canHoldMemberTier(member.role) ? tierOf(member.memberTierId) : undefined;
    // The invitation email was refused (§671): until the person signs in, the row says why it did not reach them.
    const refusedFor = member.firstSignedInAt === null ? invitationRefusals.get(member.email.trim().toLowerCase()) : undefined;
    const ids = (
      <>
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="staffUserId" value={member.id} />
      </>
    );
    const address = (
      <>
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="email" value={member.email} />
      </>
    );

    /** The line's words: the name, then the address the person signs in with. */
    const who = (
      <Box sx={{ gridArea: "words", minWidth: 0 }}>
        <Typography component="span" sx={{ fontWeight: 600, overflowWrap: "anywhere" }} data-testid="staff-name">
          {member.displayName}
        </Typography>
        <Typography component="span" color="text.secondary" sx={{ wordBreak: "break-all" }} data-testid="staff-email">
          {" · "}
          {member.email}
        </Typography>
        {locked && (
          <Typography variant="body2" color="text.secondary" sx={{ display: "block" }} data-testid="staff-superadmin-row">
            {t("staff.superadminRow")}
          </Typography>
        )}
      </Box>
    );

    /** The line's facts — on the line, never in a column that hides on a phone: the account's mark is what the row carries until it stops being true (§288). */
    const facts = (
      <Box sx={FACTS_SX}>
        <StatusChip glyph="role" label={STAFF_ROLE_LABEL[member.role]} testId="staff-role" />
        {/* A club member's level (§811): its glyph and name, beside the role — a label, not a permission. */}
        {level && <TierBadge tier={level} testId="staff-member-tier" />}
        {/* «Gestionează magazinul» given on top of the role (§687) — only where it means something. */}
        {shop && <StatusChip glyph="shop" color="secondary" variant="outlined" label={t("staff.permissions.chipShop")} testId="staff-permission-shop" />}
        {own && <StatusChip glyph="self" color="primary" variant="outlined" label={t("staff.you")} testId="staff-you" />}
        {member.firstSignedInAt === null && <StatusChip glyph="planned" variant="outlined" label={t("staff.pending")} testId="staff-pending" />}
        {hasNoAccount(accounts, member.email) && <StatusChip glyph="noAccount" color="warning" label={t("staff.noAccount")} testId="staff-no-account" />}
        {refusedFor && (
          <StatusChip glyph="failed" color="error" variant="outlined" label={t("staff.invitationRefused", { label: causeLabel(refusedFor, locale) })} testId="staff-invitation-refused" />
        )}
      </Box>
    );

    if (own || locked) {
      return (
        <Box component="li" key={member.id} id={`staff-${member.id}`} data-testid="staff-row" data-staff-id={member.id} sx={{ ...ROW_SX, scrollMarginTop: 16 }}>
          <Box sx={READ_LINE_SX}>
            {who}
            {facts}
          </Box>
        </Box>
      );
    }

    return (
      <Box component="li" key={member.id} id={`staff-${member.id}`} data-testid="staff-row" data-staff-id={member.id} sx={{ ...ROW_SX, scrollMarginTop: 16 }}>
        <Box component="details" key={[member.role, member.memberTierId ?? "", shop ? "shop" : ""].join("\u0001")} data-testid="staff-row-edit">
          <Box component="summary" title={t("staff.edit")} data-testid="staff-row-toggle" sx={SUMMARY_SX}>
            {who}
            {facts}
            <PencilIcon aria-hidden fontSize="small" sx={PENCIL_SX} />
          </Box>
          <Stack spacing={1.5} sx={{ pb: 1.5, pt: 0.5 }}>
            {/* The role is a value rather than a verb (§256): its select and its own «Schimbă rolul», first. */}
            <ActionForm
              action={changeStaffRoleAction}
              confirm={{ title: t("confirm.changeRoleTitle"), body: t("confirm.changeRoleBody", { name: member.displayName }), confirmLabel: t("staff.changeRole"), cancelLabel: words.cancel }}
              data-testid="staff-role-form"
            >
              {ids}
              <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                <TextField name="role" label={t("staff.role")} defaultValue={member.role} select size="small" sx={{ minWidth: 150 }}>
                  {offered.map((role) => (
                    <MenuItem key={role} value={role}>
                      {STAFF_ROLE_LABEL[role]}
                    </MenuItem>
                  ))}
                </TextField>
                <GlyphSubmitButton label={t("staff.changeRole")} pendingLabel={t("staff.changeRolePending")} icon="role" variant="outlined" />
              </Stack>
            </ActionForm>

            {/*
              «Nivel» (§811): a club member's level, given or cleared on the row — the visible levels and the one the member
              holds, and «—» for none. Only a member's row: a colleague is no member and holds no level. A press that asks first
              and then toasts, like the row's other verbs. A label and its benefits: it opens and refuses nothing.
            */}
            {canHoldMemberTier(member.role) && tiers.length > 0 && (
              <ActionForm
                action={setMemberTierAction}
                messages={tierBoxes}
                confirm={{ title: t("confirm.memberTierTitle"), body: t("confirm.memberTierBody", { name: member.displayName }), confirmLabel: t("staff.memberTierSave"), cancelLabel: words.cancel }}
                data-testid="staff-member-tier-form"
              >
                {ids}
                <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                  <MemberTierSelect
                    tiers={tiers}
                    noneLabel={t("staff.memberTierNone")}
                    hiddenOption={hiddenTierLabel}
                    keepId={member.memberTierId}
                    // One box per row, so each carries its own id (the refusal summary's link is for a form that is alone).
                    id={`member-tier-${member.id}`}
                    label={t("staff.memberTier")}
                    defaultValue={member.memberTierId ?? ""}
                    size="small"
                    sx={{ minWidth: 150 }}
                  />
                  <GlyphSubmitButton label={t("staff.memberTierSave")} pendingLabel={t("staff.memberTierSaving")} icon="save" variant="outlined" />
                </Stack>
              </ActionForm>
            )}

            {/*
              «Gestionează magazinul» (§687): a permission on top of the role, after the role. A press that asks first and then
              toasts, like the row's other verbs — a `TickButton` (§766), drawn ticked or empty — offered only where the service
              would accept it (`canGrantPermission`): never a club member's row; an Administrator's or a Superadministrator's has
              it by rank, drawn ticked and greyed, «inclus în rol».
            */}
            {canGrantPermission(actor, member.role, "shop.manage") ? (
              <ActionForm
                action={setStaffPermissionAction}
                confirm={
                  shop
                    ? { title: t("staff.permissions.revokeTitle"), body: t("staff.permissions.revokeBody", { name: member.displayName }), confirmLabel: t("staff.permissions.revoke"), cancelLabel: words.cancel, destructive: true }
                    : { title: t("staff.permissions.grantTitle"), body: t("staff.permissions.grantBody", { name: member.displayName }), confirmLabel: t("staff.permissions.grant"), cancelLabel: words.cancel }
                }
                data-testid="staff-permission-shop-form"
              >
                {ids}
                <input type="hidden" name="permission" value="shop.manage" />
                <input type="hidden" name="on" value={shop ? "0" : "1"} />
                <TickButton checked={shop}>{t("staff.permissions.shopManage")}</TickButton>
              </ActionForm>
            ) : impliesPermission(member.role, "shop.manage") ? (
              <Box>
                <GlyphButton icon="tickOn" variant="text" disabled sx={{ minHeight: 44 }} data-testid="staff-permission-shop-implied">
                  {t("staff.permissions.shopManage")} · {t("staff.permissions.implied")}
                </GlyphButton>
              </Box>
            ) : null}

            {/*
              The account's verbs, each asking before it acts (§256, §384): two of them end somebody's access.

              The invitation again while they have not signed in (§123), offered whether or not the key is set: without it the
              answer names the key, which is better than a control that is not there. The password reset only once they *have*
              signed in — before that the invitation is the right email and it sets the first password anyway (§171). Zitadel
              sends both and owns the code; nothing here touches a password.

              Switching the account off and «Retrage accesul» are different verbs, which is why both exist (§171): the first
              happens at the provider and outlives the row; the second removes the allowlist row, which is what stops the
              backoffice letting somebody in — the row's end, so last, apart from the verbs that keep the person.
            */}
            <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
              {member.firstSignedInAt === null ? (
                <ActionForm
                  action={resendStaffInviteAction}
                  confirm={withSendNowChoice(
                    { title: t("staff.resendInviteTitle"), body: t("staff.resendInviteBody", { email: member.email }), confirmLabel: t("staff.resendInvite"), cancelLabel: words.cancel },
                    sendNow,
                  )}
                  data-testid="staff-resend-form"
                >
                  {address}
                  {sendNow && <input type="hidden" name={sendNow.field} value={sendNow.value} />}
                  <GlyphSubmitButton label={t("staff.resendInvite")} pendingLabel={t("staff.resendInvitePending")} icon="resend" variant="outlined" />
                </ActionForm>
              ) : (
                <ActionForm
                  action={sendStaffPasswordResetAction}
                  confirm={{ title: t("staff.passwordResetTitle"), body: t("staff.passwordResetBody", { email: member.email }), confirmLabel: t("staff.passwordReset"), cancelLabel: words.cancel }}
                  data-testid="staff-password-form"
                >
                  {address}
                  <GlyphSubmitButton label={t("staff.passwordReset")} pendingLabel={t("staff.passwordResetPending")} icon="resend" variant="outlined" />
                </ActionForm>
              )}
              <ActionForm
                action={setStaffAccountActiveAction}
                confirm={{ title: t("staff.deactivateAccountTitle"), body: t("staff.deactivateAccountBody", { name: member.displayName }), confirmLabel: t("staff.deactivateAccount"), cancelLabel: words.cancel, destructive: true }}
                data-testid="staff-deactivate-form"
              >
                {address}
                <input type="hidden" name="active" value="0" />
                <GlyphSubmitButton label={t("staff.deactivateAccount")} pendingLabel={t("staff.deactivateAccountPending")} icon="revoke" variant="outlined" color="warning" />
              </ActionForm>
            </Stack>

            <ActionForm
              action={revokeStaffAction}
              confirm={{ title: t("staff.revokeTitle"), body: t("staff.revokeBody", { name: member.displayName }), confirmLabel: t("staff.revoke"), cancelLabel: words.cancel, destructive: true }}
              data-testid="staff-revoke-form"
            >
              {ids}
              <GlyphSubmitButton label={t("staff.revoke")} pendingLabel={t("staff.revokePending")} icon="delete" variant="outlined" color="error" />
            </ActionForm>
          </Stack>
        </Box>
      </Box>
    );
  };

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
        {/* «Adaugă mai mulți membri» (§524): how many, and how many accounts the provider refused. */}
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
        The accounts could not be checked, and why, in the provider's words (§288). Never a
        guess in either direction: no row below says "no account" after this, and none is
        presumed to have one. A missing key is not repeated here — the warning in «Adaugă o
        persoană» says it.
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

      {/* The team, one row fold per person (§842), in `listStaff`'s order — a handful of accounts, nothing to sort or page. */}
      <Stack spacing={1}>
        {staff.length === 0 ? (
          <Typography variant="body1">{t("staff.empty")}</Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("staff.tableCaption")} data-testid="staff-list">
            {staff.map((member) => staffRowOf(member))}
          </Box>
        )}

        {/* What the mark means and what to do about it, once, under the list: a mark with no
            remedy beside it is a worry, not a fact (§288). */}
        {staff.some((member) => hasNoAccount(accounts, member.email)) && (
          <Typography variant="body2" color="text.secondary" data-testid="staff-no-account-help">
            {t("staff.noAccountHelp")}
          </Typography>
        )}
      </Stack>

      {/*
        Adding a colleague is a nine-field form and a rare act — twice a season — so it is a fold
        after the list that is read every time, like every «Adaugă…» of the backoffice (§842): open
        by itself only while the team is the reader alone. Its heading is a real `h2` in the
        summary, which a screen reader finds while the fold is shut (§336). A refused add keeps the
        fold the person opened (§315); a successful one is shown in the list above and in the
        banner, so it does not reopen an empty form.
      */}
      <Panel glyph="invite"
        title={t("staff.inviteTitle")}
        // What "Add" does, readable while the fold is shut, like every other fold's aside (§336,
        // folds start closed): the account too when the Zitadel key can make it (§123).
        aside={invitesSend ? t("staff.inviteAsideSends") : t("staff.inviteAsideManual")}
        collapsible
        openWhen={{ primary: alone }}
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
            tierId: t("staff.memberTier"),
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
            {/*
              «Nivel» (§811, §817), under the role: a club member's level chosen in the same step, shown while the role is «Membru»
              and only once the club named a level the press may give (the page is the Administrator's, so the select is too — the
              service asserts both again). The same select as a member's row and «Adaugă mai mulți membri» (`MemberTierSelect`);
              the level is the staff's label, so the invitation email does not mention it.
            */}
            {offered.includes("MEMBER") && givableTiers.length > 0 && (
              <OnlyForType type="MEMBER" selectName="role" initialType="CONTRIBUTOR">
                <MemberTierSelect
                  tiers={givableTiers}
                  noneLabel={t("staff.memberTierNone")}
                  hiddenOption={hiddenTierLabel}
                  label={t("staff.memberTier")}
                  defaultValue=""
                  helperText={t("staff.memberTierInviteHelp")}
                  data-testid="staff-invite-tier"
                />
              </OnlyForType>
            )}
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
        «Adaugă mai mulți membri» (§524): the club's members, one per row, all as «Membru» — a list
        pasted from the club's own records rather than nine fields per person. The whole list or
        nobody (§457): a row that is not an address, or an address already on the team, adds no one
        and names the rows. A fold of its own, after the list, open by itself only while the team is
        the reader alone (§842).
      */}
      <Panel glyph="members" title={t("staff.membersTitle")} aside={t("staff.membersAside")} collapsible openWhen={{ primary: alone }} id="staff-members" data-testid="staff-members">
        <ActionForm
          action={inviteMembersAction}
          // Its own boxes' ids, apart from «Adaugă o persoană»'s namesakes (the language, the level).
          scope="members"
          messages={await refusalMessages({ members: t("staff.membersRows"), preferredLocale: t("staff.preferredLocale"), tierId: t("staff.memberTier") })}
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
            {/* «Nivel» (§811): one level for every member this press adds — the club's visible levels, or none. Only once the club named one. */}
            {givableTiers.length > 0 && (
              <MemberTierSelect
                tiers={givableTiers}
                noneLabel={t("staff.memberTierNone")}
                hiddenOption={hiddenTierLabel}
                label={t("staff.memberTier")}
                defaultValue=""
                helperText={t("staff.memberTierBulkHelp")}
                data-testid="staff-members-tier"
              />
            )}
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
    </Stack>
  );
}
