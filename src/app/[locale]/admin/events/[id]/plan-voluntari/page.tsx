import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { getDb } from "@/db/client";
import { PLAN_POINT_NOTE_MAX } from "@/db/schema/event-checkpoints";
import { PLAN_LINK_LABEL_MAX, PLAN_LINK_URL_MAX, PLAN_LINKS_MAX, PLAN_PICTURES_MAX } from "@/db/schema/volunteer-plan";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
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
import { PLAN_LINK_BOXES, planLinkShort, planMapsRefusalValues } from "@/modules/volunteers/domain/plan-link";
import { roleLabel } from "@/modules/volunteers/domain/volunteer";
import { readVolunteerPlan, type VolunteerPlanPerson, type VolunteerPlanPoint } from "@/modules/volunteers/plan";
import { coordinatesOf, PLAN_POINT_BOXES, type PlanPoint, planPointRefusalValues } from "@/modules/volunteers/plan-points";
import { previewVolunteerPoints } from "@/modules/volunteers/point-mail";
import PlanPictureUpload from "@/modules/volunteers/ui/PlanPictureUpload";
import type { VolunteerPlanNote } from "@/modules/volunteers/volunteer-notes";
import { isDomainError } from "@/shared/errors/domain-error";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import ActionForm from "@/shared/forms/ActionForm";
import { fieldId } from "@/shared/forms/outcome";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { isUuid } from "@/shared/ids";
import { noteLine } from "@/shared/notes/note-text";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_INLINE_SX } from "@/shared/ui/disclosure";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import { PANEL_GLYPHS, type PanelGlyphName } from "@/shared/ui/panel-glyphs";
import PrintButton from "@/shared/ui/PrintButton";
import RadioField from "@/shared/ui/RadioField";
import SubNav from "@/shared/ui/SubNav";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  addPlanLinkAction,
  addPlanPictureAction,
  addPlanPointAction,
  editPlanPointAction,
  placeVolunteerAction,
  removePlanLinkAction,
  removePlanPictureAction,
  removePlanPointAction,
  sendVolunteerPointsAction,
} from "./actions";
import { PLAN_SAVED, planAddress, planViewOf } from "./plan-address";

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

/** The digits and the plus of a telephone number, which is what a `tel:` link dials (§953): one rule for a point and the table. */
const dialOf = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/**
 * A point's name in «Punctele, pe scurt» (§974): in bold, as everywhere on the page (the owner: «vreau ca denumirea punctului să
 * fie cu bold și mai vizibilă»), the link to its point on «Pe puncte», a thumb's 44 pixels like the telephone beside it, and
 * on paper the name as text. A long name breaks inside the cell rather than widening the table.
 */
const POINT_LINK_SX = { ...PHONE_LINK_SX, fontWeight: 700, overflowWrap: "anywhere" } as const;

/** The telephone in the table: the point's own link, its number kept on one line. */
const TABLE_PHONE_SX = { ...PHONE_LINK_SX, whiteSpace: "nowrap" } as const;

/**
 * The address beside the telephone in «Punctele, pe scurt» (§994): a `mailto:` link with the telephone's shape — a thumb's 44
 * pixels, on paper the address as text — that breaks inside the cell rather than widening the table.
 */
const TABLE_EMAIL_SX = { ...PHONE_LINK_SX, overflowWrap: "anywhere" } as const;

/**
 * The volunteers of one point in «Punctele, pe scurt» (§1009; the owner, 2026-11-19: «vreau sa numerotez aici voluntarii si sa
 * fac cu bold numele lor» — «si vreau un separator acolo la voluntari sa se vada ca e o lista, gen un <hr/>»): a numbered list
 * whose numbers are its words («1.», «2.», …), each person under a thin line — the house's divider colour, one pixel — but the
 * first, on the screen and on paper alike.
 */
const TABLE_PEOPLE_SX = {
  listStyle: "none",
  m: 0,
  p: 0,
  "& > li + li": { borderTop: "1px solid", borderColor: "divider", mt: 0.75, pt: 0.75 },
} as const;

/** A person's name in that list (§994, §1009): in bold and in capitals — the words stay as typed — breaking inside the cell. */
const TABLE_PERSON_NAME_SX = { fontWeight: 700, overflowWrap: "anywhere", textTransform: "uppercase" } as const;

/**
 * «Notă pentru voluntari» where the plan draws it (§1009): a quiet block under the point's name — in its fold on «Pe puncte», in
 * the «Punct» cell of «Punctele, pe scurt» —, its label in bold, the note's own line breaks kept and a long word broken, so it
 * wraps inside the cell and never widens the table, a phone's 320 pixels included; on paper as on the screen. Its own weight and
 * size: the phone's block draws the cell inside a bold headline.
 */
const VOLUNTEER_NOTE_SX = { m: 0, fontWeight: 400, whiteSpace: "pre-line", overflowWrap: "anywhere" } as const;

/** …in the table never wider than a short line, so one long note does not squeeze the people beside it; in a fold, a reading line. */
const VOLUNTEER_NOTE_WIDTH = { table: "42ch", fold: "72ch" } as const;

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

/** The tallest a picture of «Poze și hărți» is drawn on the screen (§978): a row of the grid a laptop takes in at a glance. */
const PICTURE_ON_SCREEN_MAX_HEIGHT = 360;

/**
 * The pictures of «Poze și hărți» on the screen (§978): a grid of cells at least 260 pixels wide — two or three a row on a
 * laptop, one on a phone. On paper a column, one picture after the other, each one piece.
 */
const PICTURE_GRID_SX = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
  gap: 2,
  listStyle: "none",
  m: 0,
  p: 0,
  "@media print": { display: "block" },
} as const;

/**
 * A link of «Poze și hărți» (§978): its label in bold, a thumb's 44 pixels tall (BR-REQ-041-01 criterion 6), a long one
 * breaking inside the line rather than widening the page; on paper the words as text, no link's colour or height.
 */
const LINK_SX = {
  display: "inline-flex",
  alignItems: "center",
  ...TAP_TARGET,
  fontWeight: 700,
  overflowWrap: "anywhere",
  "@media print": { minHeight: 0, color: "inherit", textDecoration: "none" },
} as const;

/** The prefix of the ids the boxes of «Adaugă un link» carry, which its refusal's summary links to (`fieldId`). */
const LINK_SCOPE = "plan-link-add";

/** The prefix of the ids the boxes of «Adaugă un punct» carry, which its refusal's summary links to (`fieldId`). */
const ADD_SCOPE = "plan-point-add";

/** The glyph of «Modifică punctul», by its name in the registry — drawn here, on the server, never handed to an island. */
const EditIcon = ACTION_ICONS.edit;

