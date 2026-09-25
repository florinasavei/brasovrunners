import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — "Următoarele emailuri automate" on `/admin/emails`, as the server sends it: a closed fold
 * whose closed line counts the sends, one row per send in the order given — the event as a link to
 * its editor, the moment with its weekday in the reader's language and the event's zone, the
 * message as a link to its preview card, the recipients counted in words — an empty state in
 * words, and the club-copy line with a link to the panel that sets it. Both languages.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: state.locale, messages: catalogues[state.locale], namespace: namespace as "Admin" }),
  };
});
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: { params: { id: string } } }) => `/${locale}/admin/events/${href.params.id}`,
}));

const { default: UpcomingEmailsPanel } = await import("@/modules/notifications/ui/UpcomingEmailsPanel");
type Rows = Parameters<typeof UpcomingEmailsPanel>[0]["rows"];

const ROWS: Rows = [
  {
    at: new Date("2026-10-10T09:00:00.000Z"),
    overdue: false,
    eventId: "event-a",
    eventTitle: { ro: "Crosul de toamnă", en: "The autumn cross" },
    zone: "Europe/Bucharest",
    type: "EVENT_REMINDER",
    send: "reminder",
    recipients: 23,
    testRecipients: 0,
    registrationIds: [],
  },
  {
    at: new Date("2026-10-12T07:30:00.000Z"),
    overdue: false,
    eventId: "event-b",
    eventTitle: { ro: "Semimaratonul", en: null },
    zone: "Europe/Bucharest",
    type: "COMPLETE_DECLARATION",
    send: "lastCall",
    recipients: 1,
    testRecipients: 2,
    registrationIds: [],
  },
];

async function render(locale: "ro" | "en", rows: Rows, clubCopies: string[] | null = []): Promise<string> {
  state.locale = locale;
  const html = renderToStaticMarkup((await UpcomingEmailsPanel({ locale, rows, horizonDays: 14, clubCopies })) as ReactElement);
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

describe("§NNN the upcoming automatic emails card", () => {
  it("is a closed fold that counts the sends on its closed line", async () => {
    const html = await render("ro", ROWS);
    expect(html).toMatch(/^<details[^>]*id="upcoming-emails"/);
    expect(html.match(/<details[^>]*>/)?.[0]).not.toMatch(/\sopen/);
    expect(html).toContain(ro.Admin.emails.forecast.title);
    expect(html).toContain("2 trimiteri în următoarele 14 zile");
    expect(await render("en", ROWS)).toContain("2 sends in the next 14 days");
  });

  it("lists each send with its event, moment, message and recipients, in Romanian", async () => {
    const html = await render("ro", ROWS);
    const rows = html.match(/data-testid="upcoming-email"/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(html).toMatch(/href="\/ro\/admin\/events\/event-a"[^>]*>Crosul de toamnă</);
    expect(html).toMatch(/href="#email-EVENT_REMINDER"[^>]*>reminderul dinaintea startului, către cei confirmați</);
    expect(html).toContain("Sâm., 10 oct. 2026, 12:00");
    expect(html).toContain("23 de destinatari acum");
    // Test registrations are sent to and labelled apart, never counted with the real ones (§30).
    expect(html).toContain("1 destinatar acum și 2 înscrieri de test");
    expect(html).not.toMatch(/23 de destinatari acum și/);
    expect(html).toContain(ro.Admin.emails.forecast.sends.lastCall);
    // In the order given: the reminder first.
    expect(html.indexOf("Crosul de toamnă")).toBeLessThan(html.indexOf("Semimaratonul"));
  });

  it("says the same in English, and names an event by the other language's title when it has no English one", async () => {
    const html = await render("en", ROWS);
    expect(html).toMatch(/href="\/en\/admin\/events\/event-a"[^>]*>The autumn cross</);
    expect(html).toMatch(/href="#email-COMPLETE_DECLARATION"[^>]*>/);
    expect(html).toContain("Sat, 10 Oct 2026, 12:00");
    expect(html).toContain("23 recipients now");
    expect(html).toContain("1 recipient now and 2 test registrations");
    expect(html).toContain(">Semimaratonul<");
    expect(html).toContain(en.Admin.emails.forecast.sends.reminder);
  });

  it("says in words when nothing is due, in both languages", async () => {
    const roHtml = await render("ro", []);
    expect(roHtml).toContain('data-testid="upcoming-emails-empty"');
    expect(roHtml).toContain("Nimic în următoarele 14 zile");
    expect(roHtml).toContain("0 trimiteri în următoarele 14 zile");
    const enHtml = await render("en", []);
    expect(enHtml).toContain("Nothing in the next 14 days");
  });

  it("says whether the club gets a copy, to which addresses, and links to where it is set", async () => {
    const some = await render("ro", ROWS, ["arhiva@example.ro", "sef@example.ro"]);
    expect(some).toContain("arhiva@example.ro, sef@example.ro");
    expect(some).toMatch(/href="#club-notices"[^>]*>Schimbă în „Copiile clubului”</);
    expect(await render("en", ROWS, [])).toContain(en.Admin.emails.forecast.clubCopy.none);
    // A reader who may not see the club's lists gets no line.
    expect(await render("ro", ROWS, null)).not.toContain('data-testid="upcoming-emails-club-copy"');
  });

  it("has every phrase it builds a key for, in both catalogues", () => {
    for (const messages of [ro, en]) {
      const forecast = messages.Admin.emails.forecast;
      for (const form of ["one", "few", "other"] as const) {
        expect(forecast.aside[form]).toBeTruthy();
        expect(forecast.recipients[form]).toBeTruthy();
        expect(forecast.tests[form]).toBeTruthy();
      }
      for (const send of ["reminder", "lastCall", "participation", "nextInLine", "bibs", "registrationOpened"] as const) {
        expect(forecast.sends[send], send).toBeTruthy();
      }
    }
  });
});
