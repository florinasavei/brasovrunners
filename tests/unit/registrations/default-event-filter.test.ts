import { describe, expect, it } from "vitest";
import { ALL_EVENTS, AUTOMATIC, defaultEventFilter } from "@/modules/registrations/domain/default-event-filter";

/**
 * §178 — which event the registrations list is about when nobody has said. The owner: "aș vrea
 * să filtrez by default după evenimentul principal (pt că ar trebui să existe doar unul la un
 * moment dat)". And §312 — what a name typed into the search does to that default.
 */
const EVENTS = [
  { id: "a", featured: false },
  { id: "b", featured: true },
  { id: "c", featured: false },
];

describe("BR-REQ-037-05 the registrations list's default event", () => {
  it("takes the featured event when nothing was asked for, and keeps the choice automatic", () => {
    // `AUTOMATIC` is what the select shows and the links carry, so a sort or a page does not
    // turn the default into a choice nobody made (§312).
    expect(defaultEventFilter(undefined, EVENTS)).toEqual({ eventId: "b", selected: AUTOMATIC, searchesEverywhere: false });
  });

  it("treats the select's empty value as nothing chosen", () => {
    expect(defaultEventFilter(AUTOMATIC, EVENTS)).toEqual({ eventId: "b", selected: AUTOMATIC, searchesEverywhere: false });
  });

  it("honours an explicit choice", () => {
    expect(defaultEventFilter("c", EVENTS)).toEqual({ eventId: "c", selected: "c", searchesEverywhere: false });
  });

  /** Asking for everything has to remain possible, or the default becomes a wall. */
  it("shows everything when the organizer asked for everything", () => {
    expect(defaultEventFilter(ALL_EVENTS, EVENTS)).toEqual({ eventId: undefined, selected: ALL_EVENTS, searchesEverywhere: false });
  });

  it("falls back to everything when the club has no featured event", () => {
    const none = EVENTS.map((event) => ({ ...event, featured: false }));
    expect(defaultEventFilter(undefined, none)).toEqual({ eventId: undefined, selected: ALL_EVENTS, searchesEverywhere: false });
    expect(defaultEventFilter(undefined, [])).toEqual({ eventId: undefined, selected: ALL_EVENTS, searchesEverywhere: false });
  });

  /**
   * A bookmarked link to an event that has since been deleted shows the default rather than an
   * empty page filtered by something the select cannot display.
   */
  it("ignores an id that is not in the list any more", () => {
    expect(defaultEventFilter("gone", EVENTS)).toEqual({ eventId: "b", selected: AUTOMATIC, searchesEverywhere: false });
  });
});

/**
 * §312 — a name search, with no event chosen, looks in every event.
 *
 * The report: a staff member searched the list for somebody by name and found nothing, because
 * the list had opened on the featured event and the search kept that filter silently. Somebody
 * typing a name is looking for a person; the featured event is a default for browsing.
 */
describe("BR-REQ-037-05 a name search with no event chosen (§312)", () => {
  it("searches every event, and says it widened", () => {
    expect(defaultEventFilter(undefined, EVENTS, "amalia")).toEqual({
      eventId: undefined,
      selected: AUTOMATIC,
      searchesEverywhere: true,
    });
    // The select's empty value is "nothing chosen" too — the form submits it until an event
    // is picked.
    expect(defaultEventFilter(AUTOMATIC, EVENTS, "amalia").searchesEverywhere).toBe(true);
  });

  it("honours an explicit event as it is, search or not", () => {
    expect(defaultEventFilter("c", EVENTS, "amalia")).toEqual({ eventId: "c", selected: "c", searchesEverywhere: false });
    // The featured event chosen explicitly is a choice, not the default.
    expect(defaultEventFilter("b", EVENTS, "amalia")).toEqual({ eventId: "b", selected: "b", searchesEverywhere: false });
  });

  it("honours `all` as it is, and does not call that widening", () => {
    expect(defaultEventFilter(ALL_EVENTS, EVENTS, "amalia")).toEqual({
      eventId: undefined,
      selected: ALL_EVENTS,
      searchesEverywhere: false,
    });
  });

  it("does not widen on blank search text", () => {
    expect(defaultEventFilter(undefined, EVENTS, "   ")).toEqual({ eventId: "b", selected: AUTOMATIC, searchesEverywhere: false });
    expect(defaultEventFilter(undefined, EVENTS, "")).toEqual({ eventId: "b", selected: AUTOMATIC, searchesEverywhere: false });
  });

  it("has nothing to widen when the club features no event", () => {
    const none = EVENTS.map((event) => ({ ...event, featured: false }));
    expect(defaultEventFilter(undefined, none, "amalia")).toEqual({
      eventId: undefined,
      selected: ALL_EVENTS,
      searchesEverywhere: false,
    });
  });

  it("widens for a stale id as it would for none", () => {
    expect(defaultEventFilter("gone", EVENTS, "amalia")).toEqual({
      eventId: undefined,
      selected: AUTOMATIC,
      searchesEverywhere: true,
    });
  });
});
