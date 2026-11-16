import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pictureSizes } from "@/modules/media/ladder";
import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "@/modules/media/limits";
import { isStorageConfigured } from "@/modules/media/storage";
import { bibEventDate, findEventForBibs } from "@/modules/registrations/bibs";
import { formatPhone } from "@/modules/registrations/phone";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { roleLabel } from "@/modules/volunteers/domain/volunteer";
import { readVolunteerPlan, type VolunteerPlanPerson } from "@/modules/volunteers/plan";
import { previewVolunteerPoints } from "@/modules/volunteers/point-mail";
import PlanPictureUpload from "@/modules/volunteers/ui/PlanPictureUpload";
import { isDomainError } from "@/shared/errors/domain-error";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import ActionForm from "@/shared/forms/ActionForm";
import { isUuid } from "@/shared/ids";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import PrintButton from "@/shared/ui/PrintButton";
import { ROW_SX } from "@/shared/ui/row-fold";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { placeVolunteerAction, removePlanPictureAction, sendVolunteerPointsAction, setPlanPictureAction } from "./actions";

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** What the paper leaves out: the links, the buttons and the boxes that build the plan. */
const NOT_ON_PAPER = { "@media print": { display: "none" } } as const;

/**
 * A person's telephone number as the person's own page draws it (§953, amending §949): a `tel:` link 44 pixels tall, because
 * an organizer rings from the plan with a thumb on the day (BR-REQ-041-01 criterion 6). On paper it is the number as text:
 * no link's colour or underline, and no height that would space the sheet's lines.
 */
const PHONE_LINK_SX = { display: "inline-flex", alignItems: "center", ...TAP_TARGET, "@media print": { minHeight: 0, color: "inherit", textDecoration: "none" } } as const;

/**
 * The tallest the plan's picture is printed (§952): under the height of a sheet whichever way it is turned — an A4 or a Letter
 * page on its side leaves some 18 centimetres between the margins — so the picture is one piece on one sheet and never cut
 * between two. In centimetres, not in the viewport's units: a printed page's `vh` is not the same length in every browser.
 */
const PICTURE_ON_PAPER_MAX_HEIGHT = "17cm";

/**
 * «Planul voluntarilor» (§949; the owner, 2026-11-16, with a map of the route and its seven points: «e foarte important sa
 * avem planul de voluntari si fiecare in ce punct ramane»): one event's points on the route, in the route's order, each with
 * the volunteers who stand at it — their name, their number, how to reach them, what they were given to do — and under them
 * everybody at no point. Built here, one press a person («Pune aici», «Scoate»), and printed from here: the page is the paper.
 *
 * The points are the event's own «Puncte pe traseu» (§757), kept in the editor; the people are the event's volunteers who are
 * not cancelled (`modules/volunteers/plan.ts`). For whoever works the volunteers (`canManageVolunteers`: the Organizer and the
 * Administrators) — anybody else gets the 404 of an address that does not exist (BR-REQ-060-01), and the service refuses them
 * again. Nothing on it is public, and placing, moving or taking off a person emails nobody: it is the organizers' own plan.
 *
 * One press tells the volunteers (§NNN; the owner, the same day: «…si sa ii pot distribui din aplicatie, sa stie exact unde si
 * cum» — «Email din site, la apăsarea ta»): «Trimite fiecăruia punctul lui» emails each person placed at a point their point,
 * what they do there and the plan's picture (`modules/volunteers/point-mail.ts`). It asks first, with the four numbers the
 * service counted — who is written to, who already knows their point, who stands at a point with no address, who stands at
 * none — and «Trimite din nou tuturor», a tick in that question, writes to everybody again.
 *
 * Above the points, the plan as the organizers drew it (the decision after the plan's own; the owner, the same day, with a
 * picture of the route and its points numbered on it: «trebui sa pot incarca si planul voluntarilor pe traseu in genul
 * [pozei]»): one picture, as wide as the column, a press opening the whole of it in a new tab — and on paper the first thing
 * after the sheet's title, in one piece. Uploaded, changed and taken off here by the same people («Încarcă poza planului»,
 * «Schimbă poza», «Șterge poza», which asks first); with no picture the page reads as it did, plus the upload.
 */
