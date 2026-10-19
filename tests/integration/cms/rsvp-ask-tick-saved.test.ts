import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent } from "@/modules/content/events/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §823 — the value the event editor's tick «Trimite emailul „Vii?” înainte de această dată» (`events.rsvp_ask_enabled`) is saved with,
 * proved through the editor's real action and the two blocks as the browser posts them (the owner, 2026-10-19: the tick showed unticked
 * on an event whose «Vin!» tick was on — was it the club, or a save?).
 *
 * What the browser posts, which is the whole question: both ticks sit in the turn-up block, which is hidden — never removed — on a race,
 * and the «Vii?» tick sits in a second block hidden while «Vin!» is unticked (`OnlyWhenTicked`). A hidden checkbox still posts its state,
 * so each marker (`….present`) says «the box was on the form», and the box itself says on or off: ticked posts `on`, unticked posts nothing.
 * The session and navigation stand-ins are `rsvp-ask-enabled.test.ts`'s.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[] }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { saveEventAndTranslationsAction } = await import("@/app/[locale]/admin/actions");

const NOW = new Date("2026-09-25T10:00:00.000Z");

const COMMON = {
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-07T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Piața Sfatului",
  locationNameEn: "Council Square",
  locationAddress: "",
  surface: "ASPHALT",
  difficulty: "MEDIUM",
  costType: "FREE",
  costAmount: "",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "10000",
  elevationGainMeters: "",
  featured: false,
  participantListVisibility: "HIDDEN" as const,
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
};

/** Sunday's group run: a turn-up event, which takes no registration. */
const GROUP_RUN = { ...COMMON, type: "GROUP_RUN", registrationMode: "NONE" };
/** A race that registers elsewhere: the turn-up block is hidden in the editor. */
const RACE = { ...COMMON, type: "RACE", registrationMode: "EXTERNAL", externalProvider: "Alt club", externalRegistrationUrl: "https://alt-club.ro/inscriere" };

const TRANSLATIONS = {
  ro: { slug: "alergarea-cu-intrebare", title: "Alergarea cu întrebare", excerpt: "Cu întrebarea „Vii?”." },
  en: { slug: "question-run", title: "The question run", excerpt: "With the question." },
};

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  state.actor = admin;
  state.redirected.length = 0;
});

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

type Block = "absent" | "on" | "off";

/**
 * The editor's form as the browser posts it: «Vin!» block (`rsvp`) and «Vii?» block (`ask`) — «absent» is a form that does not carry the
 * block at all (a reader who may not change the settings, another card's fixture), «off» is the marker with the box unticked (the box
 * posts nothing), «on» is the marker with the box ticked.
 */
function editorForm(row: { id: string; version: number }, fields: Record<string, string | boolean>, blocks: { rsvp: Block; ask: Block }): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", row.id);
  form.set("event.expectedVersion", String(row.version));
  for (const [name, value] of Object.entries(fields)) if (typeof value === "string") form.set(`event.${name}`, value);
  if (blocks.rsvp !== "absent") form.set("event.rsvpEnabled.present", "1");
  if (blocks.rsvp === "on") form.set("event.rsvpEnabled", "on");
  if (blocks.ask !== "absent") form.set("event.rsvpAskEnabled.present", "1");
  if (blocks.ask === "on") form.set("event.rsvpAskEnabled", "on");
  return form;
}

async function save(id: string, fields: Record<string, string | boolean>, blocks: { rsvp: Block; ask: Block }) {
  const form = editorForm(await reload(id), fields, blocks);
  const outcome = await saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
  expect(outcome, JSON.stringify(outcome)).toBe("redirected");
  return reload(id);
}

/** One row, with addresses of its own: the two languages' slugs are unique across the table. */
let made = 0;
const make = async (fields: Record<string, string | boolean>, extra: Record<string, unknown> = {}) => {
  made += 1;
  const translations = { ro: { ...TRANSLATIONS.ro, slug: `${TRANSLATIONS.ro.slug}-${made}` }, en: { ...TRANSLATIONS.en, slug: `${TRANSLATIONS.en.slug}-${made}` } };
  return createEvent(db, { actor: admin, fields: { ...fields, ...extra, translations }, now: NOW });
};

