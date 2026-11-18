import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §953 (amending §949), BR-REQ-050-02 — what a press on a volunteer tells the public cache (§333).
 *
 * `changeVolunteer` expires the public «places» rows after a change, because a volunteer added, confirmed, cancelled or given
 * a role moves what the volunteers' page counts and lists. The organizers' own marks move nothing a visitor reads — «Are kit»
 * (§904), the point a person stands at on «Planul voluntarilor» and «Participă la tombolă» (§949) — and each expiry is a read
 * that may wake the database: on race week the plan is built one press a person. So those three presses expire no public tag,
 * and every other change still does. Since §NNN a fourth: «Prezent», ticked one press a person on race morning.
 *
 * `next/cache` is stubbed with spies and the cache is told it runs in a Next server (`revalidation.test.ts`'s way): without
 * that `revalidatePublicContent` returns before it expires anything, and "nothing was expired" would prove nothing — which is
 * why every press that must not expire is asserted beside one that must.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string | { pathname: string; params?: Record<string, string> } }) => {
    if (typeof href === "string") return `/${locale}${href}`;
    return `/${locale}${Object.entries(href.params ?? {}).reduce((path, [key, value]) => path.replace(`[${key}]`, value), href.pathname)}`;
  },
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { revalidatePath, revalidateTag } = await import("next/cache");
const { changeVolunteer } = await import("@/modules/volunteers/volunteers");
const { placeVolunteerAction } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/actions");
const { setVolunteerKitAction, setVolunteerPresentAction, setVolunteerRaffleAction } = await import("@/app/[locale]/admin/volunteers/actions");

const NOW = new Date("2026-11-16T10:00:00.000Z");
/** The one call the public cache listens for (§333): the «places» rows expired at once. */
const PLACES_EXPIRED = ["public:places", { expire: 0 }];

let db: TestDatabase;
let close: () => Promise<void>;
let organizer: StaffUser;
let eventId: string;
let roleId: string;
let otherRoleId: string;
let pointId: string;
let anaId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@example.test", displayName: "Oana Organizator", role: "MODERATOR" }).returning();
  state.actor = organizer;
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), acceptsVolunteers: true, hasRaffle: true }).returning({ id: events.id });
  eventId = event.id;
  const [guide, water] = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId, nameRo: "Direcționare", nameEn: "Guidance", needed: 4, position: 0 },
      { eventId, nameRo: "Punct de hidratare", nameEn: "Water point", needed: 2, position: 1 },
    ])
    .returning({ id: eventVolunteerRoles.id });
  roleId = guide.id;
  otherRoleId = water.id;
  const [point] = await db.insert(eventCheckpoints).values({ eventId, km: "1.20", nameRo: "Intersecția Stejeriș", nameEn: "Stejeriș junction", kinds: ["DIRECTION"], position: 0 }).returning({ id: eventCheckpoints.id });
  pointId = point.id;
  // Ana, entered and confirmed as the card's own verbs do it.
  const added = await changeVolunteer(db, organizer, { kind: "add", eventId, fields: { name: "Ana Pop", email: "ana.pop@example.test", phone: "+40700000001", assignedRoleIds: [roleId] } }, NOW, { sendEmail: false });
  anaId = added.volunteer.id;
  await changeVolunteer(db, organizer, { kind: "setState", eventId, id: anaId, state: "CONFIRMED" }, NOW, { sendEmail: false });

  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.mocked(revalidateTag).mockClear();
  vi.mocked(revalidatePath).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const rowOf = async () => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, anaId)))[0];

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId, volunteerId: anaId, ...fields })) data.set(key, value);
  return data;
}