/**
 * The picture each part of the page wears (§521), by its name in the subjects' table (`panel-glyphs.ts`): the two views — the
 * house's list (the one «Înscrieri» wears) and the pin of a point —, the two groups — the route, and the start and finish
 * line's flag —, each point's pin, «Poze și hărți» above the plan (§978), the two folds under it — the add, the email —, and
 * «Fără punct» (§978).
 */
const PART_GLYPH = {
  table: { glyph: "registrations" },
  points: { glyph: "checkpoints" },
  route: { glyph: "course" },
  startFinish: { glyph: "finishLine" },
  point: { glyph: "checkpoints" },
  maps: { glyph: "pictures" },
  add: { glyph: "add" },
  mail: { glyph: "email" },
  unplaced: { glyph: "volunteers" },
} as const satisfies Record<string, { glyph: PanelGlyphName }>;

const ListGlyph = PANEL_GLYPHS[PART_GLYPH.table.glyph];
const PointIcon = PANEL_GLYPHS[PART_GLYPH.point.glyph];

/** A fold inside a fold — each point inside its group — pads a step narrower on a phone, as `Panel`'s card of cards does (§350). */
const NESTED_FOLD_SX = {
  px: { xs: 1.5, sm: 2 },
  "& > summary": { ...BOXED_DISCLOSURE_SX["& > summary"], mx: { xs: -1.5, sm: -2 }, px: { xs: 1.5, sm: 2 } },
} as const;

/**
 * On paper a group and a point print open, their arrows left off (§974): the sheet is the whole plan whatever the screen had
 * folded — the body the browser hides in a closed fold (`::details-content`) is shown. A browser that has no such part prints
 * the folds as they stand on the screen.
 */
const OPEN_ON_PAPER = {
  "@media print": {
    "& > summary::before": { display: "none" },
    "&::details-content": { display: "block", contentVisibility: "visible" },
  },
} as const;

/**
 * «Poze și hărți» on paper (§952, §978): the pictures and the links alone, open whatever the screen had folded — the fold's
 * frame, its bar and its closed line are left off, so the sheet carries the maps and nothing that builds them — and after the
 * rest of the plan (`order` in the page's flex column), which prints first as it always did: the fold stands first on the
 * screen, where the owner wants the map in sight.
 */
const MAPS_ON_PAPER = {
  "@media print": {
    order: 1,
    border: 0,
    px: 0,
    bgcolor: "transparent",
    "& > summary": { display: "none" },
    "&::details-content": { display: "block", contentVisibility: "visible" },
  },
} as const;

/**
 * «Modifică punctul» (§974; the owner: «și în loc de „modifică punctul” pune doar buton de edit»): the house's pencil, a
 * 44-pixel square at the right of the point's people — a native fold whose bar is the glyph alone, so it opens without a
 * script —, and open, the point's form under it across the whole row, the pencil still at its right. Never on paper.
 */
