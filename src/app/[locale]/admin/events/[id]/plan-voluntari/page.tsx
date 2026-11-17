import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { getDb } from "@/db/client";
import { countForm } from "@/i18n/count-form";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { CHECKPOINT_NAME_MAX } from "@/modules/event-checkpoints/domain/checkpoint";
import { formatCoordinates, mapUrlOf } from "@/modules/event-checkpoints/domain/coordinates";
import { pictureSizes } from "@/modules/media/ladder";
import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "@/modules/media/limits";
import { isStorageConfigured } from "@/modules/media/storage";
import { bibEventDate, findEventForBibs } from "@/modules/registrations/bibs";
import { formatPhone } from "@/modules/registrations/phone";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import { roleLabel } from "@/modules/volunteers/domain/volunteer";
import { readVolunteerPlan, type VolunteerPlanPerson, type VolunteerPlanPoint } from "@/modules/volunteers/plan";
import { coordinatesOf, PLAN_POINT_BOXES, type PlanPoint, planPointRefusalValues } from "@/modules/volunteers/plan-points";
import { previewVolunteerPoints } from "@/modules/volunteers/point-mail";
import PlanPictureUpload from "@/modules/volunteers/ui/PlanPictureUpload";
import { isDomainError } from "@/shared/errors/domain-error";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import ActionForm from "@/shared/forms/ActionForm";
import { fieldId } from "@/shared/forms/outcome";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { isUuid } from "@/shared/ids";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_INLINE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import { PANEL_GLYPHS } from "@/shared/ui/panel-glyphs";
import PrintButton from "@/shared/ui/PrintButton";
import RadioField from "@/shared/ui/RadioField";
import { ROW_SX } from "@/shared/ui/row-fold";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  addPlanPointAction,
  editPlanPointAction,
  placeVolunteerAction,
  removePlanPictureAction,
  removePlanPointAction,
  sendVolunteerPointsAction,
  setPlanPictureAction,
} from "./actions";

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

/** The digits and the plus of a telephone number, which is what a `tel:` link dials (§953): one rule for a card and the table. */
const dialOf = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/**
 * A point's name in «Punctele, pe scurt» (§NNN): the link to its card below, a thumb's 44 pixels like the telephone beside it,
 * and on paper the name as text. A long name breaks inside the cell rather than widening the table.
 */
const POINT_LINK_SX = { ...PHONE_LINK_SX, overflowWrap: "anywhere" } as const;

/** The telephone in the table: the card's link, its number kept on one line. */
const TABLE_PHONE_SX = { ...PHONE_LINK_SX, whiteSpace: "nowrap" } as const;

/** The glyph of «Punctele, pe scurt»: the house's list (the one «Înscrieri» wears), by its name in the subjects' table. */
const ListGlyph = PANEL_GLYPHS.registrations;

/**
 * «Deschide pe hartă» beside a point's coordinates (§961): a link a thumb can press, 44 pixels tall (BR-REQ-041-01
 * criterion 6). Never on the paper, where the numbers stand as text and a link's words say nothing.
 */
const MAP_LINK_SX = { display: "inline-flex", alignItems: "center", ...TAP_TARGET, ...NOT_ON_PAPER } as const;

/**
 * The tallest the plan's picture is printed (§952): under the height of a sheet whichever way it is turned — an A4 or a Letter
 * page on its side leaves some 18 centimetres between the margins — so the picture is one piece on one sheet and never cut
 * between two. In centimetres, not in the viewport's units: a printed page's `vh` is not the same length in every browser.
 */
const PICTURE_ON_PAPER_MAX_HEIGHT = "17cm";

/** The prefix of the ids the boxes of «Adaugă un punct» carry, which its refusal's summary links to (`fieldId`). */
const ADD_SCOPE = "plan-point-add";

/** The glyph of «Modifică punctul», by its name in the registry — drawn here, on the server, never handed to an island. */
const EditIcon = ACTION_ICONS.edit;

