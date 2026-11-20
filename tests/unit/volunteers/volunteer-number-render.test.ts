import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import type { VolunteerItem, VolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §NNN, amending §948 — the event editor's «Voluntari» card once the volunteers number themselves V001, V002, …: the box «Numerele
 * voluntarilor încep de la» is gone (no form, no label, no action left to post it to), and a confirmed person's row wears «Nr. V007»
 * — in both languages; a person without a number wears none. BR-REQ-050-02.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (arg?: string | { locale: "ro" | "en"; namespace: string }) =>
      typeof arg === "object"
        ? createTranslator({ locale: arg.locale, messages: messages[arg.locale], namespace: arg.namespace as "Admin" })
        : createTranslator({ locale, messages: messages[locale], namespace: arg as "Admin" }),
    getLocale: async () => locale,
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, children }: { href: string; children: unknown }) => h("a", { href: typeof href === "string" ? href : "/" }, children as string),
    getPathname: () => "/",
  };
});
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
// Every action of the card is a no-op, by the names the actions file exports (the actions are proved in tests/integration/volunteers/).
vi.mock("@/app/[locale]/admin/events/[id]/volunteer-actions", async () => {
  const noop = async () => {};
  const { readFileSync: read } = await import("node:fs");
  const source = read("src/app/[locale]/admin/events/[id]/volunteer-actions.ts", "utf8");
  return Object.fromEntries([...source.matchAll(/export async function (\w+)/g)].map((match) => [match[1], noop]));
});
vi.mock("@/app/[locale]/events/[slug]/volunteers/actions", () => ({ submitVolunteerAction: async () => {} }));

const { default: VolunteersCard } = await import("@/modules/volunteers/ui/VolunteersCard");

const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
const EVENT = "11111111-1111-4111-8111-111111111111";
const WATER = "22222222-2222-4222-8222-222222222222";

const ROLE: VolunteerRole = {
  id: WATER,
  eventId: EVENT,
  nameRo: "Punct de apă",
  nameEn: "Water point",
  needed: 3,
  descriptionRo: null,
  descriptionEn: null,
  descriptionRoJson: null,
  descriptionEnJson: null,
  colour: null,
  categoryId: null,
  position: 0,
  createdAt: new Date("2026-10-14T08:00:00Z"),
};

let counter = 0;
const person = (over: Partial<VolunteerItem>): VolunteerItem => {
  counter += 1;
  return {
    id: `55555555-5555-4555-8555-${String(counter).padStart(12, "0")}`,
    eventId: EVENT,
    roleIds: [WATER],
    choiceIds: [WATER],
    name: `Maria Test ${counter}`,
    email: `maria.${counter}@example.test`,
    phone: "+40712345678",
    state: "CONFIRMED",
    source: "PUBLIC",
    message: null,
    age: null,
    dateOfBirth: null,
    sex: null,
    city: null,
    volunteeredBefore: false,
    clubMember: false,
    listOptIn: false,
    hasKit: false,
    volunteerNumber: null,
    checkpointId: null,
    raceDayDecision: null,
    inRaffle: true,
    present: false,
    shirtSize: null,
    createdAt: new Date("2026-10-14T09:00:00Z"),
    updatedAt: new Date("2026-10-14T09:00:00Z"),
    agreementAcceptedAt: null,
    agreementMethod: null,
    agreementVersion: null,
    agreementRoleName: null,
    agreementLocale: null,
    agreementEventDate: null,
    agreementEventLocation: null,
    locale: "ro",
    agreementTokenExpiresAt: null,
    agreementRequestedAt: null,
    guardianName: null,
    guardianEmail: null,
    guardianAcceptedAt: null,
    guardianMethod: null,
    guardianVersion: null,
    guardianTokenExpiresAt: null,
    guardianRequestedAt: null,
    ...over,
  };
};

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

async function drawCard(volunteers: VolunteerItem[], language: "ro" | "en" = "ro") {
  locale = language;
  const drawn = (await VolunteersCard({
    locale: language,
    eventId: EVENT,
    acceptsVolunteers: true,
    volunteersShirts: false,
    volunteersShowCounts: false,
    access: "ANYONE",
    invitations: [],
    eventDay: "2026-11-21",
    profileDescribed: true,
    minorsOpen: false,
    offerClosed: null,
    roles: [ROLE],
    categories: [],
    standings: [{ roleIds: [ROLE.id], needed: ROLE.needed, taken: 0, confirmed: 0, free: ROLE.needed }],
    agreementInForce: true,
    agreementNoticeDescribes: true,
    agreementDocumentIds: {},
    agreementEvent: {},
    now: new Date("2026-10-14T10:00:00Z"),
    volunteers,
  } as unknown as ComponentProps<typeof VolunteersCard>)) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Translate: messages[language].Translate, Admin: messages[language].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer: { action: translate, setupHref: null } } as ComponentProps<typeof TranslateProvider>, drawn)));
}

describe("§NNN BR-REQ-050-02 the «Voluntari» card once the volunteers number themselves", () => {
  it("has no «Numerele voluntarilor încep de la» — no form, no box, no words — in either language", async () => {
    for (const language of ["ro", "en"] as const) {
      const page = await drawCard([person({})], language);
      expect(page).not.toContain('data-testid="volunteer-numbers-form"');
      expect(page).not.toContain('data-testid="volunteer-numbers-start"');
      expect(page).not.toContain('name="start"');
      expect(page).not.toMatch(/Numerele voluntarilor încep de la|Volunteers' numbers start at/);
      // The card's other boxes stand: «Cel mult câte roluri poate bifa o persoană» is still there.
      expect(page).toContain('data-testid="volunteer-choices-max-form"');
    }
    // Nothing left to post it to, and no words left for it in either catalogue.
    expect(readFileSync("src/app/[locale]/admin/events/[id]/volunteer-actions.ts", "utf8")).not.toContain("setVolunteerNumbersStartAction");
    for (const catalogue of [ro, en]) {
      expect((catalogue.Admin.volunteers as Record<string, unknown>).numbers).toBeUndefined();
      expect((catalogue.Admin.errors as Record<string, unknown>).VOLUNTEER_NUMBERS_IN_RACE_SERIES).toBeUndefined();
    }
  });

  it("writes a confirmed person's number «Nr. V007» on the row, and nothing for a person who has none", async () => {
    const numbered = person({ volunteerNumber: 7, name: "Ana Numărul" });
    const waiting = person({ state: "REGISTERED", name: "Eva Fără" });
    const page = await drawCard([numbered, waiting]);
    expect(page).toContain(">Nr. V007<");
    expect(page.match(/data-testid="volunteer-number"/g)).toHaveLength(1);
    expect(await drawCard([person({ volunteerNumber: 1234 })], "en")).toContain(">No. V1234<");
  });
});
