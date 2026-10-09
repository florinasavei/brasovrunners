import { z } from "zod";
import { type AppEnvironment, markSubjectForEnvironment } from "@/infrastructure/email/delivery";

/**
 * «Spune-ne ceva» / "Tell us something" (§676; the owner, 2026-10-08: «I just want to know how my
 * runners are feeling») — the wizard's rules, pure: which branches a visitor is offered, how the
 * address bar is read, what each form takes, and the email each one becomes.
 *
 * Four branches, each switched on by the club on «Pagini» → «Contact» and off by default:
 *
 * - **«Cum a fost»** (`cum-a-fost`) — one form for every kind of event, races and group runs alike:
 *   the event, a date for a run of a series, a rating as five faces, what happened, and why a person
 *   stopped coming.
 * - **«O sugestie»** (`sugestie`) — one box.
 * - **«O reclamație»** (`reclamatie`) — what happened, and optionally the event and the date.
 * - **«Siguranță pentru femei»** (`siguranta`) — confidential, for women who did not feel safe: it
 *   reaches one person the club names, by the club's email service alone, and the site keeps nothing of it.
 *
 * Anonymous unless the person chooses otherwise (§NNN): every form opens with «Anonim» (the default)
 * or «Cu nume și prenume», and only the named mode shows — and the server only keeps — a name, which it
 * then requires, and the branch's way back (an address, or for the safety form an address or a telephone).
 */

export const FEEDBACK_BRANCHES = ["howItWent", "suggestion", "complaint", "safety"] as const;
export type FeedbackBranch = (typeof FEEDBACK_BRANCHES)[number];

/**
 * The branch as the address bar names it (`?tip=`): the same Romanian word in both languages, so a
 * link the club shares — or the one the thank-you email carries — opens the same form whichever
 * language the reader's page is in.
 */
export const BRANCH_SLUG: Readonly<Record<FeedbackBranch, string>> = {
  howItWent: "cum-a-fost",
  suggestion: "sugestie",
  complaint: "reclamatie",
  safety: "siguranta",
};

/** The address bar's three names: the branch, the event's slug and the day of the run. */
export const FEEDBACK_QUERY = { branch: "tip", event: "eveniment", date: "data" } as const;

export function branchFromSlug(value: string | null | undefined): FeedbackBranch | null {
  return FEEDBACK_BRANCHES.find((branch) => BRANCH_SLUG[branch] === value) ?? null;
}

/** One branch as the club set it: a switch and the address that receives it. */
export type BranchSetting = { on: boolean; to: string | null };

/** The setting `feedbackForms` (`settings.ts`): per branch a switch and a recipient; the safety branch also the first name shown. */
export type FeedbackSettings = {
  howItWent: BranchSetting;
  suggestion: BranchSetting;
  complaint: BranchSetting;
  safety: BranchSetting & { name: string | null };
};

/** Off, each of them, until the club switches it on (the owner: «must be a toggle»). */
export const DEFAULT_FEEDBACK_SETTINGS: FeedbackSettings = {
  howItWent: { on: false, to: null },
  suggestion: { on: false, to: null },
  complaint: { on: false, to: null },
  safety: { on: false, to: null, name: null },
};

/** The branches that leave by the contact form's SMTP road (§149); the safety branch leaves by Mailgun alone. */
export const SMTP_BRANCHES: readonly FeedbackBranch[] = ["howItWent", "suggestion", "complaint"];

/**
 * The branches a visitor is offered, in the wizard's order: switched on, with somebody to receive
 * them (and, for the safety branch, the first name the page promises), and with a road to leave by —
 * the three ordinary branches only where the deployment has the SMTP road (`contactSmtpRoadExists`;
 * `CONTACT_FORM_MODE=off` has none), as «Scrie-ne» draws no form without one — and none at all while
 * the privacy notice in force does not describe the forms (`describesFeedbackForms`): nothing is
 * taken from a person before the notice the club approved says what happens to it (AGENTS.md §10.8).
 */
