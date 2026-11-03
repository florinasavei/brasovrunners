import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The email press scope (the design «telling the owner about every email a staff press sends», slice 1, its
 * sections 1 and 7): every row a staff press queues carries the press's `cause`, one `press_id` for the whole press
 * and the actor as `requested_by_staff_user_id` — the person's message, the club's copies of it, a bulk send's one
 * copy, a road's notice — and nothing outside a scope is stamped. The rows are what the transaction committed: a
 * rolled-back one leaves none, and a waiting-list email withdrawn in the same press is not among them.
 *
 * Against PGlite, the migrations included (`helpers/db.ts`); one real press end to end, «Oferă-i un loc acum».
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));
vi.mock("@/shared/feedback/flash", () => ({ flashOutcome: async () => undefined, flash: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("next/cache", async () => ({ ...(await import("../../helpers/next-cache")).fakeNextCache.module, revalidatePath: () => undefined }));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));

const { currentEmailPress, inEmailPress, pressStamp } = await import("@/modules/notifications/press");
const { enqueueBulkClubCopies, enqueueEmail } = await import("@/modules/notifications/outbox");
const { enqueueRelay } = await import("@/modules/notifications/relay");
const { updateClubNotices } = await import("@/modules/notifications/club-notices");
const { addToWaitlistAction } = await import("@/app/[locale]/admin/registrations/actions");
const { confirmEmail, submitRegistration } = await import("@/modules/registrations/service");

const NOW = new Date();
const STARTS = new Date(NOW.getTime() + 30 * 24 * 3_600_000);
const COPY = "copii@club.test";

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let other: StaffUser;

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Ana Admin", role: "ADMIN" }).returning();
  [other] = await db.insert(staffUsers).values({ email: "super@example.ro", displayName: "Sergiu Super", role: "SUPERADMIN" }).returning();
  state.actor = admin;
});

/** One message, as a service queues it: the person's address, no registration behind it (so no club copy). */
const message = (key: string, extra: Partial<Parameters<typeof enqueueEmail>[1]> = {}): Parameters<typeof enqueueEmail>[1] => ({
  participantId: null,
  registrationId: null,
  messageType: "PROFILE_MANAGE_LINK",
  locale: "ro",
  recipientEmail: "maria@example.ro",
  payload: {},
  idempotencyKey: key,
  now: NOW,
  ...extra,
});

const rowOf = async (key: string) => (await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, key)))[0];

async function createEvent(capacity: number): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: STARTS, registrationMode: "INTERNAL", capacity, waitlistAutoOffer: false, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
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
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  } as EventInput;
}

/** One person through the public door, as far as the address's confirmation: the event's one place, held. */
async function confirmedAddress(event: EventInput, name: string) {
  await submitRegistration(
    db,
    event,
    {
      firstName: name,
      lastName: "Munteanu",
      birthDate: "1985-03-02",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Ion Vecinul",
      emergencyContactPhone: "+40722222222",
      email: `${name.toLowerCase()}@example.ro`,
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      resultsNameConsent: false,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(NOW.getTime() - 30_000).toISOString(),
    },
    NOW,
    "REAL",
    { source: "PUBLIC", createdByStaffUserId: null },
  );
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return confirmEmail(db, event, row.id, NOW);
}