/**
 * «Planul voluntarilor» (§949; the owner, 2026-11-16, with a map of the route and its seven points: «e foarte important sa
 * avem planul de voluntari si fiecare in ce punct ramane»): one event's points, each with the volunteers who stand at it —
 * their name, their number, how to reach them, what they were given to do — and under them everybody at no point. Built
 * here, one press a person («Pune aici», «Scoate»), and printed from here: the page is the paper.
 *
 * For whoever works the volunteers (`canManageVolunteers`: the Organizer and the Administrators) — anybody else gets the 404
 * of an address that does not exist (BR-REQ-060-01), and the service refuses them again. Nothing on it is public, and
 * placing, moving or taking off a person emails nobody: it is the organizers' own plan.
 *
 * **The points are of two kinds, in two groups (§961; the owner, 2026-11-17: «vreau să pot defini punctele de mână, să pun
 * nume punct și la ce km e și coordonate punct» — «Practic voluntarii sunt de 2 tipuri: start-finish și pe traseu»).**
 * «Start–finish» — the desk, the kits, the start and the finish line: no number and no kilometre — and «Pe traseu», the
 * numbered points in the route's order: the event's own «Puncte pe traseu» (§757), kept in the editor, and the ones the
 * organizers add here by hand, which only this page and the volunteer's own email see. They are added in «Punctele
 * planului», right under the picture they are drawn on — where the point is, its name, its kilometre, its coordinates — and
 * each point folds open onto «Modifică punctul»: everything of a point added here, the coordinates alone of an editor's
 * point. A point that has coordinates says them, with «Deschide pe hartă». The order and every number are
 * `plan-points.ts#listPlanPoints`'s, the one list the «Voluntari» list and the email read too.
 *
 * One press tells the volunteers (§956; the owner: «…si sa ii pot distribui din aplicatie, sa stie exact unde si cum» —
 * «Email din site, la apăsarea ta»): «Trimite fiecăruia punctul lui» emails each person placed at a point their point,
 * what they do there and the plan's picture (`modules/volunteers/point-mail.ts`). It asks first, with the four numbers the
 * service counted — who is written to, who already knows their point, who stands at a point with no address, who stands at
 * none — and «Trimite din nou tuturor», a tick in that question, writes to everybody again.
 *
 * Above the points, the plan as the organizers drew it (§952; the owner, with a picture of the route and its points numbered
 * on it: «trebui sa pot incarca si planul voluntarilor pe traseu in genul [pozei]»): one picture, as wide as the column, a
 * press opening the whole of it in a new tab — and on paper the first thing after the points' table, in one piece. Uploaded,
 * changed and taken off here by the same people; with no picture the page reads as it did, plus the upload.
 *
 * And above everything, the plan at a glance (§NNN; the owner, 2026-11-17: «aș vrea să văd punctele ca și tabel, mai ales pe
 * traseu»): «Punctele, pe scurt», one table of every point — the route's by kilometre, then the start–finish's —, its number,
 * its name linking to its card, its kilometre, where it is, its people with their telephones and how many; under it the
 * people placed and the points with nobody. The house's table (`AdminTable`: a block a point on a phone), read from the same
 * plan as the cards, and printed first, as a table: the plan's summary sheet.
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
  // The four numbers of «Trimite fiecăruia punctul lui» (§956), counted by the service exactly as the press counts them.
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
  // A kilometre as a box holds it: the page's decimal mark and no grouping — what `readKm` reads back.
  const kmBox = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(value);
  const rolesOf = (person: VolunteerPlanPerson) =>
    person.roleIds.flatMap((roleId) => {
      const words = plan.roles.get(roleId);
      return words ? [roleLabel(words, locale)] : [];
    });
  // The two groups (§961), as the plan's one list has them: the start–finish points first, then the route in its order.
  const startFinishPoints = plan.points.filter(({ point }) => point.startFinish);
  const routePoints = plan.points.filter(({ point }) => !point.startFinish);
  const peopleAt = (points: readonly VolunteerPlanPoint[]) => points.reduce((sum, { people }) => sum + people.length, 0);
  const atStartFinish = peopleAt(startFinishPoints);
  const onRoute = peopleAt(routePoints);
  const placed = atStartFinish + onRoute;
  const empty = plan.points.filter(({ people }) => people.length === 0).length;
  // The summary's four numbers, each a counted phrase (`countForm`, never an ICU plural).
  const counted = (key: "startFinish" | "route" | "unplaced" | "empty", count: number) => t(`volunteers.plan.summary.${key}.${countForm(count, locale)}`, { count });
  const summary = [counted("startFinish", atStartFinish), counted("route", onRoute), counted("unplaced", plan.unplaced.length), counted("empty", empty)];

  /*
    «Punctele, pe scurt» (§NNN; the owner, 2026-11-17: «aș vrea să văd punctele ca și tabel, mai ales pe traseu»): every point
    of the plan as one table at the top — the route's first, the start–finish's after — read from the plan the cards below
    read, so a row says exactly what its card says. The route's points come in the plan's one order (`listPlanPoints`): by
    kilometre, and numbered in that order, so by number too; the start–finish points as the page lists them. One row a point:
    its number, its name (a link to its card), its kilometre, where it is, who stands there with their telephones, how many.
  */
  const tableRows = [...routePoints, ...startFinishPoints];
  const nameOf = (point: PlanPoint) => (locale === "ro" ? point.nameRo : point.nameEn);
  const tableColumns: readonly AdminColumn<VolunteerPlanPoint>[] = [
    {
      key: "number",
      label: t("volunteers.plan.table.columns.number"),
      align: "right",
      // A start–finish point has no number: an empty cell, and on a phone no line.
      omitEmptyOnPhone: true,
      render: ({ number }) => (number === null ? null : <span data-testid="plan-table-number">{number}</span>),
    },
    {
      key: "point",
      label: t("volunteers.plan.table.columns.point"),
      // The phone's block is headed by the point's name.
      primary: true,
      render: ({ point }) => (
        <Box component="a" href={`#point-${point.id}`} sx={POINT_LINK_SX} data-testid="plan-table-point">
          {nameOf(point)}
        </Box>
      ),
    },
    {
      key: "km",
      label: t("volunteers.plan.table.columns.km"),
      align: "right",
      // As the card's title writes it («4,5»), or the plan's word for a point that has no kilometre.
      render: ({ point }) => <span data-testid="plan-table-km">{point.startFinish ? t("volunteers.plan.columnStartFinish") : km(point.km)}</span>,
    },
    {
      key: "coordinates",
      label: t("volunteers.plan.table.columns.coordinates"),
      // The numbers, on paper too, and the card's own link to a map beside them, which the paper leaves out.
      render: ({ point }) => {
        const where = coordinatesOf(point);
        if (!where) return <span data-testid="plan-table-coordinates">—</span>;
        return (
          <>
            <span data-testid="plan-table-coordinates">{formatCoordinates(where)}</span>{" "}
            <Box
              component="a"
              href={mapUrlOf(where)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("volunteers.plan.points.openMapFor", { name: nameOf(point) })}
              sx={MAP_LINK_SX}
              data-testid="plan-table-map"
            >
              {t("volunteers.plan.points.openMap")}
            </Box>
          </>
        );
      },
    },
    {
      key: "people",
      label: t("volunteers.plan.table.columns.people"),
      // The card's people in the card's order, a line each: the name and the telephone to ring.
      render: ({ people }) =>
        people.length === 0 ? (
          <Box component="span" sx={{ color: "text.secondary", fontStyle: "italic" }} data-testid="plan-table-nobody">
            {t("volunteers.plan.table.nobody")}
          </Box>
        ) : (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {people.map((person) => (
              <li key={person.id} data-testid="plan-table-person">
                <Box component="span" sx={{ overflowWrap: "anywhere" }} data-testid="plan-table-person-name">
                  {person.name}
                </Box>
                {person.phone && (
                  <>
                    {" "}
                    <Box component="a" href={dialOf(person.phone)} sx={TABLE_PHONE_SX} data-testid="plan-table-phone">
                      {formatPhone(person.phone)}
                    </Box>
                  </>
                )}
              </li>
            ))}
          </Box>
        ),
    },
    {
      key: "count",
      label: t("volunteers.plan.table.columns.count"),
      align: "right",
      render: ({ people }) => <span data-testid="plan-table-count">{people.length}</span>,
    },
  ];
  // The table's last line: the people placed at a point and the points with nobody, each a counted phrase.
  const tableTotal = t("volunteers.plan.table.total", {
    placed: t(`volunteers.plan.table.placed.${countForm(placed, locale)}`, { count: placed }),
    empty: counted("empty", empty),
  });
  const planPath = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id } } });
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
  // «Adaugă un punct» (§961): the words its refusal's summary says, and the label of each box it can name.
  const pointBoxes = {
    [PLAN_POINT_BOXES.place]: t("volunteers.plan.points.place"),
    [PLAN_POINT_BOXES.name]: t("volunteers.plan.points.name"),
    [PLAN_POINT_BOXES.km]: t("volunteers.plan.points.km"),
    [PLAN_POINT_BOXES.coordinates]: t("volunteers.plan.points.coordinates"),
  };
  const addRefusal = await refusalMessages(pointBoxes);
  // The form is drawn anew whenever the plan's points change, so the boxes are empty for the next point — while a refusal,
  // which changes no point, keeps the form and what was typed in it.
  const addFormKey = plan.points.map(({ point }) => point.id).join(",");

  /*
    «Trimite fiecăruia punctul lui» (§956): from the four numbers of its question (`previewVolunteerPoints`, read above with
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
            <Box component="a" href={dialOf(person.phone)} sx={PHONE_LINK_SX} data-testid="plan-person-phone">
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

  /**
   * One point of the plan, in either group: its title — numbered with its kilometre on the route, the name alone at the
   * start–finish —, what it is, where it is, its people, «Pune aici», and the fold that changes it. Everything that builds
   * the plan stays off the paper; a point is never split across two sheets.
   */
  const pointRow = ({ point, number, people }: VolunteerPlanPoint) => {
    const name = locale === "ro" ? point.nameRo : point.nameEn;
    const where = coordinatesOf(point);
    // What an editor's point offers and its note, in the backoffice's words; a point added here has neither.
    const facts = [point.kinds.map((kind) => t(`checkpoints.kinds.${kind}`)).join(", "), (locale === "ro" ? point.noteRo : point.noteEn) ?? ""].filter((part) => part !== "");
    return (
      <Box
        component="li"
        key={point.id}
        id={`point-${point.id}`}
        data-testid="plan-point"
        data-place={point.startFinish ? "startFinish" : "route"}
        // The house's row (§842): a hairline between points, never a card of its own; a point is not split across two sheets.
        sx={{ ...ROW_SX, py: 2, breakInside: "avoid", scrollMarginTop: 16 }}
      >
        <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "baseline", columnGap: 1 }}>
          <Typography component="h4" variant="h3" sx={{ ...HEADING_SX[4], minWidth: 0, overflowWrap: "break-word" }} data-testid="plan-point-title">
            {number === null ? name : t("volunteers.plan.pointTitle", { number, title: t("checkpoints.rowTitle", { km: km(point.km), name }) })}
          </Typography>
          {/* A point of the route that only the plan has: said so, quietly. At the start–finish the group says what the point is. */}
          {point.planOnly && !point.startFinish && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", ...NOT_ON_PAPER }} data-testid="plan-point-own">
              {t("volunteers.plan.points.planOnly")}
            </Typography>
          )}
        </Stack>
        {facts.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "break-word" }}>
            {facts.join(" · ")}
          </Typography>
        )}
        {/* Where the point is, when it has coordinates: the numbers — on the paper too — and the link to a map, which the paper leaves out. */}
        {where && (
          <Typography variant="body2" component="p" sx={{ m: 0, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1.5 }} data-testid="plan-point-where">
            <span data-testid="plan-point-coordinates">{formatCoordinates(where)}</span>
            <Box component="a" href={mapUrlOf(where)} target="_blank" rel="noopener noreferrer" aria-label={t("volunteers.plan.points.openMapFor", { name })} sx={MAP_LINK_SX} data-testid="plan-point-map">
              {t("volunteers.plan.points.openMap")}
            </Box>
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

        {/* «Modifică punctul» (§961): the row's own fold, closed — a native one, so it opens without scripts. A point added here
            is changed whole, its kind included; of an editor's point only where it is: its name and kilometre are public, and
            are the editor's. A refused save lands at the page's alert with its code, as every press of this page (§953). */}
        <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, boxSizing: "border-box", width: "100%", maxWidth: 560, mt: 2, ...NOT_ON_PAPER }} data-testid="plan-point-edit">
          <Box component="summary" aria-label={t("volunteers.plan.points.editFor", { name })}>
            <EditIcon fontSize="small" aria-hidden sx={FOLD_GLYPH_SX} />
            <Typography component="span" variant="body2">
              {t("volunteers.plan.points.edit")}
            </Typography>
          </Box>
          <Stack component="form" action={editPlanPointAction} spacing={2} sx={{ alignItems: "flex-start", mt: 1 }} data-testid="plan-point-edit-form">
            {hidden}
            <input type="hidden" name="pointId" value={point.id} />
            {point.planOnly ? (
              <>
                <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0, width: "100%" }}>
                  <Typography component="legend" variant="body2" sx={{ p: 0, fontWeight: 600 }}>
                    {t("volunteers.plan.points.place")}
                  </Typography>
                  <RadioField name={PLAN_POINT_BOXES.place} value="route" defaultChecked={!point.startFinish}>
                    {t("volunteers.plan.points.placeRoute")}
                  </RadioField>
                  <RadioField name={PLAN_POINT_BOXES.place} value="startFinish" defaultChecked={point.startFinish}>
                    {t("volunteers.plan.points.placeStartFinish")}
                  </RadioField>
                </Box>
                <TextField
                  name={PLAN_POINT_BOXES.name}
                  label={t("volunteers.plan.points.name")}
                  defaultValue={point.nameRo}
                  required
                  fullWidth
                  size="small"
                  slotProps={{ htmlInput: { maxLength: CHECKPOINT_NAME_MAX, "data-testid": "plan-point-edit-name" } }}
                />
                <TextField
                  name={PLAN_POINT_BOXES.km}
                  label={t("volunteers.plan.points.km")}
                  helperText={t("volunteers.plan.points.kmHelper")}
                  defaultValue={point.startFinish ? "" : kmBox(point.km)}
                  fullWidth
                  size="small"
                  slotProps={{ htmlInput: { inputMode: "decimal", maxLength: 12, "data-testid": "plan-point-edit-km" } }}
                />
              </>
            ) : (
              <Typography variant="body2" color="text.secondary" data-testid="plan-point-editors">
                {/* The link says the editor's card by its own name: the sentence has already said «în editorul evenimentului». */}
                {t("volunteers.plan.points.editorsOnly")} <Link href={{ pathname: "/admin/events/[id]", params: { id }, hash: "box-checkpoints" }}>{t("checkpoints.title")}</Link>
              </Typography>
            )}
            <TextField
              name={PLAN_POINT_BOXES.coordinates}
              label={t("volunteers.plan.points.coordinates")}
              helperText={t("volunteers.plan.points.coordinatesHelper")}
              defaultValue={where ? formatCoordinates(where) : ""}
              fullWidth
              size="small"
              slotProps={{ htmlInput: { "data-testid": "plan-point-edit-coordinates" } }}
            />
            <GlyphButton icon="save" type="submit" variant="outlined" size="small" sx={TAP_TARGET} data-testid="plan-point-save">
              {t("volunteers.plan.points.save")}
            </GlyphButton>
          </Stack>
          {/* «Șterge punctul», last and only on a point added here: it asks first, with the point's name and how many people
              stand there — they stay on the plan, at no point. An editor's point is deleted in the editor. */}
          {point.planOnly && (
            <Box component="form" action={removePlanPointAction} sx={{ mt: 1.5 }} data-testid="plan-point-remove-form">
              {hidden}
              <input type="hidden" name="pointId" value={point.id} />
              <ConfirmSubmitButton
                label={t("volunteers.plan.points.remove")}
                ariaLabel={t("volunteers.plan.points.removeFor", { name })}
                icon="delete"
                color="error"
                variant="text"
                size="medium"
                title={t("volunteers.plan.points.removeTitle", { name })}
                body={people.length === 0 ? t("volunteers.plan.points.removeBodyNobody") : t(`volunteers.plan.points.removeBody.${countForm(people.length, locale)}`, { count: people.length })}
                confirmLabel={t("volunteers.plan.points.remove")}
                cancelLabel={t("confirm.cancel")}
              />
            </Box>
          )}
        </Box>
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
          so the region can take the focus and stands clear of the page's top edge, as the other pages' regions do. A sentence
          of the plan's points that names a number (`{max}`) is given it (`planPointRefusalValues`). */}
      <Box id="admin-alert" tabIndex={-1} aria-live="polite" sx={{ scrollMarginTop: 16, ...NOT_ON_PAPER }}>
        {errorCode && <Alert severity="error">{t(`errors.${errorCode}`, planPointRefusalValues(errorCode))}</Alert>}
      </Box>

      <Typography variant="h2" sx={HEADING_SX.title}>
        {t("volunteers.plan.title")}
      </Typography>
      {event && (
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t("volunteers.plan.event", { event: event.title, date: when })}
        </Typography>
      )}
      <Box sx={NOT_ON_PAPER}>
        <Typography variant="body2" color="text.secondary">
          {t("volunteers.plan.help")}
        </Typography>
        {/* Who sees which points (§961): the editor's are public too. That the ones added here are the plan's alone is said once,
            where they are added («Punctele planului», `points.helpPrivate`). */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="plan-help-points">
          {t("volunteers.plan.helpPoints")}
        </Typography>
      </Box>
      <Box>
        <PrintButton label={t("volunteers.plan.print")} />
      </Box>

      {/* «Punctele, pe scurt» (§NNN): the whole plan at a glance, before the picture and the cards — the house's table, a block a
          point on a phone, every row on the one page. On paper it is the plan's summary sheet, printed whole as a table, the
          first thing after the title; the map's links stay off it, the names and the telephones print as text. A plan with no
          point has no table: the list below says how to add one. */}
      {tableRows.length > 0 && (
        <Box component="section" id="plan-table" aria-labelledby="plan-table-heading" sx={{ scrollMarginTop: 16 }} data-testid="plan-table-section">
          <Typography id="plan-table-heading" variant="h3" sx={HEADING_SX[3]}>
            <ListGlyph aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
            {t("volunteers.plan.table.title")}
          </Typography>
          <Box sx={{ mt: 1 }}>
            <AdminTable
              caption={t("volunteers.plan.table.title")}
              tableId="volunteer-plan"
              columns={tableColumns}
              rows={tableRows}
              rowKey={({ point }) => point.id}
              basePath={planPath}
              currentParams={{}}
              query={{ page: 1, perPage: tableRows.length, sort: "number", dir: "asc", offset: 0, limit: tableRows.length }}
              total={tableRows.length}
              labels={{
                results: tableTotal,
                page: t("list.page", { page: 1, pages: 1 }),
                previous: t("list.previous"),
                next: t("list.next"),
                perPage: t("list.perPage"),
                actions: t("list.actions"),
                sortBy: (column) => t("list.sortBy", { column }),
              }}
              paged={false}
              printable
              empty={null}
            />
          </Box>
        </Box>
      )}

      {/* The plan as the organizers drew it (§952): above the points on the page, and on paper the first thing after the points'
          table (§NNN) — the section's own heading, its hint and every control stay off the sheet, so a plan with no picture
          prints as it did. */}
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

      {/* «Punctele planului» (§961): right under the picture the points are drawn on — where the organizers add the plan's own
          points by hand, one after another. Never on the paper. A plain form and a Server Action: it works with scripts off,
          where the kilometre's box is simply there and not read for a point at the start–finish. A refusal comes back as the
          form's own state (§315): the box is named and what was typed stays. */}
      <Box id="plan-points" sx={{ scrollMarginTop: 16, ...NOT_ON_PAPER }} data-testid="plan-points-section">
        <Typography variant="h3" sx={HEADING_SX[3]}>
          {t("volunteers.plan.points.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="plan-points-help">
          {t("volunteers.plan.points.help")} {t("volunteers.plan.points.helpCoordinates")} {t("volunteers.plan.points.helpPrivate")}
        </Typography>
        <Typography component="h4" variant="h3" sx={{ ...HEADING_SX[4], mt: 2 }}>
          {t("volunteers.plan.points.addTitle")}
        </Typography>
        <Box sx={{ mt: 1, maxWidth: 560 }}>
          <ActionForm key={addFormKey} action={addPlanPointAction} messages={addRefusal} scope={ADD_SCOPE} data-testid="plan-point-add-form">
            {hidden}
            <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
              <Box component="fieldset" id={fieldId(PLAN_POINT_BOXES.place, ADD_SCOPE)} tabIndex={-1} sx={{ border: 0, m: 0, p: 0, minWidth: 0, width: "100%", scrollMarginTop: 16 }}>
                <Typography component="legend" variant="body2" sx={{ p: 0, fontWeight: 600 }}>
                  {t("volunteers.plan.points.place")}
                </Typography>
                <RadioField name={PLAN_POINT_BOXES.place} value="route" defaultChecked>
                  {t("volunteers.plan.points.placeRoute")}
                </RadioField>
                <RadioField name={PLAN_POINT_BOXES.place} value="startFinish">
                  {t("volunteers.plan.points.placeStartFinish")}
                </RadioField>
              </Box>
              <RecallField
                name={PLAN_POINT_BOXES.name}
                label={t("volunteers.plan.points.name")}
                required
                fullWidth
                size="small"
                slotProps={{ htmlInput: { maxLength: CHECKPOINT_NAME_MAX, "data-testid": "plan-point-add-name" } }}
              />
              <RecallField
                name={PLAN_POINT_BOXES.km}
                label={t("volunteers.plan.points.km")}
                helperText={t("volunteers.plan.points.kmHelper")}
                fullWidth
                size="small"
                slotProps={{ htmlInput: { inputMode: "decimal", maxLength: 12, "data-testid": "plan-point-add-km" } }}
              />
              <RecallField
                name={PLAN_POINT_BOXES.coordinates}
                label={t("volunteers.plan.points.coordinates")}
                helperText={t("volunteers.plan.points.coordinatesHelper")}
                fullWidth
                size="small"
                slotProps={{ htmlInput: { "data-testid": "plan-point-add-coordinates" } }}
              />
              <GlyphButton icon="add" type="submit" variant="contained" size="medium" sx={TAP_TARGET} data-testid="plan-point-add">
                {t("volunteers.plan.points.add")}
              </GlyphButton>
            </Stack>
          </ActionForm>
        </Box>
      </Box>

      {/* «Trimite fiecăruia punctul lui» (§956): the one press that tells the volunteers — never on the paper. The numbers are the
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

      {/* The plan itself (§961): two groups, each under its own heading on the page and on the paper — the points at the
          start–finish, with no number and no kilometre, then the points on the route, numbered in the route's order. A press
          that deleted a point comes back here. */}
      <Stack id="plan-list" spacing={2} sx={{ scrollMarginTop: 16 }}>
        {plan.points.length === 0 ? (
          <Alert severity="info" sx={NOT_ON_PAPER} data-testid="plan-no-points">
            {t("volunteers.plan.noPoints")}
          </Alert>
        ) : (
          <>
            {/* How many people stand where, and how many points have nobody: each number a phrase that never breaks in two, so
                the line wraps between them on a phone. */}
            <Typography variant="body2" data-testid="plan-summary">
              {summary.map((part, at) => (
                <Fragment key={part}>
                  {at > 0 && " · "}
                  <Box component="span" sx={{ whiteSpace: "nowrap" }}>
                    {part}
                  </Box>
                </Fragment>
              ))}
            </Typography>

            {/* A group with no point says so in one quiet line, and stays off the paper whole: a heading with nothing under it is no plan. */}
            <Box component="section" aria-labelledby="plan-group-start-finish" sx={startFinishPoints.length === 0 ? NOT_ON_PAPER : undefined} data-testid="plan-group" data-group="startFinish">
              <Typography id="plan-group-start-finish" variant="h3" sx={HEADING_SX[3]}>
                {t("volunteers.plan.groups.startFinish")}
              </Typography>
              {startFinishPoints.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="plan-group-none">
                  {t("volunteers.plan.groups.startFinishNone")}
                </Typography>
              ) : (
                <Stack spacing={0} component="ul" aria-labelledby="plan-group-start-finish" sx={{ listStyle: "none", m: 0, p: 0 }}>
                  {startFinishPoints.map(pointRow)}
                </Stack>
              )}
            </Box>

            <Box component="section" aria-labelledby="plan-group-route" sx={routePoints.length === 0 ? NOT_ON_PAPER : undefined} data-testid="plan-group" data-group="route">
              <Typography id="plan-group-route" variant="h3" sx={HEADING_SX[3]}>
                {t("volunteers.plan.groups.route")}
              </Typography>
              {routePoints.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="plan-group-none">
                  {t("volunteers.plan.groups.routeNone")}
                </Typography>
              ) : (
                <Stack spacing={0} component="ol" aria-labelledby="plan-group-route" sx={{ listStyle: "none", m: 0, p: 0 }}>
                  {routePoints.map(pointRow)}
                </Stack>
              )}
            </Box>
          </>
        )}
      </Stack>

      <Box sx={{ breakInside: "avoid" }} data-testid="plan-unplaced">
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