describe("§823 the «Vii?» tick's saved value, through the editor's action", () => {
  it("(a) a turn-up event with «Vin!» ticked and the «Vii?» tick ticked is stored on", async () => {
    // Start from off, so the save is what turns it on.
    const created = await make(GROUP_RUN, { rsvpEnabled: true, rsvpAskEnabled: false });
    expect((await reload(created.id)).rsvpAskEnabled).toBe(false);
    const row = await save(created.id, GROUP_RUN, { rsvp: "on", ask: "on" });
    expect(row.rsvpEnabled).toBe(true);
    expect(row.rsvpAskEnabled).toBe(true);
  });

  it("(b) the same event with the «Vii?» tick unticked is stored off, «Vin!» still on", async () => {
    const created = await make(GROUP_RUN, { rsvpEnabled: true });
    expect((await reload(created.id)).rsvpAskEnabled).toBe(true);
    const row = await save(created.id, GROUP_RUN, { rsvp: "on", ask: "off" });
    expect(row.rsvpEnabled).toBe(true);
    expect(row.rsvpAskEnabled).toBe(false);
  });

  it("(c) «Vin!» unticked while the «Vii?» box, hidden under it, is still ticked leaves the «Vii?» value on — it is the club's answer, kept", async () => {
    const created = await make(GROUP_RUN, { rsvpEnabled: true });
    const row = await save(created.id, GROUP_RUN, { rsvp: "off", ask: "on" });
    expect(row.rsvpEnabled).toBe(false);
    expect(row.rsvpAskEnabled).toBe(true);
    // Ticking «Vin!» again finds the question's tick as it was left, because the box posted its state while hidden.
    const again = await save(created.id, GROUP_RUN, { rsvp: "on", ask: "on" });
    expect(again.rsvpEnabled).toBe(true);
    expect(again.rsvpAskEnabled).toBe(true);
  });

  it("(c') «Vin!» unticked with the «Vii?» box unticked keeps it off: the hidden box posts what it shows, never a default", async () => {
    const created = await make(GROUP_RUN, { rsvpEnabled: true, rsvpAskEnabled: false });
    const row = await save(created.id, GROUP_RUN, { rsvp: "off", ask: "off" });
    expect(row.rsvpEnabled).toBe(false);
    expect(row.rsvpAskEnabled).toBe(false);
  });

  it("(d) a form that carries neither block (another card's save, a reader who may not change the settings) changes neither value", async () => {
    for (const stored of [true, false]) {
      const created = await make(GROUP_RUN, { rsvpEnabled: true, rsvpAskEnabled: stored });
      const row = await save(created.id, GROUP_RUN, { rsvp: "absent", ask: "absent" });
      expect(row.rsvpEnabled, `«Vin!» with «Vii?» stored ${stored}`).toBe(true);
      expect(row.rsvpAskEnabled, `«Vii?» stored ${stored}`).toBe(stored);
    }
  });

  it("(d') a form with the «Vin!» block alone, and one with the «Vii?» block alone, each write only their own value", async () => {
    const created = await make(GROUP_RUN, { rsvpEnabled: true });
    const onlyAsk = await save(created.id, GROUP_RUN, { rsvp: "absent", ask: "off" });
    expect(onlyAsk.rsvpEnabled).toBe(true);
    expect(onlyAsk.rsvpAskEnabled).toBe(false);
    const onlyRsvp = await save(created.id, GROUP_RUN, { rsvp: "off", ask: "absent" });
    expect(onlyRsvp.rsvpEnabled).toBe(false);
    expect(onlyRsvp.rsvpAskEnabled).toBe(false);
  });

  it("(e) a race, whose turn-up block is hidden, keeps the value: the hidden box posts what it shows, and a form without it changes nothing", async () => {
    for (const stored of [true, false]) {
      const created = await make(RACE, { rsvpAskEnabled: stored });
      expect((await reload(created.id)).rsvpAskEnabled).toBe(stored);
      // The block is in the document (hidden), «Vin!» is off on a race, and the question's box posts its own state.
      const hiddenBlock = await save(created.id, RACE, { rsvp: "off", ask: stored ? "on" : "off" });
      expect(hiddenBlock.rsvpEnabled).toBe(false);
      expect(hiddenBlock.rsvpAskEnabled, `hidden block, stored ${stored}`).toBe(stored);
      // A form without the block at all.
      const withoutBlock = await save(created.id, RACE, { rsvp: "absent", ask: "absent" });
      expect(withoutBlock.rsvpAskEnabled, `no block, stored ${stored}`).toBe(stored);
    }
  });
});
