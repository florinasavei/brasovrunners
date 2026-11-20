import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import {
  confirmedVolunteersWithoutNumber,
  leftOutForNoNumber,
  type RaffleKind,
  type RaffleReason,
  raffleParticipation,
  raffleSettingsMoved,
  type RaffleSettingsRow,
} from "@/modules/volunteers/domain/raffle";
import RaffleNumberHint, { VOLUNTEER_NUMBERS_ANCHOR } from "@/modules/volunteers/ui/RaffleNumberHint";
import type { VolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §NNN, BR-REQ-050-02 — why the volunteers are out of the raffle (the owner, 2026-11-20: «vreau să le dau automat numere și
 * voluntarilor, pentru că văd că deși voluntarii sunt bifați aici… cumva sunt excluși de pe lista de la tombolă»), its pure parts:
 *
 * - who is counted — the confirmed volunteers without a number, the ones the raffle's one answer leaves out as `noNumber`; never a
 *   registered (not yet confirmed) or cancelled one, never one with a number;
 * - «Tombolă»'s count, the roster's own `noNumber` rows, nought while «Voluntarii» is unticked;
 * - which save opens the editor's «Tombolă» fold — one that moved a raffle setting, and no other;
 * - the line itself, its link to the «Voluntari» card's numbers, and that anchor on the card's numbers form.
 *
 * The rendered editor is `tests/unit/content/raffle-fold-render.test.ts`; the tab and the page, `tests/integration/volunteers/
 * raffle-volunteers-without-number.test.ts`.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

// The dialogs' road line (§841) reads the club's roads once per request: no database here.
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
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
vi.mock("@/app/[locale]/admin/events/[id]/volunteer-actions", () => {
  const noop = async () => {};
  return Object.fromEntries(
    [
      "addVolunteerAction",
      "addVolunteerCategoryAction",
      "assignVolunteerAction",
      "unassignVolunteerAction",
      "deleteVolunteerAction",
      "deleteVolunteerCategoryAction",
      "deleteVolunteerRoleAction",
      "editVolunteerAction",
      "editVolunteerCategoryAction",
      "moveVolunteerCategoryAction",
      "saveVolunteerCategoryContactAction",
      "saveVolunteerRolesAction",
      "recordPaperVolunteerAgreementAction",
      "recordPaperVolunteerGuardianAction",
      "requestVolunteerAgreementAction",
      "requestVolunteerGuardianAction",
      "setVolunteerStateAction",
      "switchVolunteersAction",
      "switchVolunteersShirtsAction",
      "setVolunteerNumbersStartAction",
      "setVolunteerChoicesMaxAction",
      "switchVolunteersCountsAction",
      "switchVolunteersListAction",
      "switchVolunteersButtonAction",
      "switchVolunteersAccessAction",
      "sendVolunteerInvitationsAction",
      "resendVolunteerInvitationAction",
      "withdrawVolunteerInvitationAction",
    ].map((name) => [name, noop]),
  );
});

const { default: VolunteersCard } = await import("@/modules/volunteers/ui/VolunteersCard");

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
}

const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const SETTINGS: RaffleSettingsRow = { hasRaffle: true, raffleRunners: true, raffleElites: true, raffleVolunteers: true, raffleSignUp: false, raffleSignUpOpen: false };

describe("§NNN who the line counts: the confirmed volunteers who wear no number", () => {
  it("counts a confirmed volunteer without a number, and nobody else", () => {
    expect(
      confirmedVolunteersWithoutNumber([
        { state: "CONFIRMED", bibNumber: null },
        { state: "CONFIRMED", bibNumber: null },
        { state: "CONFIRMED", bibNumber: 500 },
        { state: "REGISTERED", bibNumber: null },
        { state: "CANCELLED", bibNumber: null },
      ]),
    ).toBe(2);
    expect(confirmedVolunteersWithoutNumber([])).toBe(0);
  });

  it("is exactly whom the raffle's one answer leaves out as «fără număr» while «Voluntarii» is ticked", () => {
    const people = [
      { state: "CONFIRMED", bibNumber: null },
      { state: "CONFIRMED", bibNumber: 501 },
      { state: "REGISTERED", bibNumber: null },
    ];
    const groups = { RUNNER: true, ELITE: true, VOLUNTEER: true };
    const reasons = people.map((person) =>
      raffleParticipation({ kind: "VOLUNTEER", confirmed: person.state === "CONFIRMED", hasNumber: person.bibNumber !== null, inRaffle: true, signedUp: false }, { groups, signUp: false }),
    );
    expect(reasons).toEqual(["noNumber", "in", "notConfirmed"]);
    expect(confirmedVolunteersWithoutNumber(people)).toBe(reasons.filter((reason) => reason === "noNumber").length);
  });
});

