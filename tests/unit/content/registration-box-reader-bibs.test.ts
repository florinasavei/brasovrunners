import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EditableEvent } from "@/modules/content/events/repository";
import { canEditEventFields, canReadRegistrations } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-060-01 — the Organizer reads the events and changes none (§NNN), and keeps reading the
 * race numbers (§289). «Participare și înscrieri» shows a reader one sentence in place of the
 * settings; the numbers' card — «Alocare și tipărire», «Vezi numerele», «Descarcă toate numerele
 * (PDF)» — is not a setting of the event, so it stays under that sentence. The page draws it only
 * for a role that reads the registrations: the Organizer, never the Redactor.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});

vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, children }: { href: string; children: unknown }) => h("a", { href }, children as string), getPathname: () => "/" };
});

const { default: RegistrationBox } = await import("@/modules/content/events/ui/boxes/RegistrationBox");

const RACE = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "RACE",
  eventStatus: "SCHEDULED",
  registrationMode: "INTERNAL",
  timezone: "Europe/Bucharest",
  startsAt: new Date("2026-11-21T08:00:00Z"),
  confirmationOpensDaysBefore: 7,
  confirmationDeadlineDaysBefore: 2,
  bibStartNumber: 1,
  bibColour: null,
  bibDesign: null,
  declarationDocumentId: null,
  reminderHoursBefore: null,
} as unknown as EditableEvent;

const BIB_PRINT = createElement("div", { "data-testid": "bib-print" }, "Alocare și tipărire");

async function render(mayEditSettings: boolean, bibPrint: ReactElement | null) {
  const element = await RegistrationBox({
    event: RACE,
    mayEditSettings,
    declarations: [],
    bibCounts: bibPrint ? { total: 3, unprinted: 1 } : null,
    bibPrint,
    locale: "ro",
    now: new Date("2026-10-01T08:00:00Z"),
    clubDeadlines: { reminderHours: 48, holdMinutes: 30, offerHours: 24, raceWeekDays: 7 },
  } as Parameters<typeof RegistrationBox>[0]);
  // The read-only sentence is an async Server Component, so the whole tree is streamed to the end.
  const { NextIntlClientProvider } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, element as ReactElement),
  );
  await stream.allReady;
  return new Response(stream).text();
}

describe("BR-REQ-060-01 a reader of the event keeps the race numbers' card (§NNN, §289)", () => {
  it("draws the numbers' card under the read-only sentence when the settings are not the reader's", async () => {
    const html = await render(false, BIB_PRINT);
    expect(html).toContain("Setările le schimbă Administratorul.");
    expect(html).toContain('data-testid="bib-print"');
    expect(html).not.toContain('name="event.capacity"');
  });

  it("draws no numbers' card for a reader the page gave none (the Redactor)", async () => {
    const html = await render(false, null);
    expect(html).toContain("Setările le schimbă Administratorul.");
    expect(html).not.toContain('data-testid="bib-print"');
  });

  it("gives the card to the Organizer and not to the Redactor: the page counts the numbers only for a reader of the registrations", () => {
    const page = readFileSync(path.join(process.cwd(), "src", "app", "[locale]", "admin", "events", "[id]", "page.tsx"), "utf8");
    expect(page).toContain("const bibCounts = canReadRegistrations(staffUser.role) && internal ? await countBibs(db, event.id) : null;");
    expect(page).toMatch(/bibPrint=\{\s*bibCounts \?/);
    expect(canEditEventFields("MODERATOR")).toBe(false);
    expect(canReadRegistrations("MODERATOR")).toBe(true);
    expect(canEditEventFields("COPYWRITER")).toBe(false);
    expect(canReadRegistrations("COPYWRITER")).toBe(false);
  });
});
