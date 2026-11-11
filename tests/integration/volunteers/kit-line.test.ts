import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace } from "../../helpers/results";

/**
 * The volunteers' line under the runners' in «Kituri de pregătit» (the owner, 2026-11-11): «Voluntari: 11 cu kit · 23 fără kit.»
 * «Cu kit» is the headline's own figure (the active volunteers ticked «Are kit»), «fără kit» the active ones not ticked, the
 * cancelled left out of both and named in the closing sentence; each number links to the «Voluntari» list only where that list,
 * read with the link's address, shows exactly that many people.
 */
let db: TestDatabase;
let close: () => Promise<void>;
let locale: "ro" | "en" = "ro";

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale, messages: (locale === "ro" ? ro : en) as unknown as Record<string, never>, namespace: namespace as never }),
  getLocale: async () => locale,
}));

const { countVolunteersForAdmin, countVolunteersWithKit, kitFilterOf, readVolunteerKitFigures, volunteerKitHrefs } = await import("@/modules/volunteers/admin-list");
const { default: KitCount } = await import("@/modules/registrations/ui/KitCount");
const { VOLUNTEER_STATES } = await import("@/modules/volunteers/domain/volunteer");
const isVolunteerState = (value: string): value is State => (VOLUNTEER_STATES as readonly string[]).includes(value);

type State = "REGISTERED" | "CONFIRMED" | "CANCELLED";
const LIST = "/ro/admin/volunteers";
const none = { kitShirt: false, bySize: {}, registrations: 0, invitations: 0 };

async function add(eventId: string, state: State, hasKit: boolean, times = 1) {
  for (let i = 0; i < times; i += 1) await db.insert(eventVolunteers).values({ eventId, name: "Vlad Test", source: "STAFF", state, hasKit });
}

/** What the «Voluntari» page does with an address: its event, state and kit filters, then the count the list shows. */
async function listShows(href: string): Promise<number> {
  const query = new URL(href, "http://list.invalid").searchParams;
  const state = query.get("state") ?? undefined;
  return countVolunteersForAdmin(db, {
    eventId: query.get("eventId") ?? undefined,
    state: state && isVolunteerState(state) ? state : undefined,
    kit: kitFilterOf(query.get("kit") ?? undefined),
  });
}

async function line(eventId: string, spoken: "ro" | "en" = "ro") {
  locale = spoken;
  const figures = await readVolunteerKitFigures(db, eventId);
  const html = renderToStaticMarkup(
    await KitCount({ kits: none, locale, volunteers: figures.withKit, volunteerLine: { withoutKit: figures.withoutKit, cancelled: figures.cancelled, ...volunteerKitHrefs(LIST, eventId, figures) } }),
  );
  const match = /data-testid="registrations-kits-volunteers"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  return { figures, html, text: match ? match[1].replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").replace(/ ([.,])/g, "$1").trim() : null };
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  locale = "ro";
  await resetTables(db);
});

