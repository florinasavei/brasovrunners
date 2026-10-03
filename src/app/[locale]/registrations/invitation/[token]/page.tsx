import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { datedOrNull } from "@/modules/events/domain/dated";
import { ALREADY_ON_ADDRESS, ADDRESS_AT_CAP } from "@/modules/registrations/domain/family";
import { UNDER_MINIMUM_AGE } from "@/modules/registrations/fields";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { ERROR_SUMMARY_ID, parseInvalidFields } from "@/modules/registrations/form-errors";
import { readFormDraft } from "@/modules/registrations/form-draft";
import { fieldId, formViewOf } from "@/modules/registrations/form-view";
import { type InvitationLink, isRefusedKind, readInvitationLink, type RefusedKind } from "@/modules/registrations/invitations";
import { registrationFacts, registrationForm } from "@/modules/registrations/ui/registration-form";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import { spamHintWords } from "@/modules/registrations/ui/link-wait-words";
import { cachedListSocialsDisclosed, cachedListStatesDisclosed, cachedPromotionalMaterialsOffered, cachedPromotionalMaterialsShared, cachedRefusalDisclosed } from "@/modules/public-cache/reads";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { acceptInvitationAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; error?: string; fields?: string; refused?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Each refused link's sentence under `invitation.*`: a sent form and a spent token read the same. */
const INVITATION_SENTENCE_KEYS: Record<RefusedKind, "used" | "withdrawn" | "expired" | "cancelled" | "replaced" | "invalid"> = {
  accepted: "used",
  used: "used",
  withdrawn: "withdrawn",
  expired: "expired",
  cancelled: "cancelled",
  replaced: "replaced",
  invalid: "invalid",
};

/**
 * A personal invitation's link (§NNN; `EVENT_INVITATION`). The GET reads the link and changes nothing —
 * a mail scanner opening it leaves it working (§12.8) — and draws the event's registration form,
 * prefilled with the invited name, the address said back and locked (the invitation's, never one
 * typed), «Sunt membru» ticked when the club picked a member (and set by the press whatever is posted,
 * `invitations.ts#acceptInvitation`), under one line: whose invitation, to
 * which event, until when. Every other field, consent and the declaration stay the person's. Only the
 * POST registers (`acceptInvitationAction`), with no confirmation email: the link proved the inbox.
 *
 * A link that no longer works says why — accepted, withdrawn, past its deadline, the event called off, replaced by a newer
 * email (§619) — with the club's contact page. No family flow: one person per invitation.
 */
export default async function InvitationPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { done, error, fields, refused } = await searchParams;
  const t = await getTranslations("Registration");
  const contactHref = getPathname({ locale, href: "/contact" });
  const contactLink = (
    <MuiLink href={contactHref} sx={{ display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight }}>
      {t("invitation.contact")}
    </MuiLink>
  );
  const shell = (children: ReactNode) => (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {children}
    </Container>
  );

  if (done === "1") {
    return shell(
      <>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("invitation.doneTitle")}
        </Typography>
        <RegistrationJourney current="declare" declaration="emailJustSent" />
        <Stack spacing={2}>
          <Alert severity="success" data-testid="invitation-accepted">
            {t("invitation.done")}
          </Alert>
          <Alert severity="info" data-testid="spam-hint">
            {await spamHintWords()}
          </Alert>
        </Stack>
      </>,
    );
  }

  const now = new Date();
  /*
    A press the link refused (`acceptInvitationAction`'s `refused=<kind>`) is said as the press answered
    it — withdrawn, past its deadline, the event called off — with no second read (and no second attempt
    charged, §39). A marker only, one of the closed list; anything else reads the link.
  */
  const link: InvitationLink | { kind: RefusedKind } = isRefusedKind(refused) ? { kind: refused } : await readInvitationLink(getDb(), token, locale, now);
  if (link.kind !== "open") {
    const titleKey = link.kind === "replaced" ? "replacedTitle" : link.kind === "invalid" ? "invalidTitle" : "endedTitle";
    const sentenceKey = INVITATION_SENTENCE_KEYS[link.kind];
    return shell(
      <>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t(`invitation.${titleKey}`)}
        </Typography>
        <Alert severity={link.kind === "accepted" || link.kind === "used" ? "info" : "warning"} data-testid={`invitation-${link.kind}`}>
          {t(`invitation.${sentenceKey}`)}
        </Alert>
        <Typography variant="body2" sx={{ mt: 2 }}>
          {t("invitation.askClub")} {contactLink}
        </Typography>
      </>,
    );
  }

  // Any published event, the members' own included (§552): the invitation is the door. Dated, as the form needs.
  const found = await findPublishedEventBySlug(getDb(), locale, link.slug, "members");
  const event = found ? datedOrNull(found) : null;
  if (!event || event.id !== link.eventId) notFound();
  const view = formViewOf(event, now);
  const [termsVersion, refusalOn, listStatesOn, listSocialsOn, promoOn, promoShared] = await Promise.all([
    findCurrentApprovedDocument(getDb(), "TERMS", locale, now).then((document) => document?.version ?? null),
    cachedRefusalDisclosed(now),
    view.publishesList ? cachedListStatesDisclosed(now) : Promise.resolve(false),
    view.publishesList ? cachedListSocialsDisclosed(now) : Promise.resolve(false),
    cachedPromotionalMaterialsOffered(now),
    cachedPromotionalMaterialsShared(now),
  ]);

  const markers = (fields ?? "").split(",");
  const rejected = parseInvalidFields(fields);
  const invalid = new Set<string>(rejected);
  const tooYoung = markers.includes(UNDER_MINIMUM_AGE);
  // What was typed before a refusal (§142); else the invitation's name, and «Sunt membru» for a member.
  const words = link.name.split(" ");
  const draft =
    error !== undefined
      ? await readFormDraft()
      : {
          firstName: words.length > 1 ? words.slice(0, -1).join(" ") : link.name,
          lastName: words.length > 1 ? words[words.length - 1] : "",
          ...(link.member ? { clubMemberDeclared: "on", clubName: CLUB_NAME } : {}),
        };
  const deadline = formatDay(link.expiresAt, { locale, timeZone: event.timezone, style: "long", month: "long", withTime: true, position: "inline" });

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {await registrationFacts({ view, locale, slug: link.slug, submitted: false })}
      <Alert severity="success" icon={false} sx={{ mb: 2 }} data-testid="invitation-banner">
        <AlertTitle>{t("invitation.banner", { name: link.name, event: link.eventTitle, deadline })}</AlertTitle>
        <Typography variant="body2">{t("invitation.bannerHelp")}</Typography>
      </Alert>
      <RegistrationJourney current="details" />
      {error && (
        <Alert severity="error" id={ERROR_SUMMARY_ID} role="alert" tabIndex={-1} sx={{ mb: 2 }}>
          <AlertTitle>{t("errors.title")}</AlertTitle>
          {markers.includes("databaseAway") ? (
            t("errors.databaseAway")
          ) : markers.includes(ALREADY_ON_ADDRESS) ? (
            t("invitation.alreadyRegistered")
          ) : markers.includes(ADDRESS_AT_CAP) ? (
            t("invitation.addressAtCap")
          ) : markers.includes("throttled") ? (
            t("errors.throttled")
          ) : rejected.length > 0 ? (
            <>
              {t("errors.fieldsIntro")}
              <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
                {rejected.map((name) => (
                  <li key={name}>
                    <MuiLink href={`#${fieldId(name)}`}>{t(`fieldNames.${name}`)}</MuiLink>
                    {name === "birthDate" && tooYoung && <>: {t("errors.tooYoung", { age: yearsPhrase(view.minAge, locale) })}</>}
                  </li>
                ))}
              </Box>
            </>
          ) : (
            t("errors.generic")
          )}
        </Alert>
      )}
      {await registrationForm({
        view,
        locale,
        slug: link.slug,
        now,
        // No family, no limit per address, no bot check: one person, behind a link only the inbox holds.
        settings: { termsVersion, refusalOn, listStatesOn, listSocialsOn, promoOn, promoShared, capMax: null, familyOpen: false, siteKey: undefined },
        address: { kind: "invitation", email: link.email, token },
        invalid,
        refusal: { tooYoung, emergencySame: markers.includes("emergencySame"), captchaFailed: false, tooFast: false, retry: false },
        draft,
        resting: false,
        fullNotice: null,
        fullCounts: null,
        offerHours: null,
        action: acceptInvitationAction,
      })}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        {t("invitation.notYou")} {contactLink}
      </Typography>
    </Container>
  );
}
