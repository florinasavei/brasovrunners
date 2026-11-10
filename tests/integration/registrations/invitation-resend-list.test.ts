import { eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { invitationDeadline } from "@/modules/registrations/domain/invitations";
import { type ConfirmSpec, fillFromForm, pickConfirm } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «La retrimitere», the list beside «Retrimite» on an open invitation (the owner, 2026-11-10, of the bare
 * number box «Zile (opțional)» that stood there: «nu înțeleg ce înseamnă asta»; BR-REQ-037-07).
 *
 * What is protected, read from the panel as the server draws it for a real database (PGlite):
 * - the list rests on «Termenul rămâne», and every other line is a deadline by its day, the start last;
 * - every line is a move the server really makes (`resendInvitationByStaff`): later than the deadline the
 *   invitation has, on the day the line names — never a line that would move nothing;
 * - the question each choice asks names its outcome: the deadline kept, the start, or the day chosen;
 * - no list where the deadline cannot move: a counted place while somebody waits, a deadline already at the
 *   start — and none for the Organizer, who has no «Retrimite» at all;
 * - the form still posts `days`, empty or a whole number, as the server has always read it.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
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
});

async function createEvent(capacity: number, options: { startsAt?: Date; auto?: boolean; hidden?: boolean } = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: options.startsAt ?? STARTS,
      registrationMode: "INTERNAL",
      capacity,
      waitlistAutoOffer: options.auto ?? false,
      hiddenListEnabled: options.hidden ?? false,
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

/** What one invitation's row offers: the list's label and lines (null without a list), and the questions of «Retrimite». */
type RowView = { label: string | null; lines: { value: string; words: string }[] | null; confirm: ConfirmSpec | readonly ConfirmSpec[] | undefined; hasResend: boolean };

async function panel(event: EventInput, now: Date, mayManage = true): Promise<Map<string, RowView>> {
  const never = (async () => null) as never;
  const tree = await InvitationsPanel({ db, locale: state.locale, eventId: event.id, mayManage, sendAction: never, resendAction: never, withdrawAction: never, now });
  const rows = elementsOf(tree).filter((element) => element.props["data-testid"] === "invitation-row");
  const view = new Map<string, RowView>();
  for (const row of rows) {
    const inside = elementsOf(row);
    const name = inside.map((element) => element.props.children).find((child) => typeof child === "string" && / (Pop|Munteanu)$/.test(child)) as string;
    const form = inside.find((element) => element.props["data-testid"] === "invitation-resend-form");
    const list = inside.find((element) => element.props.name === "days");
    view.set(name, {
      hasResend: form !== undefined,
      confirm: form?.props.confirm as RowView["confirm"],
      label: list ? (list.props.label as string) : null,
      lines: list ? elementsOf(list.props.children as ReactNode).filter((element) => element.type === "option").map((option) => ({ value: String(option.props.value), words: String(option.props.children) })) : null,
    });
  }
  return view;
}

/** The question a press would ask with `days` posted so, as the dialog shows it. */
function question(view: RowView, days: string | null): ConfirmSpec {
  const valueOf = (field: string) => (field === "days" ? days : null);
  const spec = pickConfirm(view.confirm, valueOf);
  if (!spec) throw new Error("the press asks nothing");
  return fillFromForm(spec, valueOf);
}

const invitationOf = async (name: string) => (await db.select().from(eventInvitations).where(eq(eventInvitations.name, name)))[0];
const LINK_AGAIN = "primește invitația din nou, cu un link nou; linkul vechi nu mai merge.";

describe("BR-REQ-037-07 §NNN «La retrimitere»: the deadlines a resend can give, by their day", () => {
  it("rests on «Termenul rămâne» and offers each later day by its date and its days from now, the start last", async () => {
    const event = await createEvent(10);
    await invite(event, "Ana Pop", 7);
    const ana = (await panel(event, at(2))).get("Ana Pop")!;
    expect(ana.label).toBe("La retrimitere");
    expect(ana.lines).toEqual([
      { value: "", words: "Termenul rămâne" },
      // Seven days from now is the 17th again, a few minutes later: not a choice. The first is a day later.
      { value: "8", words: "Termen nou: mie., 18 nov. (peste 8 zile)" },
      { value: "9", words: "Termen nou: joi, 19 nov. (peste 9 zile)" },
      { value: "10", words: "Termen nou: vin., 20 nov. (peste 10 zile)" },
      // Eleven days from now is past the start: the start itself, once.
      { value: "11", words: "Termen nou: la start, sâm., 21 nov." },
    ]);

    state.locale = "en";
    const english = (await panel(event, at(2))).get("Ana Pop")!;
    expect(english.label).toBe("On resend");
    expect(english.lines?.map((line) => line.words)).toEqual([
      "The deadline stays",
      "New deadline: Wed, 18 Nov (in 8 days)",
      "New deadline: Thu, 19 Nov (in 9 days)",
      "New deadline: Fri, 20 Nov (in 10 days)",
      "New deadline: the start, Sat, 21 Nov",
    ]);
  });

  it("counts the days in Romanian's three forms: «o zi», «2 zile», «20 de zile»", async () => {
    const event = await createEvent(10, { startsAt: new Date(NOW.getTime() + 40 * DAY) });
    // Sent last night with one day: it ends tonight, so tomorrow is already a later day.
    await invite(event, "Ana Pop", 1, at(-12 * 60));
    const words = (await panel(event, at(2))).get("Ana Pop")!.lines!.map((line) => line.words);
    expect(words[1]).toBe("Termen nou: mie., 11 nov. (peste o zi)");
    expect(words[2]).toBe("Termen nou: joi, 12 nov. (peste 2 zile)");
    expect(words[19]).toBe("Termen nou: dum., 29 nov. (peste 19 zile)");
    expect(words[20]).toBe("Termen nou: lun., 30 nov. (peste 20 de zile)");
    // Forty days to the start: the list ends where the start is reached, never past it.
    expect(words.at(-1)).toBe("Termen nou: la start, dum., 20 dec.");
    expect(words).toHaveLength(41);
  });

  it("offers only moves the server really makes: each line pressed lands later than before, on the day it named", async () => {
    const event = await createEvent(10);
    for (const name of ["Ana Pop", "Dan Pop", "Ema Pop", "Ion Pop"]) await invite(event, name, 7);
    const drawnAt = at(2);
    const offered = (await panel(event, drawnAt)).get("Ana Pop")!.lines!.filter((line) => line.value !== "");
    expect(offered.map((line) => line.value)).toEqual(["8", "9", "10", "11"]);
    const day = (when: Date) => new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", day: "numeric", month: "short" }).format(when);
    const people = ["Ana Pop", "Dan Pop", "Ema Pop", "Ion Pop"];
    for (const [index, line] of offered.entries()) {
      const before = await invitationOf(people[index]);
      // Pressed twenty minutes after the page was drawn: the clock only adds.
      const pressedAt = at(22);
      const resent = await resendInvitationByStaff(db, before.id, { days: Number(line.value) }, admin, pressedAt);
      expect(resent.kept, line.words).toBeNull();
      expect(resent.expiresAt.getTime(), line.words).toBeGreaterThan(before.expiresAt.getTime());
      expect(resent.expiresAt, line.words).toEqual(invitationDeadline({ now: pressedAt, days: Number(line.value), startsAt: STARTS }));
      expect(line.words, line.words).toContain(day(resent.expiresAt));
    }
    // The last line is the start itself.
    expect((await invitationOf("Ion Pop")).expiresAt).toEqual(STARTS);
    // And the list left alone posts no days: the deadline stays.
    const kept = await invitationOf("Ana Pop");
    expect((await resendInvitationByStaff(db, kept.id, { days: null }, admin, at(30))).expiresAt).toEqual(kept.expiresAt);
  });

  it("asks a question that names the outcome: the deadline kept, the start, or the day chosen — each with its email line", async () => {
    const event = await createEvent(10);
    await invite(event, "Ana Pop", 7);
    const ana = (await panel(event, at(2))).get("Ana Pop")!;
    const kept = question(ana, "");
    expect(kept.title).toBe("Retrimiți invitația?");
    expect(kept.body).toBe(`Ana Pop ${LINK_AGAIN} Termenul rămâne mar., 17 nov. 2026, la 10:00.`);
    expect(question(ana, "11").body).toBe(`Ana Pop ${LINK_AGAIN} Termenul se mută la start: sâm., 21 nov. 2026, la 09:00.`);
    expect(question(ana, "9").body).toBe(`Ana Pop ${LINK_AGAIN} Termenul se mută la ziua aleasă în listă (zile de acum: 9).`);
    for (const days of ["", "9", "11"]) {
      const asked = question(ana, days);
      expect(asked.email, days).toContain("Ana Pop");
      expect(asked.confirmLabel, days).toBe("Retrimite");
    }

    state.locale = "en";
    const english = (await panel(event, at(2))).get("Ana Pop")!;
    expect(question(english, "").body).toBe("Ana Pop gets the invitation again, with a new link; the old link stops working. The deadline stays Tue, 17 Nov 2026, at 10:00.");
    expect(question(english, "11").body).toBe("Ana Pop gets the invitation again, with a new link; the old link stops working. The deadline moves to the start: Sat, 21 Nov 2026, at 09:00.");
    expect(question(english, "9").body).toBe("Ana Pop gets the invitation again, with a new link; the old link stops working. The deadline moves to the day chosen in the list (days from now: 9).");
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
    expect(question(ana, null).body).toBe(
      "Ana Pop primește invitația din nou, cu un link nou; cel vechi nu mai merge. Termenul rămâne cel de acum: cineva așteaptă pe listă, iar dacă invitația nu e acceptată până atunci, locul trece la listă.",
    );
    // «Pe lista de invitați speciali» holds no counted place: nobody waits for it, and its deadline may move.
    expect(view.get("Dana Pop")!.lines?.map((line) => line.value)).toEqual(["", "8", "9", "10", "11"]);
  });

  it("draws no list when no later day is left — the deadline is already the start — and the one question says it stays", async () => {
    const event = await createEvent(10, { startsAt: new Date(NOW.getTime() + 3 * DAY) });
    await invite(event, "Ana Pop", 7);
    expect((await invitationOf("Ana Pop")).expiresAt).toEqual(new Date(NOW.getTime() + 3 * DAY));
    const ana = (await panel(event, at(2))).get("Ana Pop")!;
    expect(ana.hasResend).toBe(true);
    expect(ana.lines).toBeNull();
    expect(Array.isArray(ana.confirm)).toBe(false);
    expect(question(ana, null).body).toBe(`Ana Pop ${LINK_AGAIN} Termenul rămâne vin., 13 nov. 2026, la 10:00.`);
  });

  it("gives the Organizer no «Retrimite» and no list (BR-REQ-060-01 is the action's: the service refuses the role)", async () => {
    const event = await createEvent(10);
    await invite(event, "Ana Pop", 7);
    const ana = (await panel(event, at(2), false)).get("Ana Pop")!;
    expect(ana.hasResend).toBe(false);
    expect(ana.lines).toBeNull();
    const refusal = await resendInvitationByStaff(db, (await invitationOf("Ana Pop")).id, { days: 9 }, organizer, at(3)).then(() => null, (error: unknown) => error);
    expect((refusal as { code?: string } | null)?.code).toBe("FORBIDDEN");
  });
});
