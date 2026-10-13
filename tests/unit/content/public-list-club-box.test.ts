import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §753 — «Clubul pe lista publică» in the public list's card: three native radios (one `name`, the
 * stored mode checked, each a 44-pixel row), the help in plain words, the club's name from the platform's
 * constant — and both languages carry every word.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});

const { default: StartListBox } = await import("@/modules/content/events/ui/boxes/StartListBox");

const RACE = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "RACE",
  eventStatus: "SCHEDULED",
  registrationMode: "INTERNAL",
  participantListVisibility: "NAMES",
  waitlistPublic: false,
  waitlistCountPublic: true,
  hiddenListEnabled: false,
  hiddenListBibStart: null,
  participantCountPublic: true,
  hiddenListCounted: false,
} as unknown as EditableEvent;

async function render(event: EditableEvent | null) {
  const element = await StartListBox({ event, mayEditSettings: true });
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>, element as ReactElement),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const radios = (html: string) => [...html.matchAll(/<input[^>]*type="radio"[^>]*name="event\.publicListClub"[^>]*>/g)].map((match) => match[0]);

describe("§753 «Clubul pe lista publică» in the editor", () => {
  it("offers the three modes as one radio group, «Doar» the club checked when the event has none stored", async () => {
    for (const event of [RACE, null]) {
      const html = await render(event);
      const found = radios(html);
      expect(found).toHaveLength(3);
      expect(found.map((tag) => /value="([^"]+)"/.exec(tag)?.[1])).toEqual(["members_only", "as_typed", "hidden"]);
      expect(found.map((tag) => /checked/.test(tag))).toEqual([true, false, false]);
    }
  });

  it("checks the stored mode", async () => {
    const asTyped = radios(await render({ ...RACE, publicListClub: "as_typed" } as unknown as EditableEvent));
    expect(asTyped.map((tag) => /checked/.test(tag))).toEqual([false, true, false]);
    const hidden = radios(await render({ ...RACE, publicListClub: "hidden" } as unknown as EditableEvent));
    expect(hidden.map((tag) => /checked/.test(tag))).toEqual([false, false, true]);
  });

  it("says each mode in the club's words, the name from the platform's constant, and the help in plain words", async () => {
    const html = await render(RACE);
    expect(html).toContain(`Doar ${CLUB_NAME}`);
    expect(html).toContain("Cum l-au scris");
    expect(html).toContain("Nu arăta clubul");
    expect(html).toContain('data-testid="public-list-club-help"');
    expect(html).toContain("Clubul pe lista publică");
    // The fold says what the owner met on the live race: nobody on the page typed it, so no column (§756).
    expect(html).toContain("coloana nu apare");
    expect(html).toContain("orice alt text rămâne ascuns");
  });

  it("has the words in both catalogues, the help short enough to read at a glance, and the name never typed in", () => {
    for (const key of ["publicListClub", "publicListClubHelp", "publicListClubHelpMore", "publicListClubMembersOnly", "publicListClubAsTyped", "publicListClubHidden"] as const) {
      expect(ro.Admin.editor[key].length, `ro ${key}`).toBeGreaterThan(0);
      expect(en.Admin.editor[key].length, `en ${key}`).toBeGreaterThan(0);
    }
    expect(ro.Admin.editor.publicListClubHelp.length).toBeLessThanOrEqual(200);
    expect(en.Admin.editor.publicListClubHelp.length).toBeLessThanOrEqual(200);
    for (const catalogue of [ro.Admin.editor, en.Admin.editor]) {
      expect(catalogue.publicListClubHelp).toContain("{club}");
      expect(catalogue.publicListClubMembersOnly).toContain("{club}");
    }
  });
});