export function offeredBranches(settings: FeedbackSettings, noticeDescribes: boolean, smtpRoad: boolean): FeedbackBranch[] {
  if (!noticeDescribes) return [];
  return FEEDBACK_BRANCHES.filter((branch) => {
    const setting = settings[branch];
    if (!setting.on || !setting.to) return false;
    if (!smtpRoad && SMTP_BRANCHES.includes(branch)) return false;
    return branch !== "safety" || Boolean(settings.safety.name);
  });
}

/**
 * The door's sentence on `/contact` (§676), from what is offered: the three ordinary forms named only
 * while one of them is there — with «Siguranță pentru femei» alone (a deployment with no SMTP road, or the club's
 * choice) the button opens the safety form straight away, and the sentence says that form alone.
 */
export function doorIntroKey(offered: readonly FeedbackBranch[]): "door.intro" | "door.introSafety" {
  return offered.length === 1 && offered[0] === "safety" ? "door.introSafety" : "door.intro";
}

/** How many branches are switched on, whatever the notice says: the backoffice summary's count. */
export function branchesSwitchedOn(settings: FeedbackSettings): FeedbackBranch[] {
  return FEEDBACK_BRANCHES.filter((branch) => settings[branch].on);
}

/**
 * What the page draws: nothing (a 404, and no door on `/contact`), step 1's choice, or one branch's
 * form. One branch on is that branch's form straight away — a choice of one is a click for nothing.
 */
export type WizardStep =
  | { kind: "none" }
  | { kind: "choose"; branches: FeedbackBranch[] }
  | { kind: "form"; branch: FeedbackBranch; single: boolean };

export function wizardStep(offered: readonly FeedbackBranch[], chosen: FeedbackBranch | null): WizardStep {
  if (offered.length === 0) return { kind: "none" };
  if (offered.length === 1) return { kind: "form", branch: offered[0], single: true };
  if (chosen && offered.includes(chosen)) return { kind: "form", branch: chosen, single: false };
  return { kind: "choose", branches: [...offered] };
}

/** An event's slug as the router writes one; anything else is not looked up. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written `YYYY-MM-DD`, or null — `2026-02-31` is not one. */
export function readDay(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !DAY.test(value)) return null;
  const at = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value ? value : null;
}

export type FeedbackQuery = { branch: FeedbackBranch | null; eventSlug: string | null; date: string | null };

/**
 * `?tip=`, `?eveniment=` and `?data=`, read and never trusted: an unknown branch is no branch, a
 * slug that is not a slug is no event, a date that is not a day is no date. Whether the slug names a
 * published event is the page's question — an unknown one simply leaves «Altceva» selected.
 */
export function readFeedbackQuery(query: { tip?: string | string[]; eveniment?: string | string[]; data?: string | string[] }): FeedbackQuery {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const slug = one(query.eveniment);
  return {
    branch: branchFromSlug(one(query.tip)),
    eventSlug: typeof slug === "string" && slug.length <= 200 && SLUG.test(slug) ? slug : null,
    date: readDay(one(query.data)),
  };
}

// --- The forms ---------------------------------------------------------------------------------

/** What happened, a suggestion: the contact form's own ceiling (§149), which a refused draft still holds. */
export const FEEDBACK_TEXT_MAX = 2_000;
/** One line: where and when, how to be reached, the «other» reason. */
export const FEEDBACK_LINE_MAX = 200;

/** «Dacă nu mai vii, ne spui de ce?» — the ticks, in the order the form shows them. */
export const STOPPED_REASONS = ["time", "place", "pace", "health", "moved", "other"] as const;
export type StoppedReason = (typeof STOPPED_REASONS)[number];

export const RATINGS = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATINGS)[number];

