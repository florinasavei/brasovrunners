import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations, type PublicListClub } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { listPublicStartList, listPublicStartListOthers } from "@/modules/registrations/repository";
import { resolveDisplayName } from "@/modules/registrations/names";
import type { PublicEvent } from "@/modules/events/repository";
import { CLUB_NAME } from "@/theme/brand";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §753 and §756 (amending §32, §143 and §396) — «Clubul pe lista publică»: the public list's «Club» column, by
 * the event's mode. The default shows the club's own name for every registration whose typed club names the
 * club — whoever typed it: since §756 an account on «Echipa» is no condition, because the club's runners have
 * none — and every other cell is blank; the column is not drawn when no row holds a value. «Cum l-au scris»
 * is the list as it was; «Nu arăta clubul» draws no column. Rendered end to end, as
 * `start-list-render.test.ts` does (BR-REQ-039-01).
 */
let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const messages = (namespace === "Event" ? ro.Event : (ro as Record<string, object>)[namespace]) as Record<string, string>;
    return createTranslator({ locale: "ro", messages, namespace: undefined });
  },
  getLocale: async () => "ro",
}));

const { default: StartListNow } = await import("@/modules/events/ui/StartList");
const StartList = (props: Parameters<typeof StartListNow>[0]) => atTheClock(NOW, () => StartListNow(props));

const NOW = new Date("2026-09-24T10:00:00.000Z");

/** The silly things people type, and the real ones: who typed what, and whether they are on the allowlist. */
const PEOPLE = [
  { name: "Ioana Membra", email: "ioana.membra@example.org", club: "BVR", member: true },
  { name: "Mihai Membru", email: "mihai.membru@example.org", club: "alergam pe tavan", member: true },
  { name: "Tudor Tacut", email: "tudor.tacut@example.org", club: null, member: true },
  { name: "Vlad Vizitator", email: "vlad.vizitator@example.org", club: "Brașov Runners", member: false },
  { name: "Radu Rapid", email: "radu.rapid@example.org", club: "CS Rapid", member: false },
] as const;

async function createEvent(mode?: PublicListClub): Promise<{ publicEvent: PublicEvent; id: string }> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      participantListVisibility: "NAMES",
      ...(mode ? { publicListClub: mode } : {}),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `cros-club-${event.id}`, title: "Cros" },
    { eventId: event.id, locale: "en", slug: `cross-club-${event.id}`, title: "Cross" },
  ]);
  // Only what the list reads: the rest of `PublicEvent` is asserted nowhere here.
  const publicEvent = { id: event.id, participantListVisibility: "NAMES", publicListClub: event.publicListClub, startsAt: event.startsAt, endsAt: event.endsAt } as unknown as PublicEvent;
  return { publicEvent, id: event.id };
}

async function register(
  eventId: string,
  input: { name: string; email: string; club: string | null; status?: "CONFIRMED" | "PENDING_DECLARATION" | "WAITLISTED"; at: number },
) {
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: input.email,
      normalizedEmail: input.email,
      canonicalEmail: input.email,
      canonicalizationVersion: 1,
      defaultName: input.name,
      preferredLocale: "ro",
    })
    .returning();
  const status = input.status ?? "CONFIRMED";
  const at = new Date(NOW.getTime() + input.at * 1000);
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status,
    kind: "REAL",
    locale: "ro",
    registeredName: input.name,
    displayName: resolveDisplayName({ legalName: input.name }),
    clubName: input.club,
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    listOptOut: false,
    confirmedAt: status === "CONFIRMED" ? at : null,
    emailConfirmedAt: at,
    waitlistedAt: status === "WAITLISTED" ? at : null,
  });
}

/** Everyone in `PEOPLE` who is wanted, confirmed in order, with the members among them on the allowlist. */
async function seed(eventId: string, who: readonly string[] = PEOPLE.map((person) => person.name)) {
  let at = 1;
  for (const person of PEOPLE) {
    if (!who.includes(person.name)) continue;
    await register(eventId, { ...person, at });
    at += 1;
    if (person.member) {
      await db.insert(staffUsers).values({ email: person.email, displayName: person.name, role: "MEMBER" }).onConflictDoNothing();
    }
  }
}

