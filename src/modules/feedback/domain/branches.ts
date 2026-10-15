import { z } from "zod";
import { ADDRESS_QUERY, type PickerChip, readPickerChip } from "./event-picker";
import { type AppEnvironment, markSubjectForEnvironment } from "@/infrastructure/email/delivery";
import { canonicalizeEmail, InvalidEmailError } from "@/modules/participants/domain/canonical-email";

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
 * - **«Girl Zone»** (`girl-zone`; `siguranta` until §772, still read) — confidential, for women who did
 *   not feel safe: it reaches one person the club names, by Mailgun unless the club chose its Gmail
 *   (§772), and the site keeps nothing of it.
 *
 * Anonymous unless the person chooses otherwise (§678): every form opens with «Anonim» (the default)
 * or «Cu nume și prenume», and only the named mode shows — and the server only keeps — a name, which it
 * then requires, the branch's way back (an address, or for the safety form an address or a telephone)
 * and «Cine să afle?»: the club's mailbox or the safety branch's person (`audiencesFor`). The way back's
 * address, when one is typed, is checked by the canonicalizer and is the message's `Reply-To` (§772). The named mode
 * exists only while the privacy notice in force says so (`{{feedbackFormsNamed}}`); until then every
 * form is anonymous only.
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
  safety: "girl-zone",
};

/**
 * The names a branch had before (§772, amending §676): the address bar still understands them, so a
 * link in a sent email or on printed material keeps opening the same form — `siguranta` was the
 * safety branch's slug until the owner asked for «girl-zone» (2026-10-14). Read, never written: every
 * address the code builds uses `BRANCH_SLUG`.
 */
export const BRANCH_SLUG_ALIASES: Readonly<Record<string, FeedbackBranch>> = {
  siguranta: "safety",
};

/** The address bar's four names: the branch, the event's slug, the day of the run and the chip (`ADDRESS_QUERY`). */
export const FEEDBACK_QUERY = { branch: "tip", ...ADDRESS_QUERY } as const;

export function branchFromSlug(value: string | null | undefined): FeedbackBranch | null {
  if (typeof value !== "string") return null;
  // `isBranchAlias` is an own-property test: `toString` and `__proto__` are not an old name of any branch.
  return FEEDBACK_BRANCHES.find((branch) => BRANCH_SLUG[branch] === value) ?? (isBranchAlias(value) ? BRANCH_SLUG_ALIASES[value] : null);
}

/** Whether `value` is a name the branch had before and no longer has (`BRANCH_SLUG_ALIASES`). */
export function isBranchAlias(value: string | null | undefined): boolean {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BRANCH_SLUG_ALIASES, value);
}

/**
 * The address a link with an old branch name moves to (§772): the same path and every other word of
 * the query as it came, with `?tip=` and `?sent=` — the two that carry a branch's slug — written with the
 * current one. `null` when neither names a branch by an old name, so the page redirects only a link that
 * needs it. The query is the page's own, read from its search parameters, never a free-form URL.
 */
export function aliasRedirect(path: string, search: Readonly<Record<string, string | string[] | undefined>>): string | null {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  if (!isBranchAlias(first(search.tip)) && !isBranchAlias(first(search.sent))) return null;
  const query = new URLSearchParams();
  for (const [name, raw] of Object.entries(search)) {
    const value = first(raw);
    if (value === undefined) continue;
    const moved = (name === FEEDBACK_QUERY.branch || name === "sent") && isBranchAlias(value) ? BRANCH_SLUG[BRANCH_SLUG_ALIASES[value]] : value;
    query.set(name, moved);
  }
  return `${path}?${query.toString().replace(/%2C/g, ",")}`;
}

/**
 * The road a form's messages leave by (§772; the owner, 2026-10-14: «prin ce trimitem mail, Mailgun sau
 * Gmail»): the club's Gmail — the one `Scrie-ne` leaves by (§149) — or Mailgun, the platform's own
 * email service. Chosen per form on «Pagini» → «Contact».
 */
export const FEEDBACK_VIAS = ["gmail", "mailgun"] as const;
export type FeedbackVia = (typeof FEEDBACK_VIAS)[number];

/** Each form's road until the club chooses (§676, as it was fixed in code): Gmail for the three, Mailgun alone for Girl Zone. */
export const DEFAULT_VIA: Readonly<Record<FeedbackBranch, FeedbackVia>> = {
  howItWent: "gmail",
  suggestion: "gmail",
  complaint: "gmail",
  safety: "mailgun",
};