describe("the email press scope stamps what a press queues", () => {
  it("stamps the cause, one id per press and the actor on the person's message", async () => {
    const pressId = await inEmailPress("registrations.resend", async (press) => {
      press.by(admin.id);
      await db.transaction((tx) => enqueueEmail(tx, message("k:one")));
      await db.transaction((tx) => enqueueEmail(tx, message("k:two", { recipientEmail: "ion@example.ro" })));
      return press.id;
    });
    const [one, two] = [await rowOf("k:one"), await rowOf("k:two")];
    expect(one).toMatchObject({ cause: "registrations.resend", pressId, requestedByStaffUserId: admin.id });
    // Every row of the same press carries the same id.
    expect(two).toMatchObject({ cause: "registrations.resend", pressId, requestedByStaffUserId: admin.id });
  });

  it("stamps nothing outside a scope: a public flow's row carries no cause, no press and no requester", async () => {
    expect(currentEmailPress()).toBeUndefined();
    expect(pressStamp()).toEqual({ cause: null, pressId: null, requestedByStaffUserId: null });
    await db.transaction((tx) => enqueueEmail(tx, message("k:public")));
    expect(await rowOf("k:public")).toMatchObject({ cause: null, pressId: null, requestedByStaffUserId: null });
    // A service that names its requester keeps it, as before the scope existed.
    await db.transaction((tx) => enqueueEmail(tx, message("k:named", { requestedByStaffUserId: other.id })));
    expect(await rowOf("k:named")).toMatchObject({ cause: null, pressId: null, requestedByStaffUserId: other.id });
  });

  it("keeps the requester a service names over the press's actor, and stamps no actor before `by`", async () => {
    await inEmailPress("club.newsletter", async (press) => {
      await db.transaction((tx) => enqueueEmail(tx, message("k:before")));
      press.by(admin.id);
      await db.transaction((tx) => enqueueEmail(tx, message("k:named", { requestedByStaffUserId: other.id })));
    });
    expect((await rowOf("k:before")).requestedByStaffUserId).toBeNull();
    expect(await rowOf("k:named")).toMatchObject({ cause: "club.newsletter", requestedByStaffUserId: other.id });
  });

  it("lets the inner scope win, and the outer resume after it", async () => {
    const ids = await inEmailPress("registrations.cancel", async (outer) => {
      outer.by(admin.id);
      const inner = await inEmailPress("job.emailOutbox", async (job) => {
        await db.transaction((tx) => enqueueEmail(tx, message("k:inner")));
        return job.id;
      });
      await db.transaction((tx) => enqueueEmail(tx, message("k:outer")));
      return { outer: outer.id, inner };
    });
    expect(await rowOf("k:inner")).toMatchObject({ cause: "job.emailOutbox", pressId: ids.inner, requestedByStaffUserId: null });
    expect(await rowOf("k:outer")).toMatchObject({ cause: "registrations.cancel", pressId: ids.outer, requestedByStaffUserId: admin.id });
    expect(ids.inner).not.toBe(ids.outer);
  });

  it("keeps two presses running at once apart", async () => {
    const [a, b] = await Promise.all([
      inEmailPress("volunteers.assign", async (press) => {
        press.by(admin.id);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await db.transaction((tx) => enqueueEmail(tx, message("k:a")));
        return press.id;
      }),
      inEmailPress("volunteers.unassign", async (press) => {
        press.by(other.id);
        await db.transaction((tx) => enqueueEmail(tx, message("k:b")));
        return press.id;
      }),
    ]);
    expect(await rowOf("k:a")).toMatchObject({ cause: "volunteers.assign", pressId: a, requestedByStaffUserId: admin.id });
    expect(await rowOf("k:b")).toMatchObject({ cause: "volunteers.unassign", pressId: b, requestedByStaffUserId: other.id });
  });

  it("leaves no row of a press whose transaction rolled back", async () => {
    const pressId = await inEmailPress("registrations.erase", async (press) => {
      press.by(admin.id);
      await db
        .transaction(async (tx) => {
          await enqueueEmail(tx, message("k:rolled-back"));
          throw new Error("refused after the enqueue");
        })
        .catch(() => undefined);
      return press.id;
    });
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.pressId, pressId))).toEqual([]);
  });

  it("stamps a bulk send's one club copy with the send's press", async () => {
    await updateClubNotices(db, admin, { participants: { bcc: [COPY] } }, NOW);
    const event = await createEvent(10);
    const pressId = await inEmailPress("events.participantMessage", async (press) => {
      press.by(admin.id);
      await db.transaction((tx) =>
        enqueueBulkClubCopies(tx, { messageType: "ORGANIZER_MESSAGE", eventId: event.id, payload: {}, sendKey: "organizer-message:send-1", realRecipients: 2, now: NOW, drainAfter: false }),
      );
      return press.id;
    });
    expect(await rowOf(`organizer-message:send-1:club-copy:${COPY}`)).toMatchObject({ cause: "events.participantMessage", pressId, requestedByStaffUserId: admin.id });
  });

  it("stamps a road's notice the relay queues in the outbox job's scope, with no actor", async () => {
    const pressId = await inEmailPress("job.emailOutbox", async (press) => {
      await enqueueRelay(db, {
        type: "RELAY_NOTICE",
        road: "mailgun",
        to: "admin@example.ro",
        locale: "ro",
        content: { subject: "s", text: "t", html: "<p>t</p>", fallbackAllowed: true, notice: true },
        idempotencyKey: "relay-notice:test",
        now: NOW,
      });
      return press.id;
    });
    expect(await rowOf("relay-notice:test")).toMatchObject({ cause: "job.emailOutbox", pressId, requestedByStaffUserId: null });
  });
});

describe("one real press, end to end: «Oferă-i un loc acum» on a full race", () => {
  it("stamps the offer and the club's copy with the press, names the actor, and the withdrawn «Ești pe lista de așteptare» is not among its rows", async () => {
    await updateClubNotices(db, admin, { participants: { bcc: [COPY] } }, NOW);
    const event = await createEvent(1);
    expect((await confirmedAddress(event, "Ana")).status).toBe("PENDING_DECLARATION");
    const form = new FormData();
    form.set("uiLocale", "ro");
    form.set("eventId", event.id);
    form.set("firstName", "Mara");
    form.set("lastName", "Munteanu");
    form.set("email", "mara@example.ro");
    form.set("relayedByParticipantRequest", "on");
    form.set("intent", "offer");
    form.set("addPlace", "2");

    // The redirect throws through the scope unchanged.
    await expect(addToWaitlistAction(null, form)).rejects.toThrow(/^REDIRECT /);

    const [mara] = await db.select().from(registrations).where(eq(registrations.registeredName, "Mara Munteanu"));
    expect(mara.status).toBe("WAITLIST_OFFERED");
    const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, mara.id));
    const pressIds = new Set(rows.map((row) => row.pressId));
    expect(pressIds.size).toBe(1);
    const [pressId] = [...pressIds];
    expect(pressId).not.toBeNull();
    // The press's rows: the offer to Mara and the club's copy of it — never the waiting-list email the offer replaced.
    const ofPress = await db.select().from(emailOutbox).where(eq(emailOutbox.pressId, pressId as string));
    expect(ofPress.map((row) => [row.messageType, row.recipientEmail]).sort()).toEqual([
      ["WAITLIST_SPOT_OFFER", COPY],
      ["WAITLIST_SPOT_OFFER", "mara@example.ro"],
    ]);
    for (const row of ofPress) expect(row).toMatchObject({ cause: "registrations.offerNow", requestedByStaffUserId: admin.id });
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, mara.id), eq(emailOutbox.messageType, "WAITLIST_JOINED")))).toEqual([]);
    // Ana's own rows came from the public door: no press, no cause.
    const publicRows = await db.select().from(emailOutbox).where(isNull(emailOutbox.pressId));
    expect(publicRows.length).toBeGreaterThan(0);
    for (const row of publicRows) expect(row.cause).toBeNull();
  });
});