const clubCells = (html: string) => [...html.matchAll(/<td[^>]*data-col="club"[^>]*>([^<]*)</g)].map((match) => match[1]);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

describe("§753 «Clubul pe lista publică» — the migration", () => {
  it("is expand only, and an event written without the column reads «Doar» the club's own members: less than before", async () => {
    const sql = readFileSync(join(process.cwd(), "src/db/migrations/0145_public_list_club.sql"), "utf8");
    expect(sql).toContain(`CREATE TYPE "public"."public_list_club" AS ENUM('members_only', 'as_typed', 'hidden')`);
    expect(sql).toContain(`ALTER TABLE "events" ADD COLUMN "public_list_club" "public_list_club" DEFAULT 'members_only' NOT NULL;`);
    expect(sql).not.toMatch(/DROP|RENAME/i);
    const [row] = await db.insert(events).values({ type: "RACE", startsAt: NOW, registrationMode: "INTERNAL" }).returning();
    expect(row.publicListClub).toBe("members_only");
    expect((await db.select().from(events).where(eq(events.id, row.id)))[0].publicListClub).toBe("members_only");
  });
});

describe("§756 the owner's bug: «Doar» the club, and nobody on «Echipa»", () => {
  it("shows the club's name for every runner who typed it, though none of them has an account", async () => {
    const { publicEvent, id } = await createEvent("members_only");
    const typed = ["BVR", "Brasov Runners", "Clubul Brașov Runners"];
    for (const [index, club] of typed.entries()) {
      await register(id, { name: `Alergator ${index}`, email: `alergator.${index}@example.org`, club, at: index + 1 });
    }
    expect(await db.select().from(staffUsers)).toEqual([]);
    expect((await listPublicStartList(db, id)).map((row) => row.clubName)).toEqual([CLUB_NAME, CLUB_NAME, CLUB_NAME]);
    const html = renderToStaticMarkup(await StartList({ event: publicEvent }));
    expect(html).toContain(">Club</th>");
    expect(clubCells(html)).toEqual([CLUB_NAME, CLUB_NAME, CLUB_NAME]);
  });
});

describe("§753 «Clubul pe lista publică» — the query", () => {
  it("under the default, returns the club's own name for whoever typed it, and nothing for any other text", async () => {
    const { id } = await createEvent();
    await seed(id);
    const rows = await listPublicStartList(db, id);
    expect(rows.map((row) => [row.displayName, row.clubName])).toEqual([
      ["Ioana Membra", CLUB_NAME], // a member who typed «BVR»: the club's name, not the nickname
      ["Mihai Membru", null], // a member who typed something else: membership shows nothing by itself
      ["Tudor Tacut", null], // a member who typed nothing: no membership is disclosed
      ["Vlad Vizitator", CLUB_NAME], // no account, typed the club's name: what they wrote, in the club's spelling
      ["Radu Rapid", null], // another club
    ]);
    // The keys are the same as ever: nothing about membership leaves the query.
    expect(Object.keys(rows[0])).toEqual(["displayName", "clubName"]);
  });

  it("is the same whether or not anyone has an account on «Echipa»", async () => {
    const { id } = await createEvent();
    await seed(id);
    const before = (await listPublicStartList(db, id)).map((row) => row.clubName);
    await db.delete(staffUsers);
    expect((await listPublicStartList(db, id)).map((row) => row.clubName)).toEqual(before);
    expect(before).toEqual([CLUB_NAME, null, null, CLUB_NAME, null]);
  });

  it("«Cum l-au scris» returns the typed text of everyone, and «Nu arăta clubul» of nobody", async () => {
    const { id } = await createEvent();
    await seed(id);
    expect((await listPublicStartList(db, id, undefined, { club: "as_typed" })).map((row) => row.clubName)).toEqual([
      "BVR",
      "alergam pe tavan",
      null,
      "Brașov Runners",
      "CS Rapid",
    ]);
    expect((await listPublicStartList(db, id, undefined, { club: "hidden" })).map((row) => row.clubName)).toEqual([null, null, null, null, null]);
  });

  it("applies to the pending and the waiting list rows as well", async () => {
    const { id } = await createEvent();
    await seed(id, []);
    await register(id, { ...PEOPLE[0], status: "PENDING_DECLARATION", at: 1 });
    await register(id, { ...PEOPLE[1], status: "WAITLISTED", at: 2 });
    await register(id, { ...PEOPLE[3], status: "WAITLISTED", at: 3 });
    await db.insert(staffUsers).values([PEOPLE[0], PEOPLE[1]].map((person) => ({ email: person.email, displayName: person.name, role: "MEMBER" as const })));
    const others = (club?: PublicListClub) => listPublicStartListOthers(db, id, 1, true, undefined, club ? { club } : {});
    expect((await others()).map((row) => [row.displayName, row.group, row.clubName])).toEqual([
      ["Ioana Membra", "PENDING", CLUB_NAME],
      ["Mihai Membru", "WAITLISTED", null],
      ["Vlad Vizitator", "WAITLISTED", CLUB_NAME],
    ]);
    expect((await others("as_typed")).map((row) => row.clubName)).toEqual(["BVR", "alergam pe tavan", "Brașov Runners"]);
    expect((await others("hidden")).map((row) => row.clubName)).toEqual([null, null, null]);
  });
});