/** A Server Action pressed: the address it came back to. */
async function pressed(action: Promise<void>): Promise<string> {
  try {
    await action;
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return message.slice("REDIRECT ".length);
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("§953 the organizers' own marks leave the public cache as it was", () => {
  it("«Pune aici» and «Scoate» change the plan and expire no public tag", async () => {
    expect(await changeVolunteer(db, organizer, { kind: "setCheckpoint", eventId, id: anaId, checkpointId: pointId }, NOW)).toMatchObject({ changed: true });
    expect((await rowOf()).checkpointId).toBe(pointId);
    expect(await changeVolunteer(db, organizer, { kind: "setCheckpoint", eventId, id: anaId, checkpointId: "" }, NOW)).toMatchObject({ changed: true });
    expect((await rowOf()).checkpointId).toBeNull();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("«Participă la tombolă» on a volunteer changes the raffle's list and expires no public tag", async () => {
    expect(await changeVolunteer(db, organizer, { kind: "setRaffle", eventId, id: anaId, inRaffle: false }, NOW)).toMatchObject({ changed: true });
    expect((await rowOf()).inRaffle).toBe(false);
    expect(await changeVolunteer(db, organizer, { kind: "setRaffle", eventId, id: anaId, inRaffle: true }, NOW)).toMatchObject({ changed: true });
    expect((await rowOf()).inRaffle).toBe(true);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("«Are kit» expires none either, as before (§904)", async () => {
    expect(await changeVolunteer(db, organizer, { kind: "setKit", eventId, id: anaId, hasKit: true }, NOW)).toMatchObject({ changed: true });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("«Prezent» on a volunteer ticks and clears the organizers' mark and expires no public tag (§NNN)", async () => {
    expect(await changeVolunteer(db, organizer, { kind: "setPresent", eventId, id: anaId, present: true }, NOW)).toMatchObject({ changed: true });
    expect((await rowOf()).present).toBe(true);
    expect(await changeVolunteer(db, organizer, { kind: "setPresent", eventId, id: anaId, present: false }, NOW)).toMatchObject({ changed: true });
    expect((await rowOf()).present).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("the «Prezent» press, from the list and from the person's page, tells only the staff page it was made on (§NNN)", async () => {
    const person = `/ro/admin/volunteers/${anaId}`;
    expect(await pressed(setVolunteerPresentAction(form({ present: "1", returnTo: "/ro/admin/volunteers?present=no" })))).toBe("/ro/admin/volunteers?present=no");
    expect(await pressed(setVolunteerPresentAction(form({ present: "0", returnTo: person })))).toBe(person);
    expect((await rowOf()).present).toBe(false);
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toEqual(["/ro/admin/volunteers", person]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("the presses themselves — the plan's form, the two ticks of the list — tell only their own backoffice page", async () => {
    const plan = `/ro/admin/events/${eventId}/plan-voluntari`;
    // Back to the point, open, on «Pe puncte» (§974) — the address carries the view; the page it refreshes is the plan's path.
    const atPoint = `${plan}?view=points&open=${pointId}#point-${pointId}`;
    expect(await pressed(placeVolunteerAction(form({ checkpointId: pointId, at: pointId })))).toBe(atPoint);
    expect(await pressed(placeVolunteerAction(form({ checkpointId: "", at: pointId })))).toBe(atPoint);
    expect(await pressed(setVolunteerRaffleAction(form({ inRaffle: "0", returnTo: "/ro/admin/volunteers" })))).toBe("/ro/admin/volunteers");
    expect(await pressed(setVolunteerKitAction(form({ hasKit: "1", returnTo: "/ro/admin/volunteers" })))).toBe("/ro/admin/volunteers");
    // Each press changed its mark…
    expect(await rowOf()).toMatchObject({ checkpointId: null, inRaffle: false, hasKit: true });
    // …refreshed the staff page it was made on, and expired nothing a visitor reads.
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toEqual([plan, plan, "/ro/admin/volunteers", "/ro/admin/volunteers"]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("§953 every other change to a volunteer still expires «places»", () => {
  /** One change, and what the cache was told for it alone. */
  async function expiredBy(request: Parameters<typeof changeVolunteer>[2]): Promise<unknown[][]> {
    vi.mocked(revalidateTag).mockClear();
    expect(await changeVolunteer(db, organizer, request, NOW, { sendEmail: false }), request.kind).toMatchObject({ changed: true });
    return vi.mocked(revalidateTag).mock.calls;
  }

  it("a hand entry, an edit, a confirmation, a cancellation, a role given, a role taken back and a delete", async () => {
    expect(await expiredBy({ kind: "add", eventId, fields: { name: "Dan Ene", email: "dan.ene@example.test", phone: "+40700000002", roleIds: [otherRoleId] } })).toEqual([PLACES_EXPIRED]);
    expect(await expiredBy({ kind: "edit", eventId, id: anaId, fields: { name: "Ana Popa", email: "ana.pop@example.test", phone: "+40700000001", assignedRoleIds: [roleId] } })).toEqual([PLACES_EXPIRED]);
    expect(await expiredBy({ kind: "assign", eventId, id: anaId, roleId: otherRoleId })).toEqual([PLACES_EXPIRED]);
    expect(await expiredBy({ kind: "unassign", eventId, id: anaId, roleId: otherRoleId })).toEqual([PLACES_EXPIRED]);
    expect(await expiredBy({ kind: "setState", eventId, id: anaId, state: "CANCELLED" })).toEqual([PLACES_EXPIRED]);
    expect(await expiredBy({ kind: "setState", eventId, id: anaId, state: "CONFIRMED" })).toEqual([PLACES_EXPIRED]);
    expect(await expiredBy({ kind: "delete", eventId, id: anaId })).toEqual([PLACES_EXPIRED]);
  });

  it("a press that changes nothing expires nothing, whatever its kind", async () => {
    expect(await changeVolunteer(db, organizer, { kind: "setState", eventId, id: anaId, state: "CONFIRMED" }, NOW)).toMatchObject({ changed: false });
    expect(await changeVolunteer(db, organizer, { kind: "setCheckpoint", eventId, id: anaId, checkpointId: "" }, NOW)).toMatchObject({ changed: false });
    expect(await changeVolunteer(db, organizer, { kind: "setRaffle", eventId, id: anaId, inRaffle: true }, NOW)).toMatchObject({ changed: false });
    expect(await changeVolunteer(db, organizer, { kind: "setPresent", eventId, id: anaId, present: false }, NOW)).toMatchObject({ changed: false });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
