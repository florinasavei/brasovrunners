import { describe, expect, it } from "vitest";
import {
  MENU_SECTION_KEYS,
  isMenuSectionKey,
  moveMenuEntry,
  pageIdOfMenuKey,
  pageMenuKey,
  parseStoredMenuOrder,
  resolveMenuOrder,
  sortByMenuOrder,
} from "@/modules/content/menu/order";

/**
 * §571 (amending §406 and §537) — «Ordinea meniului»: one order for every entry the site menu can
 * carry, stored as one list of keys. The owner, 2026-09-29: «vreau să pot seta ordinea la orice
 * pagină, inclusiv cea de evenimente, calendar, contact».
 *
 * The merge rule, pinned here because the header, the footer and the backoffice card all use it:
 * the stored list rules; an entry it does not name falls to the end in today's default order (the
 * sections, then the custom pages by the old «Ordinea» column); a key for something that no longer
 * exists is dropped.
 */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("§571 the menu's keys", () => {
  it("names every section the header offers, in today's default order", () => {
    expect([...MENU_SECTION_KEYS]).toEqual(["events", "calendar", "contact", "gallery", "team", "faq"]);
    expect(isMenuSectionKey("faq")).toBe(true);
    expect(isMenuSectionKey("page:x")).toBe(false);
  });

  it("keys a custom page by its id, never by its address", () => {
    expect(pageMenuKey(A)).toBe(`page:${A}`);
    expect(pageIdOfMenuKey(`page:${A}`)).toBe(A);
    expect(pageIdOfMenuKey("page:")).toBeNull();
    expect(pageIdOfMenuKey("events")).toBeNull();
  });
});

describe("§571 reading the stored value", () => {
  it("keeps a list of strings, each once, and reads anything else as no list", () => {
    expect(parseStoredMenuOrder(["contact", "events", "contact"])).toEqual(["contact", "events"]);
    expect(parseStoredMenuOrder(["events", 3, null, "", "calendar"])).toEqual(["events", "calendar"]);
    expect(parseStoredMenuOrder(null)).toEqual([]);
    expect(parseStoredMenuOrder({ order: ["events"] })).toEqual([]);
    expect(parseStoredMenuOrder("events,calendar")).toEqual([]);
  });
});

describe("§571 the merge rule", () => {
  it("is today's menu with no stored list: the sections, then the pages in the old column's order", () => {
    expect(resolveMenuOrder([], [B, A])).toEqual([...MENU_SECTION_KEYS, `page:${B}`, `page:${A}`]);
  });

  it("follows the stored list, and puts what it does not name at the end in the default order", () => {
    const stored = [`page:${A}`, "contact", "events"];
    expect(resolveMenuOrder(stored, [B, A, C])).toEqual([
      `page:${A}`,
      "contact",
      "events",
      "calendar",
      "gallery",
      "team",
      "faq",
      `page:${B}`,
      `page:${C}`,
    ]);
  });

  it("drops a key for a page deleted since the save, and a key no release knows", () => {
    const stored = [`page:${C}`, "faq", "newsletter", `page:${A}`];
    expect(resolveMenuOrder(stored, [A])).toEqual(["faq", `page:${A}`, "events", "calendar", "contact", "gallery", "team"]);
  });

  it("gives an unpublished entry its place: the rule orders every key, the reader leaves out what it does not offer", () => {
    // The header's list has no «Echipa» (a draft) and no page B (unpublished): the others keep the club's order.
    const offered = ["events", "calendar", "contact", `page:${A}`];
    const stored = [`page:${B}`, "team", `page:${A}`, "contact", "events", "calendar"];
    expect(sortByMenuOrder(offered, (key) => key, stored)).toEqual([`page:${A}`, "contact", "events", "calendar"]);
    // Published again, each comes back where it was put.
    expect(sortByMenuOrder([...offered, "team", `page:${B}`], (key) => key, stored)).toEqual([
      `page:${B}`,
      "team",
      `page:${A}`,
      "contact",
      "events",
      "calendar",
    ]);
  });

  it("is stable for the entries the list does not name", () => {
    const items = [{ k: "x" }, { k: "events" }, { k: "y" }, { k: "z" }];
    expect(sortByMenuOrder(items, (item) => item.k, ["events"]).map((item) => item.k)).toEqual(["events", "x", "y", "z"]);
  });
});

describe("§571 «Sus» and «Jos»", () => {
  const order = ["events", "calendar", "contact"];

  it("moves one entry one place, and leaves the list as it was at an end", () => {
    expect(moveMenuEntry(order, "contact", "up")).toEqual(["events", "contact", "calendar"]);
    expect(moveMenuEntry(order, "events", "down")).toEqual(["calendar", "events", "contact"]);
    expect(moveMenuEntry(order, "events", "up")).toEqual(order);
    expect(moveMenuEntry(order, "contact", "down")).toEqual(order);
  });

  it("ignores a key that is not in the list, and never changes the list it was given", () => {
    expect(moveMenuEntry(order, "faq", "up")).toEqual(order);
    const copy = [...order];
    moveMenuEntry(copy, "calendar", "up");
    expect(copy).toEqual(order);
  });
});