/** Every box any branch has, in the order the forms show them — the order a refusal lists them in. */
export const FEEDBACK_FIELDS = ["name", "email", "contact", "event", "date", "rating", "message", "reasons", "reasonOther", "whereWhen", "captcha"] as const;
export type FeedbackField = (typeof FEEDBACK_FIELDS)[number];

/**
 * The choice every form opens with (§NNN), the radio named `identity`: «Anonim», the default and what
 * anything else posted reads as, or «Cu nume și prenume».
 */
export const FEEDBACK_IDENTITIES = ["anonymous", "named"] as const;
export type FeedbackIdentity = (typeof FEEDBACK_IDENTITIES)[number];

/** The boxes only the named mode shows and the server only keeps: the name and the branch's way back. */
export const NAMED_ONLY_FIELDS = ["name", "email", "contact"] as const satisfies readonly FeedbackField[];

/**
 * What a refusal keeps in the sealed draft (§142), path-scoped to the wizard and read back by its form:
 * the identity choice and every box but the ticks (kept joined, as `reasons`) and the anti-bot check —
 * never the trap, the clock or the token.
 */
export const FEEDBACK_DRAFT_BOXES = ["identity", "name", "email", "contact", "event", "date", "rating", "message", "reasonOther", "whereWhen"] as const satisfies readonly (FeedbackField | "identity")[];

/**
 * The boxes each branch has, in its form's order: the name and the way back first, inside the
 * identity choice at the very top (§NNN), then the branch's own.
 */
export const BRANCH_FIELDS: Readonly<Record<FeedbackBranch, readonly FeedbackField[]>> = {
  howItWent: ["name", "email", "event", "date", "rating", "message", "reasons", "reasonOther"],
  suggestion: ["name", "email", "message"],
  complaint: ["name", "email", "message", "event", "date"],
  safety: ["name", "contact", "message", "whereWhen"],
};

/** A line becomes a header-free line: no break, the edges trimmed. */
const line = z
  .string()
  .max(FEEDBACK_LINE_MAX * 2)
  .transform((value) => value.replace(/[\r\n]+/g, " ").trim())
  .pipe(z.string().max(FEEDBACK_LINE_MAX));
const text = z.string().trim().min(1).max(FEEDBACK_TEXT_MAX);
/** Optional: empty is none; otherwise an address the reply can go to. */
const optionalEmail = z
  .string()
  .trim()
  .max(320)
  .transform((value) => (value === "" ? null : value))
  .pipe(z.email().nullable());
const optionalSlug = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .pipe(z.string().max(200).regex(SLUG).nullable());
const optionalDay = z
  .string()
  .trim()
  .transform((value, context) => {
    if (value === "") return null;
    const day = readDay(value);
    if (!day) context.addIssue({ code: "custom", message: "not a day" });
    return day;
  });
const optionalRating = z
  .string()
  .trim()
  .transform((value, context) => {
    if (value === "") return null;
    const rating = Number(value);
    if (!RATINGS.includes(rating as Rating)) context.addIssue({ code: "custom", message: "not a rating" });
    return rating as Rating;
  });
const reasons = z.array(z.enum(STOPPED_REASONS)).max(STOPPED_REASONS.length).transform((list) => STOPPED_REASONS.filter((reason) => list.includes(reason)));

const common = {
  locale: z.enum(["ro", "en"]),
  identity: z.enum(FEEDBACK_IDENTITIES),
  /** The person's name and surname: kept only in the named mode, and required there. */
  name: line,
  honeypot: z.string().max(2000).optional(),
  renderedAt: z.iso.datetime().optional(),
};

export const howItWentFields = z.object({
  branch: z.literal("howItWent"),
  event: optionalSlug,
  date: optionalDay,
  rating: optionalRating,
  message: text,
  reasons,
  reasonOther: line,
  email: optionalEmail,
  ...common,
});

export const suggestionFields = z.object({ branch: z.literal("suggestion"), message: text, email: optionalEmail, ...common });

