import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { TOAST_MAX_CHARACTERS, toastSentence } from "@/shared/feedback/mail-line";
import { decodeFlash, FLASH_COOKIE, type FormNotice } from "@/shared/feedback/notice";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The toast after a press (the design «telling the owner about every email a staff press sends», slice 2, its
 * sections 3 and 7): a real press runs through its action, inside its email press scope, and the flash it leaves in
 * the cookie carries what the press queued — read back by the press's id once its transaction committed: the type,
 * how many, the club's copies, when — and never a name or an address. A press that queued nothing adds nothing, and a
 * Zitadel failure on an invitation is toasted only for the club's email that still left.
 *
 * Against PGlite, the migrations included (`helpers/db.ts`); the cookie jar is the request's, faked.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  jar: new Map<string, string>(),
  set: [] as { name: string; value: string }[],
}));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      state.set.push({ name, value });
      state.jar.set(name, value);
    },
    delete: (name: string) => state.jar.delete(name),
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));
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

const { inEmailPress } = await import("@/modules/notifications/press");
const { enqueueEmail } = await import("@/modules/notifications/outbox");
const { updateClubNotices } = await import("@/modules/notifications/club-notices");
const { flashOutcome } = await import("@/shared/feedback/flash");
const { addToWaitlistAction, bulkCancelRegistrationsAction } = await import("@/app/[locale]/admin/registrations/actions");
const { confirmEmail, submitRegistration } = await import("@/modules/registrations/service");

const NOW = new Date();
const STARTS = new Date(NOW.getTime() + 30 * 24 * 3_600_000);
const COPY = "copii@club.test";

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.jar.clear();
  state.set.length = 0;
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Ana Admin", role: "ADMIN" }).returning();
  state.actor = admin;
});

/** The flash the last press left, read back as the admin layout reads it. */
const flashed = () => decodeFlash(state.set.filter((cookie) => cookie.name === FLASH_COOKIE).at(-1)?.value);

/** The toast that flash draws, composed as `ToastProvider` composes it (`mail-line.ts#toastSentence`), in Romanian. */
function drawn(notice: FormNotice): string {
  const t = createTranslator({ locale: "ro", messages: ro.Feedback as never }) as unknown as Parameters<typeof toastSentence>[1];
  const types = ro.Admin.emails.types as Record<string, string>;
  return toastSentence(notice, t, (type) => types[type] ?? null, "ro");
}

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
async function confirmedAddress(event: EventInput, name: string, kind: "REAL" | "TEST" = "REAL") {
  const row = await submitted(event, name, kind);
  return confirmEmail(db, event, row.id, NOW);
}

/** One person through the public door, the address not yet confirmed: no place, and no edge to CANCELLED. */
async function submitted(event: EventInput, name: string, kind: "REAL" | "TEST" = "REAL") {
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
    kind,
    { source: "PUBLIC", createdByStaffUserId: null },
  );
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

describe("the toast after a press says what the press queued", () => {
  it("«Oferă-i un loc acum» on a full race: the offer to the person, the club's copy, when — and no name or address in the cookie", async () => {
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

    await expect(addToWaitlistAction(null, form)).rejects.toThrow(/^REDIRECT /);

    const notice = flashed();
    expect(notice?.key).toBe("registrationOfferedRaised");
    expect(notice?.values).toMatchObject({ mailTo: "people", mailType: "WAITLIST_SPOT_OFFER", mailPeople: "1", mailClub: "1" });
    expect(["now", "at"]).toContain(notice?.values?.mail);
    // The waiting-list email the offer replaced in the same press was withdrawn: it is nowhere in the receipt.
    expect(notice?.values?.mailOthers).toBeUndefined();
    const cookie = state.set.filter((entry) => entry.name === FLASH_COOKIE).at(-1)?.value ?? "";
    expect(decodeURIComponent(cookie)).not.toMatch(/Mara|Munteanu|@/);
  });

  it("adds nothing to a press that queued nothing: its toast says nothing about email", async () => {
    await inEmailPress("events.save", async (press) => {
      press.by(admin.id);
      await flashOutcome({ saved: "event" });
    });
    expect(flashed()).toEqual({ kind: "success", key: "event" });
  });

  it("keeps the plain notice outside a press, as before", async () => {
    await flashOutcome({ saved: "checkedIn" });
    expect(flashed()).toEqual({ kind: "success", key: "checkedIn" });
  });

  it("toasts a Zitadel failure on an invitation only for the club's email that still left, and never as a green tick", async () => {
    await inEmailPress("club.staffInvite", async (press) => {
      press.by(admin.id);
      await flashOutcome({ saved: "invitedProviderFailed" });
    });
    expect(flashed()).toBeNull();

    await inEmailPress("club.staffInvite", async (press) => {
      press.by(admin.id);
      await db.transaction((tx) =>
        enqueueEmail(tx, {
          participantId: null,
          registrationId: null,
          messageType: "STAFF_INVITATION",
          locale: "ro",
          recipientEmail: "noua@example.ro",
          payload: {},
          idempotencyKey: "staff-invitation:test",
          now: new Date(),
        }),
      );
      await flashOutcome({ saved: "invitedProviderFailed" });
    });
    const notice = flashed();
    expect(notice).toMatchObject({ kind: "info", key: "invitedProviderFailed", values: { mailType: "STAFF_INVITATION", mailPeople: "1" } });
    expect(JSON.stringify(notice)).not.toContain("noua@");
  });

  it("names Zitadel's own email beside the club's invitation when Zitadel invited the person", async () => {
    await inEmailPress("club.staffInvite", async (press) => {
      press.by(admin.id);
      await db.transaction((tx) =>
        enqueueEmail(tx, {
          participantId: null,
          registrationId: null,
          messageType: "STAFF_INVITATION",
          locale: "ro",
          recipientEmail: "alta@example.ro",
          payload: {},
          idempotencyKey: "staff-invitation:zitadel",
          now: new Date(),
        }),
      );
      await flashOutcome({ saved: "invited", invite: "invited" });
    });
    expect(flashed()).toMatchObject({ kind: "success", key: "invited", values: { mailType: "STAFF_INVITATION", mailZitadel: "1" } });
  });
});

