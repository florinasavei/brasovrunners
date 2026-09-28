import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-031-01 — the sitting's screen reads its deadline against the clock (§NNN, the review of
 * 2026-09-28, round three, finding 2). The deadline is the sitting's, fixed by its first form, and
 * nothing moves it; a «Da» pressed after it reserves nothing. So once it is past, the screen names no
 * place and says so — «Locurile nu mai sunt rezervate. Confirmă adresa din email; dacă mai e loc, îl
 * primești atunci.» — rather than the words the browser's half kept.
 *
 * The Server Component rendered with the real catalogues; the public cache's read of the club's
 * window is stubbed (the window is passed anyway).
 */
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale, messages: catalogues[locale] as typeof catalogues.ro, namespace: namespace as "Registration" }),
    getLocale: async () => locale,
  };
});
vi.mock("@/modules/public-cache/reads", () => ({ cachedDeadlines: async () => ({ familySittingMinutes: 10 }) }));

const { NextIntlClientProvider } = await import("next-intl");
const catalogues = {
  ro: (await import("../../../messages/ro.json")).default,
  en: (await import("../../../messages/en.json")).default,
};
const { default: FamilySittingNext } = await import("@/modules/registrations/ui/FamilySittingNext");

// 13:00 in Brașov (EEST): the deadline is the first form's instant, the window and the hold — 13:40.
const FIRST_FORM = new Date("2026-09-25T10:00:00.000Z");
const DEADLINE = new Date("2026-09-25T10:40:00.000Z");
const PEOPLE = [
  { name: "Ana Pop", birthDate: "1985-03-02" },
  { name: "Mihai Pop", birthDate: "1987-02-14" },
  { name: "Ioana Pop", birthDate: "2010-07-11", waitlist: true },
];

async function screen(now: Date): Promise<string> {
  const page = (await FamilySittingNext({
    email: "familia.pop@example.ro",
    names: PEOPLE.map((person) => person.name),
    reservation: { people: PEOPLE, until: DEADLINE },
    sameBirthDate: null,
    releaseInMs: 5 * 60_000,
    firstName: "Ioana",
    eventTitle: "Crosul familiei",
    atOnce: false,
    windowMinutes: 10,
    locale,
    slug: "crosul-familiei",
    continueAction: async () => undefined,
    releaseAction: async () => undefined,
    now,
  })) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale, messages: catalogues[locale] } as unknown as ComponentProps<typeof NextIntlClientProvider>, page),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

describe("BR-REQ-031-01 the sitting's screen past the sitting's deadline (§NNN)", () => {
  it("before it: the marker names the reserved places until 13:40, each name with its place", async () => {
    const html = await screen(new Date(FIRST_FORM.getTime() + 20 * 60_000));
    expect(html).toContain("Înscriere de familie: Ana, Mihai, Ioana — 2 locuri rezervate până la 13:40, o persoană pe lista de așteptare.");
    expect(html.match(/ — loc rezervat</g)).toHaveLength(2);
    expect(html).toContain(" — pe lista de așteptare, după confirmare");
    expect(html).not.toContain("Locurile nu mai sunt rezervate");
  });

  it("after it: no place is named, and one sentence says the places are no longer reserved", async () => {
    const html = await screen(new Date(DEADLINE.getTime() + 60_000));
    expect(html).toContain("Locurile nu mai sunt rezervate. Confirmă adresa din email; dacă mai e loc, îl primești atunci.");
    expect(html).toContain("Înscriere de familie: Ana, Mihai, Ioana.");
    expect(html).not.toContain("loc rezervat");
    expect(html).not.toContain("locuri rezervate");
    expect(html).not.toContain("pe lista de așteptare");
    // At the instant itself, too: the place lapses at the deadline, not a moment after.
    expect(await screen(DEADLINE)).toContain("Locurile nu mai sunt rezervate.");
  });

  it("says it in English too", async () => {
    locale = "en";
    try {
      const html = await screen(new Date(DEADLINE.getTime() + 60_000));
      expect(html).toContain("The places are no longer reserved. Confirm the address from the email; if there is still room, you get it then.");
      expect(html).not.toContain("place reserved");
      expect(html).not.toContain("places reserved");
    } finally {
      locale = "ro";
    }
  });
});