describe("§NNN «Tombolă»'s count: the roster's own `noNumber` rows of one group", () => {
  const rows: { kind: RaffleKind; reason: RaffleReason }[] = [
    { kind: "VOLUNTEER", reason: "noNumber" },
    { kind: "VOLUNTEER", reason: "noNumber" },
    { kind: "VOLUNTEER", reason: "in" },
    { kind: "VOLUNTEER", reason: "notConfirmed" },
    { kind: "RUNNER", reason: "noNumber" },
  ];

  it("counts the group's rows out for want of a number alone", () => {
    expect(leftOutForNoNumber(rows, "VOLUNTEER")).toBe(2);
    expect(leftOutForNoNumber(rows, "RUNNER")).toBe(1);
    expect(leftOutForNoNumber(rows, "ELITE")).toBe(0);
  });

  it("is nought while «Voluntarii» is unticked: the group's answer comes first", () => {
    const groups = { RUNNER: true, ELITE: true, VOLUNTEER: false };
    const unticked = [{ kind: "VOLUNTEER" as const, reason: raffleParticipation({ kind: "VOLUNTEER", confirmed: true, hasNumber: false, inRaffle: true, signedUp: false }, { groups, signUp: false }) }];
    expect(unticked[0].reason).toBe("groupNotAllowed");
    expect(leftOutForNoNumber(unticked, "VOLUNTEER")).toBe(0);
  });
});

describe("§NNN the save that opens «Tombolă»: one that moved a raffle setting", () => {
  it("is any of the six settings moved, and never a save that wrote them as they were", () => {
    expect(raffleSettingsMoved(SETTINGS, { ...SETTINGS })).toBe(false);
    for (const column of ["hasRaffle", "raffleRunners", "raffleElites", "raffleVolunteers", "raffleSignUp", "raffleSignUpOpen"] as const) {
      expect(raffleSettingsMoved(SETTINGS, { ...SETTINGS, [column]: !SETTINGS[column] }), column).toBe(true);
    }
  });

  it("reads the raffle's columns alone: anything else on the row moving opens nothing", () => {
    // Whole rows, as the save hands them over: the other columns ride along and are never read.
    const before = { ...SETTINGS, capacity: 100, title: "Crosul" };
    const after = { ...before, capacity: 150, title: "Crosul Tâmpei" };
    expect(raffleSettingsMoved(before, after)).toBe(false);
  });
});

describe("§NNN the line, and the anchor its link opens", () => {
  it("draws the sentence and one link of the house's glyph buttons to where it is told", async () => {
    const markup = await html(createElement(RaffleNumberHint, { text: "2 voluntari confirmați nu au număr, deci nu intră la tombolă.", linkLabel: ro.Admin.raffle.volunteersWithoutNumberLink, href: `#${VOLUNTEER_NUMBERS_ANCHOR}`, testId: "hint" }));
    expect(markup).toContain('data-testid="hint"');
    expect(words(markup)).toContain("2 voluntari confirmați nu au număr, deci nu intră la tombolă.");
    expect(markup).toMatch(/<a\b[^>]*href="#box-volunteer-numbers"[^>]*data-testid="hint-link"|<a\b[^>]*data-testid="hint-link"[^>]*href="#box-volunteer-numbers"/);
    expect(words(markup)).toContain("Mergi la numerele voluntarilor");
    // An outlined warning, not a toast or a blocking error: the save is not refused, the raffle simply leaves them out.
    expect(markup).toMatch(/class="[^"]*MuiAlert-colorWarning[^"]*MuiAlert-outlined/);
    // Standing advice drawn with the page, never announced as news on arrival.
    expect(markup).toMatch(/<div\b[^>]*role="note"[^>]*data-testid="hint"/);
  });

  it("is the «Voluntari» card's numbers form: `#box-volunteer-numbers`, where «Salvează numerele» is", async () => {
    expect(VOLUNTEER_NUMBERS_ANCHOR).toBe("box-volunteer-numbers");
    const role: VolunteerRole = {
      id: "22222222-2222-4222-8222-222222222222",
      eventId: "11111111-1111-4111-8111-111111111111",
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
    locale = "ro";
    const drawn = (await VolunteersCard({
      locale: "ro",
      eventId: role.eventId,
      acceptsVolunteers: true,
      volunteersShirts: false,
      volunteersShowCounts: false,
      eventDay: "2026-11-21",
      profileDescribed: true,
      minorsOpen: false,
      offerClosed: null,
      roles: [role],
      categories: [],
      standings: [{ roleId: role.id, needed: 3, taken: 0, confirmed: 0, free: 3 }],
      volunteers: [],
      agreementInForce: true,
      agreementNoticeDescribes: true,
      agreementDocumentIds: {},
      agreementEvent: {},
      now: new Date("2026-10-19T10:00:00Z"),
    })) as ReactElement;
    const { NextIntlClientProvider } = await import("next-intl");
    const intl = { locale: "ro", messages: { Translate: ro.Translate, Admin: ro.Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
    const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
    const markup = await html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer: { action: translate, setupHref: null } } as ComponentProps<typeof TranslateProvider>, drawn)));
    // The one element with that id is the numbers form itself, holding the start's box and its own «Salvează numerele».
    expect(markup.split(`id="${VOLUNTEER_NUMBERS_ANCHOR}"`)).toHaveLength(2);
    const form = /<form\b[^>]*id="box-volunteer-numbers"[^>]*>[\s\S]*?<\/form>/.exec(markup)?.[0] ?? "";
    expect(form).toContain('data-testid="volunteer-numbers-form"');
    expect(form).toContain('name="start"');
    expect(words(form)).toContain(ro.Admin.volunteers.numbers.save);
    // Inside the card the editor opens by its own anchor (`#box-volunteers`): `OpenFoldFromHash` opens it around the form.
    expect(markup.indexOf('id="box-volunteers"')).toBeLessThan(markup.indexOf(`id="${VOLUNTEER_NUMBERS_ANCHOR}"`));
  });
});
