import { eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { formatDay } from "@/i18n/dates";
import { type ConfirmSpec, fillFromForm, pickConfirm } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «La retrimitere», the list beside «Retrimite» on an open invitation (the owner, 2026-11-10, of the bare number box
 * «Zile (opțional)» that stood there: «nu înțeleg ce înseamnă asta»; `DECISIONS.md`, «La retrimitere»; BR-REQ-037-07).
 *
 * What is protected, read from the panel as the server draws it for a real database (PGlite) and pressed through
 * the real action:
 * - the list rests on «Termenul rămâne», and every other line is a deadline by its day and hour, one line a day
 *   on the event's clock, the start last — a list of one line when the start is the only later deadline;
 * - a line names exactly the moment its press stores — twenty minutes later, after midnight, or the next morning
 *   from a tab left open: the form posts when it was drawn, and the server counts the days from then;
 * - that anchor only ever brings a deadline earlier than the press alone would: never from a moment still to
 *   come, and a post without it counts from the press, as it always did;
 * - the question each choice asks names its outcome: the deadline kept, or the chosen line in its own words —
 *   and when that promise cannot be kept, because the deadline was moved later from another page meanwhile, the
 *   message after the press says the deadline stayed;
 * - no list where the deadline cannot move: a counted place while somebody waits (a special guest keeps hers,
 *   and her questions), no later day left — the deadline already the start, or sixty days ending on its own day —
 *   an event that is not scheduled — and none for the Organizer, who has no «Retrimite» at all.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, locale: "ro" as "ro" | "en", actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
// «Invitații» is a Server Component: its words from the catalogues, as the page has them.
vi.mock("next-intl/server", async (original) => {
  const { createTranslator } = await import("next-intl");
  return {
    ...(await original<typeof import("next-intl/server")>()),
    getLocale: async () => state.locale,
    getTranslations: async (namespace: string) => createTranslator({ locale: state.locale, messages: state.locale === "ro" ? ro : en, namespace: namespace as "Admin" }),
  };
});
// The questions' email line reads the club's roads once per render: one road here, as a site without Gmail has.
vi.mock("@/shared/feedback/email-roads-request", () => ({
  emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "mailgun", newsletter: "mailgun" }, gmail: false }),
}));

const { confirmEmail, inviteToEventByStaff, resendInvitationByStaff, submitRegistration } = await import("@/modules/registrations/service");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");
const { default: InvitationsPanel } = await import("@/modules/registrations/ui/InvitationsPanel");
const { resendInvitationAction } = await import("@/app/[locale]/admin/registrations/invitation-actions");

/** Tuesday, 10:00 in the club's zone; the race on Saturday the 21st at 09:00. */
const NOW = new Date("2026-11-10T08:00:00.000Z");
const STARTS = new Date("2026-11-21T07:00:00.000Z");
const DAY = 24 * 3_600_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

type EventInput = Parameters<typeof submitRegistration>[1];
type Element = ReactElement<Record<string, unknown>>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  forgetCachedDeadlines();
  state.locale = "ro";
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.invalid", displayName: "Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.invalid", displayName: "Organizer", role: "MODERATOR" }).returning();
  state.actor = admin;
});

async function createEvent(capacity: number, options: { startsAt?: Date; auto?: boolean; hidden?: boolean; status?: "SCHEDULED" | "CANCELLED" } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: options.startsAt ?? STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistAutoOffer: options.auto ?? false,
      hiddenListEnabled: options.hidden ?? false,
      eventStatus: options.status ?? "SCHEDULED",
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    waitlistCapacity: event.waitlistCapacity,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: event.registrationClosesAt,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  } as EventInput;
}

const invite = (event: EventInput, name: string, days: number, sentAt: Date = NOW, outsideCapacity = false) =>
  inviteToEventByStaff(db, event, { people: [{ name, email: `${name.split(" ")[0].toLowerCase()}@example.invalid` }], days, outsideCapacity }, admin, sentAt);