/** One branch as the club set it: a switch, the address that receives it and the road it leaves by. */
export type BranchSetting = { on: boolean; to: string | null; via: FeedbackVia };

/**
 * The setting `feedbackForms` (`settings.ts`): per branch a switch and a recipient; the safety branch also the first name shown
 * and — §NNN — whether Girl Zone’s messages may leave by the club’s Gmail when Mailgun is down (`fallbackToGmail`, off).
 */
export type FeedbackSettings = {
  howItWent: BranchSetting;
  suggestion: BranchSetting;
  complaint: BranchSetting;
  safety: BranchSetting & { name: string | null; fallbackToGmail: boolean };
};

/** Off, each of them, until the club switches it on (the owner: «must be a toggle»). */
export const DEFAULT_FEEDBACK_SETTINGS: FeedbackSettings = {
  howItWent: { on: false, to: null, via: DEFAULT_VIA.howItWent },
  suggestion: { on: false, to: null, via: DEFAULT_VIA.suggestion },
  complaint: { on: false, to: null, via: DEFAULT_VIA.complaint },
  safety: { on: false, to: null, via: DEFAULT_VIA.safety, name: null, fallbackToGmail: false },
};

/**
 * Which roads this deployment has (§772): `gmail` where the contact form's SMTP road exists
 * (`CONTACT_SMTP_USER` and its password, or the laptop's capture — `contactSmtpRoadExists`), `mailgun`
 * where the email service transmits (`EMAIL_DELIVERY_MODE` not `capture`, or a laptop that captures
 * on purpose — `feedbackRoads`). A form whose road is missing is not offered, and its choice is greyed
 * on the backoffice card.
 */
export type FeedbackRoads = { gmail: boolean; mailgun: boolean };

/**
 * Whose road a message leaves by (§772): the road follows the form whose reader it reaches — the
 * form it was written on for the club's mailbox, and Girl Zone's own for the person it designates,
 * whatever form the message was written on. A named Girl Zone message for «Clubul» reaches the mailbox
 * «O reclamație» names (or the contact form's), so it leaves by that form's road: a message on its way to
 * the club's mailbox leaves the way a complaint does, never by the road chosen for the confidential
 * reader. With the defaults it is exactly what §676 and §678 fixed in code.
 */
export function roadBranch(branch: FeedbackBranch, audience: FeedbackAudience): FeedbackBranch {
  if (audience === "person") return "safety";
  return branch === "safety" ? "complaint" : branch;
}

/** The road one message leaves by (`roadBranch`): what the club chose for the form that reaches its reader. */
export function viaFor(settings: FeedbackSettings, branch: FeedbackBranch, audience: FeedbackAudience): FeedbackVia {
  return settings[roadBranch(branch, audience)].via;
}

/**
 * The settings as they act (§772): Girl Zone's road is Gmail only while the privacy notice in force
 * says her messages may leave by it (`safetyGmailDescribed`, `{{feedbackSafetyGmail}}`); otherwise the
 * notice promises they never pass through the club's mailbox, so they leave by Mailgun whatever was
 * saved. Everything that decides what a visitor is told or where a message goes reads this, never the raw row.
 */
export function effectiveFeedbackSettings(settings: FeedbackSettings, safetyGmailDescribed: boolean): FeedbackSettings {
  if (safetyGmailDescribed || settings.safety.via !== "gmail") return settings;
  return { ...settings, safety: { ...settings.safety, via: "mailgun" } };
}

/** Whether a message for Girl Zone's person leaves by the club's Gmail, so the club's mailbox readers see it (`viaFor`, §772). */
export function safetyMessageSeenByMailboxReaders(settings: FeedbackSettings): boolean {
  return viaFor(settings, "safety", "person") === "gmail";
}

/**
 * Whether a message for Girl Zone's person may still pass through the club's Gmail without the club having chosen it
 * (§NNN): the club's tick «Dacă Mailgun pică, trimite prin Gmail-ul clubului» is on, the notice in force says her messages may
 * leave by Gmail, and the club's Gmail exists here — the cases in which, when Mailgun is down, her message leaves by the club's
 * mailbox and its readers see it in Sent. The public lines then say so (never «doar la …» where it may not be true).
 */
