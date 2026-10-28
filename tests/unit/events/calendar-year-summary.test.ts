import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-020-01 criterion 10, the year view's two answers (the owner, 2026-10-28, of the year: «arată
 * super ciudat»; asked to choose between the two ways to fix it: «Pune configs și butoane»).
 * «Pe scurt» (`/calendar/2026`) folds a month's weekly series into one line — weekdays, hour, title,
 * how many dates — and keeps every special date whole; «Toate datele» (`/calendar/2026/list`) shows
 * every date, as the year did before.
 */
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Events" }),
    getFormatter: async () => createFormatter({ locale: "ro", timeZone: "Europe/Bucharest" }),
    getLocale: async () => "ro",
  };
});

vi.mock("@mui/material/Tooltip", async () => {
  const react = await import("react");
  return { default: ({ children }: { title: ReactNode; children: ReactElement }) => react.createElement("span", null, children) };
});

const { default: EventCalendar } = await import("@/modules/events/ui/EventCalendar");

const NOW = new Date("2026-10-01T09:00:00Z");

function row(values: Partial<PublicEvent>): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "GROUP_RUN",
    surface: "ASPHALT",
    eventStatus: "SCHEDULED",
    timezone: "Europe/Bucharest",
    slug: "alergarea-de-luni",
    title: "Alergarea de luni",
    locationName: "Piața Sfatului",
    mapUrl: null,
    isSpecial: false,
    seriesCadence: "WEEKLY",
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    ...values,
  } as PublicEvent;
}

// Four Mondays at 19:00 in Brașov (the clocks go back on 25 October), and one race.
const mondays = ["2026-10-05T16:00:00Z", "2026-10-12T16:00:00Z", "2026-10-19T16:00:00Z", "2026-10-26T17:00:00Z"].map((at, index) =>
  row({ id: `0000000${index}-1111-1111-1111-111111111111`, slug: `alergarea-de-luni-${index}`, startsAt: new Date(at) }),
);
const race = row({ id: "99999999-1111-1111-1111-111111111111", type: "RACE", slug: "crosul", title: "Crosul aniversar", seriesCadence: null, startsAt: new Date("2026-10-18T06:00:00Z") });

const names = (html: string) => [...html.matchAll(/<a [^>]*aria-label="([^"]*)"[^>]*>/g)].map((match) => match[1]);

describe("BR-REQ-020-01 the year, «Pe scurt» or «Toate datele»", () => {
  it("«Pe scurt» folds the month's weekly series into one line and keeps the race whole", async () => {
    const html = renderToStaticMarkup(await EventCalendar({ view: { kind: "year", year: 2026 }, events: [...mondays, race], now: NOW, layout: "grid" }));
    const entries = names(html).filter((name) => !name.startsWith("octombrie"));
    expect(entries.filter((name) => name.includes("Alergarea de luni"))).toEqual(["lun. · 19:00 Alergarea de luni · 4 date"]);
    expect(entries).toContain("09:00 Crosul aniversar");
    // The line goes to the series' next date.
    expect(html).toContain("/ro/evenimente/alergarea-de-luni-0");
  });

  it("«Toate datele» shows every date", async () => {
    const html = renderToStaticMarkup(await EventCalendar({ view: { kind: "year", year: 2026 }, events: [...mondays, race], now: NOW, layout: "list" }));
    expect(names(html).filter((name) => name === "19:00 Alergarea de luni")).toHaveLength(4);
    expect(names(html)).toContain("09:00 Crosul aniversar");
    expect(html).not.toContain("4 date");
  });
});
