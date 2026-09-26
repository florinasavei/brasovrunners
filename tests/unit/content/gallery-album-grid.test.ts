import { createTranslator } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import type { PublicAlbumSummary } from "@/modules/content/gallery/repository";

/**
 * BR-REQ-054-01, §434: the public gallery lists event albums and free albums in one list. An
 * event album's card names its event on a bold line; a free album's card has no such line and
 * is named by its date alone. Both cards keep the date and the photo count.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
  getLocale: async () => "ro",
}));
// The card's link needs the router's locale context; the words are what is under test.
vi.mock("@/shared/ui/CardLink", () => ({ default: ({ children }: { children: ReactNode }) => createElement("a", null, children) }));

const { default: AlbumGrid } = await import("@/app/[locale]/gallery/AlbumGrid");

function album(overrides: Partial<PublicAlbumSummary>): PublicAlbumSummary {
  return {
    id: "a",
    slug: "a",
    title: "Album",
    description: null,
    takenOn: new Date("2026-09-12T12:00:00.000Z"),
    updatedAt: new Date("2026-09-12T12:00:00.000Z"),
    photoCount: 3,
    coverThumbUrl: null,
    coverWebUrl: null,
    coverWidth: null,
    coverHeight: null,
    eventTitle: null,
    ...overrides,
  };
}

describe("the gallery's album cards (§434)", () => {
  it("names the event only on an event album's card, and dates and counts both", async () => {
    const html = renderToStaticMarkup(
      await AlbumGrid({
        albums: Promise.resolve([
          album({ id: "e", slug: "e", title: "Poze de la concurs", eventTitle: "Crosul Tâmpei", photoCount: 12 }),
          album({ id: "f", slug: "f", title: "Alergare de grup", takenOn: new Date("2026-09-05T12:00:00.000Z"), photoCount: 5 }),
        ]),
      }),
    );

    const cards = html.split("<li").slice(1);
    expect(cards).toHaveLength(2);
    const [eventCard, freeCard] = cards;

    expect(eventCard).toContain("Crosul Tâmpei");
    // The bold line: Emotion writes the Typography's rule just before the element it styles.
    expect(eventCard).toMatch(/font-weight:600;[^<]*<\/style><p [^>]*>Crosul Tâmpei</);
    expect(eventCard).toContain("12 fotografii");
    expect(eventCard).toContain("2026");

    expect(freeCard).not.toContain("Crosul Tâmpei");
    expect(freeCard).not.toContain("font-weight:600");
    expect(freeCard).toContain("Alergare de grup");
    expect(freeCard).toContain("5 fotografii");
    expect(freeCard).toContain("2026");
    // The free card has the title and the date line only: two text lines, never a third.
    expect(freeCard.match(/<p /g)?.length ?? 0).toBe(eventCard.match(/<p /g)!.length - 1);
  });
});
