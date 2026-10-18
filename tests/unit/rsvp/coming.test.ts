import { describe, expect, it } from "vitest";
import { type ComingEvent, type ComingReads, couldBeOffered, readComing } from "@/modules/rsvp/coming";

/**
 * §NNN — which events say «Vin!» outside their own page: the page's gate (`rsvpOffered`, the one rule) over a list, with
 * the reads counted so that a page with nothing to say asks nothing. Pure: the reads are fakes.
 */
const NOW = new Date("2026-10-20T10:00:00.000Z");
const AHEAD = new Date("2026-10-22T15:00:00.000Z");

const turnUp = (id: string, over: Partial<ComingEvent> = {}): ComingEvent => ({
  id,
  publishedAt: new Date("2026-10-01T00:00:00.000Z"),
  eventStatus: "SCHEDULED",
  registrationMode: "NONE",
  startsAt: AHEAD,
  rsvpEnabled: true,
  ...over,
});

function reads(options: { described?: boolean; counts?: Record<string, number> } = {}) {
  const calls = { described: 0, counts: [] as (readonly string[])[] };
  const fake: ComingReads = {
    described: async () => {
      calls.described += 1;
      return options.described ?? true;
    },
    counts: async (ids) => {
      calls.counts.push(ids);
      return Object.fromEntries(ids.map((id) => [id, options.counts?.[id] ?? 0]));
    },
  };
  return { fake, calls };
}

describe("§NNN which events say «Vin!»", () => {
  it("maps an offered event to how many confirmed they come — none included", async () => {
    const { fake } = reads({ counts: { a: 3 } });
    const coming = await readComing([turnUp("a"), turnUp("b")], NOW, fake);
    expect([...coming]).toEqual([
      ["a", 3],
      ["b", 0],
    ]);
  });

  it.each([
    ["the club did not tick it", { rsvpEnabled: false }],
    ["the ticks were never saved", { rsvpEnabled: null }],
    ["it takes registrations on the site", { registrationMode: "INTERNAL" as const }],
    ["it takes them at another organizer", { registrationMode: "EXTERNAL" as const }],
    ["it is cancelled", { eventStatus: "CANCELLED" as const }],
    ["it is over", { eventStatus: "COMPLETED" as const }],
    ["its translation is a draft", { publishedAt: null }],
    ["it has started", { startsAt: new Date(NOW.getTime() - 1000) }],
    ["it starts this very instant", { startsAt: NOW }],
    ["its date is to be announced", { startsAt: null }],
    ["its hour is to be announced", { timeToBeAnnounced: true }],
    ["it is for the members alone (the page draws no box there)", { membersOnly: true }],
  ])("is not offered when %s", async (_why, over) => {
    const { fake } = reads();
    expect([...(await readComing([turnUp("a", over as Partial<ComingEvent>)], NOW, fake))]).toEqual([]);
  });

  it("is not offered while the privacy notice in force does not describe «Vin!», and then reads no count", async () => {
    const { fake, calls } = reads({ described: false });
    expect([...(await readComing([turnUp("a")], NOW, fake))]).toEqual([]);
    expect(calls.described).toBe(1);
    expect(calls.counts).toEqual([]);
  });

  it("reads nothing at all for a page none of whose events could be offered", async () => {
    const { fake, calls } = reads();
    await readComing([], NOW, fake);
    await readComing([turnUp("a", { rsvpEnabled: false }), turnUp("b", { registrationMode: "INTERNAL" }), turnUp("c", { startsAt: new Date(NOW.getTime() - 1) })], NOW, fake);
    expect(calls.described).toBe(0);
    expect(calls.counts).toEqual([]);
  });

  it("reads the notice once and the counts once, for the offered events only, whatever their number", async () => {
    const { fake, calls } = reads({ counts: { a: 1, c: 2 } });
    const coming = await readComing([turnUp("a"), turnUp("b", { rsvpEnabled: false }), turnUp("c"), turnUp("d", { eventStatus: "CANCELLED" })], NOW, fake);
    expect(calls.described).toBe(1);
    expect(calls.counts).toEqual([["a", "c"]]);
    expect([...coming]).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
  });

  it("asks the cheap columns first: couldBeOffered is the gate without the notice", () => {
    expect(couldBeOffered(turnUp("a"), NOW)).toBe(true);
    expect(couldBeOffered(turnUp("a", { rsvpEnabled: false }), NOW)).toBe(false);
    expect(couldBeOffered(turnUp("a", { membersOnly: true }), NOW)).toBe(false);
    expect(couldBeOffered(turnUp("a", { startsAt: NOW }), NOW)).toBe(false);
  });
});