export function safetyMessageMayLeaveByGmail(settings: FeedbackSettings, safetyGmailDescribed: boolean, roads: FeedbackRoads): boolean {
  return roads.gmail && roads.mailgun && !safetyMessageSeenByMailboxReaders(settings) && fallbackAllowedFor(settings, "person", safetyGmailDescribed);
}

/**
 * Whether the other road may carry a message when the chosen one is down (§NNN, amending §772). The contact form’s and
 * the three ordinary forms’ messages go to the club’s own mailbox and the notice names both roads for them (§772),
 * so each may take them over from the other — and a message for Girl Zone’s person leaves by Gmail **only** with the club’s
 * tick, «Dacă Mailgun pică, trimite prin Gmail-ul clubului» (off by default), and only while the privacy notice in force says
 * her messages may leave by Gmail (`safetyGmailDescribed`): the notice promises they never pass through the club’s mailbox
 * otherwise, and the readers of that mailbox would see her message in Gmail’s Sent folder. Her message by Gmail that Mailgun
 * may take over (the club chose Gmail for her) needs no tick: Mailgun is the road the notice promised her.
 */
export function fallbackAllowedFor(settings: FeedbackSettings, audience: FeedbackAudience, safetyGmailDescribed: boolean): boolean {
  if (audience !== "person") return true;
  if (settings.safety.via === "gmail") return true;
  return settings.safety.fallbackToGmail && safetyGmailDescribed;
}

/**
 * Whether a form's recipient is the club's Gmail account itself (§NNN): by the canonicalizer, never a string compare —
 * a dotted or tagged spelling is the same inbox (§10.4). Gmail files a message from an account to the same account in
 * Sent and All mail, not necessarily in the Inbox, so the card says so beside the box.
 */
export function sendsToItself(recipient: string | null, account: string | null): boolean {
  if (!recipient || !account) return false;
  try {
    return canonicalizeEmail(recipient).inboxEmail === canonicalizeEmail(account).inboxEmail;
  } catch {
    return false;
  }
}

/**
 * The branches a visitor is offered, in the wizard's order: switched on, with somebody to receive
 * them (and, for the safety branch, the first name the page promises), and with the road the club chose
 * for the form to leave by (`FeedbackSettings`' `via`, §772) — Gmail only where the deployment has the SMTP road
 * (`contactSmtpRoadExists`; `CONTACT_FORM_MODE=off` has none), as «Scrie-ne» draws no form without one,
 * Mailgun only where the email service transmits — and none at all while
 * the privacy notice in force does not describe the forms (`describesFeedbackForms`): nothing is
 * taken from a person before the notice the club approved says what happens to it (AGENTS.md §10.8).
 */
export function offeredBranches(settings: FeedbackSettings, noticeDescribes: boolean, roads: FeedbackRoads): FeedbackBranch[] {
  if (!noticeDescribes) return [];
  return FEEDBACK_BRANCHES.filter((branch) => {
    const setting = settings[branch];
    if (!setting.on || !setting.to) return false;
    if (!roads[setting.via]) return false;
    return branch !== "safety" || Boolean(settings.safety.name);
  });
}

/**
 * The door's sentence on `/contact` (§676), from what is offered: the three ordinary forms named only
 * while one of them is there — with «Girl Zone» alone (a deployment with no SMTP road, or the club's
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

export type FeedbackQuery = { branch: FeedbackBranch | null; eventSlug: string | null; date: string | null; chip: PickerChip };

/**
 * `?tip=`, `?eveniment=`, `?data=` and `?filtru=`, read and never trusted: an unknown branch is no branch, a
 * slug that is not a slug is no event, a date that is not a day is no date. Whether the slug names a
 * published event is the page's question — an unknown one simply leaves «Altceva» selected.
 */
