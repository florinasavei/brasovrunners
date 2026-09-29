import Alert from "@mui/material/Alert";
import { Fragment } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDateInWords, formatDay, formatDayRange } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import {
  findCurrentApprovedDocument,
  noticeDescribesListSocials,
  noticeDescribesListStates,
  noticeDescribesPromotionalMaterials,
  noticeDescribesPromotionalMaterialsShared,
} from "@/modules/legal-documents/repository";
import { clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { shownContactAddresses } from "@/modules/contact/shown-address";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import type { PanelGlyphName } from "@/shared/ui/panel-glyphs";
import ChipLink from "@/shared/ui/ChipLink";
import { env } from "@/shared/config/env";
import { approvePlatformTemplatesAction } from "../actions";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  type LegalDocumentVersionRow,
  listVersionsForBackoffice,
} from "@/modules/legal-documents/repository";
import {
  type DeletionFacts,
  deletionObstacle,
  type InForceWindow,
  isReliedOn,
  removalPlan,
} from "@/modules/legal-documents/domain/deletability";
import { reliancePhrases } from "@/modules/legal-documents/domain/retire-steps";
import { planDraftApproval, readDeletionFacts, readLegalOverview } from "@/modules/legal-documents/service";
import { confirmationPhrase } from "@/modules/legal-documents/domain/confirmation";
import {
  filterLegalVersions,
  isNarrowing,
  kindFoldOpens,
  kindHeadline,
  LEGAL_STATE_FILTERS,
  type LegalListFilter,
  legalListQuery,
  type LegalVersionState,
  parseLegalListFilter,
  versionState,
  versionsOfKind,
} from "@/modules/legal-documents/domain/overview";
import Checkbox from "@mui/material/Checkbox";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import { canWriteLegalTexts } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { canReadContent } from "@/modules/staff-identity/domain/roles";
import { pageCount, parseListQuery } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import GlyphButton from "@/shared/ui/GlyphButton";
import {
  approveLegalDraftsAction,
  deleteLegalVersionAction,
  regenerateLegalTemplatesAction,
  withdrawLegalVersionAction,
} from "../actions";
import { LEGAL_DOCUMENT_KEYS, PLATFORM_APPROVAL_KEYS } from "@/modules/legal-documents/domain/keys";

/** The form the rows' ticks belong to (`form=`), a GET to `/admin/legal/delete` (§532). */
const BATCH_DELETE_FORM = "legal-batch-delete";

