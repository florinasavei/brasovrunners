import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";

/**
 * §634 — «Arată public câți așteaptă» in the public list's card, under «Arată public numărătoarea»
 * (§669): a tick with its marker (a form without the box is "not editing it"), on by default, and drawn
 * whatever the names switch says — it hides a number, never a name. One sentence of help, under 200
 * characters in both catalogues (§511).
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
  participantListVisibility: "HIDDEN",
  waitlistPublic: false,
  waitlistCountPublic: true,
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

describe("§634 the «Arată public câți așteaptă» box", () => {
  it("is ticked by default, with its marker and its help, under the waiting list's names switch", async () => {
    const html = await render(RACE);
    expect(html).toContain('data-testid="waitlist-count-public"');
    expect(html).toContain(ro.Admin.editor.waitlistCountPublic);
    expect(html).toContain(ro.Admin.editor.waitlistCountPublicHelp);
    expect(html).toMatch(/<input[^>]*name="event.waitlistCountPublic"[^>]*checked/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="event.waitlistCountPublic.present"[^>]*value="1"/);
    expect(html.indexOf('data-testid="waitlist-public"')).toBeLessThan(html.indexOf('data-testid="waitlist-count-public"'));
    // A new event (no row yet) starts ticked too.
    expect(await render(null)).toMatch(/<input[^>]*name="event.waitlistCountPublic"[^>]*checked/);
  });

  it("starts unticked on an event that keeps the count private, whatever the list says", async () => {
    for (const participantListVisibility of ["HIDDEN", "NAMES"]) {
      const html = await render({ ...RACE, participantListVisibility, waitlistCountPublic: false } as unknown as EditableEvent);
      expect(html).toContain('name="event.waitlistCountPublic"');
      expect(html).not.toMatch(/<input[^>]*name="event.waitlistCountPublic"[^>]*checked/);
    }
  });

  it("has its words in both catalogues, the help under 200 characters", () => {
    for (const messages of [ro, en]) {
      expect(messages.Admin.editor.waitlistCountPublic.length).toBeGreaterThan(0);
      expect(messages.Admin.editor.waitlistCountPublicHelp.length).toBeLessThan(200);
    }
    expect(en.Admin.editor.waitlistCountPublic).toBe("Show publicly how many are waiting");
  });
});