export const complaintFields = z.object({
  branch: z.literal("complaint"),
  message: text,
  event: optionalSlug,
  date: optionalDay,
  email: optionalEmail,
  ...common,
});

export const safetyFields = z.object({ branch: z.literal("safety"), message: text, whereWhen: line, contact: line, ...common });

/**
 * Anonymous unless the person chose otherwise (§NNN): any identity but «Cu nume și prenume» reads as
 * «Anonim», and then the name and the way back are dropped before anything is read — a box the page
 * hid is never refused, and never sent.
 */
function anonymousDropsWhoIsWriting(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const posted = raw as Record<string, unknown>;
  if (posted.identity === "named") return raw;
  return { ...posted, identity: "anonymous", ...Object.fromEntries(NAMED_ONLY_FIELDS.map((field) => [field, ""])) };
}

export const feedbackFields = z.preprocess(
  anonymousDropsWhoIsWriting,
  z.discriminatedUnion("branch", [howItWentFields, suggestionFields, complaintFields, safetyFields]).superRefine((input, context) => {
    // The named mode is a name: «Cu nume și prenume» with the box empty is refused on the box.
    if (input.identity === "named" && input.name === "") context.addIssue({ code: "custom", path: ["name"], message: "a name" });
  }),
);

export type FeedbackInput = z.infer<typeof feedbackFields>;

/** The boxes a refused post names: the schema's own paths, in the form's order. */
export function invalidFeedbackFields(error: unknown): FeedbackField[] {
  const issues = (error as { issues?: Array<{ path?: unknown[] }> }).issues ?? [];
  const named = new Set(issues.map((issue) => String(issue.path?.[0] ?? "")));
  return FEEDBACK_FIELDS.filter((field) => named.has(field));
}

/** `?fields=` read against the closed list, never trusted (§14.5's reflected-content rule). */
export function parseFeedbackErrorFields(value: string | undefined): FeedbackField[] {
  if (!value) return [];
  const named = new Set(value.split(","));
  return FEEDBACK_FIELDS.filter((field) => named.has(field));
}

/**
 * What `?error=` may say. `VALIDATION_ERROR` comes with `fields`; `LIMITED` is the branch's hour;
 * `UNAVAILABLE` is «Nu am putut trimite acum…» — a road that did not answer, or the safety branch's
 * own answer to a post that looked automated (a lost report costs more than a bot's sentence).
 */
export const FEEDBACK_ERRORS = ["VALIDATION_ERROR", "LIMITED", "UNAVAILABLE"] as const;
export type FeedbackError = (typeof FEEDBACK_ERRORS)[number];

export function parseFeedbackError(value: string | undefined): FeedbackError | null {
  return FEEDBACK_ERRORS.find((code) => code === value) ?? null;
}

/** The anchor a refused post lands on (a `"use server"` module may not export it). */
export const FEEDBACK_ERROR_SUMMARY_ID = "feedback-errors";

/**
 * Where a refused post goes back to (§676): the wizard's path with `?tip=` — so the refusal lands on
 * the form it came from, never the choice —, `error=` the code, `&fields=` the boxes it names (names
 * only, never a value: what was typed rides in the sealed draft, AGENTS.md §14.5), `&since=` the render
 * the corrected form is timed from (§146: a quick fix must not read as a bot), and the summary's anchor.
 * Pure, so the action's redirect is tested without a request.
 */
export function feedbackRefusalUrl(
  path: string,
  branch: FeedbackBranch | null,
  code: FeedbackError,
  options: { fields?: readonly string[]; renderedAt?: string } = {},
): string {
  const query = new URLSearchParams();
  if (branch) query.set(FEEDBACK_QUERY.branch, BRANCH_SLUG[branch]);
  query.set("error", code);
  if (options.fields && options.fields.length > 0) query.set("fields", options.fields.join(","));
  if (options.renderedAt) query.set("since", options.renderedAt);
  return `${path}?${query.toString().replace(/%2C/g, ",")}#${FEEDBACK_ERROR_SUMMARY_ID}`;
}