/** Somebody from the public form, with the address proved: on a full race, the waiting list. */
async function registered(event: EventInput, firstName: string, minute: number) {
  const sentAt = at(minute);
  await submitRegistration(
    db,
    event,
    {
      firstName,
      lastName: "Munteanu",
      birthDate: "1985-03-02",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Ion Vecinul",
      emergencyContactPhone: "+40722222222",
      email: `${firstName.toLowerCase()}@example.invalid`,
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      resultsNameConsent: false,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(sentAt.getTime() - 1_000).toISOString(),
    },
    sentAt,
    "REAL",
    { source: "PUBLIC" as const, createdByStaffUserId: null },
  );
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${firstName} Munteanu`));
  return confirmEmail(db, event, row.id, sentAt);
}

/** Every element of a tree the Server Component returned, depth first. */
function elementsOf(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elementsOf(element.props.children as ReactNode)];
}

/**
 * What one invitation's row offers: the list's label and lines (null without a list), the value it rests on and
 * whether it is the browser's own list — it posts with JavaScript off — the questions of «Retrimite», and what its
 * form posts unseen.
 */
type RowView = {
  label: string | null;
  rests: string | null;
  native: boolean | null;
  /** The list's widths by screen, as its `sx` gives them. */
  width: unknown;
  lines: { value: string; words: string }[] | null;
  confirm: ConfirmSpec | readonly ConfirmSpec[] | undefined;
  hasResend: boolean;
  hidden: Record<string, string>;
};

async function panel(event: EventInput, now: Date, mayManage = true): Promise<Map<string, RowView>> {
  const never = (async () => null) as never;
  const tree = await InvitationsPanel({ db, actor: { role: mayManage ? "ADMIN" : "MODERATOR" }, locale: state.locale, eventId: event.id, mayManage, sendAction: never, resendAction: never, withdrawAction: never, deleteAction: never, now });
  const rows = elementsOf(tree).filter((element) => element.props["data-testid"] === "invitation-row");
  const view = new Map<string, RowView>();
  for (const row of rows) {
    const inside = elementsOf(row);
    const name = inside.map((element) => element.props.children).find((child) => typeof child === "string" && / (Pop|Munteanu)$/.test(child)) as string;
    const form = inside.find((element) => element.props["data-testid"] === "invitation-resend-form");
    const list = inside.find((element) => element.props.name === "days");
    view.set(name, {
      hidden: Object.fromEntries(
        (form ? elementsOf(form.props.children as ReactNode) : []).filter((element) => element.type === "input" && element.props.type === "hidden").map((input) => [String(input.props.name), String(input.props.value)]),
      ),
      hasResend: form !== undefined,
      confirm: form?.props.confirm as RowView["confirm"],
      label: list ? (list.props.label as string) : null,
      rests: list ? (list.props.defaultValue as string) : null,
      native: list ? ((list.props.slotProps as { select?: { native?: boolean } } | undefined)?.select?.native ?? false) : null,
      width: list ? (list.props.sx as { width?: unknown } | undefined)?.width : null,
      lines: list ? elementsOf(list.props.children as ReactNode).filter((element) => element.type === "option").map((option) => ({ value: String(option.props.value), words: String(option.props.children) })) : null,
    });
  }
  return view;
}

/** The question a press would ask with `days` chosen so, as the dialog shows it: the island reads the value posted and the chosen line's own words. */
function question(view: RowView, days: string | null): ConfirmSpec {
  const valueOf = (field: string) => (field === "days" ? days : null);
  const chosenOf = (field: string) => (field === "days" ? (view.lines?.find((line) => line.value === days)?.words ?? null) : null);
  const spec = pickConfirm(view.confirm, valueOf);
  if (!spec) throw new Error("the press asks nothing");
  return fillFromForm(spec, valueOf, chosenOf);
}

/**
 * «Retrimite» pressed at `pressedAt` with the row's form as the page drew it and `days` chosen in its list: the real
 * action. Answers what the page it redirects to is told, exactly — `saved=invitationResent`, `error=FORBIDDEN`.
 */
async function press(view: RowView, days: string, pressedAt: Date, over: Record<string, string> = {}): Promise<string> {
  const form = new FormData();
  for (const [name, value] of Object.entries({ ...view.hidden, days, ...over })) form.set(name, value);
  try {
    await atTheClock(pressedAt, () => resendInvitationAction(null, form));
  } catch (error) {
    const digest = String((error as { digest?: unknown } | null)?.digest ?? "");
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    const told = /[?&](saved|error)=([A-Za-z_]+)(?=[&#;]|$)/.exec(digest);
    if (!told) throw new Error(`the redirect says neither saved nor error: ${digest}`);
    return `${told[1]}=${told[2]}`;
  }
  throw new Error("expected a redirect");
}

const invitationOf = async (name: string) => (await db.select().from(eventInvitations).where(eq(eventInvitations.name, name)))[0];
const LINK_AGAIN = "primește invitația din nou, cu un link nou; linkul vechi nu mai merge.";
/** A moment as a list's line writes it, in Romanian, on the event's clock. */
const inLine = (at: Date) => formatDay(at, { locale: "ro", timeZone: "Europe/Bucharest", style: "short", year: false, withTime: true, position: "continues" });

describe("BR-REQ-037-07 «La retrimitere»: the deadlines a resend can give, by their day and hour", () => {
  it("rests on «Termenul rămâne» and offers one line a day, each a later day with its hour, the start last", async () => {
    const event = await createEvent(10);
    await invite(event, "Ana Pop", 7);
    const ana = (await panel(event, at(2))).get("Ana Pop")!;
    expect(ana.label).toBe("La retrimitere");
    expect(ana.lines).toEqual([
      { value: "", words: "Termenul rămâne" },
      // Seven days from the draw is the 17th again, two minutes later: not a choice. The first is a day later.
      { value: "8", words: "Termen nou: mie., 18 nov., 10:02" },
      { value: "9", words: "Termen nou: joi, 19 nov., 10:02" },
      { value: "10", words: "Termen nou: vin., 20 nov., 10:02" },
      // Eleven days from the draw is past the start: the start itself, once.
      { value: "11", words: "Termen nou: la start, sâm., 21 nov., 09:00" },
    ]);
    // At rest the list posts no days — a plain «Retrimite» moves nothing — and it is the browser's own list.
    expect(ana.rests).toBe("");
    expect(ana.native).toBe(true);
    // The closed list shows the chosen line: from 900 pixels wide enough for the longest of a year in either language —
    // «la start», 311 pixels in English, and the control's own 46; an ordinary line from 600; a phone's whole block.
    expect(ana.width).toEqual({ xs: "100%", sm: 290, md: 360 });
    // The form says when it was drawn, for the server to count from.
    expect(ana.hidden.drawnAt).toBe(at(2).toISOString());

    state.locale = "en";
    const english = (await panel(event, at(2))).get("Ana Pop")!;
    expect(english.label).toBe("On resend");
    expect(english.lines?.map((line) => line.words)).toEqual([
      "The deadline stays",
      "New deadline: Wed, 18 Nov, 10:02",
      "New deadline: Thu, 19 Nov, 10:02",
      "New deadline: Fri, 20 Nov, 10:02",
      "New deadline: the start, Sat, 21 Nov, 09:00",
    ]);
  });

  it("leaves the start's own day to «la start» when the page is drawn before the start's hour, and ends a far start's list where it is reached", async () => {
    const event = await createEvent(10);
    await invite(event, "Ana Pop", 7, at(-180));
    // Drawn at 08:00: eleven days on is the 21st at 08:00, an hour before the start — that day is «la start»'s alone.
    const early = (await panel(event, at(-120))).get("Ana Pop")!.lines!.map((line) => line.words);
    expect(early.slice(-2)).toEqual(["Termen nou: vin., 20 nov., 08:00", "Termen nou: la start, sâm., 21 nov., 09:00"]);
    expect(early.filter((words) => words.includes("21 nov."))).toHaveLength(1);

    const far = await createEvent(10, { startsAt: new Date(NOW.getTime() + 40 * DAY) });
    // Sent last night with one day: it ends tonight, so tomorrow is already a later day.
    await invite(far, "Dan Pop", 1, at(-12 * 60));
    const words = (await panel(far, at(2))).get("Dan Pop")!.lines!.map((line) => line.words);
    expect(words[1]).toBe("Termen nou: mie., 11 nov., 10:02");
    expect(words.at(-1)).toBe("Termen nou: la start, dum., 20 dec., 10:00");
    // «Termenul rămâne», thirty-nine days and the start.
    expect(words).toHaveLength(41);
  });

  it("draws a list of one line when the start is the only later deadline, and asks about that line", async () => {
    // The race on Tuesday the 17th at 22:00; the invitation ends that morning at 10:00. Eight days on is past the start.
    const startsAt = new Date(NOW.getTime() + 7.5 * DAY);
    const event = await createEvent(10, { startsAt });
    await invite(event, "Ana Pop", 7);
    const ana = (await panel(event, at(2))).get("Ana Pop")!;
    expect(ana.lines).toEqual([
      { value: "", words: "Termenul rămâne" },
      { value: "8", words: "Termen nou: la start, mar., 17 nov., 22:00" },
    ]);
    expect(ana.rests).toBe("");
    expect(ana.hidden.drawnAt).toBe(at(2).toISOString());
    // One line is a list like any other: left alone the deadline stays, chosen it is the start.
    expect(question(ana, "").body).toBe(`Ana Pop ${LINK_AGAIN} Termenul rămâne: mar., 17 nov. 2026, la 10:00.`);
    expect(question(ana, "8").body).toBe(`Ana Pop ${LINK_AGAIN} Termen nou: la start, mar., 17 nov., 22:00.`);
    expect(await press(ana, "8", at(22))).toBe("saved=invitationResent");
    expect((await invitationOf("Ana Pop")).expiresAt).toEqual(startsAt);
  });

  it("reads «a later day» on the event's clock: a page drawn after midnight offers the day that has just begun there", async () => {
    const event = await createEvent(10);
    // Sent on Monday the 9th at 23:30 with seven days: it ends on the 16th at 23:30. Drawn an hour later, at 00:30:
    // seven days on is the 17th at 00:30 — a later day in Brașov, the 16th still by UTC's clock.
    await invite(event, "Ana Pop", 7, new Date("2026-11-09T21:30:00.000Z"));
    const ana = (await panel(event, new Date("2026-11-09T22:30:00.000Z"))).get("Ana Pop")!;
    expect(ana.lines).toEqual([
      { value: "", words: "Termenul rămâne" },
      { value: "7", words: "Termen nou: mar., 17 nov., 00:30" },
      { value: "8", words: "Termen nou: mie., 18 nov., 00:30" },
      { value: "9", words: "Termen nou: joi, 19 nov., 00:30" },
      { value: "10", words: "Termen nou: vin., 20 nov., 00:30" },
      // Eleven days on is the 21st at 00:30, the start's own day: «la start»'s.
      { value: "12", words: "Termen nou: la start, sâm., 21 nov., 09:00" },
    ]);
  });

  it.each([
    ["twenty minutes later", at(2), at(22)],
    // 23:50 on Tuesday, pressed at 00:10 on Wednesday: counted from the press, every line would store the day after the one it names.
    ["after midnight", new Date("2026-11-10T21:50:00.000Z"), new Date("2026-11-10T22:10:00.000Z")],
    ["the next morning, from a tab left open", new Date("2026-11-10T14:00:00.000Z"), new Date("2026-11-11T07:00:00.000Z")],
  ])("stores exactly the moment a line names, pressed %s", async (_when, drawnAt, pressedAt) => {
    const event = await createEvent(10);
    const people = ["Ana Pop", "Dan Pop", "Ema Pop", "Ion Pop"];
    for (const name of people) await invite(event, name, 7);
    const view = await panel(event, drawnAt);
    const offered = view.get("Ana Pop")!.lines!.filter((line) => line.value !== "");
    expect(offered.map((line) => line.value)).toEqual(["8", "9", "10", "11"]);
    for (const [index, line] of offered.entries()) {
      const before = await invitationOf(people[index]);
      expect(await press(view.get(people[index])!, line.value, pressedAt), line.words).toBe("saved=invitationResent");
      const after = await invitationOf(people[index]);
      expect(after.expiresAt.getTime(), line.words).toBeGreaterThan(before.expiresAt.getTime());
      expect(after.resendCount, line.words).toBe(1);
      // The line's own words are the stored moment's: the same day, the same hour.
      expect(line.words, line.words).toBe(index === 3 ? `Termen nou: la start, ${inLine(after.expiresAt)}` : `Termen nou: ${inLine(after.expiresAt)}`);
      // The days counted from the draw, never from the press.
      expect(after.expiresAt, line.words).toEqual(index === 3 ? STARTS : new Date(drawnAt.getTime() + Number(line.value) * DAY));
    }
  });

  it("keeps the deadline when the list is left on «Termenul rămâne», and sends the email again all the same", async () => {
    const event = await createEvent(10);
    await invite(event, "Ana Pop", 7);
    const view = await panel(event, at(2));
    const before = await invitationOf("Ana Pop");
    expect(await press(view.get("Ana Pop")!, "", at(30))).toBe("saved=invitationResent");
    expect(await invitationOf("Ana Pop")).toMatchObject({ expiresAt: before.expiresAt, resendCount: 1, lastSentAt: at(30) });
  });

  it("counts from the press, as it always did, when the post says nothing usable of its draw — and never from a moment still to come", async () => {
    const event = await createEvent(10);
    for (const name of ["Ana Pop", "Dan Pop", "Ema Pop", "Ion Pop"]) await invite(event, name, 3);
    const view = await panel(event, at(2));
    // No `drawnAt` at all (a days post by hand), and one that is no instant: both count from the press.
    const withoutDraw = { ...view.get("Ana Pop")!, hidden: Object.fromEntries(Object.entries(view.get("Ana Pop")!.hidden).filter(([name]) => name !== "drawnAt")) };
    await press(withoutDraw, "5", at(60));
    expect((await invitationOf("Ana Pop")).expiresAt).toEqual(new Date(at(60).getTime() + 5 * DAY));
    await press(view.get("Dan Pop")!, "5", at(60), { drawnAt: "ieri la prânz" });
    expect((await invitationOf("Dan Pop")).expiresAt).toEqual(new Date(at(60).getTime() + 5 * DAY));
    // A day without its time is a date, not the instant the form writes: counted from its first minute the deadline would come nine hours early.
    await press(view.get("Ion Pop")!, "5", at(60), { drawnAt: "2026-11-10" });
    expect((await invitationOf("Ion Pop")).expiresAt).toEqual(new Date(at(60).getTime() + 5 * DAY));
    // A draw an hour ahead of the press buys no extra hour.
    const resent = await resendInvitationByStaff(db, (await invitationOf("Ema Pop")).id, { days: 5, countedFrom: at(120) }, admin, at(60));
    expect(resent.expiresAt).toEqual(new Date(at(60).getTime() + 5 * DAY));
  });

  it("an old draw only ever brings the deadline earlier, never earlier than it was: the email leaves, the deadline stays", async () => {
    const event = await createEvent(10);
    for (const name of ["Ana Pop", "Dan Pop"]) await invite(event, name, 7);
    const before = await invitationOf("Ana Pop");
    // Five days counted from a page drawn two days ago reach the 13th: earlier than the 17th it has.
    const resent = await resendInvitationByStaff(db, before.id, { days: 5, countedFrom: at(-2 * 24 * 60) }, admin, at(5));
    // The answer says why the deadline did not go where the days asked: it was already later.
    expect(resent).toEqual({ expiresAt: before.expiresAt, kept: "alreadyLater" });
    expect(await invitationOf("Ana Pop")).toMatchObject({ expiresAt: before.expiresAt, resendCount: 1 });
    // The same through the form itself, posted with the draw of two days ago: the message after the press says it stayed.
    const view = await panel(event, at(2));
    const dan = await invitationOf("Dan Pop");
    expect(await press(view.get("Dan Pop")!, "5", at(5), { drawnAt: at(-2 * 24 * 60).toISOString() })).toBe("saved=invitationResentAlreadyLater");
    expect(await invitationOf("Dan Pop")).toMatchObject({ expiresAt: dan.expiresAt, resendCount: 1 });
  });

  it("says after the press when a line's promise could not be kept: the deadline was moved later from another page meanwhile", async () => {
    const event = await createEvent(10);
    for (const name of ["Ana Pop", "Dan Pop"]) await invite(event, name, 7);
    // Two pages open on the same invitations: one drawn at 10:02, the other at 10:05.
    const first = await panel(event, at(2));
    const second = await panel(event, at(5));
    // On the second, the 20th is chosen and pressed.
    const twentieth = second.get("Ana Pop")!.lines!.find((line) => line.words === "Termen nou: vin., 20 nov., 10:05")!;
    expect(await press(second.get("Ana Pop")!, twentieth.value, at(6))).toBe("saved=invitationResent");
    const moved = new Date(at(5).getTime() + 10 * DAY);
    expect((await invitationOf("Ana Pop")).expiresAt).toEqual(moved);

    // The first page still offers the 18th, and its question still promises it: the server keeps the later deadline,
    // as a resend never takes time back — and the message says the deadline stayed, and why.
    const eighteenth = first.get("Ana Pop")!.lines!.find((line) => line.words === "Termen nou: mie., 18 nov., 10:02")!;
    expect(question(first.get("Ana Pop")!, eighteenth.value).body).toBe(`Ana Pop ${LINK_AGAIN} Termen nou: mie., 18 nov., 10:02.`);
    expect(await press(first.get("Ana Pop")!, eighteenth.value, at(8))).toBe("saved=invitationResentAlreadyLater");
    expect(await invitationOf("Ana Pop")).toMatchObject({ expiresAt: moved, resendCount: 2 });

    // The very deadline the line names, reached meanwhile from the other page — here the start — is no surprise: the plain message.
    expect(await press(second.get("Dan Pop")!, "11", at(9))).toBe("saved=invitationResent");
    expect((await invitationOf("Dan Pop")).expiresAt).toEqual(STARTS);
    expect(await press(first.get("Dan Pop")!, "11", at(10))).toBe("saved=invitationResent");
    expect(await invitationOf("Dan Pop")).toMatchObject({ expiresAt: STARTS, resendCount: 2 });
  });

  it("asks a question that names the outcome: the deadline kept, or the chosen line in its own words — each with its email line", async () => {
    const event = await createEvent(10);
    await invite(event, "Ana Pop", 7);
    const ana = (await panel(event, at(2))).get("Ana Pop")!;
    const kept = question(ana, "");
    expect(kept.title).toBe("Retrimiți invitația?");
    expect(kept.body).toBe(`Ana Pop ${LINK_AGAIN} Termenul rămâne: mar., 17 nov. 2026, la 10:00.`);
    expect(question(ana, "11").body).toBe(`Ana Pop ${LINK_AGAIN} Termen nou: la start, sâm., 21 nov., 09:00.`);
    expect(question(ana, "9").body).toBe(`Ana Pop ${LINK_AGAIN} Termen nou: joi, 19 nov., 10:02.`);
    // Two questions for a row with a list: the one that keeps, and the one that repeats the line.
    expect(ana.confirm).toHaveLength(2);
    for (const days of ["", "9", "11"]) {
      const asked = question(ana, days);
      expect(asked.email, days).toContain("Ana Pop");
      expect(asked.confirmLabel, days).toBe("Retrimite");
    }

    state.locale = "en";
    const english = (await panel(event, at(2))).get("Ana Pop")!;
    expect(question(english, "").body).toBe("Ana Pop gets the invitation again, with a new link; the old link stops working. The deadline stays: Tue, 17 Nov 2026, at 10:00.");
    expect(question(english, "11").body).toBe("Ana Pop gets the invitation again, with a new link; the old link stops working. New deadline: the start, Sat, 21 Nov, 09:00.");
    expect(question(english, "9").body).toBe("Ana Pop gets the invitation again, with a new link; the old link stops working. New deadline: Thu, 19 Nov, 10:02.");
  });

  it("draws no list where the deadline cannot move: a counted place while somebody waits — and a special guest keeps hers", async () => {
    const event = await createEvent(1, { auto: true, hidden: true });
    await invite(event, "Ana Pop", 7);
    // Elena queued behind the invitation's place and its deadline.
    expect((await registered(event, "Elena", 1)).status).toBe("WAITLISTED");
    await invite(event, "Dana Pop", 7, at(2), true);
    const view = await panel(event, at(3));

    const ana = view.get("Ana Pop")!;
    expect(ana.hasResend).toBe(true);
    expect(ana.lines).toBeNull();
    expect(ana.hidden.drawnAt).toBeUndefined();
    expect(question(ana, null).body).toBe(
      "Ana Pop primește invitația din nou, cu un link nou; cel vechi nu mai merge. Termenul rămâne cel de acum: cineva așteaptă pe listă, iar dacă invitația nu e acceptată până atunci, locul trece la listă.",
    );
    // Days posted by hand for her all the same, with a draw moment beside them: the email leaves, the deadline stays
    // while Elena waits, and the message says it stayed.
    const before = await invitationOf("Ana Pop");
    expect(await press(ana, "9", at(5), { drawnAt: at(3).toISOString() })).toBe("saved=invitationResentKept");
    expect(await invitationOf("Ana Pop")).toMatchObject({ expiresAt: before.expiresAt, resendCount: 1 });
    // «Pe lista de invitați speciali» holds no counted place: nobody waits for it, and its deadline may move.
    const dana = view.get("Dana Pop")!;
    expect(dana.lines?.map((line) => line.value)).toEqual(["", "8", "9", "10", "11"]);
    // Her questions are the list's own — the deadline kept, or the chosen line — never the one about somebody waiting.
    expect(question(dana, "").body).toBe(`Dana Pop ${LINK_AGAIN} Termenul rămâne: mar., 17 nov. 2026, la 10:02.`);
    expect(question(dana, "9").body).toBe(`Dana Pop ${LINK_AGAIN} Termen nou: joi, 19 nov., 10:03.`);
  });

  it("draws no list when no later day is left — the deadline is already the start — and the one question says it stays", async () => {
    const event = await createEvent(10, { startsAt: new Date(NOW.getTime() + 3 * DAY) });
    await invite(event, "Ana Pop", 7);
    expect((await invitationOf("Ana Pop")).expiresAt).toEqual(new Date(NOW.getTime() + 3 * DAY));
    const ana = (await panel(event, at(2))).get("Ana Pop")!;
    expect(ana.hasResend).toBe(true);
    expect(ana.lines).toBeNull();
    expect(Array.isArray(ana.confirm)).toBe(false);
    expect(question(ana, null).body).toBe(`Ana Pop ${LINK_AGAIN} Termenul rămâne: vin., 13 nov. 2026, la 10:00.`);
  });

  it("draws no list when sixty days end on the deadline's own day, short of the start — and the question names the deadline, not the start", async () => {
    // A race a hundred days away, an invitation sent with the sixty a deadline may run: sixty days from the draw is the same 9 January, two minutes later.
    const event = await createEvent(10, { startsAt: new Date(NOW.getTime() + 100 * DAY) });
    await invite(event, "Ana Pop", 60);
    const ana = (await panel(event, at(2))).get("Ana Pop")!;
    expect(ana.hasResend).toBe(true);
    expect(ana.lines).toBeNull();
    expect(ana.hidden.drawnAt).toBeUndefined();
    expect(Array.isArray(ana.confirm)).toBe(false);
    expect(question(ana, null).body).toBe(`Ana Pop ${LINK_AGAIN} Termenul rămâne: sâm., 9 ian. 2027, la 10:00.`);
  });

  it("draws no list on an event that is not scheduled: every resend is refused there, so no line may promise a day", async () => {
    const event = await createEvent(10);
    await invite(event, "Ana Pop", 7);
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
    const view = await panel(event, at(2));
    const ana = view.get("Ana Pop")!;
    expect(ana.lines).toBeNull();
    expect(Array.isArray(ana.confirm)).toBe(false);
    // The press itself is refused, as before, and nothing moves.
    const before = await invitationOf("Ana Pop");
    expect(await press(ana, "", at(5))).toBe("error=INVITATION_EVENT_CLOSED");
    expect(await invitationOf("Ana Pop")).toMatchObject({ expiresAt: before.expiresAt, resendCount: 0 });
  });

  it("gives the Organizer no «Retrimite» and no list, and the press is refused for the role (BR-REQ-060-01)", async () => {
    const event = await createEvent(10);
    await invite(event, "Ana Pop", 7);
    const asAdministrator = (await panel(event, at(2))).get("Ana Pop")!;
    const ana = (await panel(event, at(2), false)).get("Ana Pop")!;
    expect(ana.hasResend).toBe(false);
    expect(ana.lines).toBeNull();
    // The form the Administrator's page drew, posted by the Organizer: refused, nothing sent, nothing moved.
    state.actor = organizer;
    const before = await invitationOf("Ana Pop");
    expect(await press(asAdministrator, "9", at(3))).toBe("error=FORBIDDEN");
    expect(await invitationOf("Ana Pop")).toMatchObject({ expiresAt: before.expiresAt, resendCount: 0 });
  });
});