export default async function VolunteerPlanPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageVolunteers(actor.role)) notFound();
  // A malformed id is the same 404 an unknown one gets, not the query Postgres refuses (§376).
  if (!isUuid(id)) notFound();

  const db = getDb();
  let plan;
  // The four numbers of «Trimite fiecăruia punctul lui» (§NNN), counted by the service exactly as the press counts them.
  let mail;
  try {
    plan = await readVolunteerPlan(db, actor, id);
    mail = await previewVolunteerPoints(db, actor, id);
  } catch (error) {
    if (isDomainError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
  const event = await findEventForBibs(db, id, locale);
  const t = await getTranslations("Admin");
  // The day in words, or «Data se anunță mai târziu» while it is left blank (§545).
  const when = event ? bibEventDate(event, locale) || t("editor.dateToBeAnnounced") : "";
  // The action's language-neutral code (AGENTS.md §14.3) becomes a sentence here; an unknown code says nothing.
  const { planError } = await searchParams;
  const errorCode = planError && /^[A-Z_]{1,48}$/.test(planError) && t.has(`errors.${planError}`) ? planError : null;

  const km = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const rolesOf = (person: VolunteerPlanPerson) =>
    person.roleIds.flatMap((roleId) => {
      const words = plan.roles.get(roleId);
      return words ? [roleLabel(words, locale)] : [];
    });
  const placed = plan.points.reduce((sum, { people }) => sum + people.length, 0);
  const empty = plan.points.filter(({ people }) => people.length === 0).length;
  // The plan's picture (§952), and who is offered its controls: whoever works the volunteers — the action and the service ask again.
  const picture = plan.picture;
  const mayChangePicture = canManageVolunteers(actor.role);
  // Whether this environment can take a picture at all (`STORAGE_MODE`): without a store the page says so and offers no upload.
  const storeHere = isStorageConfigured();
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={id} />
    </>
  );

  /*
    «Trimite fiecăruia punctul lui» (§NNN): from the four numbers of its question (`previewVolunteerPoints`, read above with
    the plan), what the press can be:

    - somebody still to tell, nobody told yet → the plain question;
    - somebody still to tell, others who already know their point → the same question with «Trimite din nou tuturor» to tick in it;
    - everybody at a point already told → the press can only write to everybody again: the button and the question say so;
    - nobody with an address at a point → no press at all, and the sentence that says why (the service refuses it likewise).

    Each question states the four numbers, one a line, and — worded by the one builder — the email that leaves and to how many.
  */
  const everybody = mail.toWrite + mail.told;
  const words = await confirmWords();
  const countLine = (key: "toWrite" | "told" | "toldAmong" | "noAddress" | "unplaced", count: number) => t(`volunteers.plan.mail.lines.${key}`, { count });
  const mailLines = [countLine("toWrite", mail.toWrite), countLine("told", mail.told), countLine("noAddress", mail.noAddress), countLine("unplaced", mail.unplaced)];
  // «Din nou tuturor»: everybody at a point with an address is written to, those who already know their point among them.
  const againLines = [countLine("toWrite", everybody), countLine("toldAmong", mail.told), countLine("noAddress", mail.noAddress), countLine("unplaced", mail.unplaced)];
  const mailBody = t(picture ? "volunteers.plan.mail.confirmBodyPicture" : "volunteers.plan.mail.confirmBody");
  const againMail = words.mail({ to: { count: everybody, audience: "volunteersAtPoints" }, type: "VOLUNTEER_POINT" });
  const mailConfirm: ConfirmSpec | null =
    everybody === 0
      ? null
      : mail.toWrite === 0
        ? {
            title: t("volunteers.plan.mail.againTitle"),
            body: mailBody,
            lines: againLines,
            ...againMail,
            confirmLabel: t("volunteers.plan.mail.again"),
            cancelLabel: words.cancel,
          }
        : {
            title: t("volunteers.plan.mail.confirmTitle"),
            body: mailBody,
            lines: mailLines,
            ...words.mail({ to: { count: mail.toWrite, audience: "volunteersNotTold" }, type: "VOLUNTEER_POINT" }),
            confirmLabel: t("volunteers.plan.mail.confirm"),
            cancelLabel: words.cancel,
            // The tick in the question: only while somebody already knows their point — otherwise «everybody» is who the press writes to anyway.
            ...(mail.told > 0
              ? { option: { field: "again", label: t("volunteers.plan.mail.againTick"), ticked: { lines: againLines, email: againMail.email, also: againMail.also } } }
              : {}),
          };
  // With everybody already told, the form itself asks for «din nou tuturor»; otherwise the question's tick decides, and the box is posted empty.
  const againOnly = everybody > 0 && mail.toWrite === 0;

  /** One person's line: who, their number, how to reach them, what they do — the same words at a point and under «Fără punct». */
  const personWords = (person: VolunteerPlanPerson) => {
    const roles = rolesOf(person);
    return (
      <Box sx={{ minWidth: 0 }}>
        <Typography component="span" sx={{ fontWeight: 600, overflowWrap: "break-word" }} data-testid="plan-person-name">
          <Link href={{ pathname: "/admin/volunteers/[id]", params: { id: person.id } }}>{person.name}</Link>
        </Typography>
        {person.bibNumber !== null && (
          <Typography component="span" variant="body2" sx={{ ml: 1, whiteSpace: "nowrap" }}>
            {t("volunteers.chips.number", { number: person.bibNumber })}
          </Typography>
        )}
        {person.phone && (
          <Typography component="span" variant="body2" sx={{ ml: 1, whiteSpace: "nowrap" }}>
            {/* Read grouped («+40 712 345 678», `formatPhone`); the link keeps the digits and the plus alone, which is what a telephone dials. */}
            <Box component="a" href={`tel:${person.phone.replace(/[^\d+]/g, "")}`} sx={PHONE_LINK_SX} data-testid="plan-person-phone">
              {formatPhone(person.phone)}
            </Box>
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "break-word" }}>
          {[roles.length > 0 ? roles.join(", ") : t("volunteers.plan.noRole"), ...(person.state === "REGISTERED" ? [t("volunteers.plan.notConfirmed")] : [])].join(" · ")}
        </Typography>
      </Box>
    );
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 2, ...NOT_ON_PAPER }}>
        <Typography variant="body2">
          <Link href={{ pathname: "/admin/volunteers", query: { eventId: id } }}>{t("volunteers.plan.back")}</Link>
        </Typography>
        <Typography variant="body2">
          {/* To the points' own card in the editor («Puncte pe traseu», `CheckpointsCard`'s `box-checkpoints`), which the address opens — not the editor's top. */}
          <Link href={{ pathname: "/admin/events/[id]", params: { id }, hash: "box-checkpoints" }}>{t("volunteers.plan.editPoints")}</Link>
        </Typography>
      </Stack>

      {/* Every backoffice page gives this id to its alert region; the Server Action redirects a refusal here with its code (§953),
          so the region can take the focus and stands clear of the page's top edge, as the other pages' regions do. */}
      <Box id="admin-alert" tabIndex={-1} aria-live="polite" sx={{ scrollMarginTop: 16, ...NOT_ON_PAPER }}>
        {errorCode && <Alert severity="error">{t(`errors.${errorCode}`)}</Alert>}
      </Box>

      <Typography variant="h2" sx={HEADING_SX.title}>
        {t("volunteers.plan.title")}
      </Typography>
      {event && (
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t("volunteers.plan.event", { event: event.title, date: when })}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" sx={NOT_ON_PAPER}>
        {t("volunteers.plan.help")}
      </Typography>
      <Box>
        <PrintButton label={t("volunteers.plan.print")} />
      </Box>

      {/* The plan as the organizers drew it (§952): above the points on the page, and the first thing after the title on paper —
          the section's own heading, its hint and every control stay off the sheet, so a plan with no picture prints as it did. */}
      <Box id="plan-picture" sx={{ scrollMarginTop: 16 }} data-testid="plan-picture-section">
        <Typography variant="h3" sx={{ ...HEADING_SX[3], ...NOT_ON_PAPER }}>
          {t("volunteers.plan.picture.title")}
        </Typography>
        {picture ? (
          // One piece on one sheet: never cut between two pages, and never taller than a sheet (`PICTURE_ON_PAPER_MAX_HEIGHT`).
          <Box component="figure" sx={{ m: 0, mt: 1, breakInside: "avoid", "@media print": { mt: 0 } }} data-testid="plan-picture">
            <Box
              component="a"
              href={picture.fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("volunteers.plan.picture.open")}
              sx={{ display: "block", lineHeight: 0 }}
              data-testid="plan-picture-link"
            >
              <Box
                component="img"
                src={picture.displayUrl}
                srcSet={picture.srcSet}
                sizes={picture.srcSet ? pictureSizes("page") : undefined}
                alt={t("volunteers.plan.picture.alt")}
                width={picture.width}
                height={picture.height}
                decoding="async"
                // As wide as the column and never wider than its own pixels; on paper as large as fits one sheet, in its own shape.
                sx={{
                  display: "block",
                  width: "100%",
                  maxWidth: `${picture.width}px`,
                  height: "auto",
                  "@media print": { width: "auto", maxWidth: "100%", maxHeight: PICTURE_ON_PAPER_MAX_HEIGHT },
                }}
                data-testid="plan-picture-image"
              />
            </Box>
            <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, ...NOT_ON_PAPER }}>
              {t("volunteers.plan.picture.openHint")}
            </Typography>
          </Box>
        ) : (
          // What to do about it, said only to somebody who can: where there is no store, the line under says that instead.
          mayChangePicture &&
          storeHere && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, ...NOT_ON_PAPER }} data-testid="plan-picture-none">
              {t("volunteers.plan.picture.none")}
            </Typography>
          )
        )}
        {/* Whoever works the volunteers — on this page, everybody it answers to; said here so the controls never outlive the gate. */}
        {mayChangePicture &&
          (storeHere ? (
            <Stack spacing={1} sx={{ mt: 1.5, ...NOT_ON_PAPER }} data-testid="plan-picture-controls">
              {/* The island uploads the file, writes the stored picture's id into this form and sends it (`setPlanPictureAction`). */}
              <Box component="form" action={setPlanPictureAction} data-testid="plan-picture-form">
                {hidden}
                <PlanPictureUpload
                  replaces={picture !== null}
                  inputId="plan-picture-file"
                  lang={locale}
                  labels={{
                    upload: t("volunteers.plan.picture.upload"),
                    replace: t("volunteers.plan.picture.replace"),
                    uploading: t("volunteers.plan.picture.uploading"),
                    saving: t("volunteers.plan.picture.saving"),
                    failed: t("volunteers.plan.picture.failed"),
                    help: t("volunteers.plan.picture.help"),
                    // The house's one quality choice and the chosen file's facts (§414, §437), in their own words.
                    quality: {
                      legend: t("gallery.qualityLegend"),
                      low: t("gallery.qualityLow"),
                      normal: t("gallery.qualityNormal"),
                      high: t("gallery.qualityHigh"),
                      original: t("gallery.qualityOriginal"),
                      help: t("gallery.qualityHelp", { lowMax: String(LOW_WEB_MAX), normalMax: String(WEB_MAX), highMax: String(HIGH_WEB_MAX), originalMax: String(ORIGINAL_WEB_MAX) }),
                    },
                    chosen: {
                      chosen: t.raw("richText.imageChosen") as string,
                      sent: t.raw("richText.imageSent") as string,
                      lighter: t.raw("richText.imageLighter") as string,
                    },
                  }}
                />
              </Box>
              {/* «Șterge poza» asks first: only uploading the picture again brings it back. */}
              {picture && (
                <Box component="form" action={removePlanPictureAction} data-testid="plan-picture-remove-form">
                  {hidden}
                  <ConfirmSubmitButton
                    label={t("volunteers.plan.picture.remove")}
                    icon="delete"
                    color="error"
                    variant="text"
                    size="medium"
                    title={t("volunteers.plan.picture.removeTitle")}
                    body={t("volunteers.plan.picture.removeBody")}
                    confirmLabel={t("volunteers.plan.picture.remove")}
                    cancelLabel={t("confirm.cancel")}
                  />
                </Box>
              )}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, ...NOT_ON_PAPER }} data-testid="plan-picture-no-storage">
              {t("volunteers.plan.picture.noStorage")}
            </Typography>
          ))}
      </Box>

      {/* «Trimite fiecăruia punctul lui» (§NNN): the one press that tells the volunteers — never on the paper. The numbers are the
          question's own, said here too so the page answers «cine mai e de anunțat» before anything is pressed. */}
      <Box id="plan-mail" sx={{ scrollMarginTop: 16, ...NOT_ON_PAPER }} data-testid="plan-mail-section">
        <Typography variant="h3" sx={HEADING_SX[3]}>
          {t("volunteers.plan.mail.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("volunteers.plan.mail.help")}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, overflowWrap: "break-word" }} data-testid="plan-mail-counts">
          {mailLines.join(" · ")}
        </Typography>
        {mailConfirm ? (
          <Box sx={{ mt: 1.5 }}>
            <ActionForm action={sendVolunteerPointsAction} confirm={mailConfirm} data-testid="plan-mail-form">
              {hidden}
              {/* «Trimite din nou tuturor»: `on` when it is all the press can do; else empty as drawn, and the question's tick fills it. */}
              <input key={againOnly ? "again" : "choice"} type="hidden" name="again" value={againOnly ? "on" : ""} />
              <GlyphButton icon={againOnly ? "resend" : "send"} type="submit" variant="contained" size="medium" sx={TAP_TARGET} data-testid="plan-mail-send">
                {t(againOnly ? "volunteers.plan.mail.again" : "volunteers.plan.mail.send")}
              </GlyphButton>
            </ActionForm>
            {againOnly && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="plan-mail-all-told">
                {t("volunteers.plan.mail.allTold")}
              </Typography>
            )}
          </Box>
        ) : (
          <Typography variant="body2" sx={{ mt: 1, fontStyle: "italic" }} data-testid="plan-mail-nobody">
            {t("volunteers.plan.mail.nobody")}
          </Typography>
        )}
      </Box>

      {plan.points.length === 0 ? (
        <Alert severity="info">{t("volunteers.plan.noPoints")}</Alert>
      ) : (
        <>
          <Typography variant="body2" data-testid="plan-summary">
            {t("volunteers.plan.summary", { placed, unplaced: plan.unplaced.length, empty })}
          </Typography>
          <Stack spacing={0} component="ol" aria-label={t("volunteers.plan.title")} sx={{ listStyle: "none", m: 0, p: 0 }}>
            {plan.points.map(({ point, number, people }) => {
              const facts = [point.kinds.map((kind) => t(`checkpoints.kinds.${kind}`)).join(", "), (locale === "ro" ? point.noteRo : point.noteEn) ?? ""].filter((part) => part !== "");
              return (
                <Box
                  component="li"
                  key={point.id}
                  id={`point-${point.id}`}
                  data-testid="plan-point"
                  // The house's row (§842): a hairline between points, never a card of its own; a point is not split across two sheets.
                  sx={{ ...ROW_SX, py: 2, breakInside: "avoid", scrollMarginTop: 16 }}
                >
                  <Typography variant="h3" sx={{ ...HEADING_SX[3], overflowWrap: "break-word" }} data-testid="plan-point-title">
                    {t("volunteers.plan.pointTitle", { number, title: t("checkpoints.rowTitle", { km: km(point.km), name: locale === "ro" ? point.nameRo : point.nameEn }) })}
                  </Typography>
                  {facts.length > 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "break-word" }}>
                      {facts.join(" · ")}
                    </Typography>
                  )}

                  {people.length === 0 ? (
                    <Typography variant="body2" sx={{ mt: 1, fontStyle: "italic" }} data-testid="plan-point-empty">
                      {t("volunteers.plan.nobodyHere")}
                    </Typography>
                  ) : (
                    <Stack spacing={1} component="ul" sx={{ listStyle: "none", m: 0, mt: 1, p: 0 }}>
                      {people.map((person) => (
                        <Stack component="li" key={person.id} direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }} data-testid="plan-person">
                          {personWords(person)}
                          {/* «Scoate»: the same form with no point — the person stands under «Fără punct» again. */}
                          <Box component="form" action={placeVolunteerAction} sx={NOT_ON_PAPER}>
                            {hidden}
                            <input type="hidden" name="volunteerId" value={person.id} />
                            <input type="hidden" name="checkpointId" value="" />
                            <input type="hidden" name="at" value={point.id} />
                            <GlyphButton icon="undo" type="submit" variant="text" size="small" sx={TAP_TARGET} aria-label={t("volunteers.plan.takeOffFor", { name: person.name })} data-testid="plan-take-off">
                              {t("volunteers.plan.takeOff")}
                            </GlyphButton>
                          </Box>
                        </Stack>
                      ))}
                    </Stack>
                  )}

                  {/* «Pune aici»: anybody of the event who stands at no point yet. A native select — it works without scripts, asks for a
                      choice before it posts, and opens as the phone's own list. */}
                  {plan.unplaced.length > 0 && (
                    <Stack component="form" action={placeVolunteerAction} direction="row" sx={{ mt: 2, gap: 1, alignItems: "center", flexWrap: "wrap", ...NOT_ON_PAPER }} data-testid="plan-place-form">
                      {hidden}
                      <input type="hidden" name="checkpointId" value={point.id} />
                      <input type="hidden" name="at" value={point.id} />
                      <TextField
                        select
                        required
                        size="small"
                        name="volunteerId"
                        label={t("volunteers.plan.choose")}
                        defaultValue=""
                        sx={{ minWidth: 240, flex: "1 1 240px", maxWidth: 420 }}
                        slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: { "data-testid": "plan-place-select" } }}
                      >
                        <option value="">{t("volunteers.plan.chooseEmpty")}</option>
                        {plan.unplaced.map((person) => {
                          const roles = rolesOf(person);
                          return (
                            <option key={person.id} value={person.id}>
                              {roles.length > 0 ? `${person.name} — ${roles.join(", ")}` : person.name}
                            </option>
                          );
                        })}
                      </TextField>
                      <GlyphButton icon="addPerson" type="submit" variant="outlined" size="small" sx={TAP_TARGET} data-testid="plan-place">
                        {t("volunteers.plan.place")}
                      </GlyphButton>
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Stack>
        </>
      )}

      <Box sx={{ breakInside: "avoid" }}>
        <Typography variant="h3" sx={HEADING_SX[3]}>
          {t("volunteers.plan.unplacedTitle")}
        </Typography>
        {placed === 0 && plan.unplaced.length === 0 ? (
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t("volunteers.plan.noVolunteers")}
          </Typography>
        ) : plan.unplaced.length === 0 ? (
          <Typography variant="body2" sx={{ mt: 1 }} data-testid="plan-unplaced-none">
            {t("volunteers.plan.unplacedNone")}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={NOT_ON_PAPER}>
              {t("volunteers.plan.unplacedHelp")}
            </Typography>
            <Stack spacing={1} component="ul" sx={{ listStyle: "none", m: 0, mt: 1, p: 0 }}>
              {plan.unplaced.map((person) => (
                <Box component="li" key={person.id} data-testid="plan-unplaced-person">
                  {personWords(person)}
                </Box>
              ))}
            </Stack>
          </>
        )}
      </Box>
    </Stack>
  );
}