const PENCIL_FOLD_SX = {
  flex: "none",
  "&[open]": { flexBasis: "100%" },
  "& > summary": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    width: 44,
    height: 44,
    ml: "auto",
    border: 1,
    borderColor: "divider",
    borderRadius: 1,
    color: "text.secondary",
    cursor: "pointer",
    listStyle: "none",
    "&::-webkit-details-marker": { display: "none" },
    "&::marker": { content: '""' },
    "&:hover": { bgcolor: "action.hover", color: "text.primary" },
    "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
  },
  "&[open] > summary": { color: "primary.main", borderColor: "primary.main" },
  ...NOT_ON_PAPER,
} as const;

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
 * **Two views, and folds (§974; the owner, 2026-11-17, of the page's long run of cards: «vreau secțiuni colapsabile aici la
 * plan voluntari că nu mai înțeleg nimic: de fapt tabel sau mai multe views»).** Under the intro, two links — «Tabel», the
 * default, and «Pe puncte» (`?view=table|points`, `plan-address.ts`), the current one marked —, plain addresses drawn on the
 * server. «Tabel» is «Punctele, pe scurt» (§974; the owner: «aș vrea să văd punctele ca și tabel, mai ales pe traseu»): one
 * table of every point — the route's by kilometre, then the start–finish's —, its number, its name linking to that point
 * on «Pe puncte», its kilometre, where it is, its people with their telephones and how many, and under it the people placed
 * and the points with nobody; the house's table (`AdminTable`: a block a point on a phone), printed as a table. «Pe puncte»
 * is the points themselves in two folds, «Pe traseu» and «La start–finish», each point a fold of its own whose bar says its
 * name in bold, its kilometre and how many stand there, and whose body holds where it is, its people with «Scoate», «Pune
 * aici» and the pencil of «Modifică punctul». Both views keep «Poze și hărți» above them (§978: the first fold, under the
 * intro), the two folds under the plan — «Adaugă un punct», «Trimite fiecăruia punctul lui» — and, last, «Fără punct», a
 * fold too since §978, whose every person has the point to put them at and «Pune» on their own line; each fold says on its
 * closed line what it holds. Every fold starts closed and opens by itself for what the last press changed — a point and its
 * group (`open=`), the fold a press saved in (`saved=`) — or, «Adaugă un punct», on a plan with no point yet, and «Poze și
 * hărți» whenever it holds something; and every press comes back to the view it was pressed in.
 *
 * **The points are of two kinds, in two groups (§961; the owner, 2026-11-17: «vreau să pot defini punctele de mână, să pun
 * nume punct și la ce km e și coordonate punct» — «Practic voluntarii sunt de 2 tipuri: start-finish și pe traseu»).**
 * «La start–finish» — the desk, the kits, the start and the finish line: no number and no kilometre — and «Pe traseu», the
 * numbered points in the route's order: the event's own «Puncte pe traseu» (§757), kept in the editor, and the ones the
 * organizers add here by hand, which only this page and the volunteer's own email see. They are added in «Adaugă un punct» —
 * where the point is, its name, its kilometre, its coordinates — and each point's pencil opens «Modifică punctul»:
 * everything of a point added here, the coordinates alone of an editor's point. A point that has coordinates says them,
 * with «Deschide pe hartă». The order and every number are `plan-points.ts#listPlanPoints`'s, the one list the «Voluntari»
 * list and the email read too.
 *
 * One press tells the volunteers (§956; the owner: «…si sa ii pot distribui din aplicatie, sa stie exact unde si cum» —
 * «Email din site, la apăsarea ta»): «Trimite fiecăruia punctul lui» emails each person placed at a point their point,
 * what they do there and the plan's pictures and links (`modules/volunteers/point-mail.ts`). It asks first, with the four numbers the
 * service counted — who is written to, who already knows their point, who stands at a point with no address, who stands at
 * none — and «Trimite din nou tuturor», a tick in that question, writes to everybody again.
 *
 * The plan as the organizers drew it (§952; the owner, with a picture of the route and its points numbered on it: «trebui sa
 * pot incarca si planul voluntarilor pe traseu in genul [pozei]» — and since §978, 2026-11-18: «Poza planului trebuie sa fie
 * mai sus, si sa pot pune mai multe poze, si link-uri»): «Poze și hărți», up to twelve pictures in a grid, a press opening the
 * whole of one in a new tab, and up to twelve links — a Google My Maps map, for instance — each opening in a new tab; on paper
 * after the rest of the plan, each picture in one piece and each link with its whole address. Added and taken off here by the
 * same people.
 *
 * The organizers' own words beside each person (§981, amending §954 and §935; the owner, 2026-11-18, three days before the race:
 * «să văd în plan și comentariile mele»): wherever a person is drawn — at a point, under «Fără punct», in the table's people cell —
 * the race-day decision in a quiet line of its own, which prints, and the person's internal notes, newest first with their day,
 * which never print. Both come with the plan's one read (`readVolunteerPlan`); the notes only for a role their own gate allows.
 *
 * «Notă pentru voluntari» and the people as a list (§1009; the owner, 2026-11-19: «si am nevoie de un nou field "noua pentru
 * voluntari"», «vreau sa numerotez aici voluntarii si sa fac cu bold numele lor», «vreau un separator acolo la voluntari sa se
 * vada ca e o lista»): every point may carry what everybody standing there has to know, in both languages, written in its
 * «Modifică punctul» and drawn under its name — in its fold on «Pe puncte», in the «Punct» cell of «Punctele, pe scurt» — on
 * the screen and on paper (`volunteerNoteBlock`); the email of each person placed there says it too (`point-mail.ts`). A
 * point's people are numbered in its order, «1.», «2.», … — in the table each name in bold with a thin line between two
 * people (`TABLE_PEOPLE_SX`), on «Pe puncte» the same numbers before the names.
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
  const query = await searchParams;
  // The action's language-neutral code (AGENTS.md §14.3) becomes a sentence here; an unknown code says nothing.
  const errorCode = query.planError && /^[A-Z_]{1,48}$/.test(query.planError) && t.has(`errors.${query.planError}`) ? query.planError : null;
  // The view the address names (§974), «Tabel» when it names none; the point the last press changed, which «Pe puncte» draws
  // open in its open group — only a point of this plan; and the fold the last press saved in.
  const view = planViewOf(query.view);
  const opened = query.open ?? "";
  const openPoint = view === "points" && isUuid(opened) && plan.points.some(({ point }) => point.id === opened) ? opened : null;
  const saved = query.saved;

  const km = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  // A kilometre as a box holds it: the page's decimal mark and no grouping — what `readKm` reads back.
  const kmBox = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(value);
  const rolesOf = (person: VolunteerPlanPerson) =>
    person.roleIds.flatMap((roleId) => {
      const words = plan.roles.get(roleId);
      return words ? [roleLabel(words, locale)] : [];
    });
  // The two groups (§961), as the plan's one list has them: the start–finish points, and the route in its order.
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
  // How many stand at a point, or a group, said on its closed line: «2 voluntari», «niciun voluntar».
  const peopleWords = (count: number) => (count === 0 ? t("volunteers.plan.peopleNone") : t(`volunteers.plan.people.${countForm(count, locale)}`, { count }));
  const nameOf = (point: PlanPoint) => (locale === "ro" ? point.nameRo : point.nameEn);
  /**
   * A point's «Notă pentru voluntari» as the plan draws it (§1009), under the point's name — in its fold on «Pe puncte» and in the
   * «Punct» cell of «Punctele, pe scurt»: «Notă pentru voluntari:» in bold, then the note in the page's language, its line breaks
   * kept; on the screen and on paper. Nothing for a point that has none.
   */
  const volunteerNoteBlock = (point: PlanPoint, where: keyof typeof VOLUNTEER_NOTE_WIDTH, testId: string) => {
    const note = locale === "ro" ? point.volunteerNoteRo : point.volunteerNoteEn;
    if (!note) return null;
    return (
      <Typography component="p" variant="body2" sx={{ ...VOLUNTEER_NOTE_SX, maxWidth: VOLUNTEER_NOTE_WIDTH[where], ...(where === "table" ? { mt: 0.25 } : {}) }} data-testid={testId}>
        <Box component="strong" sx={{ fontWeight: 700 }}>
          {t("volunteers.plan.points.volunteerNote")}
        </Box>{" "}
        <span data-testid={`${testId}-words`}>{note}</span>
      </Typography>
    );
  };
  /** A person's number in their point's list (§1009): «1.», «2.», … in the point's order — the plan's, by name. */
  const personNumber = (number: number) => t("volunteers.plan.personNumber", { number });
  const planPath = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id } } });

  // A note's moment on the club's clock, as the person's page and the files write it: the day and the hour, short.
  const noteDay = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
  /**
   * A person's «Note interne» on the plan (§981, amending §935; the owner, 2026-11-18: «să văd în plan și comentariile mele»): the
   * live notes, newest first, one line each — the words (`noteLine`: one line, a long one cut) and, quieter, the day and hour —, a list
   * a screen reader names «Note interne». Nothing for a person with none, or for a reader the notes' gate leaves out (the read hands
   * them none). Never on paper: remarks between colleagues stay on the screen, the plan handed around on the day carries none.
   */
  const notesOf = (notes: readonly VolunteerPlanNote[]) =>
    notes.length === 0 ? null : (
      <Box component="ul" aria-label={t("volunteers.plan.notes")} sx={{ listStyle: "none", m: 0, p: 0, ...NOT_ON_PAPER }} data-testid="plan-person-notes">
        {notes.map((note) => (
          <Typography component="li" key={note.id} variant="body2" sx={{ overflowWrap: "break-word" }} data-testid="plan-person-note">
            <span data-testid="plan-person-note-words">{noteLine(note.body)}</span>
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, whiteSpace: "nowrap" }} data-testid="plan-person-note-date">
              {noteDay(note.createdAt)}
            </Typography>
          </Typography>
        ))}
      </Box>
    );
  /**
   * The organizers' own words about a person, under the person wherever the plan draws them — at a point, under «Fără punct» and in
   * the table's people cell (§981, amending §954): the race-day decision in its own quiet line, «Decizie: vine la 8:00 la start»,
   * which prints (it is the day's plan), then the notes, which do not. Nothing where there is neither.
   */
  const ownWordsOf = (person: VolunteerPlanPerson) => (
    <>
      {person.raceDayDecision && (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "break-word" }} data-testid="plan-person-decision">
          {t("volunteers.plan.decision", { decision: person.raceDayDecision })}
        </Typography>
      )}
      {notesOf(person.notes)}
    </>
  );

  /*
    «Punctele, pe scurt» (§974; the owner, 2026-11-17: «aș vrea să văd punctele ca și tabel, mai ales pe traseu»), the view
    «Tabel»: every point of the plan as one table — the route's first, the start–finish's after — read from the plan «Pe
    puncte» draws, so a row says exactly what its point says. The route's points come in the plan's one order
    (`listPlanPoints`): by kilometre, and numbered in that order, so by number too; the start–finish points as the page lists
    them. One row a point: its number, its name (a link to that point on «Pe puncte», open), its kilometre, where it is, who
    stands there with their telephones, how many.
  */
  const tableRows = [...routePoints, ...startFinishPoints];
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
      // Under the name, the point's «Notă pentru voluntari» (§1009), which prints with the table.
      render: ({ point }) => (
        <>
          <Box component="a" href={planAddress(planPath, { view: "points", open: point.id, hash: `point-${point.id}` })} sx={POINT_LINK_SX} data-testid="plan-table-point">
            {nameOf(point)}
          </Box>
          {volunteerNoteBlock(point, "table", "plan-table-volunteer-note")}
        </>
      ),
    },
    {
      key: "km",
      label: t("volunteers.plan.table.columns.km"),
      align: "right",
      // As the point's own line writes it («4,5»), or the plan's word for a point that has no kilometre.
      render: ({ point }) => <span data-testid="plan-table-km">{point.startFinish ? t("volunteers.plan.columnStartFinish") : km(point.km)}</span>,
    },
    {
      key: "coordinates",
      label: t("volunteers.plan.table.columns.coordinates"),
      // The numbers, on paper too, and the point's own link to a map beside them, which the paper leaves out.
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
      // The point's people in the point's order, a line each: the name and the telephone to ring — and under it the organizers'
      // decision and notes about the person (§981). Since §994 (the owner, 2026-11-19: «Aici vreau numele cu caps și vreau și
      // mailul»), the name in capitals, so each person stands out from the words under them — the text stays as typed, for a
      // screen reader and a copy —, and the address after the telephone. Since §1009 («vreau sa numerotez aici voluntarii si sa
      // fac cu bold numele lor» — «un separator … sa se vada ca e o lista»), a numbered list: «1.», «2.», … before each name,
      // the name in bold, and a thin line between two people (`TABLE_PEOPLE_SX`) — the phone's block the same, and the paper.
      render: ({ people }) =>
        people.length === 0 ? (
          <Box component="span" sx={{ color: "text.secondary", fontStyle: "italic" }} data-testid="plan-table-nobody">
            {t("volunteers.plan.table.nobody")}
          </Box>
        ) : (
          <Box component="ol" role="list" sx={TABLE_PEOPLE_SX} data-testid="plan-table-people">
            {people.map((person, at) => (
              <li key={person.id} data-testid="plan-table-person">
                <span data-testid="plan-table-person-number">{personNumber(at + 1)}</span>{" "}
                <Box component="span" sx={TABLE_PERSON_NAME_SX} data-testid="plan-table-person-name">
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
                {person.email && (
                  <>
                    {" "}
                    <Box component="a" href={`mailto:${person.email}`} sx={TABLE_EMAIL_SX} data-testid="plan-table-email">
                      {person.email}
                    </Box>
                  </>
                )}
                {/* Under the name, the organizers' own words about the person (§981): the decision, printed; the notes, on the screen. */}
                {ownWordsOf(person)}
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
  // Who is offered the controls of «Poze și hărți» (§952, §978): whoever works the volunteers — the actions and the service ask again.
  const mayChangeMaps = canManageVolunteers(actor.role);
  // Whether this environment can take a picture at all (`STORAGE_MODE`): without a store the page says so and offers no upload.
  const storeHere = isStorageConfigured();
  // Every form of the page carries the page's language, the event and the view it is pressed in (§974): its way back.
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={id} />
      <input type="hidden" name="view" value={view} />
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
  const mailBody = t(plan.pictures.length > 0 || plan.links.length > 0 ? "volunteers.plan.mail.confirmBodyMaps" : "volunteers.plan.mail.confirmBody");
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
  // The email's fold says on its closed line how many its press would tell: nobody, everybody already told, or how many are left.
  const mailState = mailConfirm === null ? t("volunteers.plan.mail.toTellNone") : againOnly ? t("volunteers.plan.mail.toTellAllTold") : t(`volunteers.plan.mail.toTell.${countForm(mail.toWrite, locale)}`, { count: mail.toWrite });

  /**
   * A fold's bar on this page (§974): the house's boxed fold (`BOXED_DISCLOSURE_SX`), its glyph and its words as a level-3
   * heading — the summary keeps the native fold, so it opens without a script —, and on the same line, quieter, what the fold
   * holds, readable while it is shut (`Panel`'s `aside`).
   */
  const foldBar = (glyph: PanelGlyphName, title: string, line?: { words: string; testId: string }, headingId?: string) => {
    const Glyph = PANEL_GLYPHS[glyph];
    return (
      <Box component="summary">
        <Typography id={headingId} component="h3" variant="h2" sx={{ ...HEADING_SX[3], display: "inline" }}>
          <Glyph aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
          {title}
          {line && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }} data-testid={line.testId}>
              {line.words}
            </Typography>
          )}
        </Typography>
      </Box>
    );
  };

  /**
   * One person's line: who, their number, how to reach them, what they do — the same words at a point and under «Fără punct» —, and
   * under it the organizers' own words about them (`ownWordsOf`). At a point, `place` is the person's place in the point's list
   * (§1009), said before the name as the table says it: «1.», «2.», …; under «Fără punct» nobody is numbered.
   */
  const personWords = (person: VolunteerPlanPerson, place?: number) => {
    const roles = rolesOf(person);
    return (
      <Box sx={{ minWidth: 0 }}>
        {place !== undefined && (
          <Typography component="span" sx={{ fontWeight: 600, mr: 0.75 }} data-testid="plan-person-number">
            {personNumber(place)}
          </Typography>
        )}
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
        {ownWordsOf(person)}
      </Box>
    );
  };

  /**
   * One point of the plan on «Pe puncte», in either group (§974): a fold of its own, closed unless the last press changed it.
   * Its bar is the point's name in bold at a level-3 heading's size — numbered on the route —, then its kilometre or
   * «start–finish» and how many stand there; open, what it is, where it is, its people with «Scoate», the pencil of
   * «Modifică punctul» at their right, and «Pune aici». The id (`point-<id>`) is the fold's, so an address that names the
   * point opens it. Everything that builds the plan stays off the paper, where a point prints open and is never split across
   * two sheets.
   */
  const pointFold = ({ point, number, people }: VolunteerPlanPoint) => {
    const name = nameOf(point);
    const where = coordinatesOf(point);
    // What an editor's point offers and its note, in the backoffice's words; a point added here has neither.
    const facts = [point.kinds.map((kind) => t(`checkpoints.kinds.${kind}`)).join(", "), (locale === "ro" ? point.noteRo : point.noteEn) ?? ""].filter((part) => part !== "");
    const kmWords = point.startFinish ? t("volunteers.plan.columnStartFinish") : t("volunteers.plan.pointKm", { km: km(point.km) });
    const editFor = t("volunteers.plan.points.editFor", { name });
    return (
      <Box component="li" key={point.id} sx={{ breakInside: "avoid" }}>
        <Box
          component="details"
          id={`point-${point.id}`}
          open={openPoint === point.id || undefined}
          data-testid="plan-point"
          data-place={point.startFinish ? "startFinish" : "route"}
          sx={{ ...BOXED_DISCLOSURE_SX, ...NESTED_FOLD_SX, ...OPEN_ON_PAPER, breakInside: "avoid", scrollMarginTop: 16 }}
        >
          <Box component="summary">
            <Typography component="h4" variant="h2" sx={{ ...HEADING_SX[3], display: "inline", minWidth: 0 }} data-testid="plan-point-title">
              <PointIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
              {/* The name in bold — the owner: «vreau ca denumirea punctului să fie cu bold și mai vizibilă». */}
              <Box component="span" sx={{ fontWeight: 700, overflowWrap: "anywhere" }} data-testid="plan-point-name">
                {number === null ? name : t("volunteers.plan.pointTitle", { number, title: name })}
              </Box>
              <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }} data-testid="plan-point-line">
                {kmWords} · {peopleWords(people.length)}
              </Typography>
            </Typography>
          </Box>
          <Stack spacing={1.5}>
            {/* Under the bar, the point's «Notă pentru voluntari» (§1009): what everybody standing here has to know — printed. */}
            {volunteerNoteBlock(point, "fold", "plan-point-volunteer-note")}
            {/* A point of the route that only the plan has: said so, quietly; then what an editor's point offers, and its note. */}
            {((point.planOnly && !point.startFinish) || facts.length > 0) && (
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "break-word" }}>
                {point.planOnly && !point.startFinish && (
                  <Box component="span" sx={{ whiteSpace: "nowrap", mr: 1, ...NOT_ON_PAPER }} data-testid="plan-point-own">
                    {t("volunteers.plan.points.planOnly")}
                  </Box>
                )}
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

            {/* The people, and the pencil at their right. */}
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 1 }}>
              <Box sx={{ flex: "1 1 200px", minWidth: 0 }}>
                {people.length === 0 ? (
                  <Typography variant="body2" sx={{ fontStyle: "italic", py: 1.25 }} data-testid="plan-point-empty">
                    {t("volunteers.plan.nobodyHere")}
                  </Typography>
                ) : (
                  // Numbered in the point's order, as the table numbers them (§1009): «1.», «2.», … before each name.
                  <Stack spacing={1} component="ol" role="list" sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="plan-point-people">
                    {people.map((person, at) => (
                      <Stack component="li" key={person.id} direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }} data-testid="plan-person">
                        {personWords(person, at + 1)}
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
              </Box>

              {/* «Modifică punctul» (§961, §974): the pencil alone, named for a reader who does not see it and in its tooltip. A
                  point added here is changed whole, its kind included; of an editor's point only where it is: its name and
                  kilometre are public, and are the editor's. A refused save lands at the page's alert with its code, as every
                  press of this page (§953). */}
              <Box component="details" sx={PENCIL_FOLD_SX} data-testid="plan-point-edit">
                <Box component="summary" aria-label={editFor} title={editFor} data-testid="plan-point-edit-toggle">
                  <EditIcon fontSize="small" aria-hidden />
                </Box>
                <Box sx={{ maxWidth: 560, pt: 1.5 }}>
                  <Typography component="p" variant="subtitle2" sx={{ mb: 1.5 }}>
                    {t("volunteers.plan.points.edit")}
                  </Typography>
                  <Stack component="form" action={editPlanPointAction} spacing={2} sx={{ alignItems: "flex-start" }} data-testid="plan-point-edit-form">
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
                    {/* «Notă pentru voluntari» (§1009), of any point — an editor's too: what everybody standing here has to know, in
                        Romanian and in English, both or neither (the service refuses one alone), the browser stopping each box at
                        its most. Plain text: a line break typed is a line break on the plan and in the email. */}
                    <TextField
                      name={PLAN_POINT_BOXES.volunteerNoteRo}
                      label={t("volunteers.plan.points.volunteerNoteRo")}
                      helperText={t("volunteers.plan.points.volunteerNoteHelper")}
                      defaultValue={point.volunteerNoteRo ?? ""}
                      multiline
                      minRows={2}
                      fullWidth
                      size="small"
                      slotProps={{ htmlInput: { maxLength: PLAN_POINT_NOTE_MAX, "data-testid": "plan-point-edit-note-ro" } }}
                    />
                    <TextField
                      name={PLAN_POINT_BOXES.volunteerNoteEn}
                      label={t("volunteers.plan.points.volunteerNoteEn")}
                      helperText={t("volunteers.plan.points.volunteerNoteHelperBoth", { max: String(PLAN_POINT_NOTE_MAX) })}
                      defaultValue={point.volunteerNoteEn ?? ""}
                      multiline
                      minRows={2}
                      fullWidth
                      size="small"
                      slotProps={{ htmlInput: { maxLength: PLAN_POINT_NOTE_MAX, "data-testid": "plan-point-edit-note-en" } }}
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
            </Box>

            {/* «Pune aici»: anybody of the event who stands at no point yet. A native select — it works without scripts, asks for a
                choice before it posts, and opens as the phone's own list. */}
            {plan.unplaced.length > 0 && (
              <Stack component="form" action={placeVolunteerAction} direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap", ...NOT_ON_PAPER }} data-testid="plan-place-form">
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
                  sx={{ minWidth: 0, flex: "1 1 200px", maxWidth: 420 }}
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
          </Stack>
        </Box>
      </Box>
    );
  };

  /**
   * One group of «Pe puncte» (§974): «Pe traseu», the route's points by kilometre, or «La start–finish». A fold, closed unless
   * it holds the point the last press changed; its closed line says how many points and how many people. A group with no
   * point says so in one quiet line inside, and stays off the paper whole: a heading with nothing under it is no plan.
   */
  const groupFold = (group: "route" | "startFinish", points: readonly VolunteerPlanPoint[]) => {
    const headingId = group === "route" ? "plan-group-route" : "plan-group-start-finish";
    const counts = [t(`volunteers.plan.groups.points.${countForm(points.length, locale)}`, { count: points.length }), peopleWords(peopleAt(points))].join(" · ");
    const pointsHere = points.map(pointFold);
    return (
      <Box
        component="details"
        open={points.some(({ point }) => point.id === openPoint) || undefined}
        data-testid="plan-group"
        data-group={group}
        sx={{ ...BOXED_DISCLOSURE_SX, ...(points.length === 0 ? NOT_ON_PAPER : OPEN_ON_PAPER), scrollMarginTop: 16 }}
      >
        {foldBar(PART_GLYPH[group].glyph, t(group === "route" ? "volunteers.plan.groups.route" : "volunteers.plan.groups.startFinish"), { words: counts, testId: "plan-group-count" }, headingId)}
        {points.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="plan-group-none">
            {t(group === "route" ? "volunteers.plan.groups.routeNone" : "volunteers.plan.groups.startFinishNone")}
          </Typography>
        ) : (
          // The route's order is the route's: numbered. The start–finish's is a list.
          <Stack spacing={1} component={group === "route" ? "ol" : "ul"} aria-labelledby={headingId} sx={{ listStyle: "none", m: 0, p: 0 }}>
            {pointsHere}
          </Stack>
        )}
      </Box>
    );
  };

  // The one empty state of a plan with no point (§961), in either view: where to add one.
  const noPoints = (
    <Alert severity="info" sx={NOT_ON_PAPER} data-testid="plan-no-points">
      {t("volunteers.plan.noPoints")}
    </Alert>
  );

  /*
    «Tabel» (§974): «Punctele, pe scurt», the whole plan at a glance — the house's table, a block a point on a phone, every row
    on the one page. On paper it is the plan's summary sheet, printed whole as a table, the first thing after the title; the
    map's links stay off it, the names and the telephones print as text. A plan with no point has no table: the empty state
    says how to add one.
  */
  const tableView: ReactNode =
    tableRows.length === 0 ? (
      noPoints
    ) : (
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
    );

  /*
    «Pe puncte» (§974): the plan itself in two folds — the route's points by kilometre, numbered, then the start–finish's —,
    each point a fold of its own, under the four numbers of who stands where. On paper every group and every point prints
    open, the summary first. A press that deleted a point comes back here.
  */
  const pointsView: ReactNode = (
    <Stack id="plan-list" spacing={2} sx={{ scrollMarginTop: 16 }} data-testid="plan-list">
      {plan.points.length === 0 ? (
        noPoints
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
          {groupFold("route", routePoints)}
          {groupFold("startFinish", startFinishPoints)}
        </>
      )}
    </Stack>
  );

  /*
    «Poze și hărți» (§978, amending §952 and §974; the owner, 2026-11-18: «Poza planului trebuie sa fie mai sus, si sa pot pune
    mai multe poze, si link-uri, am facut spre exemplu un google maps custom map si vreau sa pot pune url-ul»): the plan as the
    organizers drew it — its pictures and its links —, the first fold of the page in both views, right under the intro and
    above the views' tabs, OPEN whenever it holds something (the owner wants the map high and in sight), shut while empty, and
    open after a press in it (`saved=`). Its closed line says how many of each.

    The pictures stand in a grid — two or three a row on a laptop, one on a phone —, each drawn at its display size, never
    taller than 360 pixels on the screen, a press opening the whole of it in a new tab, «Șterge poza» under it; then «Adaugă o
    poză», which appends. The links are a list — each its label in bold, or the address shortened to its host and the start of
    its path, opening in a new tab, its host after it in grey —, «Șterge linkul» beside each, then «Adaugă un link».

    On paper the plan prints as before — the view's plan first (§974) — so the fold is moved after «Fără punct» there
    (`order` inside the page's flex column): each picture one piece on a sheet, each link its label and its whole address as
    text; its bar, its hint and every control off the sheet, and nothing at all for an empty fold.
  */
  const hasMaps = plan.pictures.length > 0 || plan.links.length > 0;
  const picturesWords = plan.pictures.length === 0 ? t("volunteers.plan.maps.picturesNone") : t(`volunteers.plan.maps.pictures.${countForm(plan.pictures.length, locale)}`, { count: plan.pictures.length });
  const linksWords = plan.links.length === 0 ? t("volunteers.plan.maps.linksNone") : t(`volunteers.plan.maps.links.${countForm(plan.links.length, locale)}`, { count: plan.links.length });
  // A picture's words when the plan has several: «poza 2»; with one, the words of the one picture.
  const several = plan.pictures.length > 1;
  // «Adaugă un link»: the label of each box its refusal's summary can name, and the form drawn anew once the links change.
  const linkRefusal = await refusalMessages({ [PLAN_LINK_BOXES.url]: t("volunteers.plan.link.url"), [PLAN_LINK_BOXES.label]: t("volunteers.plan.link.label") });
  const linkFormKey = plan.links.map((link) => link.id).join(",");
  const mapsFold = (
    <Box
      component="details"
      id="plan-maps"
      open={hasMaps || saved === PLAN_SAVED.maps || undefined}
      data-testid="plan-maps-section"
      sx={{ ...BOXED_DISCLOSURE_SX, ...(hasMaps ? MAPS_ON_PAPER : NOT_ON_PAPER), scrollMarginTop: 16 }}
    >
      {foldBar(PART_GLYPH.maps.glyph, t("volunteers.plan.maps.title"), { words: `${picturesWords} · ${linksWords}`, testId: "plan-maps-state" })}
      <Typography variant="body2" color="text.secondary" sx={NOT_ON_PAPER} data-testid="plan-maps-help">
        {t("volunteers.plan.maps.help")}
      </Typography>

      {/* The pictures, in the plan's order: a grid on the screen, one piece a sheet on paper. */}
      {plan.pictures.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Box component="ul" aria-label={t("volunteers.plan.maps.picturesTitle")} sx={PICTURE_GRID_SX} data-testid="plan-pictures">
            {plan.pictures.map((picture, at) => {
              const number = at + 1;
              return (
                // One piece on one sheet: never cut between two pages, and never taller than a sheet (`PICTURE_ON_PAPER_MAX_HEIGHT`).
                <Box component="li" key={picture.id} sx={{ minWidth: 0, breakInside: "avoid", "@media print": { mb: 2 } }} data-testid="plan-picture">
                  <Box component="figure" sx={{ m: 0 }}>
                    <Box
                      component="a"
                      href={picture.fullUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={several ? t("volunteers.plan.picture.openNumbered", { number }) : t("volunteers.plan.picture.open")}
                      sx={{ display: "block", lineHeight: 0 }}
                      data-testid="plan-picture-link"
                    >
                      <Box
                        component="img"
                        src={picture.displayUrl}
                        srcSet={picture.srcSet}
                        sizes={picture.srcSet ? pictureSizes("page", 50) : undefined}
                        alt={several ? t("volunteers.plan.picture.altNumbered", { number }) : t("volunteers.plan.picture.alt")}
                        width={picture.width}
                        height={picture.height}
                        decoding="async"
                        // As wide as its cell, never wider than its own pixels nor taller than 360 pixels, in its own shape; on paper as large as fits one sheet.
                        sx={{
                          display: "block",
                          width: "100%",
                          maxWidth: `${picture.width}px`,
                          height: "auto",
                          maxHeight: PICTURE_ON_SCREEN_MAX_HEIGHT,
                          objectFit: "contain",
                          objectPosition: "left top",
                          "@media print": { width: "auto", maxWidth: "100%", maxHeight: PICTURE_ON_PAPER_MAX_HEIGHT },
                        }}
                        data-testid="plan-picture-image"
                      />
                    </Box>
                  </Box>
                  {/* «Șterge poza» asks first: only uploading the picture again brings it back. */}
                  {mayChangeMaps && (
                    <Box component="form" action={removePlanPictureAction} sx={{ mt: 0.5, ...NOT_ON_PAPER }} data-testid="plan-picture-remove-form">
                      {hidden}
                      <input type="hidden" name="pictureId" value={picture.id} />
                      <ConfirmSubmitButton
                        label={t("volunteers.plan.picture.remove")}
                        ariaLabel={t("volunteers.plan.picture.removeFor", { number })}
                        icon="delete"
                        color="error"
                        variant="text"
                        size="medium"
                        title={t("volunteers.plan.picture.removeTitle", { number })}
                        body={t("volunteers.plan.picture.removeBody")}
                        confirmLabel={t("volunteers.plan.picture.remove")}
                        cancelLabel={t("confirm.cancel")}
                      />
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, ...NOT_ON_PAPER }} data-testid="plan-picture-hint">
            {t("volunteers.plan.picture.openHint")}
          </Typography>
        </Box>
      )}

      {/* «Adaugă o poză» — whoever works the volunteers; on this page, everybody it answers to, said here so the controls never outlive the gate. */}
      {mayChangeMaps &&
        (storeHere ? (
          plan.pictures.length < PLAN_PICTURES_MAX && (
            <Box sx={{ mt: 1.5, ...NOT_ON_PAPER }} data-testid="plan-picture-controls">
              {/* The island uploads the file, writes the stored picture's id into this form and sends it (`addPlanPictureAction`). */}
              <Box component="form" action={addPlanPictureAction} data-testid="plan-picture-form">
                {hidden}
                <PlanPictureUpload
                  inputId="plan-picture-file"
                  lang={locale}
                  labels={{
                    upload: t("volunteers.plan.picture.upload"),
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
            </Box>
          )
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, ...NOT_ON_PAPER }} data-testid="plan-picture-no-storage">
            {t("volunteers.plan.picture.noStorage")}
          </Typography>
        ))}

      {/* The links, in the plan's order: each opens in a new tab; on paper its label and its whole address, as text. */}
      {plan.links.length > 0 && (
        <Stack component="ul" spacing={0.5} aria-label={t("volunteers.plan.maps.linksTitle")} sx={{ listStyle: "none", m: 0, mt: 2, p: 0 }} data-testid="plan-links">
          {plan.links.map((link) => {
            const name = link.label ?? planLinkShort(link.url);
            return (
              <Box component="li" key={link.id} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, breakInside: "avoid" }} data-testid="plan-link">
                <Box sx={{ minWidth: 0, flex: "1 1 240px" }}>
                  <Box
                    component="a"
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("volunteers.plan.link.opens", { name })}
                    sx={LINK_SX}
                    data-testid="plan-link-open"
                  >
                    {name}
                  </Box>
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, overflowWrap: "anywhere", ...NOT_ON_PAPER }} data-testid="plan-link-host">
                    {link.host}
                  </Typography>
                  {/* On paper the whole address, which a sheet cannot open: whoever holds it types or scans it. */}
                  <Typography component="span" variant="body2" sx={{ display: "none", "@media print": { display: "inline", ml: 1, overflowWrap: "anywhere" } }} data-testid="plan-link-address">
                    {link.url}
                  </Typography>
                </Box>
                {mayChangeMaps && (
                  <Box component="form" action={removePlanLinkAction} sx={NOT_ON_PAPER} data-testid="plan-link-remove-form">
                    {hidden}
                    <input type="hidden" name="linkId" value={link.id} />
                    <ConfirmSubmitButton
                      label={t("volunteers.plan.link.remove")}
                      ariaLabel={t("volunteers.plan.link.removeFor", { name })}
                      icon="delete"
                      color="error"
                      variant="text"
                      size="medium"
                      title={t("volunteers.plan.link.removeTitle", { name })}
                      body={t("volunteers.plan.link.removeBody")}
                      confirmLabel={t("volunteers.plan.link.remove")}
                      cancelLabel={t("confirm.cancel")}
                    />
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>
      )}

      {/* «Adaugă un link»: a plain form and a Server Action, as «Adaugă un punct» — a refusal names its box and keeps what was typed (§315). */}
      {mayChangeMaps && plan.links.length < PLAN_LINKS_MAX && (
        <Box sx={{ mt: 2, maxWidth: 560, ...NOT_ON_PAPER }} data-testid="plan-link-controls">
          <ActionForm key={linkFormKey} action={addPlanLinkAction} messages={linkRefusal} scope={LINK_SCOPE} data-testid="plan-link-add-form">
            {hidden}
            <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
              <RecallField
                name={PLAN_LINK_BOXES.url}
                label={t("volunteers.plan.link.url")}
                helperText={t("volunteers.plan.link.hint")}
                required
                fullWidth
                size="small"
                slotProps={{ htmlInput: { maxLength: PLAN_LINK_URL_MAX, inputMode: "url", autoComplete: "url", spellCheck: false, "data-testid": "plan-link-add-url" } }}
              />
              <RecallField
                name={PLAN_LINK_BOXES.label}
                label={t("volunteers.plan.link.label")}
                fullWidth
                size="small"
                slotProps={{ htmlInput: { maxLength: PLAN_LINK_LABEL_MAX, "data-testid": "plan-link-add-label" } }}
              />
              <GlyphButton icon="add" type="submit" variant="outlined" size="medium" sx={TAP_TARGET} data-testid="plan-link-add">
                {t("volunteers.plan.link.add")}
              </GlyphButton>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Box>
  );

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
          of the plan's points or of «Poze și hărți» that names a number (`{max}`) is given it (`planPointRefusalValues`,
          `planMapsRefusalValues`). */}
      <Box id="admin-alert" tabIndex={-1} aria-live="polite" sx={{ scrollMarginTop: 16, ...NOT_ON_PAPER }}>
        {errorCode && <Alert severity="error">{t(`errors.${errorCode}`, { ...planPointRefusalValues(errorCode), ...planMapsRefusalValues(errorCode) })}</Alert>}
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
            where they are added («Adaugă un punct», `points.helpPrivate`). */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="plan-help-points">
          {t("volunteers.plan.helpPoints")}
        </Typography>
      </Box>

      {mapsFold}

      {/* The two views (§974): plain links, the current one marked (`aria-current`), drawn on the server — the house's row of
          sub-tabs, which two short words never make wider than a phone (`fits`: no script to scroll it). Never on paper. */}
      <Box sx={NOT_ON_PAPER} data-testid="plan-views">
        <SubNav
          fits
          label={t("volunteers.plan.views.label")}
          items={[
            { href: planAddress(planPath, { view: "table" }), label: t("volunteers.plan.views.table"), active: view === "table", glyph: <ListGlyph /> },
            { href: planAddress(planPath, { view: "points" }), label: t("volunteers.plan.views.points"), active: view === "points", glyph: <PointIcon /> },
          ]}
        />
      </Box>
      <Box>
        <PrintButton label={t("volunteers.plan.print")} />
      </Box>

      {view === "table" ? tableView : pointsView}

      {/* «Adaugă un punct» (§961), a fold in both views (§974): where the organizers add the plan's own points by hand, one after
          another — open by itself on a plan with no point yet, the page's first work, and after a point it added. Never on the
          paper. A plain form and a Server Action: it works with scripts off, where the kilometre's box is simply there and not
          read for a point at the start–finish. A refusal comes back as the form's own state (§315): the box is named, what was
          typed stays, and the fold shows it even shut (`BOXED_DISCLOSURE_SX`). */}
      <Box
        component="details"
        id="plan-points"
        open={saved === PLAN_SAVED.added || plan.points.length === 0 || undefined}
        data-testid="plan-points-section"
        sx={{ ...BOXED_DISCLOSURE_SX, ...NOT_ON_PAPER, scrollMarginTop: 16 }}
      >
        {foldBar(PART_GLYPH.add.glyph, t("volunteers.plan.points.addTitle"))}
        <Typography variant="body2" color="text.secondary" data-testid="plan-points-help">
          {t("volunteers.plan.points.help")} {t("volunteers.plan.points.helpCoordinates")} {t("volunteers.plan.points.helpPrivate")}
        </Typography>
        <Box sx={{ mt: 1.5, maxWidth: 560 }}>
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

      {/* «Trimite fiecăruia punctul lui» (§956), a fold in both views (§974) whose closed line says how many its press would tell —
          never on the paper. The numbers are the question's own, said inside too so the page answers «cine mai e de anunțat»
          before anything is pressed. A press that went through comes back with it open. */}
      <Box
        component="details"
        id="plan-mail"
        open={saved === PLAN_SAVED.sent || undefined}
        data-testid="plan-mail-section"
        sx={{ ...BOXED_DISCLOSURE_SX, ...NOT_ON_PAPER, scrollMarginTop: 16 }}
      >
        {foldBar(PART_GLYPH.mail.glyph, t("volunteers.plan.mail.title"), { words: mailState, testId: "plan-mail-state" })}
        <Typography variant="body2" color="text.secondary">
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

      {/* «Fără punct» (§949; a fold since §978, amending §974 — the owner, 2026-11-18: «aici eu vreau sa pot asigna voluntari la
          punct direct de aici: Si sectiunea trebuie sa fie collapsible»): everybody at no point, last in both views. Closed as
          every fold of the page, its closed line how many stand at no point, and open after a press made in it (`saved=`). On
          each person's line, while the plan has a point, the point to put them at — a native select, as «Pune aici»'s: it
          works without scripts and opens as the phone's own list — and «Pune». On paper it prints open, its arrow off, the
          people without the forms. */}
      <Box
        component="details"
        id="plan-unplaced"
        open={saved === PLAN_SAVED.unplaced || undefined}
        data-testid="plan-unplaced"
        sx={{ ...BOXED_DISCLOSURE_SX, ...OPEN_ON_PAPER, breakInside: "avoid", scrollMarginTop: 16 }}
      >
        {foldBar(PART_GLYPH.unplaced.glyph, t("volunteers.plan.unplacedTitle"), { words: peopleWords(plan.unplaced.length), testId: "plan-unplaced-count" })}
        {placed === 0 && plan.unplaced.length === 0 ? (
          <Typography variant="body2" data-testid="plan-unplaced-nobody">
            {t("volunteers.plan.noVolunteers")}
          </Typography>
        ) : plan.unplaced.length === 0 ? (
          <Typography variant="body2" data-testid="plan-unplaced-none">
            {t("volunteers.plan.unplacedNone")}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={NOT_ON_PAPER} data-testid="plan-unplaced-help">
              {t("volunteers.plan.unplacedHelp")}
            </Typography>
            <Stack spacing={1} component="ul" sx={{ listStyle: "none", m: 0, mt: 1, p: 0 }}>
              {plan.unplaced.map((person) => (
                <Stack component="li" key={person.id} direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }} data-testid="plan-unplaced-person">
                  {personWords(person)}
                  {plan.points.length > 0 && (
                    <Stack component="form" action={placeVolunteerAction} direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap", flex: "0 1 420px", minWidth: 0, ...NOT_ON_PAPER }} data-testid="plan-unplaced-place-form">
                      {hidden}
                      <input type="hidden" name="volunteerId" value={person.id} />
                      <input type="hidden" name="at" value="unplaced" />
                      <TextField
                        select
                        required
                        size="small"
                        name="checkpointId"
                        label={t("volunteers.plan.unplaced.point")}
                        defaultValue=""
                        // A thumb's 44 pixels on the list itself (BR-REQ-041-01 criterion 6), not only on «Pune» beside it.
                        sx={{ minWidth: 0, flex: "1 1 200px", "& .MuiNativeSelect-select": { boxSizing: "border-box", minHeight: 44 } }}
                        slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: { "data-testid": "plan-unplaced-select" } }}
                      >
                        <option value="">{t("volunteers.plan.unplaced.choose")}</option>
                        {/* The route's points in the plan's one order, numbered as everywhere; then the start–finish's. A group with no point is left out. */}
                        {routePoints.length > 0 && (
                          <optgroup label={t("volunteers.plan.groups.route")}>
                            {routePoints.map(({ point, number }) => (
                              <option key={point.id} value={point.id}>
                                {t("volunteers.plan.unplaced.routeOption", { number: number ?? 0, name: nameOf(point), km: km(point.km) })}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {startFinishPoints.length > 0 && (
                          <optgroup label={t("volunteers.plan.groups.startFinish")}>
                            {startFinishPoints.map(({ point }) => (
                              <option key={point.id} value={point.id}>
                                {nameOf(point)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </TextField>
                      <GlyphButton
                        icon="addPerson"
                        type="submit"
                        variant="outlined"
                        size="small"
                        sx={TAP_TARGET}
                        aria-label={t("volunteers.plan.unplaced.placeFor", { name: person.name })}
                        data-testid="plan-unplaced-place"
                      >
                        {t("volunteers.plan.unplaced.place")}
                      </GlyphButton>
                    </Stack>
                  )}
                </Stack>
              ))}
            </Stack>
          </>
        )}
      </Box>
    </Stack>
  );
}