describe("§753 «Clubul pe lista publică» — the rendered list", () => {
  it("«Doar» the club: the cells of those who typed the club hold its name, the others are blank, and the header is there", async () => {
    const { publicEvent, id } = await createEvent("members_only");
    await seed(id);
    const html = renderToStaticMarkup(await StartList({ event: publicEvent }));
    expect(html).toContain(">Club</th>");
    expect(clubCells(html)).toEqual([CLUB_NAME, "", "", CLUB_NAME, ""]);
    // The silly text, another club and the nickname as typed never reach the page.
    expect(html).not.toContain("alergam pe tavan");
    expect(html).not.toContain("CS Rapid");
    expect(html).not.toContain("BVR");
    expect(html).toContain("Vlad Vizitator");
  });

  it("a page of nothing but other clubs, nonsense and empty cells: the column is not drawn", async () => {
    const { publicEvent, id } = await createEvent("members_only");
    await seed(id, ["Mihai Membru", "Tudor Tacut", "Radu Rapid"]);
    const html = renderToStaticMarkup(await StartList({ event: publicEvent }));
    expect(html).toContain("Mihai Membru");
    expect(html).not.toContain(">Club</th>");
    expect(html).not.toContain('data-col="club"');
  });

  it("an event with no setting on its row reads as «Doar» the club", async () => {
    const { publicEvent, id } = await createEvent();
    await seed(id);
    const html = renderToStaticMarkup(await StartList({ event: { ...publicEvent, publicListClub: undefined } as unknown as PublicEvent }));
    expect(clubCells(html)).toEqual([CLUB_NAME, "", "", CLUB_NAME, ""]);
  });

  it("«Cum l-au scris» is the list as it was: every typed club, and the column even when it is empty", async () => {
    const { publicEvent, id } = await createEvent("as_typed");
    await seed(id);
    const html = renderToStaticMarkup(await StartList({ event: publicEvent }));
    expect(clubCells(html)).toEqual(["BVR", "alergam pe tavan", "", "Brașov Runners", "CS Rapid"]);
  });

  it("«Cum l-au scris» keeps the column even when nobody typed a club, as the list always did", async () => {
    const { publicEvent, id } = await createEvent("as_typed");
    await seed(id, ["Tudor Tacut"]);
    const html = renderToStaticMarkup(await StartList({ event: publicEvent }));
    expect(html).toContain(">Club</th>");
    expect(clubCells(html)).toEqual([""]);
  });

  it("«Nu arăta clubul» draws no column and no club", async () => {
    const { publicEvent, id } = await createEvent("hidden");
    await seed(id);
    const html = renderToStaticMarkup(await StartList({ event: publicEvent }));
    expect(html).toContain("Ioana Membra");
    expect(html).not.toContain(">Club</th>");
    expect(html).not.toContain('data-col="club"');
    expect(html).not.toContain("BVR");
    expect(html).not.toContain("CS Rapid");
    expect(html).not.toContain(CLUB_NAME);
  });
});
