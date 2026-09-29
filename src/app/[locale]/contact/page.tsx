import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { faqOnSite } from "@/modules/content/faq/on-site";
import {
  cachedBotCheckSiteKey,
  cachedContactFormReaches,
  cachedNewsletterOffered,
  cachedPublishedEventBySlug,
  cachedShownContactAddresses,
} from "@/modules/public-cache/reads";
import NewsletterSignup from "@/modules/newsletter/ui/NewsletterSignup";
import {
  newsletterLeaveRefused,
  parseNewsletterFields,
  parseNewsletterLeaveOutcome,
  parseNewsletterOutcome,
} from "@/modules/newsletter/ui/newsletter-box";
import { parseInterestSince } from "@/modules/registrations/interest-box";
import {
  CONTACT_ERROR_SUMMARY_ID,
  CONTACT_MESSAGE_MAX,
  parseContactError,
  parseContactErrorFields,
} from "@/modules/contact/fields";
import { readFormDraft } from "@/modules/registrations/form-draft";
import BotCheck from "@/modules/registrations/ui/BotCheck";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import PublicFlash from "@/shared/feedback/PublicFlash";
import SubmitButton from "@/shared/ui/SubmitButton";
import Wordmark from "@/shared/ui/Wordmark";
import { INLINE_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import { submitContactAction } from "./actions";
import { DENSITY } from "@/theme/density";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string; error?: string; fields?: string; about?: string; newsletter?: string; nfields?: string; nleave?: string; since?: string }>;
};

/**
 * Per request: the page reads the draft cookie and the outcome in the address. Its three reads —
 * the captcha switch, who receives the messages, the event in `?about=` — come from the public
 * cache (§333); sending a message reads the switch and the recipients from the database itself.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Contact" });
  return {
    title: t("title"),
    description: t("intro"),
    /*
      One page per language, whatever `?sent=`, `?error=`, `?fields=` or `?about=` adds (§342):
      each is this same form, before or after a submission, never distinct content.
    */
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/contact")),
  };
}

const fieldId = (name: string) => `c-${name}`;

/**
 * "Scrie-ne" (BR-REQ-070-04, `DECISIONS.md` §149): three boxes, the registration form's bot
 * defences, and a message that lands in the club's own mailbox without touching the outbox.
 *
 * A Server Component with one client island — the submit button, which says the server is
 * working. Every guard is on the server; a rejection is a redirect back here with the field
 * names and the typed values in the draft cookie, the same shape as the registration form.
 *
 * The club's address is shown beside the form as a `mailto:` on every deployment (§449).
 * On a deployment where the form has no way out the page shows the club's address as a
 * `mailto:` instead of a form that would fail — the address from the environment, never the
 * source (§8). "No way out" is two things since §164: no transport (`CONTACT_FORM_MODE=off`,
 * the Gmail account and its app password), or nobody to send to — neither the club's own
 * list on `/admin/emails` nor `CONTACT_FORM_TO` behind it.
 */
