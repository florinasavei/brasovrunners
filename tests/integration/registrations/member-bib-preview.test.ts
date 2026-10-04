import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §664, BR-REQ-038-01 — the preview route draws a member's bib where the sheet would print one:
 * a row that asked AND whose canonical address is a member account's; a declared-only row draws the
 * ordinary bib. `member=1` on the sample draws the members' design, the switch on or not yet, with
 * the platform's label in the picture's language.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, drawn: [] as Array<Record<string, unknown>> }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ namespace }: { namespace: string }) =>
    createTranslator({ locale: "ro", messages: (ro as unknown as Record<string, never>)[namespace] }),
}));
// What the renderer was asked to draw: the picture itself is `member-bib.test.ts`'s.
vi.mock("@/modules/registrations/bib-image", () => ({
  renderBibImage: async (input: Record<string, unknown>) => {
    state.drawn.push(input);
    return new Response("png", { headers: { "Content-Type": "image/png" } });
  },
}));

const { GET } = await import("@/app/api/admin/events/[id]/bibs/preview/route");

describe("§664 the preview draws the members' bib for wanted AND verified", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let eventId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    state.drawn = [];
    const [volunteer]: StaffUser[] = await db.insert(staffUsers).values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" }).returning();
    state.actor = volunteer;
    // A member account (§662): its address verifies.
    await db.insert(staffUsers).values({ email: "membru@example.test", displayName: "Membru", role: "MEMBER" });
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date("2026-10-11T07:00:00Z"),
        registrationMode: "INTERNAL",
        locationName: "Start",
        bibDesign: { member: { enabled: true, bandColour: "#6a1b9a" } },
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
      { eventId: event.id, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
    ]);
    eventId = event.id;
  });

  async function confirmed(email: string, bibNumber: number) {
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: email })
      .returning();
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status: "CONFIRMED",
        kind: "REAL",
        locale: "ro",
        registeredName: email,
        displayName: email,
        clubMemberDeclared: true,
        memberBibWanted: true,
        bibNumber,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: new Date("2026-09-01T00:00:00Z"),
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        submittedAt: new Date("2026-09-01T00:00:00Z"),
        confirmedAt: new Date("2026-09-02T10:00:00Z"),
      })
      .returning();
    return row;
  }

  const ask = (query: string) => GET(new Request(`http://localhost/api/admin/events/${eventId}/bibs/preview?${query}`), { params: Promise.resolve({ id: eventId }) });

  it("draws a verified member's bib with the members' design and the platform's label", async () => {
    const row = await confirmed("membru@example.test", 7);
    expect((await ask(`registration=${row.id}&locale=ro`)).status).toBe(200);
    expect(state.drawn[0]).toMatchObject({ member: true, memberLabelDefault: "Membru Brașov Runners" });
  });

  it("draws the ordinary bib for a member who only declared", async () => {
    const row = await confirmed("declarat@example.test", 8);
    expect((await ask(`registration=${row.id}&locale=ro`)).status).toBe(200);
    expect(state.drawn[0]).toMatchObject({ member: false });
  });

  it("draws the members' sample with `member=1`, the switch read from the address or not", async () => {
    expect((await ask("sample=1&locale=ro&member=1&memberEnabled=0&memberLabel=BVR")).status).toBe(200);
    const drawn = state.drawn[0] as { member: boolean; design: { member: { enabled: boolean; label: string } } };
    expect(drawn.member).toBe(true);
    expect(drawn.design.member).toMatchObject({ enabled: true, label: "BVR" });
  });
});
