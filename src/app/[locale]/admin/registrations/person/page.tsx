import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { openPersonLookup, PERSON_LOOKUP_MINUTES, viewPersonData } from "@/modules/registrations/person-data";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import VolunteerAnswers from "@/modules/volunteers/ui/VolunteerAnswers";
import { eraseRsvpsAction, eraseVolunteerInvitationsAction, lookUpPersonAction } from "./actions";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { actionKeyOf } from "@/shared/forms/action-key";
import GlyphButton from "@/shared/ui/GlyphButton";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; error?: string; erased?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Everything held about one person (§322): the answer to "what do you have about me" (art. 15
 * GDPR), and the list to go through before an erasure.
 *
 * Administrator only, asserted here and again in `person-data.ts`: it puts the whole of a person
 * on one screen, the health note included. The address is typed into a form that posts it, and
 * comes back in the URL only sealed; a sealed lookup older than half an hour asks for the address
 * again rather than opening. Every stored column is shown as stored — this is the record, not a
 * summary of it — and the JSON beside it is the same data as a file, recorded when it is taken.
 */
export default async function PersonDataPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageRegistrations(actor.role)) notFound();

  const { q, error, erased } = await searchParams;
  const words = await confirmWords();
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const now = new Date();
  const canonicalEmail = q ? openPersonLookup(q, now) : null;
  const data = canonicalEmail ? await viewPersonData(getDb(), actor, canonicalEmail, now) : null;
  const pagePath = getPathname({ locale, href: "/admin/registrations/person" });

  /** One stored value as text: dates in the reader's format, objects as JSON, empties as a dash. */
  const show = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    // A timestamp in the short form with its time (§349); a birth date is a stored string and
    // is shown as it is stored.
    if (value instanceof Date) return formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };
  /** Every column of a row, in the order the table stores them. */
  const fields = (row: object) => (
    <Box component="dl" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "minmax(160px, max-content) 1fr" }, columnGap: 2, rowGap: 0.25, m: 0 }}>
      {Object.entries(row).map(([key, value]) => (
        <Box key={key} sx={{ display: "contents" }}>
          <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
            {key}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
            {show(value)}
          </Typography>
        </Box>
      ))}
    </Box>
  );

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin/registrations">{t("registrations.backToList")}</Link>
      </Typography>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("person.title")}
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {erased === "invitations" ? (
          <Alert severity="success" data-testid="person-volunteer-invitations-erased">{t("person.volunteerInvitationsErased")}</Alert>
        ) : (
          erased && <Alert severity="success" data-testid="person-rsvps-erased">{t("person.rsvpsErased")}</Alert>
        )}
        {q && !canonicalEmail && <Alert severity="warning">{t("person.expired", { minutes: PERSON_LOOKUP_MINUTES })}</Alert>}
      </Box>

      {!data ? (
        <Stack spacing={2} sx={{ maxWidth: 560 }}>
          <Typography variant="body2" color="text.secondary">
            {t("person.intro")}
          </Typography>
          <form action={lookUpPersonAction} data-action-key={actionKeyOf(lookUpPersonAction)}>
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
              <TextField name="email" type="email" label={t("person.email")} required autoComplete="off" sx={{ flex: 1 }} />
              <GlyphButton icon="search" type="submit" variant="contained" sx={{ minHeight: 44 }}>
                {t("person.lookUp")}
              </GlyphButton>
            </Stack>
          </form>
        </Stack>
      ) : (
        <Stack spacing={3}>
          <Stack spacing={0.5}>
            <Typography variant="body2">{t("person.canonical", { email: data.canonicalEmail })}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t("person.audited")}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {/* A GET for a file, like the registrations export; the lookup travels sealed. */}
            <GlyphButton icon="download" href={`/api/admin/registrations/person?q=${encodeURIComponent(q ?? "")}`} variant="outlined" sx={{ minHeight: 44 }}>
              {t("person.downloadJson")}
            </GlyphButton>
            <GlyphButton icon="search" href={pagePath} variant="text" sx={{ minHeight: 44 }}>
              {t("person.newSearch")}
            </GlyphButton>
          </Stack>

          {!data.participant && data.announcementRequests.length === 0 && data.rsvpAnswers.length === 0 && data.askRefusals.length === 0 && data.rememberedBrowsers.length === 0 && data.volunteerOffers.length === 0 && data.volunteerInvitations.length === 0 && data.groupRunDeclarations.length === 0 ? (
            <Alert severity="info">{t("person.notFound")}</Alert>
          ) : (
            <>
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.participant")}
                </Typography>
                {data.participant ? fields(data.participant) : <Typography variant="body2">{t("person.none")}</Typography>}
              </Box>
              <Divider />
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.registrations", { count: data.registrations.length })}
                </Typography>
                {data.registrations.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  <Stack spacing={2}>
                    {data.registrations.map((registration) => (
                      <Box key={registration.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                          <Link href={{ pathname: "/admin/registrations/[id]", params: { id: registration.id } }}>
                            {registration.eventTitle ?? registration.eventId} · {registration.status}
                          </Link>
                        </Typography>
                        {fields(registration)}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
              <Divider />
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.acceptances", { count: data.declarationAcceptances.length })}
                </Typography>
                {data.declarationAcceptances.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  <Stack spacing={2}>
                    {data.declarationAcceptances.map((acceptance) => (
                      <Box key={acceptance.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                        {fields(acceptance)}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
              <Divider />
              {/*
                The organizers' internal notes (§777; art. 15 GDPR): the words, the moment, the event and the author's role —
                «Organizator», «Administrator» — never the colleague's name. The registration's erase removes them.
              */}
              <Box component="section" data-testid="person-notes">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.notes", { count: data.notes.length })}
                </Typography>
                {data.notes.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  <Stack spacing={1}>
                    {data.notes.map((note, index) => (
                      <Box key={index} data-testid="person-note">
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                          {note.body}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t("person.noteBy", {
                            role: note.authorRole ? STAFF_ROLE_LABEL[note.authorRole] : t("person.noteAuthorGone"),
                            date: show(note.createdAt),
                            event: note.eventTitle ?? note.eventId,
                          })}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
              <Divider />
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.messages", { count: data.messages.length })}
                </Typography>
                {data.messages.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  data.messages.map((message, index) => (
                    <Typography key={index} variant="body2" color="text.secondary">
                      {show(message.createdAt)} · {message.messageType} · {message.status}
                      {message.sentAt ? ` · ${show(message.sentAt)}` : ""}
                    </Typography>
                  ))
                )}
              </Box>
              <Divider />
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.interests", { count: data.announcementRequests.length })}
                </Typography>
                {data.announcementRequests.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  data.announcementRequests.map((request, index) => (
                    <Typography key={index} variant="body2" color="text.secondary">
                      {show(request.createdAt)} · {request.eventTitle ?? request.eventId} · {request.deliveryEmail} · {request.locale}
                    </Typography>
                  ))
                )}
              </Box>
              <Divider />
              {/* The answers «Vin!» and the browsers remembered for them (§811): every column of the row (art. 15 GDPR), erased on request (art. 17). */}
              <Box component="section" data-testid="person-rsvps">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.rsvps", { count: data.rsvpAnswers.length })}
                </Typography>
                {data.rsvpAnswers.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  data.rsvpAnswers.map((answer, index) => (
                    <Typography key={index} variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                      {show(answer.createdAt)} · {answer.eventTitle ?? answer.eventId} · {answer.deliveryEmail} · {show(answer.displayName)} ·{" "}
                      {answer.showName ? t("person.rsvpNameShown") : t("person.rsvpNameHidden")} ·{" "}
                      {answer.clubMember === "DECLARED" ? `${t("person.rsvpMemberDeclared")} · ` : answer.clubMember === "ACCOUNT" ? `${t("person.rsvpMemberAccount")} · ` : ""}{answer.locale} · {t("person.rsvpNotice", { version: answer.privacyNoticeVersion })} ·{" "}
                      {answer.confirmedAt ? t("person.rsvpConfirmedAt", { when: show(answer.confirmedAt) }) : answer.askedAt ? t("person.rsvpAsked", { when: show(answer.askedAt) }) : t("person.rsvpUnconfirmed")}
                    </Typography>
                  ))
                )}
                <Typography variant="h3" sx={{ fontSize: "1rem", mt: 2, mb: 1 }}>
                  {t("person.askRefusals", { count: data.askRefusals.length })}
                </Typography>
                {data.askRefusals.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  <>
                    {data.askRefusals.map((refusal, index) => (
                      <Typography key={index} variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                        {show(refusal.createdAt)} · {refusal.series ? `${tEvent(`type.${refusal.series.type}`)} · ${refusal.series.title}` : t("person.askRefusalGone")}
                      </Typography>
                    ))}
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {t("person.askRefusalsKept")}
                    </Typography>
                  </>
                )}
                <Typography variant="h3" sx={{ fontSize: "1rem", mt: 2, mb: 1 }}>
                  {t("person.browsers", { count: data.rememberedBrowsers.length })}
                </Typography>
                {data.rememberedBrowsers.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  data.rememberedBrowsers.map((browser, index) => (
                    <Typography key={index} variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                      {show(browser.createdAt)} · {browser.deliveryEmail} · {show(browser.displayName)} · {t("person.browserUsed", { when: show(browser.lastUsedAt) })} · {t("person.browserUntil", { when: show(browser.expiresAt) })}
                    </Typography>
                  ))
                )}
                {(data.rsvpAnswers.length > 0 || data.rememberedBrowsers.length > 0) && (
                  <form action={eraseRsvpsAction} style={{ marginTop: 12 }}>
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="q" value={q ?? ""} />
                    <ConfirmSubmitButton
                      label={t("person.rsvpsErase")}
                      icon="erase"
                      title={t("person.rsvpsEraseTitle")}
                      body={t("person.rsvpsEraseBody")}
                      confirmLabel={t("person.rsvpsErase")}
                      cancelLabel={words.cancel}
                      color="error"
                      variant="outlined"
                      size="small"
                    />
                  </form>
                )}
              </Box>
              <Divider />
              {/*
                The club's invitations to volunteer sent to this address (§820; art. 15 GDPR): the event, when it was sent, sent again, used,
                withdrawn, the deadline recorded, the language and the club's line in both languages — every column but the link's fingerprint.
                An unused or withdrawn one holds an address and a line and nothing else, so it is erased here on request (art. 17).
              */}
              <Box component="section" data-testid="person-volunteer-invitations">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.volunteerInvitations", { count: data.volunteerInvitations.length })}
                </Typography>
                {data.volunteerInvitations.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  <>
                    {data.volunteerInvitations.map((invitation, index) => (
                      <Typography key={index} variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }} data-testid="person-volunteer-invitation">
                        {t("person.volunteerInvitationSent", { when: show(invitation.sentAt) })} · {invitation.eventTitle ?? invitation.eventId} · {invitation.deliveryEmail} · {invitation.locale}
                        {invitation.resentAt ? ` · ${t("person.volunteerInvitationResent", { when: show(invitation.resentAt) })}` : ""}
                        {invitation.usedAt ? ` · ${t("person.volunteerInvitationUsed", { when: show(invitation.usedAt) })}` : ""}
                        {invitation.withdrawnAt ? ` · ${t("person.volunteerInvitationWithdrawn", { when: show(invitation.withdrawnAt) })}` : ""}
                        {` · ${t("person.volunteerInvitationUntil", { when: show(invitation.expiresAt) })}`}
                        {invitation.messageRo ? ` · ${t("person.volunteerInvitationLine", { ro: invitation.messageRo, en: invitation.messageEn ?? "—" })}` : ""}
                      </Typography>
                    ))}
                    <form action={eraseVolunteerInvitationsAction} style={{ marginTop: 12 }}>
                      <input type="hidden" name="uiLocale" value={locale} />
                      <input type="hidden" name="q" value={q ?? ""} />
                      <ConfirmSubmitButton
                        label={t("person.volunteerInvitationsErase")}
                        icon="erase"
                        title={t("person.volunteerInvitationsEraseTitle")}
                        body={t("person.volunteerInvitationsEraseBody")}
                        confirmLabel={t("person.volunteerInvitationsErase")}
                        cancelLabel={words.cancel}
                        color="error"
                        variant="outlined"
                        size="small"
                      />
                    </form>
                  </>
                )}
              </Box>
              <Divider />
              {/* What the person offered as a volunteer (§754): every column of the row, deleted from the event's «Voluntari» card. */}
              <Box component="section" data-testid="person-volunteer-offers">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.volunteers", { count: data.volunteerOffers.length })}
                </Typography>
                {data.volunteerOffers.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  data.volunteerOffers.map((offer, index) => (
                    <Typography key={index} variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                      {show(offer.createdAt)} · {offer.eventTitle ?? offer.eventId} ·{" "}
                      {/* The role given, or «De repartizat» (§761), then the roles the person offered for. */}
                      {(locale === "en" ? offer.roleNameEn : offer.roleNameRo) ?? t("volunteers.unassigned.title")} ·{" "}
                      {t("volunteers.person.choicesLine", { roles: (locale === "en" ? offer.chosenRolesEn : offer.chosenRolesRo).join(", ") || "—" })} · {t(`volunteers.states.${offer.state}`)} · {t(`volunteers.sources.${offer.source}`)} · {offer.name}
                      {/* The address and the telephone number as stored; one the club typed without is simply absent (§864). */}
                      {offer.deliveryEmail ? ` · ${offer.deliveryEmail}` : ""}
                      {offer.phone ? ` · ${offer.phone}` : ""}
                      {offer.message ? ` · ${offer.message}` : ""}
                      {offer.note ? ` · ${offer.note}` : ""}
                      {/* What the person said about themselves (§765): every column of the row, art. 15 GDPR. */}
                      <VolunteerAnswers offer={offer} />
                      {/* The volunteer agreement (§758): accepted — which version, how, when — or not yet. */}
                      {" · "}
                      {offer.agreementAcceptedAt && offer.agreementMethod
                        ? `${t("volunteers.agreement.accepted")} (${t("volunteers.agreement.acceptedLine", {
                            version: String(offer.agreementVersion ?? ""),
                            how: t(`volunteers.agreement.methods.${offer.agreementMethod}`),
                            when: show(offer.agreementAcceptedAt),
                          })})`
                        : t("volunteers.agreement.notAccepted")}
                      {/* The electronic acceptance's trace (§771): the IP address and browser of each press, the volunteer's and the guardian's. */}
                      {offer.agreementIp || offer.agreementUserAgent
                        ? ` · ${t("person.traceVolunteer", { ip: show(offer.agreementIp), browser: show(offer.agreementUserAgent) })}`
                        : ""}
                      {offer.guardianIp || offer.guardianUserAgent
                        ? ` · ${t("person.traceGuardian", { ip: show(offer.guardianIp), browser: show(offer.guardianUserAgent) })}`
                        : ""}
                    </Typography>
                  ))
                )}
              </Box>
              <Divider />
              {/* The group-run declarations signed with this address (§393): every personal column, the signature's IP address and browser (§771) among them. */}
              <Box component="section" data-testid="person-group-run-declarations">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.groupRuns", { count: data.groupRunDeclarations.length })}
                </Typography>
                {data.groupRunDeclarations.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  <Stack spacing={2}>
                    {data.groupRunDeclarations.map((declaration, index) => (
                      <Box key={index} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                        {fields(declaration)}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
              <Divider />
              {/* The results entered for this person's registrations (§808): every column, the positions and the category as stored. */}
              <Box component="section" data-testid="person-results">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.results", { count: data.results.length })}
                </Typography>
                {data.results.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  <Stack spacing={2}>
                    {data.results.map((result, index) => (
                      <Box key={index} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                        {fields(result)}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
              <Divider />
              <Box component="section">
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
                  {t("person.audit", { count: data.auditTrail.length })}
                </Typography>
                {data.auditTrail.length === 0 ? (
                  <Typography variant="body2">{t("person.none")}</Typography>
                ) : (
                  data.auditTrail.map((entry, index) => (
                    <Typography key={index} variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                      {show(entry.createdAt)} · {entry.action} · {entry.actorName ?? "—"}
                      {entry.metadata && Object.keys(entry.metadata as object).length > 0 ? ` · ${JSON.stringify(entry.metadata)}` : ""}
                    </Typography>
                  ))
                )}
              </Box>
            </>
          )}
        </Stack>
      )}
    </Stack>
  );
}