/** Where a post that left goes (§676): `?sent=<the branch's slug>`, which the page answers with its sent line. */
export function feedbackSentUrl(path: string, branch: FeedbackBranch | null): string {
  return `${path}?sent=${branch ? BRANCH_SLUG[branch] : ""}`;
}
/** The door's section on `/contact` — `/ro/contact#spune-ne`, an address the club can share. */
export const FEEDBACK_SECTION_ID = "spune-ne";

// --- The email -----------------------------------------------------------------------------------

/** The face beside each rating, in the club's words — the same order as the page's five faces. */
const RATING_WORDS: Readonly<Record<Rating, string>> = {
  1: "foarte rău",
  2: "rău",
  3: "așa și așa",
  4: "bine",
  5: "foarte bine",
};

const REASON_WORDS: Readonly<Record<StoppedReason, string>> = {
  time: "ora sau ziua",
  place: "locul",
  pace: "ritmul grupului",
  health: "o accidentare sau sănătatea",
  moved: "m-am mutat",
  other: "altceva",
};

const LANGUAGE_NAME = { ro: "română", en: "engleză" } as const;

/** Said when no way back was left: the club knows at a glance that there is nobody to answer. */
export const NO_CONTACT_LINE = "(fără contact lăsat)";

/** The email's first line in the anonymous mode (§NNN): «Nume: (anonim)». */
export const ANONYMOUS_NAME_LINE = "(anonim)";

/**
 * The safety branch's subject (§676): neutral, so a notification on a phone's lock screen says
 * nothing of what is inside. The other three name their branch, because the club files them.
 */
export const SAFETY_SUBJECT = "Mesaj confidențial de pe site";

const SUBJECT: Readonly<Record<Exclude<FeedbackBranch, "safety">, string>> = {
  howItWent: "Cum a fost",
  suggestion: "O sugestie de pe site",
  complaint: "O reclamație de pe site",
};

/** «Altceva / în general»: no event chosen, or one the club does not publish. */
const GENERAL = "altceva / în general";

