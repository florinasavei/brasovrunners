import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";

/**
 * §NNN — «Lista ascunsă» in the public list's card, under «Arată public câți așteaptă»: the switch with
 * its marker and help, and the three fields that mean something only with it on — drawn always (still
 * posted, read-only while hidden), shown only while the switch is ticked.
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

/** The block `ShownWhen` draws around the three dependent fields, from its opening tag. */
const detailsBlock = (html: string) => {
  const at = html.indexOf('data-testid="hidden-list-details"');
  return html.slice(html.lastIndexOf("<div", html.lastIndexOf("<div", at) - 1), at);
};

describe("§NNN the «Lista ascunsă» group in the editor", () => {
  it("draws the switch with its marker and help after the count box, and the three fields under it", async () => {
    const html = await render(RACE);
    expect(html.indexOf('data-testid="waitlist-count-public"')).toBeLessThan(html.indexOf('data-testid="hidden-list-settings"'));
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="event.hiddenList.present"[^>]*value="1"/);
    expect(html).toContain('name="event.hiddenListEnabled"');
    expect(html).not.toMatch(/<input[^>]*name="event.hiddenListEnabled"[^>]*checked/);
    for (const key of ["hiddenListEnabled", "hiddenListEnabledHelp", "hiddenListBibStart", "participantCountPublic", "participantCountPublicHelp", "hiddenListCounted", "hiddenListCountedHelp"] as const) {
      expect(html, key).toContain(ro.Admin.editor[key].split("„")[0].split("«")[0]);
    }
    expect(html).toContain('name="event.hiddenListBibStart"');
    // «Arată public numărătoarea» starts ticked, «Numără și lista ascunsă» not.
    expect(html).toMatch(/<input[^>]*name="event.participantCountPublic"[^>]*checked/);
    expect(html).not.toMatch(/<input[^>]*name="event.hiddenListCounted"[^>]*checked/);
    // Hidden while the switch is off: in the page, posted, but not shown.
    expect(detailsBlock(html)).toContain("data-hidden-block");
  });

  it("shows the three fields with the switch ticked, with the event's values", async () => {
    const html = await render({ ...RACE, hiddenListEnabled: true, hiddenListBibStart: 900, participantCountPublic: false, hiddenListCounted: true } as unknown as EditableEvent);
    expect(html).toMatch(/<input[^>]*name="event.hiddenListEnabled"[^>]*checked/);
    expect(detailsBlock(html)).not.toContain("data-hidden-block");
    expect(html).toMatch(/<input[^>]*name="event.hiddenListBibStart"[^>]*value="900"|<input[^>]*value="900"[^>]*name="event.hiddenListBibStart"/);
    expect(html).not.toMatch(/<input[^>]*name="event.participantCountPublic"[^>]*checked/);
    expect(html).toMatch(/<input[^>]*name="event.hiddenListCounted"[^>]*checked/);
  });
});