/**
 * The bulk cancel's toast (§384, slice 2), drawn from the press itself: `tests/e2e/bulk-cancel-count.spec.ts` ticks four rows
 * — two real ones the cancel reaches, an address never confirmed, a test row — and on 2026-11-04 waited for «2 înscrieri
 * anulate. Pleacă …» while the toast, rightly, said the test row went too («… Anulate și ele, nenumărate nicăieri: …»)
 * before its mail line. Here the press runs through its action, the flash is read back from the cookie and composed as
 * the provider composes it, so the sentence the browser shows is the one asserted.
 */
describe("the bulk cancel's toast: the act, then what the press emailed", () => {
  async function bulkCancel(rows: readonly { id: string }[]) {
    const form = new FormData();
    form.set("uiLocale", "ro");
    form.set("reason", "Test automat");
    for (const row of rows) form.append("registrationId", row.id);
    await expect(bulkCancelRegistrationsAction(form)).rejects.toThrow(/^REDIRECT \/ro\/admin\/registrations\?saved=registrationsCancelled&/);
    const notice = flashed();
    expect(notice).not.toBeNull();
    return { notice: notice as FormNotice, toast: drawn(notice as FormNotice) };
  }

  it("four ticked as the e2e ticks them: the two real ones counted, the test row said apart, and the emails the press queued", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    const bia = await confirmedAddress(event, "Bia");
    const cora = await submitted(event, "Cora");
    const dana = await confirmedAddress(event, "Dana", "TEST");
    expect(cora.status).toBe("PENDING_EMAIL_CONFIRMATION");

    const { notice, toast } = await bulkCancel([ana, bia, cora, dana]);
    expect(notice).toMatchObject({
      kind: "success",
      key: "registrationsCancelledTest",
      values: { count: "2", test: "1", mailTo: "people", mailType: "REGISTRATION_CANCELLED", mailPeople: "2", mailTest: "1" },
    });
    expect(toast).toMatch(/^2 înscrieri anulate\. Anulate și ele, nenumărate nicăieri: 1 [^.]+\. Pleacă [^:]+: „Înscriere anulată” către 2 persoane \(\+1 către adresă de test, nenumărat\)\.$/);
    // What the e2e waited for on 2026-11-04, and what a toast over a test row never says.
    expect(toast).not.toContain("2 înscrieri anulate. Pleacă ");
    expect(toast.length).toBeLessThanOrEqual(TOAST_MAX_CHARACTERS);
  });

  it("the two real ones alone: «2 înscrieri anulate. Pleacă …: „Înscriere anulată” către 2 persoane.»", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    const bia = await confirmedAddress(event, "Bia");

    const { notice, toast } = await bulkCancel([ana, bia]);
    expect(notice).toMatchObject({ kind: "success", key: "registrationsCancelled", values: { count: "2", mailPeople: "2", mailType: "REGISTRATION_CANCELLED" } });
    expect(toast).toMatch(/^2 înscrieri anulate\. Pleacă [^:]+: „Înscriere anulată” către 2 persoane\.$/);
  });

  it("«Trimite emailul» unticked: the act, and how many emails it kept back — nothing about any that left", async () => {
    const event = await createEvent(5);
    const ana = await confirmedAddress(event, "Ana");
    const bia = await confirmedAddress(event, "Bia");
    const form = new FormData();
    form.set("uiLocale", "ro");
    form.set("reason", "Test automat");
    form.set("sendEmail", "off");
    for (const row of [ana, bia]) form.append("registrationId", row.id);
    await expect(bulkCancelRegistrationsAction(form)).rejects.toThrow(/^REDIRECT /);
    expect(drawn(flashed() as FormNotice)).toBe("2 înscrieri anulate. 2 emailuri nu au plecat: ai debifat „Trimite…”.");
  });
});
