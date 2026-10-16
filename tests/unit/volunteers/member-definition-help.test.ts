import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { PublicVolunteerRole } from "@/modules/volunteers/volunteers";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §789 — the volunteers' form's tick «Fac parte din grupul {club}» carries the same «?» as the registration
 * form's member tick, with the same words: the club's sentence from «Pagini» → «Membri» in the page's language,
 * else the platform's (`Registration.clubMemberDefinition`). The form reads it through the public cache, so
 * what is stood in for here is that read (`cachedMemberDefinition`, proved against a database in
 * `tests/integration/cms/member-definition-action.test.ts`).
 */
const messages = { ro, en } as const;
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en", sentence: null as { ro: string; en: string } | null, reads: 0 }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (arg?: string | { locale: "ro" | "en"; namespace: string }) =>
      typeof arg === "object"
        ? createTranslator({ locale: arg.locale, messages: messages[arg.locale], namespace: arg.namespace as "Event" })
        : createTranslator({ locale: state.locale, messages: messages[state.locale], namespace: arg as "Event" }),
    getLocale: async () => state.locale,
  };
});
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedMemberDefinition: async (locale: "ro" | "en") => {
    state.reads += 1;
    return state.sentence?.[locale] ?? null;
  },
}));
vi.mock("@/app/[locale]/events/[slug]/volunteers/actions", () => ({ submitVolunteerAction: async () => {} }));
vi.mock("@/shared/feedback/PublicFlash", async () => {
  const { createElement: element } = await import("react");
  return { default: () => element("div", { "data-testid": "public-flash" }) };
});

const { default: VolunteerBox } = await import("@/modules/volunteers/ui/VolunteerBox");
const { NextIntlClientProvider } = await import("next-intl");

const ROLE: PublicVolunteerRole = {
  id: "22222222-2222-4222-8222-222222222222",
  nameRo: "Punct de apă",
  nameEn: "Water point",
  descriptionRo: null,
  descriptionEn: null,
  descriptionRoJson: null,
  descriptionEnJson: null,
  needed: 3,
  taken: 0,
  free: 3,
  categoryId: null,
};
const CLUB = { ro: "Ai fost la cel puțin 5 alergări de grup în ultimele 3 luni.", en: "You have joined at least 5 group runs in the last 3 months." };

async function drawBox(language: "ro" | "en", over: Partial<ComponentProps<typeof VolunteerBox>> = {}) {
  state.locale = language;
  const drawn = (await VolunteerBox({
    locale: language,
    slug: "cursa",
    roles: [ROLE],
    shirts: false,
    showCounts: true,
    eventDay: "2026-11-21",
    profile: true,
    minors: false,
    outcome: null,
    refused: [],
    typed: {},
    renderedAt: new Date("2026-10-14T10:00:00Z"),
    attempt: "attempt",
    ...over,
  })) as ReactElement;
  const intl = { locale: language, messages: { Event: messages[language].Event, Registration: messages[language].Registration } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, drawn), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "").replaceAll("&#x27;", "'");
}

/** The member tick's own label, from its box to the label's end. */
const memberTick = (page: string) => /name="clubMember"[\s\S]*?<\/label>/.exec(page)?.[0] ?? "";

describe("§789 the volunteers' member tick has the «?»", () => {
  it("says the club's sentence in the page's language, behind a button that submits nothing", async () => {
    state.sentence = CLUB;
    const page = await drawBox("ro");
    const tick = memberTick(page);
    expect(tick).toContain(`Fac parte din grupul ${CLUB_NAME}`);
    const button = /<button[^>]*>/.exec(tick)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toContain(`aria-label="${CLUB.ro}"`);
    expect(page).not.toContain(CLUB.en);
    // Not a visible line: the sentence is said once, by the «?».
    expect(page.split(CLUB.ro)).toHaveLength(2);

    const english = await drawBox("en");
    expect(memberTick(english)).toContain(`aria-label="${CLUB.en}"`);
    expect(english).not.toContain(CLUB.ro);
  });

  it("says the platform's words while the club wrote none, in each language", async () => {
    state.sentence = null;
    expect(memberTick(await drawBox("ro"))).toContain(`aria-label="${ro.Registration.clubMemberDefinition}"`);
    expect(memberTick(await drawBox("en"))).toContain(`aria-label="${en.Registration.clubMemberDefinition}"`);
  });

  it("is the registration form's own «?» — the same `Hint`, the same words — and only on the form that asks the tick", async () => {
    state.sentence = CLUB;
    const source = readFileSync("src/modules/volunteers/ui/VolunteerBox.tsx", "utf8");
    expect(source).toContain('import Hint from "@/shared/ui/Hint"');
    expect(readFileSync("src/modules/registrations/ui/registration-form.tsx", "utf8")).toContain('import Hint from "@/shared/ui/Hint"');
    // The older form (§758: no profile, so no tick) draws neither the tick nor the «?», and does not read the setting.
    state.reads = 0;
    const older = await drawBox("ro", { profile: false });
    expect(older).not.toContain('name="clubMember"');
    expect(older).not.toContain(CLUB.ro);
    expect(state.reads).toBe(0);
  });
});