/** What the composer is told about the event the person chose: its title in the form's language, or none. */
export type FeedbackContext = { eventTitle: string | null };

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** `2026-10-04` as the club reads a day: «4.10.2026». */
function dayWords(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date}.${month}.${year}`;
}

type Line = { label: string; value: string };

/**
 * The lines of one message: first «Nume: …» — the name the person gave, or «(anonim)» (§NNN) — then
 * only what they filled, in the form's order (`BRANCH_FIELDS`), and the way back or «(fără contact
 * lăsat)». Romanian whatever the form's language — the reader is the club — with the form's language
 * on its own line so the club knows how to answer.
 */
export function feedbackLines(input: FeedbackInput, context: FeedbackContext): { lines: Line[]; message: Line; contact: Line } {
  const lines: Line[] = [{ label: "Nume", value: input.identity === "named" && input.name ? input.name : ANONYMOUS_NAME_LINE }];
  // A slug the club does not publish is no event: the posted value is only ever a picker's option.
  const event = (slug: string | null) => (slug && context.eventTitle ? context.eventTitle : GENERAL);
  switch (input.branch) {
    case "howItWent":
      lines.push({ label: "Eveniment", value: event(input.event) });
      if (input.date) lines.push({ label: "Data", value: dayWords(input.date) });
      if (input.rating) lines.push({ label: "Cum a fost", value: `${input.rating} din 5 — ${RATING_WORDS[input.rating]}` });
      if (input.reasons.length > 0) lines.push({ label: "Dacă nu mai vine, de ce", value: input.reasons.map((reason) => REASON_WORDS[reason]).join(", ") });
      if (input.reasonOther) lines.push({ label: "Altceva, în cuvintele lui", value: input.reasonOther });
      break;
    case "complaint":
      lines.push({ label: "Eveniment", value: event(input.event) });
      if (input.date) lines.push({ label: "Data", value: dayWords(input.date) });
      break;
    case "safety":
      if (input.whereWhen) lines.push({ label: "Unde și când", value: input.whereWhen });
      break;
    case "suggestion":
      break;
  }
  lines.push({ label: "Limba formularului", value: LANGUAGE_NAME[input.locale] });
  const message: Line = { label: input.branch === "suggestion" ? "Sugestia" : "Ce s-a întâmplat", value: input.message };
  const way = input.branch === "safety" ? input.contact : (input.email ?? "");
  const contact: Line = { label: "Contact", value: way || NO_CONTACT_LINE };
  return { lines, message, contact };
}

export type FeedbackEmail = { subject: string; text: string; html: string };

/**
 * The message one branch sends: its subject (the environment's `[QA] ` first, §163), and the text
 * and the HTML of the same lines. Nothing the person did not fill; never an address of theirs but
 * the one they typed for an answer.
 */
export function composeFeedbackEmail(input: FeedbackInput, context: FeedbackContext, appEnv: AppEnvironment): FeedbackEmail {
  const { lines, message, contact } = feedbackLines(input, context);
  const subjectBase =
    input.branch === "safety"
      ? SAFETY_SUBJECT
      : input.branch === "howItWent"
        ? `${SUBJECT.howItWent}: ${oneLine(input.event && context.eventTitle ? context.eventTitle : GENERAL)}`
        : SUBJECT[input.branch];
  const footer =
    input.branch === "safety"
      ? "— Trimis prin formularul confidențial „Siguranță pentru femei” al site-ului. Site-ul nu a păstrat nimic din el."
      : "— Trimis prin formularele „Spune-ne ceva” ale site-ului. Site-ul nu a păstrat nimic din el.";
  const text = [
    ...lines.map((entry) => `${entry.label}: ${entry.value}`),
    "",
    `${message.label}:`,
    message.value,
    "",
    `${contact.label}: ${contact.value}`,
    "",
    footer,
  ].join("\n");
  const html = [
    "<p>",
    lines.map((entry) => `<strong>${escapeHtml(entry.label)}:</strong> ${escapeHtml(entry.value)}`).join("<br>"),
    "</p>",
    `<p><strong>${escapeHtml(message.label)}:</strong></p>`,
    `<p style="white-space:pre-wrap">${escapeHtml(message.value)}</p>`,
    `<p><strong>${escapeHtml(contact.label)}:</strong> ${escapeHtml(contact.value)}</p>`,
    `<p><em>${escapeHtml(footer)}</em></p>`,
  ].join("");
  return { subject: markSubjectForEnvironment(oneLine(subjectBase), appEnv), text, html };
}

/** The feedback page's address for one event and day, as the thank-you email and the event page link it. */
export function feedbackQueryFor(eventSlug: string | null, date: string | null): Record<string, string> {
  return {
    [FEEDBACK_QUERY.branch]: BRANCH_SLUG.howItWent,
    ...(eventSlug ? { [FEEDBACK_QUERY.event]: eventSlug } : {}),
    ...(date ? { [FEEDBACK_QUERY.date]: date } : {}),
  };
}

// --- The event picker ------------------------------------------------------------------------------

/** How far back the picker reaches, and how far ahead: a run last quarter, a race next month. */
export const PICKER_PAST_DAYS = 90;
export const PICKER_FUTURE_DAYS = 30;

/**
 * The picker's order: the events already held, the most recent first — the one a person writes
 * about is nearly always the last one — then the ones ahead, the soonest first.
 */
export function pickerOrder<T extends { startsAt: Date | null }>(events: readonly T[], now: Date): T[] {
  const dated = events.filter((event): event is T & { startsAt: Date } => event.startsAt instanceof Date);
  const past = dated.filter((event) => event.startsAt.getTime() <= now.getTime()).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const ahead = dated.filter((event) => event.startsAt.getTime() > now.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return [...past, ...ahead];
}
