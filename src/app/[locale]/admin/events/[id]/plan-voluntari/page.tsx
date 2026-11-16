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
import { bibEventDate, findEventForBibs } from "@/modules/registrations/bibs";
import { formatPhone } from "@/modules/registrations/phone";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { roleLabel } from "@/modules/volunteers/domain/volunteer";
import { readVolunteerPlan, type VolunteerPlanPerson } from "@/modules/volunteers/plan";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import PrintButton from "@/shared/ui/PrintButton";
import { ROW_SX } from "@/shared/ui/row-fold";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { placeVolunteerAction } from "./actions";

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** What the paper leaves out: the links, the buttons and the boxes that build the plan. */
const NOT_ON_PAPER = { "@media print": { display: "none" } } as const;

/**
 * A person's telephone number as the person's own page draws it (§NNN, amending §949): a `tel:` link 44 pixels tall, because
 * an organizer rings from the plan with a thumb on the day (BR-REQ-041-01 criterion 6). On paper it is the number as text:
 * no link's colour or underline, and no height that would space the sheet's lines.
 */
const PHONE_LINK_SX = { display: "inline-flex", alignItems: "center", ...TAP_TARGET, "@media print": { minHeight: 0, color: "inherit", textDecoration: "none" } } as const;

/**
 * «Planul voluntarilor» (§949; the owner, 2026-11-16, with a map of the route and its seven points: «e foarte important sa
 * avem planul de voluntari si fiecare in ce punct ramane»): one event's points on the route, in the route's order, each with
 * the volunteers who stand at it — their name, their number, how to reach them, what they were given to do — and under them
 * everybody at no point. Built here, one press a person («Pune aici», «Scoate»), and printed from here: the page is the paper.
 *
 * The points are the event's own «Puncte pe traseu» (§757), kept in the editor; the people are the event's volunteers who are
 * not cancelled (`modules/volunteers/plan.ts`). For whoever works the volunteers (`canManageVolunteers`: the Organizer and the
 * Administrators) — anybody else gets the 404 of an address that does not exist (BR-REQ-060-01), and the service refuses them
 * again. Nothing on it is public, and nobody is emailed from it: it is the organizers' own plan.
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
  try {
    plan = await readVolunteerPlan(db, actor, id);
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
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={id} />
    </>
  );

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

      {/* Every backoffice page gives this id to its alert region; the Server Action redirects a refusal here with its code (§NNN),
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