describe("«Voluntari: N cu kit · M fără kit»", () => {
  it("counts every state with and without the tick: «cu kit» is the headline's figure, the cancelled are left out of both", async () => {
    const race = await createRace(db, {});
    const other = await createRace(db, {});
    await add(race.id, "CONFIRMED", true, 2);
    await add(race.id, "REGISTERED", true, 1);
    await add(race.id, "CONFIRMED", false, 3);
    await add(race.id, "REGISTERED", false, 4);
    await add(race.id, "CANCELLED", true, 5);
    await add(race.id, "CANCELLED", false, 6);
    await add(other.id, "CONFIRMED", true, 9);

    const { figures, text } = await line(race.id);
    expect(figures).toMatchObject({ withKit: 3, withoutKit: 7, cancelled: 11 });
    // One rule, one read: the headline's figure is the line's.
    expect(await countVolunteersWithKit(db, race.id)).toBe(figures.withKit);
    expect(text).toBe("Voluntari: 3 cu kit · 7 fără kit. Cei anulați nu intră.");
  });

  it("says 0 with a kit when nobody was ticked, and draws nothing for an event with no volunteer (or only cancelled ones)", async () => {
    const race = await createRace(db, {});
    expect((await line(race.id)).text).toBeNull();
    await add(race.id, "REGISTERED", false, 12);
    expect((await line(race.id)).text).toBe("Voluntari: 0 cu kit · 12 fără kit.");
    const quiet = await createRace(db, {});
    await add(quiet.id, "CANCELLED", true, 2);
    expect((await line(quiet.id)).text).toBeNull();
  });

  it("draws the line in English, and nothing about the cancelled when there is none", async () => {
    const race = await createRace(db, {});
    await add(race.id, "CONFIRMED", true, 1);
    await add(race.id, "REGISTERED", false, 2);
    expect((await line(race.id, "en")).text).toBe("Volunteers: 1 with a kit · 2 without a kit.");
    await add(race.id, "CANCELLED", false, 1);
    expect((await line(race.id, "en")).text).toBe("Volunteers: 1 with a kit · 2 without a kit. Cancelled ones are not counted.");
    expect((await line(race.id, "ro")).text).toBe("Voluntari: 1 cu kit · 2 fără kit. Cei anulați nu intră.");
  });

  it("links a number to the list for this event with the kit filter, the list showing exactly that many people", async () => {
    const race = await createRace(db, {});
    await add(race.id, "CONFIRMED", true, 2);
    await add(race.id, "REGISTERED", false, 3);
    await add(race.id, "CONFIRMED", false, 1);
    const { figures, html } = await line(race.id);
    const hrefs = volunteerKitHrefs(LIST, race.id, figures);
    expect(hrefs.yesHref).toBe(`${LIST}?eventId=${race.id}&kit=yes`);
    expect(hrefs.noHref).toBe(`${LIST}?eventId=${race.id}&kit=no`);
    expect(html).toContain(`href="${hrefs.yesHref!.replace(/&/g, "&amp;")}"`);
    expect(await listShows(hrefs.yesHref!)).toBe(figures.withKit);
    expect(await listShows(hrefs.noHref!)).toBe(figures.withoutKit);
  });

  it("adds the state filter when the cancelled share the tick and one active state is left, and draws no link when no filter can match", async () => {
    // A cancelled ticked volunteer, the active ticked ones all «Confirmat»: state=CONFIRMED matches «cu kit».
    const race = await createRace(db, {});
    await add(race.id, "CONFIRMED", true, 2);
    await add(race.id, "CANCELLED", true, 1);
    await add(race.id, "REGISTERED", false, 4);
    let { figures } = await line(race.id);
    let hrefs = volunteerKitHrefs(LIST, race.id, figures);
    expect(hrefs.yesHref).toBe(`${LIST}?eventId=${race.id}&kit=yes&state=CONFIRMED`);
    expect(await listShows(hrefs.yesHref!)).toBe(figures.withKit);
    expect(await listShows(hrefs.noHref!)).toBe(figures.withoutKit);

    // Both active states ticked and a cancelled one too: the list has one state filter, so the number has no link.
    await add(race.id, "REGISTERED", true, 1);
    ({ figures } = await line(race.id));
    hrefs = volunteerKitHrefs(LIST, race.id, figures);
    expect(hrefs.yesHref).toBeUndefined();
    expect(hrefs.noHref).toBeDefined();
    const { html } = await line(race.id);
    expect(html).not.toContain("registrations-kits-volunteers-yes");
    expect(html).toContain("registrations-kits-volunteers-no");
  });

  it("counts the three forms of a number the same in both languages (1, 2, 20)", async () => {
    const race = await createRace(db, {});
    await add(race.id, "CONFIRMED", true, 20);
    await add(race.id, "REGISTERED", false, 1);
    expect((await line(race.id)).text).toBe("Voluntari: 20 cu kit · 1 fără kit.");
    expect((await line(race.id, "en")).text).toBe("Volunteers: 20 with a kit · 1 without a kit.");
  });
});
