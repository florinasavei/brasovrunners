import { describe, expect, it } from "vitest";
import { ALL_EVENTS, defaultEventFilter } from "@/modules/registrations/domain/default-event-filter";

/**
 * §178 — which event the registrations list is about when nobody has said. The owner: "aș vrea
 * să filtrez by default după evenimentul principal (pt că ar trebui să existe doar unul la un
 * moment dat)".
 */
const EVENTS = [
  { id: "a", featured: false },
  { id: "b", featured: true },
  { id: "c", featured: false },
];

describe("BR-REQ-037-05 the registrations list's default event", () => {
  it("takes the featured event when nothing was asked for", () => {
    expect(defaultEventFilter(undefined, EVENTS)).toEqual({ eventId: "b", selected: "b" });
  });

  it("honours an explicit choice", () => {
    expect(defaultEventFilter("c", EVENTS)).toEqual({ eventId: "c", selected: "c" });
  });

  /** Asking for everything has to remain possible, or the default becomes a wall. */
  it("shows everything when the organizer asked for everything", () => {
    expect(defaultEventFilter(ALL_EVENTS, EVENTS)).toEqual({ eventId: undefined, selected: ALL_EVENTS });
  });

  it("falls back to everything when the club has no featured event", () => {
    const none = EVENTS.map((event) => ({ ...event, featured: false }));
    expect(defaultEventFilter(undefined, none)).toEqual({ eventId: undefined, selected: ALL_EVENTS });
    expect(defaultEventFilter(undefined, [])).toEqual({ eventId: undefined, selected: ALL_EVENTS });
  });

  /**
   * A bookmarked link to an event that has since been deleted shows the default rather than an
   * empty page filtered by something the select cannot display.
   */
  it("ignores an id that is not in the list any more", () => {
    expect(defaultEventFilter("gone", EVENTS)).toEqual({ eventId: "b", selected: "b" });
  });
});