/** Each text's card wears its subject's picture (§521): the notice and the terms their own, the declarations the pen. */
const KIND_GLYPH: Record<LegalDocumentKey, PanelGlyphName> = {
  PRIVACY_NOTICE: "legal",
  TERMS: "rules",
  EVENT_DECLARATION: "declaration",
  EVENT_DECLARATION_ROAD: "declaration",
  GROUP_RUN_DECLARATION_ASPHALT: "declaration",
  GROUP_RUN_DECLARATION_TRAIL: "declaration",
};

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
 * ## One card per text (§539, amending §532)
 *
 * The list was one long table of every version of every text, and the owner could not see at a
 * glance which text is in force, which draft waits, or where «regenerate» lives. So the page is
 * one card per text, in `LEGAL_DOCUMENT_KEYS`' fixed order: the card's header says the state in
 * words (`kindHeadline`), carries «Regenerează din șablon» for that text alone — the same
 * `regenerateFromTemplates` §532's press calls, with one key — and folds the text's versions,
 * newest first, beneath it. A fold opens on arrival only when a draft waits or nothing is in force
 * (§336 `attention`), or when a filter keeps rows in it (`inUse`).
 *
 * The chips above the cards filter by state and by text through the address (§413's shape): plain
 * links, so it works without JavaScript, and the address says what the page shows. The old
 * withdrawn fold's `?withdrawn=1` still means «Retrase».
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
 * Where neither is possible the row says why, from the service's own verdict (`deletionObstacle`)
 * — the three counts, then "in force right now" — and it says it about both verbs at once,
 * because the condition is the same condition. Where only deletion is refused — a terms version
 * somebody registered or signed a declaration under while it was in force (§316) — the withdraw
 * button stays and the link gives way to the reason, with the count and the dates. A missing button
 * explains nothing; a count is a reason an organizer accepts. The server refuses regardless
 * (BR-REQ-060-01) — this only changes what the screen is able to explain before anything is
 * pressed.
 *
 * Administrator only, asserted here on the server — the same rule the staff screen carries,
 * because a legal document is exactly the kind of thing that must not be editable by whoever
 * happens to be signed in.
 */
export default async function LegalDocumentsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  /*
    Reading what the club published is not writing it (§208). The Organizer must be able to see
    the texts in force — "organizatorul îi zice administratorului să modifice X, Y lucru" cannot be said about a
    document he cannot read. Writing, approving, withdrawing and deleting each assert their own
    role below and again in the service (§46, §181, §203).
  */
  const actor = await requireStaff();
  if (!canReadContent(actor.role)) notFound();
  // Creating a version is an Administrator's act since §450 (BR-REQ-053-02); an Organizer and a
  // Redactor read. Offered here rather than only from an existing version's page, because an
  // environment with no version yet — production, by design — has no such page to start from,
  // and the create route was reachable by typing its address and no other way (found on
  // production, 2026-09-17: "I still can't create documents").
  const mayCreate = canWriteLegalTexts(actor.role);
  /*
    Deleting a version outright is the same gate as writing one (`canWriteLegalTexts`), because
    the role that publishes the club's word is the role that unpublishes it (§151).

    The link is hidden from a reader rather than the row saying nothing: the sentence below it —
    what deletion would mean — is shown to everybody who can read this screen, so a reader learns
    that the version *can* go and who can do it, instead of finding a control that answers 404.
    The page and the service refuse regardless (BR-REQ-060-01).
  */
  const mayDestroy = canWriteLegalTexts(actor.role);

  const current = await searchParams;
  const { saved, error } = current;
  const filter = parseLegalListFilter(current);

  const t = await getTranslations("Admin");
  const words = await confirmWords();
  /*
    Every row, and the two lists the page draws from it (§567): the versions — everything but a
    version deleted from the list — and «Versiuni șterse», read-only. A deleted version is never
    listed, filtered, counted or offered anything; it stays among `allVersions` only where the rows
    are read as history (a terms version's time in force was shortened by it while it was in force).
    It is withdrawn as well, so every other reader skips it as it skips any withdrawn version.
  */
  const allVersions = await listVersionsForBackoffice(getDb());
  const versions = allVersions.filter((version) => version.deletedAt === null);
  const deletedVersions = allVersions.filter((version) => version.deletedAt !== null);
  // The one press (§132): offered while any text it covers (`PLATFORM_APPROVAL_KEYS`, §515) has no approved version, with the
  // facts it would write shown first — a wrong CIF is seen here, not on the public notice.
  // The contact address as the club chose to show it (§442).
  const facts = clubFactsFromEnv(env, await shownContactAddresses(getDb()));
  const now = new Date();
  const missingKeys = (
    await Promise.all(
      PLATFORM_APPROVAL_KEYS.map(async (key) =>
        (await findCurrentApprovedDocument(getDb(), key, "ro", now)) ? null : key,
      ),
    )
  ).filter((key) => key !== null);
  /*
    §396: the public list shows each runner's stage, and the pending and waiting groups, only
    while the notice in force names `{{participantListStates}}`. Said here, where the text that
    would switch it on is approved, only while a notice is in force and does not — with none at
    all, the "one step" box above is the thing to do, and registration is closed anyway.
  */
  const listStatesMissing = !missingKeys.includes("PRIVACY_NOTICE") && !(await noticeDescribesListStates(getDb(), now));
  // The same for the socials beside a name (§500): the form offers the tick only while the notice
  // in force names `{{participantListSocials}}`, and this is where that notice is approved.
  const listSocialsMissing = !missingKeys.includes("PRIVACY_NOTICE") && !(await noticeDescribesListSocials(getDb(), now));
  // The same for the offers and benefits (§562): no form offers the box, and nothing is kept,
  // until the notice in force names `{{promotionalMaterials}}`.
  const promoMissing = !missingKeys.includes("PRIVACY_NOTICE") && !(await noticeDescribesPromotionalMaterials(getDb(), now));
  // §570: the list for sponsors, off until the notice in force names `{{promotionalMaterialsShared}}`.
  const sponsorMissing = !missingKeys.includes("PRIVACY_NOTICE") && !(await noticeDescribesPromotionalMaterialsShared(getDb(), now));
  /*
    What the service would answer about each row, asked of the service before anything is drawn
    (§290, §316): `readDeletionFacts` and `deletionObstacle` are exactly what `assertDeletable`
    asks before it destroys anything. The row's link, its sentence and its "Folosit" cell all read
    from this, so the list cannot offer a press the server will refuse.

    It used to carry its own copy — the three counts, then "in force right now" — and the copy
    was one rule short: a terms version that had been in force read "Nefolosit încă" with a
    "Șterge definitiv" link, and the page behind the link refused. The owner, the third time:
    "Still can't delete these docs...".

    It includes which rows the site is serving right now — the one reason a withdrawal is refused
    that no count on the row can show. A privacy notice with zero signatures is not unused; it is
    the notice of a quiet week, and withdrawing it would close registration (BR-REQ-053-01).

    Every row in one call, so the in-force question is asked once per document rather than once
    per row; the only per-row cost is the count for each terms version that was ever in force.
  */
  const allFacts = await readDeletionFacts(getDb(), versions, allVersions, now);
  const factsById = new Map<string, DeletionFacts>(
    versions.map((version, index) => [version.id, allFacts[index]]),
  );
  const factsOf = (version: LegalDocumentVersionRow): DeletionFacts => {
    const facts = factsById.get(version.id);
    if (!facts) throw new Error(`no deletion facts were read for version ${version.id}`);
    return facts;
  };
  // "joi, 4 sept. 2026 – dum., 20 sept. 2026": the stretch a terms version was the text in
  // force, inside the sentence (§349).
  const span = (window: InForceWindow) =>
    formatDayRange(window.from, window.until ?? now, { locale, timeZone: CLUB_TIME_ZONE, style: "short", position: "inline" });
  const missingFacts = (
    [
      ["CLUB_LEGAL_NAME", facts.legalName],
      ["CLUB_REGISTRATION_NUMBER", facts.registrationNumber],
      ["CLUB_REGISTERED_ADDRESS", facts.registeredAddress],
      // Not only the variable since §442: «Adresa de contact afișată» on /admin/emails decides it.
      [t("legal.platform.contactFactMissing"), facts.contactEmail],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  /*
    Each text as its card says it (§539): what is in force, which draft waits, what «Regenerează
    din șablon» would do with it and the number its draft would get — one read for the cards and
    for §532's box beside them, so the box, the cards and their confirm dialogs name the same
    texts. The in-force ids come with it, for the rows' states and the filter.
  */
  const overview = await readLegalOverview(getDb(), facts, now, versions);
  const inForceIds = Object.fromEntries(LEGAL_DOCUMENT_KEYS.map((key) => [key, overview[key].inForceId]));
  const stateOf = (version: LegalDocumentVersionRow): LegalVersionState => versionState(version, inForceIds[version.key]);
  /*
    The presses over every text at once (§532), asked of the service's own plans so the box, its
    confirm dialog and the press name the same versions: which templates now say something no
    version in force or waiting says, and which drafts one press may approve. Read only for the
    role that may press them.
  */
  const toRegenerate = mayCreate
    ? LEGAL_DOCUMENT_KEYS.filter((key) => overview[key].regeneration === "create").map((key) => ({ key, hasPlaceholders: overview[key].hasPlaceholders }))
    : [];
  const regeneratedWithBlanks = toRegenerate.filter((item) => item.hasPlaceholders);
  const draftPlan = mayCreate ? await planDraftApproval(getDb()) : [];
  const readyDrafts = draftPlan.filter((item) => item.outcome === "ready").map((item) => item.row);
  const heldDrafts = draftPlan.filter((item) => item.outcome !== "ready");
  const phraseOf = (row: LegalDocumentVersionRow) => confirmationPhrase(row.key, row.version);
  const keyNames = (keys: readonly LegalDocumentVersionRow["key"][]) => keys.map((key) => t(`legal.keys.${key}`)).join(", ");

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
  // The three counts in words, «1 semnătură · 0 evenimente · 0 înscrieri» (§567, `countForm`).
  const relianceWords = (version: LegalDocumentVersionRow) => reliancePhrases((key, values) => t(key, values), relianceOf(version), locale);

  // What the filter keeps, and how many of how many: «4 versiuni din 11».
  const shown = filterLegalVersions(versions, inForceIds, filter);
  const listHref = (next: LegalListFilter) => getPathname({ locale, href: { pathname: "/admin/legal", query: legalListQuery(next) } });
  const kindsShown = LEGAL_DOCUMENT_KEYS.filter(
    (key) => (filter.kind === null || filter.kind === key) && (!isNarrowing(filter) || shown.some((row) => row.key === key)),
  );

  const stateChip = (state: LegalVersionState) => {
    // Outlined rather than filled for the two that are no longer the club's word, so «Retrasă»
    // and «Înlocuită» cannot be mistaken for «Ciornă» at a glance.
    if (state === "inForce") return <Chip size="small" color="success" label={t("legal.stateLabel.inForce")} />;
    if (state === "draft") return <Chip size="small" label={t("legal.draft")} />;
    if (state === "superseded") return <Chip size="small" variant="outlined" label={t("legal.stateLabel.superseded")} />;
    return <Chip size="small" variant="outlined" label={t("legal.withdrawn")} />;
  };

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
      render: (version) => stateChip(stateOf(version)),
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
        /*
          A terms version is used by whoever submitted a registration, or signed a
          declaration, while it was in force, and that is the figure it gets. "Nefolosit
          încă" was never true of one: the three counts are vacuous for this key, because a
          registration records no terms version (§203).
        */
        const terms = factsOf(version).terms;
        if (terms) {
          return terms.window.until
            ? t("legal.termsRegistrations", { count: terms.registrations })
            : t("legal.termsRegistrationsSoFar", { count: terms.registrations });
        }
        const reliance = relianceOf(version);
        return isReliedOn({
          acceptances: reliance.signatures,
          events: reliance.events,
          privacyAcknowledgements: reliance.acknowledgements,
        })
          ? t("legal.referencedFull", relianceWords(version))
          : t("legal.unreferenced");
      },
    },
    {
      key: "effectiveAt",
      label: t("legal.effectiveAt"),
      hideBelow: "lg",
      // The version line's date, as the public pages say it: no weekday, the month in words (§534).
      render: (version) => formatDateInWords(version.effectiveAt, { locale, timeZone: CLUB_TIME_ZONE }),
    },
  ];

  /*
    A tick for every row the batch delete would take (§532) — a draft nothing relied on, an
    approved version with no obstacle — from the same verdict the row's own link reads, so no row
    offers a tick the service would refuse. `form` on the `<input>` itself, never on the Checkbox
    (it lands on the wrapping span there and the form posts nothing, §114).
  */
  const tickOf = (version: LegalDocumentVersionRow) => {
    if (!mayDestroy) return null;
    const deletable = version.isApproved
      ? deletionObstacle(factsOf(version)) === null
      : !isReliedOn({
          acceptances: version.acceptanceCount,
          events: version.eventCount,
          privacyAcknowledgements: version.privacyAcknowledgementCount,
        });
    if (!deletable) return null;
    return (
      <Checkbox
        name="id"
        value={version.id}
        slotProps={{
          input: {
            form: BATCH_DELETE_FORM,
            "aria-label": t("legal.batch.tick", { version: confirmationPhrase(version.key, version.version) }),
          },
        }}
        sx={CHECKBOX_TAP_TARGET}
        data-testid="legal-batch-tick"
      />
    );
  };

  const verbsOf = (version: LegalDocumentVersionRow) => {
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

      The obstacle is the service's own (`deletionObstacle`), so the sentence the row
      gives and the refusal the server would give name the same thing. The first two
      stop both verbs, because withdrawal asks the same question (`dependantObstacle`).
    */
    const withdrawForm = (
      <ActionForm
        action={withdrawLegalVersionAction}
        confirm={{ title: t("legal.withdrawTitle"), body: t("legal.withdrawBody"), confirmLabel: t("legal.withdraw"), cancelLabel: words.cancel, destructive: true }}
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="versionId" value={version.id} />
        {/*
          Warning rather than error, and the word is "retrage" rather than "șterge", because
          this button does not destroy anything — saying otherwise in the one place somebody
          reads before pressing would be the wrong kind of honest.
        */}
        <GlyphButton icon="unpublish" type="submit" size="small" variant="outlined" color="warning" sx={{ minHeight: 44 }}>
          {t("legal.withdraw")}
        </GlyphButton>
      </ActionForm>
    );

    if (version.isApproved) {
      // What «Șterge» would do with it (§567): the service's own rule, so the row and the server agree.
      const plan = removalPlan(factsOf(version));
      if (plan.kind === "refused") return reason(t("legal.removeBlockedCurrent"));

      /*
        Somebody relied on it (§567, the owner, 2026-09-29: «aș vrea să pot șterge (cu dublă
        confirmare) chiar și documentele care sunt deja semnate»): «Șterge» takes it off the list
        and keeps its text, in two steps on its own screen. Withdrawal stays refused while a count
        stands on it (§46); a terms version agreed to only inside its window keeps its withdraw
        button (§316). The sentence says what stands on it, in words: «1 semnătură».
      */
      if (plan.kind === "retire") {
        const terms = factsOf(version).terms;
        return (
          <Stack spacing={0.75} sx={{ alignItems: "flex-end" }}>
            {mayDestroy && !relied && !version.withdrawnAt && withdrawForm}
            {mayDestroy && (
              <GlyphButtonLink
                href={{ pathname: "/admin/legal/[id]/delete", params: { id: version.id } }}
                icon="delete"
                variant="outlined"
                color="error"
                size="small"
                sx={{ minHeight: 44 }}
                data-testid="legal-retire-link"
              >
                {t("legal.deleteAction")}
              </GlyphButtonLink>
            )}
            {reason(
              relied || !terms
                ? t("legal.retireOffered", relianceWords(version))
                : t("legal.retireTermsOffered", { count: terms.registrations, window: span(terms.window) }),
            )}
          </Stack>
        );
      }

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

        A terms version somebody registered or signed under keeps its withdraw button
        and loses the link: withdrawal keeps the words, so it is still open to it, and
        deletion would destroy text somebody may have accepted — the row says that, with
        the count and the dates, instead of a link to a page that would refuse (§316).
      */
      return (
        <Stack spacing={0.75} sx={{ alignItems: "flex-end" }}>
          {version.withdrawnAt ? (
            reason(
              t("legal.withdrawnOn", {
                date: formatDay(version.withdrawnAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", position: "inline" }),
              }),
            )
          ) : !mayDestroy ? (
            // Withdrawing is the Administrator's, like deleting beside it (§222, §450): the
            // service asserts it, so a reader is shown no button — and the sentence
            // below already says what deleting would mean, once.
            null
          ) : (
            withdrawForm
          )}
          {mayDestroy && (
            <Link
              href={{
                pathname: "/admin/legal/[id]/delete",
                params: { id: version.id },
              }}
            >
              {t("legal.deletePermanently")}
            </Link>
          )}
          {reason(t("legal.deleteMeans", { version: version.version }))}
        </Stack>
      );
    }

    if (relied) return reason(t("legal.deleteBlockedReferenced", relianceWords(version)));

    // A draft nothing relied on can go, and only by the role the service lets (§222).
    if (!mayDestroy) return reason(t("legal.deleteMeans", { version: version.version }));

    return (
      <ActionForm
        action={deleteLegalVersionAction}
        confirm={{ title: t("legal.deleteTitle"), body: t("legal.deleteBody"), confirmLabel: t("legal.delete"), cancelLabel: words.cancel, destructive: true }}
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="versionId" value={version.id} />
        <GlyphButton icon="delete" type="submit" size="small" variant="outlined" color="error" sx={{ minHeight: 44 }}>
          {t("legal.delete")}
        </GlyphButton>
      </ActionForm>
    );
  };

  const tableLabels = (count: number) => ({
    results: t("list.results", { count }),
    page: t("list.page", { page: query.page, pages: pageCount(count, query.perPage) }),
    previous: t("list.previous"),
    next: t("list.next"),
    perPage: t("list.perPage"),
    actions: t("list.actions"),
    sortBy: (column: string) => t("list.sortBy", { column }),
  });

  /*
    One text's card (§539): its name and what it is, the state in words, «Regenerează din șablon»
    for this text alone, and its versions folded under it, newest first.
  */
  const kindCard = (key: LegalDocumentKey) => {
    const kind = overview[key];
    const rows = versionsOfKind(shown, key);
    // Shown whatever the filter: a deleted version is in no state the chips name (§567).
    const deletedOfKind = filter.kind === null || filter.kind === key ? versionsOfKind(deletedVersions, key) : [];
    const kindName = t(`legal.keys.${key}`);
    const headline = kindHeadline(kind.summary)
      .map((line) =>
        line.key === "inForce"
          ? t("legal.kinds.inForce", {
              version: line.version,
              date: formatDateInWords(line.effectiveAt, { locale, timeZone: CLUB_TIME_ZONE }),
            })
          : line.key === "draftWaiting"
            ? t("legal.kinds.draftWaiting", { version: line.version })
            : t("legal.kinds.noneInForce"),
      );
    return (
      <Panel
        key={key}
        glyph={KIND_GLYPH[key]}
        level={3}
        id={`legal-kind-${key}`}
        data-testid={`legal-kind-${key}`}
        title={kindName}
        intro={t(`legal.whatIs.${key}`)}
        tone={kind.summary.waitingDraft || !kind.summary.inForce ? "risk" : "default"}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", columnGap: 1, rowGap: 0.5 }}>
            {headline.map((sentence, index) => (
              <Typography key={sentence} variant="body2" sx={{ fontWeight: index === 0 ? 600 : 400 }} data-testid="legal-kind-state">
                {sentence}
              </Typography>
            ))}
            {kind.templateNewer && <Chip size="small" color="warning" variant="outlined" label={t("legal.kinds.templateNew")} title={t("legal.kinds.templateNewHint")} />}
          </Stack>

          {mayCreate &&
            (kind.regeneration === "create" ? (
              <ActionForm
                action={regenerateLegalTemplatesAction}
                confirm={{
                  title: t("legal.kinds.regenerateTitle", { kind: kindName }),
                  body: t("legal.kinds.regenerateBody", { kind: kindName, version: kind.nextVersion }),
                  confirmLabel: t("legal.kinds.regenerate"),
                  cancelLabel: words.cancel,
                }}
                data-testid="legal-kind-regenerate"
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="key" value={key} />
                <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
                  <GlyphSubmitButton
                    label={t("legal.kinds.regenerate")}
                    pendingLabel={t("legal.kinds.regeneratePending")}
                    icon="template"
                    variant="outlined"
                    size="medium"
                  />
                  {kind.hasPlaceholders && (
                    <Typography variant="body2" color="warning.main">
                      {t("legal.kinds.blanks")}
                    </Typography>
                  )}
                </Stack>
              </ActionForm>
            ) : (
              <Typography variant="body2" color="text.secondary" data-testid="legal-kind-regenerate-none">
                {t(`legal.kinds.${kind.regeneration}`)}
              </Typography>
            ))}

          <Panel
            glyph="history"
            level={4}
            collapsible
            id={`legal-versions-${key}`}
            data-testid={`legal-versions-${key}`}
            title={t("legal.kinds.versions")}
            aside={t(`legal.kinds.versionsCount.${countForm(rows.length, locale)}`, { count: rows.length })}
            openWhen={kindFoldOpens(kind.summary, filter, rows.length)}
          >
            <AdminTable
              caption={t("legal.tableCaptionOf", { kind: kindName })}
              columns={columns}
              rows={rows}
              rowKey={(version) => version.id}
              basePath={getPathname({ locale, href: "/admin/legal" })}
              // So paging and the page-size control keep the filter.
              currentParams={legalListQuery(filter)}
              query={query}
              total={rows.length}
              labels={tableLabels(rows.length)}
              empty={<Typography variant="body2" color="text.secondary">{t("legal.kinds.empty")}</Typography>}
              rowActions={(version) => (
                <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end", alignItems: "center" }}>
                  {verbsOf(version)}
                  {tickOf(version)}
                </Stack>
              )}
            />
          </Panel>

          {/*
            «Versiuni șterse» (§567): the versions of this text taken off the list, their text kept
            because somebody relied on it. Closed, read-only, and nothing is restored from here: a
            deleted version must never come back into force by accident, and the same words again
            are a new version («Versiune nouă» from its page), approved like any other.
          */}
          {deletedOfKind.length > 0 && (
            <Panel
              glyph="deletedVersions"
              level={4}
              collapsible
              id={`legal-deleted-${key}`}
              data-testid={`legal-deleted-${key}`}
              title={t("legal.deletedFold.title")}
              aside={t(`legal.deletedFold.count.${countForm(deletedOfKind.length, locale)}`, { count: deletedOfKind.length })}
              intro={t("legal.deletedFold.intro")}
            >
              <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
                {deletedOfKind.map((version) => (
                  <Box component="li" key={version.id} sx={{ py: 1, borderTop: 1, borderColor: "divider" }} data-testid="legal-deleted-row">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {t("legal.deletedFold.row", {
                        version: version.version,
                        date: formatDay(version.deletedAt ?? now, { locale, timeZone: CLUB_TIME_ZONE, style: "short", position: "inline" }),
                        who: version.deletedByName ?? t("legal.deletedFold.whoGone"),
                      })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t("legal.deletedFold.reason", { reason: version.deletedReason ?? "—" })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t("legal.referencedFull", relianceWords(version))}
                    </Typography>
                    <GlyphButtonLink
                      href={{ pathname: "/admin/legal/[id]", params: { id: version.id } }}
                      icon="preview"
                      size="small"
                      sx={{ minHeight: 44, px: 0 }}
                    >
                      {t("legal.deletedFold.read")}
                    </GlyphButtonLink>
                  </Box>
                ))}
              </Box>
            </Panel>
          )}
        </Stack>
      </Panel>
    );
  };

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
        {saved === "legalVersionRetired" && (
          <Alert severity="success">{t("legal.legalVersionRetired", { phrase: current.phrase ?? "" })}</Alert>
        )}
        {saved === "legalVersionErased" && (
          <Alert severity="success">
            {t("legal.legalVersionErased", { phrase: current.phrase ?? "" })}
          </Alert>
        )}
        {saved === "platformApproved" && (
          <Alert severity="success">{t("legal.platformApproved", { count: Number(current.approved ?? "0") })}</Alert>
        )}
        {saved === "legalTemplatesRegenerated" && (
          <Alert severity="success">{t("legal.batch.regenerated", { count: Number(current.created ?? "0") })}</Alert>
        )}
        {saved === "legalDraftsApproved" && (
          <Alert severity="success">{t("legal.batch.draftsApproved", { count: Number(current.approved ?? "0") })}</Alert>
        )}
        {saved === "legalVersionsDeleted" && (
          <Alert severity="success">{t("legal.batch.deleted", { count: Number(current.deleted ?? "0") })}</Alert>
        )}
        {saved &&
          saved !== "legalVersionDeleted" &&
          saved !== "legalVersionWithdrawn" &&
          saved !== "legalVersionErased" &&
          saved !== "legalVersionRetired" &&
          saved !== "legalTemplatesRegenerated" &&
          saved !== "legalDraftsApproved" &&
          saved !== "legalVersionsDeleted" &&
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
            <ActionForm
              action={approvePlatformTemplatesAction}
              confirm={{
                title: t("confirm.approvePlatformTitle", { count: missingKeys.length, total: PLATFORM_APPROVAL_KEYS.length }),
                // The dialog names each text the press approves, as the box above does.
                body: t("confirm.approvePlatformBody", { texts: missingKeys.map((key) => t(`legal.keys.${key}`)).join(", ") }),
                confirmLabel: t("legal.platform.button", { count: missingKeys.length, total: PLATFORM_APPROVAL_KEYS.length }),
                cancelLabel: words.cancel,
                destructive: true,
              }}
              data-testid="approve-platform-form"
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <Stack spacing={1}>
                <Typography variant="body2">{t("legal.platform.consequence")}</Typography>
                <Box>
                  <GlyphSubmitButton label={t("legal.platform.button", { count: missingKeys.length, total: PLATFORM_APPROVAL_KEYS.length })} pendingLabel={t("legal.platform.pending")} icon="approve" variant="contained" size="medium" />
                </Box>
              </Stack>
            </ActionForm>
          )}
        </Box>
      )}

      <Stack spacing={1}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("legal.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("legal.intro", { count: PLATFORM_APPROVAL_KEYS.length })}
        </Typography>
        {/* The three steps, in the owner's words, as the page's one help line (§398's help variant, §539). */}
        <Panel variant="help" legendIcon="info" title={t("legal.steps.title")} intro={t("legal.steps.body")} data-testid="legal-steps" />
      </Stack>

      {listStatesMissing && (
        <Alert severity="info" data-testid="legal-list-states-missing">
          {t("legal.listStatesMissing")}
        </Alert>
      )}
      {listSocialsMissing && (
        <Alert severity="info" data-testid="legal-list-socials-missing">
          {t("legal.listSocialsMissing")}
        </Alert>
      )}
      {promoMissing && (
        <Alert severity="info" data-testid="legal-promo-missing">
          {t("legal.promoMissing")}
        </Alert>
      )}
      {sponsorMissing && (
        <Alert severity="info" data-testid="legal-sponsor-missing">
          {t("legal.sponsorMissing")}
        </Alert>
      )}

      {/*
        The rule this section lives by, folded shut by default (§336) — it explains, it does not
        warn, so nothing opens it by itself. Shown only here, below the page's own heading and
        alerts rather than above them (only this page has a use for it; §336 review).
      */}
      <Box sx={{ mb: 1 }}>
        <Panel glyph="legal" id="legal-versions" title={t("legalNotice.title")} collapsible>
          <Typography variant="body2" color="text.secondary">
            {t("legalNotice.body")}
          </Typography>
        </Panel>
      </Box>

      {mayCreate && (
        <Box>
          {/* «Versiune nouă» opens the templates, grouped, each with its state (§539). */}
          <GlyphButtonLink href="/admin/legal/new" icon="add" variant="contained" sx={{ minHeight: 44 }}>
            {t("legal.newTitle")}
          </GlyphButtonLink>
        </Box>
      )}

      {/*
        Every text at once (§532): drafts from the platform's current templates, then the drafts
        approved in one press. Two presses on purpose — nothing reaches the site from a template
        without the club reading the draft first (§46) — each behind the §384 confirm dialog that
        names the texts. What cannot be approved together is said with its reason, never hidden.
        One text alone is its card's own «Regenerează din șablon» below (§539).
      */}
      {mayCreate && (
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }} data-testid="legal-batch-tools">
          <Typography variant="h3" sx={{ fontSize: "1.05rem", mb: 1 }}>
            {t("legal.batch.toolsTitle")}
          </Typography>
          <Stack spacing={2}>
            {toRegenerate.length > 0 ? (
              <ActionForm
                action={regenerateLegalTemplatesAction}
                confirm={{
                  title: t("legal.batch.regenerateTitle", { count: toRegenerate.length }),
                  body: t("legal.batch.regenerateBody", { texts: keyNames(toRegenerate.map((item) => item.key)) }),
                  confirmLabel: t("legal.batch.regenerate", { count: toRegenerate.length, total: LEGAL_DOCUMENT_KEYS.length }),
                  cancelLabel: words.cancel,
                }}
                data-testid="legal-regenerate-form"
              >
                <input type="hidden" name="uiLocale" value={locale} />
                {toRegenerate.map((item) => (
                  <input key={item.key} type="hidden" name="key" value={item.key} />
                ))}
                <Stack spacing={1}>
                  <Typography variant="body2">
                    {t("legal.batch.regenerateIntro", { texts: keyNames(toRegenerate.map((item) => item.key)) })}
                  </Typography>
                  {/* «4 din 6» read as a bug (the owner, 2026-09-29): the rule, said once (§555, amending §539). */}
                  <Typography variant="body2" color="text.secondary" data-testid="legal-regenerate-rule">
                    {t("legal.batch.regenerateRule")}
                  </Typography>
                  {regeneratedWithBlanks.length > 0 && (
                    <Typography variant="body2" color="warning.main">
                      {t("legal.batch.regenerateBlanks", { texts: keyNames(regeneratedWithBlanks.map((item) => item.key)) })}
                    </Typography>
                  )}
                  <Box>
                    <GlyphSubmitButton
                      // The count out of every text (§555): «4 din 6», so the 4 reads as a choice, not a loss.
                      label={t("legal.batch.regenerate", { count: toRegenerate.length, total: LEGAL_DOCUMENT_KEYS.length })}
                      pendingLabel={t("legal.batch.regeneratePending")}
                      icon="template"
                      variant="outlined"
                      size="medium"
                    />
                  </Box>
                </Stack>
              </ActionForm>
            ) : (
              <Typography variant="body2" color="text.secondary" data-testid="legal-regenerate-uptodate">
                {t("legal.batch.upToDate")}
              </Typography>
            )}

            {readyDrafts.length > 0 && (
              <ActionForm
                action={approveLegalDraftsAction}
                confirm={{
                  title: t("legal.batch.approveTitle", { count: readyDrafts.length }),
                  body: t("legal.batch.approveBody", { versions: readyDrafts.map(phraseOf).join(", ") }),
                  confirmLabel: t("legal.batch.approve", { count: readyDrafts.length }),
                  cancelLabel: words.cancel,
                  destructive: true,
                }}
                data-testid="legal-approve-drafts-form"
              >
                <input type="hidden" name="uiLocale" value={locale} />
                {readyDrafts.map((row) => (
                  <input key={row.id} type="hidden" name="versionId" value={row.id} />
                ))}
                <Stack spacing={1}>
                  <Typography variant="body2">
                    {t("legal.batch.approveIntro", { versions: readyDrafts.map(phraseOf).join(", ") })}
                  </Typography>
                  <Box>
                    <GlyphSubmitButton
                      label={t("legal.batch.approve", { count: readyDrafts.length })}
                      pendingLabel={t("legal.batch.approvePending")}
                      icon="approve"
                      variant="contained"
                      size="medium"
                    />
                  </Box>
                </Stack>
              </ActionForm>
            )}
            {heldDrafts.length > 0 && (
              <Box data-testid="legal-drafts-held">
                <Typography variant="body2" color="text.secondary">
                  {t("legal.batch.heldIntro")}
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 3 }}>
                  {heldDrafts.map((item) => (
                    <Typography component="li" variant="body2" color="text.secondary" key={item.row.id}>
                      {phraseOf(item.row)} — {t(`legal.batch.held.${item.outcome}`)}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}

            {/*
              The rows' ticks belong to this form (`form=` on each checkbox, §114's lesson): a GET
              to the batch screen, which lists what goes and what cannot, and asks the phrase and
              the reason when an approved version is among them. Without JavaScript as well.
            */}
            {mayDestroy && (
              <Box
                component="form"
                id={BATCH_DELETE_FORM}
                method="get"
                action={getPathname({ locale, href: "/admin/legal/delete" })}
              >
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t("legal.batch.deleteIntro")}
                </Typography>
                <GlyphSubmitButton
                  label={t("legal.batch.deleteTicked")}
                  pendingLabel={t("legal.batch.deleteTicked")}
                  icon="delete"
                  variant="outlined"
                  color="error"
                  size="medium"
                />
              </Box>
            )}
          </Stack>
        </Box>
      )}

      {versions.length === 0 && (
        <Alert severity="warning">{mayCreate ? t("legal.emptyCanCreate") : t("legal.empty")}</Alert>
      )}

      {/*
        The filter (§539, §413's shape): by state and by text, as plain links, so it works with
        JavaScript off and the address says what the page shows — a filtered page can be sent to
        somebody. The count line says how much of the whole it keeps.
      */}
      {versions.length > 0 && (
        <Box component="nav" aria-label={t("legal.filter.label")} data-testid="legal-filter">
          <Stack spacing={0.5}>
            <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", columnGap: 1 }}>
              <Typography component="span" variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
                {t("legal.filter.statesLabel")}
              </Typography>
              {LEGAL_STATE_FILTERS.map((state) => (
                <ChipLink
                  key={state}
                  href={listHref({ ...filter, state })}
                  label={t(`legal.filter.states.${state}`)}
                  active={filter.state === state}
                  current={filter.state === state ? "page" : undefined}
                  keepScroll
                />
              ))}
            </Stack>
            <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", columnGap: 1 }}>
              <Typography component="span" variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
                {t("legal.filter.kindsLabel")}
              </Typography>
              <ChipLink
                href={listHref({ ...filter, kind: null })}
                label={t("legal.filter.allKinds")}
                active={filter.kind === null}
                current={filter.kind === null ? "page" : undefined}
                keepScroll
              />
              {LEGAL_DOCUMENT_KEYS.map((key) => (
                <ChipLink
                  key={key}
                  href={listHref({ ...filter, kind: key })}
                  label={t(`legal.shortKeys.${key}`)}
                  active={filter.kind === key}
                  current={filter.kind === key ? "page" : undefined}
                  keepScroll
                />
              ))}
            </Stack>
            <Typography variant="body2" color="text.secondary" data-testid="legal-filter-count">
              {t(`legal.filter.count.${countForm(shown.length, locale)}`, { count: shown.length, total: versions.length })}
            </Typography>
          </Stack>
        </Box>
      )}

      {versions.length > 0 && kindsShown.length === 0 ? (
        <Alert severity="info" data-testid="legal-filter-none">
          {t("legal.filter.none")} <Link href={{ pathname: "/admin/legal" }}>{t("legal.filter.clear")}</Link>
        </Alert>
      ) : (
        <Stack spacing={2}>{kindsShown.map(kindCard)}</Stack>
      )}
    </Stack>
  );
}