export default async function ContactPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { sent, error: rawError, fields, about, newsletter, nfields, nleave, since } = await searchParams;
  const t = await getTranslations("Contact");
  const legal = await getTranslations("Legal");
  const now = new Date();
  // Read once: the widget is drawn only when both keys are set (`turnstile.ts`).
  /*
    Both database reads on this page are tolerant of an outage rather than served from a copy
    (§281). This is the page somebody reaches *because* something else did not work — the
    comment below on the recipients says so — and every word on it that matters is in the
    catalogue, not in the database. Without the captcha's key the widget is not drawn and the
    form still posts; without the event the box simply opens empty.
  */
  const siteKey = await cachedBotCheckSiteKey();

  const error = parseContactError(rawError);
  const rejected = parseContactErrorFields(fields);
  const invalid = new Set<string>(rejected);
  // What they typed before the rejection (§142) — and, after a send, the address alone, so
  // the confirmation can name where the answer goes without the address touching the URL.
  /*
    The newsletter's pop-up (§445): offered only while the privacy notice in force describes it —
    tolerant of an outage like every read on this page, and then simply not offered. A refusal
    comes back with the pop-up open and what was typed in the same sealed draft (its own keys).
  */
  const newsletterOutcome = parseNewsletterOutcome(newsletter);
  const newsletterOffered = (await orNull(() => cachedNewsletterOffered(now))) === true;
  const newsletterRefused = newsletterOutcome === "invalid" || newsletterOutcome === "captcha" || newsletterOutcome === "limited";
  // «Vreau să mă dezabonez» (§550): its own answer, and its typed address in the same sealed draft.
  const leaveOutcome = parseNewsletterLeaveOutcome(nleave);
  const leaveRefused = newsletterLeaveRefused(leaveOutcome);
  const draft = error || sent || newsletterRefused || leaveRefused ? await readFormDraft() : null;
  const typed = (name: string) => (error || sent ? draft?.[name] : undefined);

  // The address the club chose to show (§442): the mailbox, its Gmail, or both, «… sau …».
  const writeTo = await cachedShownContactAddresses();
  // Guarded, because this is the page that has to work when nothing else does: a database
  // that is not answering falls back to `CONTACT_FORM_TO`, never to an error page (§164).
  const formAvailable = await cachedContactFormReaches();
  // A thumb's 44 pixels that do not stretch the sentence's line (§480, the 360-px density pass).
  const inlineLink = INLINE_TAP_TARGET;
  // The first address reaches above its words; a second one («a sau b») may wrap to the line under
  // the first, where that reach would cover the first's lower half and win its press (it is painted
  // later). So a later address takes `TAP_TARGET`'s own shape — 44 tall in its line, the line a
  // little taller — and no two addresses share a pixel.
  const stretchedLink = { display: "inline-flex", alignItems: "center", ...TAP_TARGET } as const;
  const addressLinks = writeTo.map((address, index) => (
    <span key={address}>
      {index > 0 && ` ${t("off.or")} `}
      <MuiLink href={`mailto:${address}`} sx={index === 0 ? inlineLink : stretchedLink}>
        {address}
      </MuiLink>
    </span>
  ));

  /**
   * `?about=<slug>` — somebody sent here from a registration that produced no email (§205).
   *
   * The message box opens with the sentence they would otherwise have to compose while annoyed:
   * which event, and that nothing arrived. They can delete every word of it; what it saves is
   * the blank page, which is where somebody gives up. The slug is matched against the club's own
   * published events rather than printed, because anybody can type one into a URL and this text
   * goes into an email the club reads.
   */
  const aboutEvent = about ? await orNull(() => cachedPublishedEventBySlug(locale, about)) : null;
  // «Poate găsești răspunsul la Întrebări frecvente» (§525), while that page is on the site.
  const showFaq = await faqOnSite(locale);

  const field = (name: "name" | "email" | "message", help?: string) => ({
    id: fieldId(name),
    name,
    error: invalid.has(name),
    helperText: invalid.has(name) ? t("errors.field") : help,
    defaultValue:
      typed(name) ??
      (name === "message" && aboutEvent ? t("prefill.noEmail", { event: aboutEvent.title }) : undefined),
  });

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {/* The kit-face wordmark heads this page as it heads the listing and the calendar — the
          owner, 2026-09-22: "trebuie sa vad acest scris frumos cu Brasov Runners si pe pagina de
          contact si pe cea de calendar" (`DECISIONS.md` §292). A paragraph that is an image to assistive technology, so "Scrie-ne"
          below stays the page's one `<h1>`; a Server Component, so the page still has one
          client island — the button. */}
      <Wordmark />

      <Typography variant="h1" gutterBottom sx={{ mt: 1 }}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }}>
        {t("intro")}
        {showFaq && (
          <>
            {" "}
            {t.rich("faqHint", {
              faq: (chunks) => (
                <MuiLink href={getPathname({ locale, href: "/faq" })} sx={inlineLink} data-testid="contact-faq-link">
                  {chunks}
                </MuiLink>
              ),
            })}
          </>
        )}
      </Typography>

      {sent ? (
        <>
          <Alert severity="success" role="status">
            <AlertTitle>{t("sent.title")}</AlertTitle>
            {typed("email") ? t("sent.bodyTo", { email: typed("email") ?? "" }) : t("sent.body")}
          </Alert>
          {/* The toast the send flashed (§427), here and on no other state of this page. */}
          <PublicFlash accept={["contactSent"]} />
        </>
      ) : !formAvailable ? (
        // No form on this deployment: the club's address, when the club has named one (§8).
        <Typography variant="body1">
          {writeTo.length > 0 ? (
            <>
              {t("off.writeTo")} {addressLinks}
            </>
          ) : (
            t("off.none")
          )}
        </Typography>
      ) : (
        <>
          {/* The redirect's landing: focusable, so a rejection is read rather than hunted for (§47). */}
          {error && (
            <Alert severity="error" id={CONTACT_ERROR_SUMMARY_ID} role="alert" tabIndex={-1} sx={{ mb: 2 }}>
              <AlertTitle>{t("errors.title")}</AlertTitle>
              {error === "VALIDATION_ERROR" && rejected.length > 0 ? (
                <>
                  {t("errors.fieldsIntro")}
                  <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
                    {rejected.map((name) => (
                      <li key={name}>
                        <MuiLink href={`#${fieldId(name)}`}>{t(`fieldNames.${name}`)}</MuiLink>
                      </li>
                    ))}
                  </Box>
                </>
              ) : error === "VALIDATION_ERROR" ? (
                t("errors.generic")
              ) : error === "DELIVERY" && writeTo.length > 0 ? (
                <>
                  {t("errors.DELIVERY")} {addressLinks}
                </>
              ) : error === "DELIVERY" ? (
                t("errors.DELIVERY_NO_ADDRESS")
              ) : (
                t(`errors.${error}`)
              )}
            </Alert>
          )}

          {/* No asterisk legend (§546): all three boxes are required, and the line under the send
              button says what is still missing. */}
          <form action={submitContactAction}>
            {/* Outside the column (§480, the 360-px density pass): as its first children they made
                the name box the column's second, and a column gives every item after its first the
                column's gap — sixteen pixels above the first box on top of the legend's own margin. */}
            <input type="hidden" name="locale" value={locale} />
            {/* Bots fill every field; a human never sees or fills this one. */}
            <input
              type="text"
              name="honeypot"
              autoComplete="off"
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
            />
            <input type="hidden" name="renderedAt" value={now.toISOString()} />
            <Stack spacing={2}>
              <TextField {...field("name")} label={t("name")} required autoComplete="name" fullWidth />
              {/* The intro already says the answer comes by email (§546). */}
              <TextField
                {...field("email")}
                type="email"
                label={t("email")}
                required
                autoComplete="email"
                fullWidth
              />
              <TextField
                {...field("message", t("messageHelp"))}
                label={t("message")}
                required
                multiline
                minRows={6}
                fullWidth
                slotProps={{ htmlInput: { maxLength: CONTACT_MESSAGE_MAX } }}
              />

              {/* Cloudflare Turnstile, when the club switched it on (§97), drawn and reset by
                  its own island (§185) — the implicit widget could not survive a re-render. */}
              {siteKey && (
                <Box id={fieldId("captcha")}>
                  <BotCheck siteKey={siteKey} locale={locale} attempt={now.toISOString()} />
                  {invalid.has("captcha") && (
                    <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                      {t("errors.captcha")}
                    </Typography>
                  )}
                  {/* The same sentence the registration form has under its check (§323). */}
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                    {legal("botCheckNotice")}
                  </Typography>
                </Box>
              )}

              {/* The notice, named as the registration form names it — a sentence, not the footer's bare "GDPR". */}
              <Typography variant="body2" color="text.secondary">
                {t("privacy")} {t("privacyDetails")}{" "}
                <Link href="/legal/privacy" style={inlineLink}>
                  {t("privacyLinkLabel")}
                </Link>
                .
              </Typography>

              {/* The club's runner at the start of the label, and running while it sends (§318). */}
              <SubmitButton
                label={t("submit")}
                pendingLabel={t("submitting")}
                runner
                incompleteHint={t("incompleteHint")}
                size="large"
                fullWidth
              />
            </Stack>
          </form>

          {/* The club's address beside the form, always (§449): a visitor who prefers their own
              mail client, or whose message the form cannot carry, writes straight to the club. */}
          {writeTo.length > 0 && error !== "DELIVERY" && (
            // 24 pixels over it at every width, not the phone's 16: the first address's reach
            // (21.6 pixels above its words, `INLINE_TAP_TARGET`) must stay in the gap, never over
            // the send button's lower edge (§480).
            <Typography variant="body1" sx={{ mt: 3 }}>
              {t("direct")} {addressLinks}
            </Typography>
          )}
        </>
      )}

      {newsletterOffered && (
        <NewsletterSignup
          locale={locale}
          outcome={newsletterOutcome}
          refused={newsletterOutcome === "invalid" ? parseNewsletterFields(nfields) : []}
          typed={
            newsletterRefused
              ? {
                  email: draft?.newsletterEmail,
                  topics: (draft?.newsletterTopics ?? "").split(",").filter(Boolean),
                  consent: draft?.newsletterConsent === "on",
                }
              : {}
          }
          siteKey={siteKey}
          renderedAt={(newsletterRefused || leaveRefused ? parseInterestSince(since, now) : null)?.toISOString() ?? now.toISOString()}
          // This render's own time, never `since`: a refusal redraws with the same `since`, and a
          // Turnstile reset keyed on it would never run, posting the spent token again (§185).
          attempt={now.toISOString()}
          leaveOutcome={leaveOutcome}
          leaveTyped={leaveRefused ? draft?.newsletterLeaveEmail : undefined}
        />
      )}
    </Container>
  );
}

/**
 * One read that may simply not answer (§281).
 *
 * The contact page is the one a visitor reaches when something else has failed, so nothing on it
 * is allowed to take it down. `null` is a state every caller here already has a rendering for.
 */
async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[contact] a lookup did not answer; the page stands without it", error);
    return null;
  }
}
