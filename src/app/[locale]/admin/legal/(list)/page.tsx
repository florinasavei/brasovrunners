import Alert from "@mui/material/Alert";
import { Fragment } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import {
  findCurrentApprovedDocument,
  findCurrentApprovedVersionId,
} from "@/modules/legal-documents/repository";
import { clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import SubmitButton from "@/shared/ui/SubmitButton";
import { env } from "@/shared/config/env";
import { approvePlatformTemplatesAction } from "../actions";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  type LegalDocumentVersionRow,
  listVersionsForBackoffice,
} from "@/modules/legal-documents/repository";
import { isReliedOn } from "@/modules/legal-documents/service";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { requireStaffRole } from "@/modules/staff-identity/session";
import { pageCount, parseListQuery } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import ButtonLink from "@/shared/ui/ButtonLink";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { deleteLegalVersionAction, withdrawLegalVersionAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The legal documents, as the club can see them (BR-REQ-053-01, BR-REQ-053-02, AGENTS.md §12.5).
 *
 * §12.5 makes a version immutable once anything references it, and the reason is what a
 * declaration *is*: a participant signed version 3, and `declaration_acceptances` records that
 * they signed version 3. Editing the words of version 3 afterwards would leave every one of
 * those signatures pointing at text nobody agreed to.
 *
 * So the counts on each row are not decoration. They are the answer to "may this be changed",
 * stated on the page rather than in a document somebody has to remember.
 *
 * ## The third count
 *
 * There are three, not two, and the new one is the one that was missing. A privacy notice is
 * referenced from `registrations` by *version number* — `privacy_notice_version`,
 * `results_consent_version` and `health_consent_version` are plain integers with no foreign key
 * — so a notice hundreds of people acknowledged used to appear on this screen as "not used
 * yet". The row said a version was free when it was the most relied-upon document the club has
 * (`DECISIONS.md` §53).
 *
 * ## What may be withdrawn, what may be deleted, and what the refusal says
 *
 * Withdrawn: an approved version nobody has relied on that is not the one in force — the row,
 * its number and its words stay, and only the offering stops (§46, §53). **Deleted: the same
 * version, and now for real** — the row, both translations and the text go, and the version
 * number is retired so it can never be issued again (§151). A draft has its own delete, which
 * needs no confirmation because nothing could ever have relied on it.
 *
 * Both are offered on the same row, and the row says what each one costs before either is
 * pressed: withdrawal as a button, deletion as a link to a screen that spells out the
 * consequence and asks for a typed phrase. The reversible one is the larger target on purpose.
 *
 * Where neither is possible the row says why, derived from the same facts the service checks and
 * in the same order — the three counts, then "in force right now" — and it says it about both
 * verbs at once, because the condition is the same condition. A missing button explains nothing;
 * a count is a reason an organizer accepts. The server refuses regardless (BR-REQ-060-01) — this
 * only changes what the screen is able to explain before anything is pressed.
 *
 * Withdrawn rows are folded away by default and revealed with `?withdrawn=1`, because the
 * point of withdrawing is to get them out of the way, and the point of not deleting them is
 * that the club can still find them.
 *
 * Administrator only, asserted here on the server — the same rule the staff screen carries,
 * because a legal document is exactly the kind of thing that must not be editable by whoever
 * happens to be signed in.
 */
export default async function LegalDocumentsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaffRole("ADMIN");
  // Creating a version is a Superadministrator's act (BR-REQ-053-02); an Administrator reads.
  // Offered here rather than only from an existing version's page, because an environment with
  // no version yet — production, by design — has no such page to start from, and the create
  // route was reachable by typing its address and no other way (found on production,
  // 2026-09-17: "I still can't create documents").
  const mayCreate = actor.role === "SUPERADMIN";
  /*
    Deleting a version outright is the same gate as writing one (`canManageStaff`), because the
    role that publishes the club's word is the role that unpublishes it (§151). Written as the
    capability rather than as another `role === "SUPERADMIN"`, so it moves if the rule does.

    The link is hidden from an Administrator rather than the row saying nothing: the sentence
    below it — what deletion would mean — is shown to everybody who can read this screen, so an
    Administrator learns that the version *can* go and who can do it, instead of finding a
    control that answers 404. The page and the service refuse regardless (BR-REQ-060-01).
  */
  const mayDestroy = canManageStaff(actor.role);

  const current = await searchParams;
  const { saved, error } = current;

  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const versions = await listVersionsForBackoffice(getDb());
  // The one press (§132): offered while any of the three has no approved version, with the
  // facts it would write shown first — a wrong CIF is seen here, not on the public notice.
  const facts = clubFactsFromEnv(env);
  const now = new Date();
  const missingKeys = (
    await Promise.all(
      (["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const).map(async (key) =>
        (await findCurrentApprovedDocument(getDb(), key, "ro", now)) ? null : key,
      ),
    )
  ).filter((key): key is "PRIVACY_NOTICE" | "TERMS" | "EVENT_DECLARATION" => key !== null);
  /*
    Which three rows the site is serving right now — the one reason a withdrawal is refused that
    no count on the row can show. A privacy notice with zero signatures is not unused; it is the
    notice of a quiet week, and withdrawing it would close registration (BR-REQ-053-01).
  */
  const inForceIds = new Set(
    (
      await Promise.all(
        (["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const).map((key) =>
          findCurrentApprovedVersionId(getDb(), key, now),
        ),
      )
    ).filter((id): id is string => id !== undefined),
  );
  const missingFacts = (
    [
      ["CLUB_LEGAL_NAME", facts.legalName],
      ["CLUB_REGISTRATION_NUMBER", facts.registrationNumber],
      ["CLUB_REGISTERED_ADDRESS", facts.registeredAddress],
      ["EMAIL_REPLY_TO", facts.contactEmail],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  const query = parseListQuery(current, {
    // Grouped by document, newest version first — the order the repository already returns and
    // the only one that reads as a version history.
    sortable: [],
    defaultSort: "version",
    defaultPerPage: 100,
  });

  const relianceOf = (version: LegalDocumentVersionRow) => ({
    signatures: version.acceptanceCount,
    events: version.eventCount,
    acknowledgements: version.privacyAcknowledgementCount,
  });

  // The fold. `listVersionsForBackoffice` is the one reader that still returns withdrawn rows,
  // so the hiding happens here rather than in SQL — the count below has to be honest about
  // rows the club cannot currently see.
  const showWithdrawn = current.withdrawn === "1";
  const withdrawnCount = versions.filter((version) => version.withdrawnAt !== null).length;
  const visible = showWithdrawn
    ? versions
    : versions.filter((version) => version.withdrawnAt === null);

  const columns: readonly AdminColumn<LegalDocumentVersionRow>[] = [
    {
      key: "document",
      label: t("legal.document"),
      primary: true,
      render: (version) => (
        // Greyed when withdrawn, and still a link: the text has not gone anywhere, which is
        // the difference between this and a delete.
        <Box component="span" sx={{ opacity: version.withdrawnAt ? 0.6 : 1 }}>
          <Link href={{ pathname: "/admin/legal/[id]", params: { id: version.id } }}>
            {t(`legal.keys.${version.key}`)} · {t("legal.version")} {version.version}
          </Link>
        </Box>
      ),
    },
    {
      key: "state",
      label: t("legal.state"),
      render: (version) =>
        version.withdrawnAt ? (
          // Outlined rather than filled, so "retrasă" cannot be mistaken for "ciornă" at a
          // glance: both are grey, and only one of them was ever the club's word.
          <Chip size="small" variant="outlined" label={t("legal.withdrawn")} />
        ) : (
          <Chip
            size="small"
            color={version.isApproved ? "success" : "default"}
            label={version.isApproved ? t("legal.approved") : t("legal.draft")}
          />
        ),
    },
    {
      key: "languages",
      label: t("legal.languages"),
      hideBelow: "lg",
      render: (version) => version.locales.join(", ").toUpperCase() || "—",
    },
    {
      key: "usage",
      label: t("legal.usage"),
      render: (version) => {
        const reliance = relianceOf(version);
        return isReliedOn({
          acceptances: reliance.signatures,
          events: reliance.events,
          privacyAcknowledgements: reliance.acknowledgements,
        })
          ? t("legal.referencedFull", reliance)
          : t("legal.unreferenced");
      },
    },
    {
      key: "effectiveAt",
      label: t("legal.effectiveAt"),
      hideBelow: "lg",
      render: (version) => format.dateTime(version.effectiveAt, { dateStyle: "medium" }),
    },
  ];

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved === "legalVersionDeleted" && (
          <Alert severity="success">{t("legal.legalVersionDeleted")}</Alert>
        )}
        {saved === "legalVersionWithdrawn" && (
          <Alert severity="success">{t("legal.legalVersionWithdrawn")}</Alert>
        )}
        {/* The phrase that was typed names what went: a document code and a number, nothing
            about any person — the same two things the audit row keeps. */}
        {saved === "legalVersionErased" && (
          <Alert severity="success">
            {t("legal.legalVersionErased", { phrase: current.phrase ?? "" })}
          </Alert>
        )}
        {saved === "platformApproved" && (
          <Alert severity="success">{t("legal.platformApproved", { count: Number(current.approved ?? "0") })}</Alert>
        )}
        {saved &&
          saved !== "legalVersionDeleted" &&
          saved !== "legalVersionWithdrawn" &&
          saved !== "legalVersionErased" &&
          saved !== "platformApproved" && <Alert severity="success">{t("saved")}</Alert>}
      </Box>

      {mayCreate && missingKeys.length > 0 && (
        <Box sx={{ border: 2, borderColor: "primary.main", borderRadius: 1, p: 2 }} data-testid="platform-approve">
          <Typography variant="h3" sx={{ fontSize: "1.05rem", mb: 0.5 }}>
            {t("legal.platform.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("legal.platform.intro", { keys: missingKeys.map((key) => t(`legal.keys.${key}`)).join(", ") })}
          </Typography>
          <Box component="dl" sx={{ m: 0, mb: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "auto 1fr" }, columnGap: 2, rowGap: 0.5 }}>
            {(
              [
                ["legalName", facts.legalName],
                ["registrationNumber", facts.registrationNumber],
                ["registeredAddress", facts.registeredAddress],
                ["contactEmail", facts.contactEmail],
              ] as const
            ).map(([fact, value]) => (
              <Fragment key={fact}>
                <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>
                  {t(`legal.platform.facts.${fact}`)}
                </Typography>
                <Typography component="dd" variant="body2" color={value ? "text.primary" : "error"} sx={{ m: 0 }}>
                  {value ?? t("legal.platform.missing")}
                </Typography>
              </Fragment>
            ))}
          </Box>
          {missingFacts.length > 0 ? (
            <Alert severity="warning">{t("legal.platform.blocked", { variables: missingFacts.join(", ") })}</Alert>
          ) : (
            <form action={approvePlatformTemplatesAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <Stack spacing={1}>
                <Typography variant="body2">{t("legal.platform.consequence")}</Typography>
                <Box>
                  <SubmitButton label={t("legal.platform.button")} pendingLabel={t("legal.platform.pending")} variant="contained" size="medium" />
                </Box>
              </Stack>
            </form>
          )}
        </Box>
      )}

      <Stack spacing={1}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("legal.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("legal.intro")}
        </Typography>
        {/* What each of the three is, in one line (the owner, 2026-09-19: "it is not clear what
            these documents are — is the privacy notice GDPR? and what is the other one?"). */}
        <Box component="dl" sx={{ m: 0, mt: 1, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "auto 1fr" }, columnGap: 2, rowGap: 0.5 }}>
          {(["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const).map((key) => (
            <Fragment key={key}>
              <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>
                {t(`legal.keys.${key}`)}
              </Typography>
              <Typography component="dd" variant="body2" color="text.secondary" sx={{ m: 0 }}>
                {t(`legal.whatIs.${key}`)}
              </Typography>
            </Fragment>
          ))}
        </Box>
      </Stack>

      {mayCreate && (
        <Box>
          <ButtonLink href="/admin/legal/new" variant="contained" sx={{ minHeight: 44 }}>
            {t("legal.newTitle")}
          </ButtonLink>
          {/* The platform's own texts, complete but for the club's four facts (§95). */}
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            {t("legal.templatesIntro")}{" "}
            {(["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const).map((key, index) => (
              <span key={key}>
                {index > 0 ? " · " : ""}
                <Link href={{ pathname: "/admin/legal/new", query: { template: key } }}>{t(`legal.keys.${key}`)}</Link>
              </span>
            ))}
          </Typography>
        </Box>
      )}

      {versions.length === 0 ? (
        <Alert severity="warning">{mayCreate ? t("legal.emptyCanCreate") : t("legal.empty")}</Alert>
      ) : (
        <AdminTable
          caption={t("legal.tableCaption")}
          columns={columns}
          rows={visible}
          rowKey={(version) => version.id}
          basePath={getPathname({ locale, href: "/admin/legal" })}
          // So paging and the page-size control keep the fold open once it is.
          currentParams={{ withdrawn: current.withdrawn }}
          query={query}
          total={visible.length}
          labels={{
            results: t("list.results", { count: visible.length }),
            page: t("list.page", {
              page: query.page,
              pages: pageCount(visible.length, query.perPage),
            }),
            previous: t("list.previous"),
            next: t("list.next"),
            perPage: t("list.perPage"),
            actions: t("list.actions"),
            sortBy: (column) => t("list.sortBy", { column }),
          }}
          empty={<Alert severity="warning">{t("legal.empty")}</Alert>}
          rowActions={(version) => {
            const reliance = relianceOf(version);
            const relied = isReliedOn({
              acceptances: reliance.signatures,
              events: reliance.events,
              privacyAcknowledgements: reliance.acknowledgements,
            });

            const reason = (message: string) => (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ maxWidth: 280, textAlign: "right" }}
              >
                {message}
              </Typography>
            );

            /*
              An approved version is never deleted (§46) — but one nobody has relied on, that is
              not the text the site is serving, can be withdrawn: out of every list and every
              resolution, still on the record, still holding its number.

              The three conditions are asked in the service's own order, so the sentence the row
              gives and the refusal the server would give name the same obstacle.
            */
            if (version.isApproved) {
              if (relied) return reason(t("legal.removeBlockedReferenced", reliance));
              if (inForceIds.has(version.id)) return reason(t("legal.removeBlockedCurrent"));

              /*
                Deletable, so the row says both verbs and what each one costs (§151).

                Withdrawal first and as the button, deletion second and as a link: one of them
                keeps everything and the other keeps nothing, and the reversible one should be
                the larger target. The link goes to a screen rather than opening a dialog,
                because what deletion means — permanent, and the number retired with it — is
                three sentences and a typed phrase, not a `confirm()`.

                A withdrawn version has no withdraw button left, only the date it went and the
                delete link: it is the row the owner asked about, already out of circulation and
                still in the way.
              */
              return (
                <Stack spacing={0.75} sx={{ alignItems: "flex-end" }}>
                  {version.withdrawnAt ? (
                    reason(
                      t("legal.withdrawnOn", {
                        date: format.dateTime(version.withdrawnAt, { dateStyle: "medium" }),
                      }),
                    )
                  ) : (
                    <Box component="form" action={withdrawLegalVersionAction}>
                      <input type="hidden" name="uiLocale" value={locale} />
                      <input type="hidden" name="versionId" value={version.id} />
                      {/*
                        Warning rather than error, and the word is "retrage" rather than
                        "șterge", because this button does not destroy anything — saying
                        otherwise in the one place somebody reads before pressing would be the
                        wrong kind of honest.
                      */}
                      <ConfirmSubmitButton
                        label={t("legal.withdraw")}
                        title={t("legal.withdrawTitle")}
                        body={t("legal.withdrawBody")}
                        confirmLabel={t("legal.withdraw")}
                        cancelLabel={t("confirm.cancel")}
                        color="warning"
                      />
                    </Box>
                  )}
                  {mayDestroy && (
                    <Link
                      href={{ pathname: "/admin/legal/[id]/delete", params: { id: version.id } }}
                    >
                      {t("legal.deletePermanently")}
                    </Link>
                  )}
                  {reason(t("legal.deleteMeans", { version: version.version }))}
                </Stack>
              );
            }

            if (relied) return reason(t("legal.deleteBlockedReferenced", reliance));

            return (
              <Box component="form" action={deleteLegalVersionAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="versionId" value={version.id} />
                <ConfirmSubmitButton
                  label={t("legal.delete")}
                  title={t("legal.deleteTitle")}
                  body={t("legal.deleteBody")}
                  confirmLabel={t("legal.delete")}
                  cancelLabel={t("confirm.cancel")}
                  color="error"
                />
              </Box>
            );
          }}
        />
      )}

      {/*
        The fold, and an ordinary link rather than a disclosure widget: the state belongs in the
        URL like every other list filter here, so it survives a Server Action's redirect and can
        be sent to somebody. Offered only when there is something behind it.
      */}
      {withdrawnCount > 0 && (
        <Box>
          <Link href={{ pathname: "/admin/legal", query: showWithdrawn ? {} : { withdrawn: "1" } }}>
            {showWithdrawn
              ? t("legal.hideWithdrawn")
              : t("legal.showWithdrawn", { count: withdrawnCount })}
          </Link>
        </Box>
      )}
    </Stack>
  );
}