export function readFeedbackQuery(query: { tip?: string | string[]; eveniment?: string | string[]; data?: string | string[]; filtru?: string | string[] }): FeedbackQuery {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const slug = one(query.eveniment);
  return {
    branch: branchFromSlug(one(query.tip)),
    eventSlug: typeof slug === "string" && slug.length <= 200 && SLUG.test(slug) ? slug : null,
    date: readDay(one(query.data)),
    chip: readPickerChip(query.filtru),
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

/** A box's element id on the form, the anchor a refusal's summary links to: `f-<name>`. */
export function feedbackFieldId(name: string): string {
  return `f-${name}`;
}

/** Every box any branch has, in the order the forms show them — the order a refusal lists them in. */
export const FEEDBACK_FIELDS = ["name", "email", "contact", "audience", "event", "date", "rating", "message", "reasons", "reasonOther", "whereWhen", "captcha"] as const;
export type FeedbackField = (typeof FEEDBACK_FIELDS)[number];

/**
 * The choice every form opens with (§678), the radio named `identity`: «Anonim», the default and what
 * anything else posted reads as, or «Cu nume și prenume».
 */
export const FEEDBACK_IDENTITIES = ["anonymous", "named"] as const;
export type FeedbackIdentity = (typeof FEEDBACK_IDENTITIES)[number];

/** The name's length in the named mode (§678): a first name of two letters at least, a full name of 80 at most. */
export const FEEDBACK_NAME_MIN = 2;
export const FEEDBACK_NAME_MAX = 80;

/**
 * «Cine să afle?» (§678), the named mode's second choice, the radio named `audience`: «Clubul» — the
 * club's mailbox, by the club's Gmail — or the safety branch's person, by her first name, by Mailgun
 * alone. Posted empty, or not drawn, it is the branch's own reader (`defaultAudience`).
 */
export const FEEDBACK_AUDIENCES = ["club", "person"] as const;
export type FeedbackAudience = (typeof FEEDBACK_AUDIENCES)[number];

/** Each branch's own reader, and the only one an anonymous message ever reaches: the safety person for her form, the club otherwise. */
export function defaultAudience(branch: FeedbackBranch): FeedbackAudience {
  return branch === "safety" ? "person" : "club";
}

/**
 * Whom a named message on `branch` may reach (§678), in the order drawn — never an address, only
 * whether each exists:
 *
 * - **«Clubul»** — the branch's own recipient, and for the safety branch the «O reclamație» recipient
 *   or else the contact form's (`clubFallback`: whether the contact form reaches anybody); by the road
 *   chosen for the form that reaches it (`roadBranch`), so never where that road is missing.
 * - **the person** — while the safety branch has its recipient and its first name, switched on or not,
 *   the person the club designated; by the road chosen for Girl Zone (Mailgun unless the club chose
 *   otherwise, §772), whatever the branch, never where that road is missing. Switching the safety form
 *   off takes away her form, not her: a named message from another form may still reach her.
 *
 * Fewer than two is no choice: the group is not drawn and the message goes to the branch's own reader.
 */
export function audiencesFor(
  branch: FeedbackBranch,
  settings: FeedbackSettings,
  roads: FeedbackRoads & { clubFallback: boolean },
): FeedbackAudience[] {
  const clubRecipient = branch === "safety" ? Boolean(settings.complaint.to) || roads.clubFallback : Boolean(settings[branch].to);
  const club = roads[viaFor(settings, branch, "club")] && clubRecipient;
  const person = roads[viaFor(settings, branch, "person")] && Boolean(settings.safety.to) && Boolean(settings.safety.name);
  return FEEDBACK_AUDIENCES.filter((audience) => (audience === "club" ? club : person));
}

/**
 * The named mode one branch's form offers (§678), or `null` — the form anonymous only, with no
 * identity choice, no name, no way back and no «Cine să afle?» — while the privacy notice in force
 * does not name `{{feedbackFormsNamed}}` in every language (`namedDescribed`).
 */
export function namedModeFor(
  branch: FeedbackBranch,
  settings: FeedbackSettings,
  namedDescribed: boolean,
  roads: FeedbackRoads & { clubFallback: boolean },
): { audiences: FeedbackAudience[] } | null {
  return namedDescribed ? { audiences: audiencesFor(branch, settings, roads) } : null;
}

/**
 * The reader a post reaches (§678): the branch's own when anonymous, or when the named post chose
 * nobody; the one it chose otherwise — `null` when it chose one not offered (a tampered post, or the
 * club's setting changed under the form), which the service refuses on the box.
 */
export function chosenAudience(input: Pick<FeedbackInput, "branch" | "identity" | "audience">, offered: readonly FeedbackAudience[]): FeedbackAudience | null {
  const own = defaultAudience(input.branch);
  if (input.identity !== "named" || input.audience === "") return offered.length === 0 || offered.includes(own) ? own : offered[0];
  return offered.includes(input.audience) ? input.audience : null;
}

/**
 * `typed` as an address a reply can go to, or `null`: what the canonicalizer accepts (`deliveryEmail`,
 * the trimmed typing) and `z.email()` agrees on. Pure; the refusal's reason is not kept — it would carry the address.
 */
export function replyAddressOf(typed: string): string | null {
  const value = typed.trim();
  if (value === "" || !z.email().safeParse(value).success) return null;
  try {
    return canonicalizeEmail(value).deliveryEmail;
  } catch (error) {
    if (error instanceof InvalidEmailError) return null;
    throw error;
  }
}

/**
 * Where a reply to this message goes (§772): the address typed beside the name in the named mode — on
 * Girl Zone's form, the «E-mail (opțional)» box (a telephone has no `Reply-To`); `null` anonymous or when none was given.
 */
export function replyAddressForInput(input: FeedbackInput): string | null {
  if (input.identity !== "named") return null;
  // Girl Zone: the box called email; a line typed in the telephone box that is an address stays as good as one.
  return input.branch === "safety" ? (input.email ?? replyAddressOf(input.contact)) : input.email;
}

/** The boxes only the named mode shows and the server only keeps: the name, the branch's way back and «Cine să afle?». */
export const NAMED_ONLY_FIELDS = ["name", "email", "contact", "audience"] as const satisfies readonly FeedbackField[];

/**
 * What a refusal keeps in the sealed draft (§142), path-scoped to the wizard and read back by its form:
 * the identity choice and every box but the ticks (kept joined, as `reasons`) and the anti-bot check —
 * never the trap, the clock or the token.
 */
export const FEEDBACK_DRAFT_BOXES = ["identity", "name", "email", "contact", "audience", "event", "date", "rating", "message", "reasonOther", "whereWhen"] as const satisfies readonly (FeedbackField | "identity")[];

/**
 * The boxes each branch has, in its form's order: the name and the way back first, inside the
 * identity choice at the very top (§678), then the branch's own.
 */
export const BRANCH_FIELDS: Readonly<Record<FeedbackBranch, readonly FeedbackField[]>> = {
  howItWent: ["name", "email", "event", "date", "rating", "message", "reasons", "reasonOther"],
  suggestion: ["name", "email", "message"],
  complaint: ["name", "email", "message", "event", "date"],
  safety: ["name", "email", "contact", "message", "whereWhen"],
};

/** A line becomes a header-free line: no break, the edges trimmed. */
const line = z
  .string()
  .max(FEEDBACK_LINE_MAX * 2)
  .transform((value) => value.replace(/[\r\n]+/g, " ").trim())
  .pipe(z.string().max(FEEDBACK_LINE_MAX));
const text = z.string().trim().min(1).max(FEEDBACK_TEXT_MAX);
/**
 * Optional: empty is none; otherwise an address the reply can go to (§772) — one the versioned
 * canonicalizer accepts (AGENTS.md §10.4, BR-REQ-032-*), as every address a person types on this site.
 * What is kept is what was typed, trimmed (`deliveryEmail`): the mail goes there with its capitals, and
 * becomes the message's `Reply-To`. Nothing of it is stored: the identity is never computed beyond this check.
 */
const optionalEmail = z
  .string()
  .trim()
  .max(320)
  .transform((value, context) => {
    if (value === "") return null;
    const address = replyAddressOf(value);
    if (!address) {
      context.addIssue({ code: "custom", message: "not an address the reply can go to" });
      return z.NEVER;
    }
    return address;
  });
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
  /** The person's name and surname: kept only in the named mode, and required there (2–80 characters). */
  name: line,
  /** «Cine să afle?»: empty is the branch's own reader; whether the one chosen is offered is the service's question. */
  audience: z.union([z.literal(""), z.enum(FEEDBACK_AUDIENCES)]).default(""),
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

/**
 * Girl Zone's named mode has two optional ways back, one box each (§772): `email`, the address a reply can go
 * to (checked by the canonicalizer, the message's `Reply-To`, kept nowhere), and `contact`, a telephone
 * number or any line the person wants the designated person to have — carried in the message and nowhere else.
 */
export const safetyFields = z.object({ branch: z.literal("safety"), message: text, whereWhen: line, contact: line, email: optionalEmail.default(null), ...common });

/**
 * Anonymous unless the person chose otherwise (§678): any identity but «Cu nume și prenume» reads as
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
    // The named mode is a name: «Cu nume și prenume» with the box empty, or a name outside 2–80 characters, is refused on the box.
    if (input.identity === "named" && !namedLengthFits(input.name)) context.addIssue({ code: "custom", path: ["name"], message: "a name of 2 to 80 characters" });
  }),
);

/** A name as the named mode takes it: 2–80 characters, once its edges are trimmed. */
export function namedLengthFits(name: string): boolean {
  return name.length >= FEEDBACK_NAME_MIN && name.length <= FEEDBACK_NAME_MAX;
}

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

/**
 * «Cine să afle?» as the sent page's address names it (§678), only when a named message went to the
 * other reader than its branch's own — `&catre=clubul` from the safety form, `&catre=persoana` from
 * another — so the sent line says who got it. A word, never an address or a name.
 */
export const AUDIENCE_SLUG: Readonly<Record<FeedbackAudience, string>> = { club: "clubul", person: "persoana" };

export function audienceFromSlug(value: string | null | undefined): FeedbackAudience | null {
  return FEEDBACK_AUDIENCES.find((audience) => AUDIENCE_SLUG[audience] === value) ?? null;
}

/** Where a post that left goes (§676): `?sent=<the branch's slug>`, which the page answers with its sent line — and `&catre=` when it reached the other reader (§678). */
export function feedbackSentUrl(path: string, branch: FeedbackBranch | null, audience?: FeedbackAudience): string {
  return `${path}?sent=${branch ? BRANCH_SLUG[branch] : ""}${audience ? `&catre=${AUDIENCE_SLUG[audience]}` : ""}`;
}

/** Who got a sent message (§678): the reader `&catre=` names, else the branch's own. */
export function sentReader(branch: FeedbackBranch, catre: string | null | undefined): FeedbackAudience {
  return audienceFromSlug(catre) ?? defaultAudience(branch);
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

/** The email's first line in the anonymous mode (§678): «Nume: (anonim)». */
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

/**
 * Each ordinary form's name as the club reads it, quoted on the line «Din formularul: …» when a named
 * message from it reaches the safety branch's person (§678): her inbox otherwise holds only her own form's.
 */
const FORM_NAME: Readonly<Record<Exclude<FeedbackBranch, "safety">, string>> = {
  howItWent: "„Cum a fost”",
  suggestion: "„O sugestie”",
  complaint: "„O reclamație”",
};

/** «Altceva / în general»: no event chosen, or one the club does not publish. */
const GENERAL = "altceva / în general";

/**
 * What the composer is told: the event's title in the form's language, or none; and whether the
 * message goes to the safety branch's person rather than the club (§678) — then its subject is the
 * neutral one whatever the branch, and its footer says the sender chose her.
 */
export type FeedbackContext = { eventTitle: string | null; toPerson?: boolean };

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
 * The lines of one message: first «Nume: …» — the name the person gave, or «(anonim)» (§678) — then,
 * for a message from an ordinary form that goes to the safety branch's person, «Din formularul: „…”»
 * (§678), then only what they filled, in the form's order (`BRANCH_FIELDS`), and the way back or «(fără contact
 * lăsat)». Romanian whatever the form's language — the reader is the club — with the form's language
 * on its own line so the club knows how to answer.
 */
export function feedbackLines(input: FeedbackInput, context: FeedbackContext): { lines: Line[]; message: Line; contact: Line } {
  const lines: Line[] = [{ label: "Nume", value: input.identity === "named" && input.name ? input.name : ANONYMOUS_NAME_LINE }];
  if (context.toPerson && input.branch !== "safety") lines.push({ label: "Din formularul", value: FORM_NAME[input.branch] });
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
  const way = (input.branch === "safety" ? [input.email, input.contact] : [input.email]).filter(Boolean).join(" · ");
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
    input.branch === "safety" || context.toPerson
      ? SAFETY_SUBJECT
      : input.branch === "howItWent"
        ? `${SUBJECT.howItWent}: ${oneLine(input.event && context.eventTitle ? context.eventTitle : GENERAL)}`
        : SUBJECT[input.branch];
  const footer =
    input.branch === "safety"
      ? "— Trimis prin formularul confidențial „Girl Zone” al site-ului. Site-ul nu a păstrat nimic din el."
      : context.toPerson
        ? "— Trimis prin formularele „Spune-ne ceva” ale site-ului; cine a scris a ales să afli doar tu. Site-ul nu a păstrat nimic din el."
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
