import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { resolveDisplayName } from "@/modules/registrations/names";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * §NNN — «Lista ascunsă»'s two ticks over the public «Cine vine» (amending §632 and §643), on the
 * rendered list, as `start-list-render.test.ts` renders it:
 *
 * - «Numără și lista ascunsă» off (the default): the title and the line count the places — a ticked
 *   runner on the hidden list is a row of the table, out of the numbers, with the note under it;
 * - on: the numbers count everybody on the hidden list with a place, ticked or not, and the note goes;
 * - «Arată public numărătoarea» off: the title has no number, no counted line and no position column —
 *   only the names;
 * - the rows never change with either tick (§32: the ticks change numbers, never which names appear),
 *   an event whose switch is off never counts the hidden list, and «Arată public numărătoarea» acts
 *   on every event, the hidden list on or off.
 */
let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const messages = (ro as Record<string, object>)[namespace] as Record<string, string>;
    return createTranslator({ locale: "ro", messages, namespace: undefined });
  },
  getLocale: async () => "ro",
}));

const { default: StartList } = await import("@/modules/events/ui/StartList");

const NOW = new Date("2026-09-24T10:00:00.000Z");

type Ticks = { hiddenListEnabled: boolean; participantCountPublic: boolean; hiddenListCounted: boolean };

async function createEvent(): Promise<string> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      participantListVisibility: "NAMES",
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `cros-${event.id.slice(0, 8)}`, title: "Cros" },
    { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "Cross" },
  ]);
  return event.id;
}

/** The fields `StartList` reads, the ticks as given: a cast stands in for the full public query. */
const asPublic = (id: string, ticks: Ticks) =>
  ({ id, participantListVisibility: "NAMES", startsAt: new Date("2026-11-21T07:00:00.000Z"), endsAt: null, ...ticks }) as unknown as PublicEvent;

let counter = 0;
async function register(eventId: string, name: string, input: { listOptOut?: boolean; hidden?: boolean; status?: "CONFIRMED" | "PENDING_DECLARATION" } = {}) {
  counter += 1;
  const email = `runner${counter}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  const status = input.status ?? "CONFIRMED";
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status,
    kind: "REAL",
    locale: "ro",
    registeredName: name,
    displayName: resolveDisplayName({ legalName: name }),
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    listOptOut: input.listOptOut ?? false,
    outsideCapacity: input.hidden ?? false,
    confirmedAt: status === "CONFIRMED" ? new Date(NOW.getTime() + counter * 1000) : null,
    emailConfirmedAt: NOW,
  });
}

/** Two counted confirmed (one named), a named and an unnamed one on the hidden list, and a hidden-list hold. */
async function seeded(): Promise<string> {
  const id = await createEvent();
  await register(id, "Ana Popescu");
  await register(id, "Secret Runner", { listOptOut: true });
  await register(id, "Ioana Pacemaker", { hidden: true });
  await register(id, "Dan Invitat", { hidden: true, listOptOut: true });
  await register(id, "Elena Organizator", { hidden: true, status: "PENDING_DECLARATION" });
  return id;
}

const render = async (event: PublicEvent) => renderToStaticMarkup(await StartList({ event }));
const rows = (html: string) => (html.match(/data-testid="start-list-(named|anonymous)"/g) ?? []).length;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

describe("§NNN «Cine vine» and the hidden list's two ticks", () => {
  it("by default counts the places: the ticked hidden-list runner is a row, out of the numbers, with the note", async () => {
    const id = await seeded();
    const html = await render(asPublic(id, { hiddenListEnabled: true, participantCountPublic: true, hiddenListCounted: false }));
    expect(html).toContain("Cine vine (2)");
    expect(html).toContain("2 participanți confirmați");
    expect(html).toContain("1 cu numele afișat");
    expect(html).toContain("Ioana Pacemaker");
    expect(html).not.toContain("Dan Invitat");
    expect(rows(html)).toBe(3);
    expect(html).toContain(ro.Event.startList.outsideNote);
  });

  it("«Numără și lista ascunsă» counts everybody on the hidden list with a place, ticked or not — the rows unchanged", async () => {
    const id = await seeded();
    const html = await render(asPublic(id, { hiddenListEnabled: true, participantCountPublic: true, hiddenListCounted: true }));
    // Confirmed: Ana, the anonymous one, Ioana and Dan. The uncapped event has no «în curs» (§32).
    expect(html).toContain("Cine vine (4)");
    expect(html).toContain("4 participanți confirmați");
    expect(html).toContain("2 cu numele afișat");
    expect(html).toContain("Ioana Pacemaker");
    expect(html).not.toContain("Dan Invitat");
    expect(rows(html)).toBe(3);
    expect(html).not.toContain(ro.Event.startList.outsideNote);
  });

  it("«Arată public numărătoarea» off: only the names — no number in the title, no counted line, no position", async () => {
    const id = await seeded();
    const html = await render(asPublic(id, { hiddenListEnabled: true, participantCountPublic: false, hiddenListCounted: true }));
    expect(html).toContain(`>${ro.Event.startList.title}</`);
    expect(html).not.toMatch(/Cine vine \(\d+\)/);
    expect(html).not.toContain('data-testid="start-list-summary"');
    expect(html).not.toContain("participanți confirmați");
    expect(html).not.toContain(`>${ro.Event.startList.columnPosition}<`);
    expect(html).not.toContain(ro.Event.startList.outsideNote);
    // The note without its sentence about the title's number (its own text up to the escaped «&»).
    expect(html).toContain(ro.Event.startList.noteNamesOnly.split("&")[0]);
    expect(html).not.toContain(ro.Event.startList.note.split(";")[0]);
    // The same rows as with the numbers on.
    expect(html).toContain("Ana Popescu");
    expect(html).toContain("Ioana Pacemaker");
    expect(rows(html)).toBe(3);
  });

  it("an event whose switch is off never counts the hidden list, whatever «Numără și lista ascunsă» says", async () => {
    const id = await seeded();
    const html = await render(asPublic(id, { hiddenListEnabled: false, participantCountPublic: true, hiddenListCounted: true }));
    expect(html).toContain("Cine vine (2)");
    expect(html).toContain("2 participanți confirmați");
    expect(html).toContain(`>${ro.Event.startList.columnPosition}<`);
    expect(rows(html)).toBe(3);
  });

  it("«Arată public numărătoarea» acts on every event: the hidden list off and the tick off leave only the names", async () => {
    const id = await seeded();
    const html = await render(asPublic(id, { hiddenListEnabled: false, participantCountPublic: false, hiddenListCounted: false }));
    expect(html).toContain(`>${ro.Event.startList.title}</`);
    expect(html).not.toMatch(/Cine vine \(\d+\)/);
    expect(html).not.toContain('data-testid="start-list-summary"');
    expect(html).not.toContain("participanți confirmați");
    expect(html).not.toContain(`>${ro.Event.startList.columnPosition}<`);
    expect(html).toContain("Ana Popescu");
    expect(html).toContain("Ioana Pacemaker");
    expect(rows(html)).toBe(3);
  });
});
