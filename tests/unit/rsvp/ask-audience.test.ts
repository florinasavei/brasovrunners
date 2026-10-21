import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  asksAnswerers,
  asksSubscribers,
  DEFAULT_RSVP_ASK_AUDIENCE,
  mergeAskRecipients,
  reachedAudience,
  readRsvpAskAudience,
  RSVP_ASK_AUDIENCES,
  rsvpAskAudienceSchema,
} from "@/modules/rsvp/domain/ask-audience";
import { emailCopyKey } from "@/modules/notifications/domain/email-copy";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";

/**
 * §823 (amends §818) — WHO the day-before question is asked of: the audience's three answers and its arithmetic (pure), the card in «Emailuri»
 * that sets it (three radios, the gate in words while the earlier answerers are chosen), and the email's refusal link, an earlier answerer's alone.
 * The queue and the send are proved on a database in `tests/integration/rsvp/ask-settings.test.ts`.
 */
describe("§823 the «Vii?» audience, pure", () => {
  it("is the subscribers alone by default — the answerers need the club's choice and the notice — and reads anything else it cannot read as that", () => {
    expect(DEFAULT_RSVP_ASK_AUDIENCE).toBe("SUBSCRIBERS");
    expect(RSVP_ASK_AUDIENCES).toEqual(["SUBSCRIBERS", "ANSWERERS", "BOTH"]);
    expect(readRsvpAskAudience(undefined)).toBe("SUBSCRIBERS");
    expect(readRsvpAskAudience({ audience: "EVERYONE" })).toBe("SUBSCRIBERS");
    expect(readRsvpAskAudience({ audience: "BOTH", extra: 1 })).toBe("SUBSCRIBERS");
    expect(readRsvpAskAudience({ audience: "ANSWERERS" })).toBe("ANSWERERS");
    expect(rsvpAskAudienceSchema.safeParse({ audience: "NOBODY" }).success).toBe(false);
  });

  it("says which list each answer asks", () => {
    expect([asksSubscribers("SUBSCRIBERS"), asksAnswerers("SUBSCRIBERS")]).toEqual([true, false]);
    expect([asksSubscribers("ANSWERERS"), asksAnswerers("ANSWERERS")]).toEqual([false, true]);
    expect([asksSubscribers("BOTH"), asksAnswerers("BOTH")]).toEqual([true, true]);
  });

  it("cuts the club's choice by the notice in force, as the queue does: nobody while the notice is silent, the subscribers alone when only the answerers' use is unnamed", () => {
    // The notice describes no «Vii?» email: nobody is asked, whatever the club chose.
    for (const audience of RSVP_ASK_AUDIENCES) expect(reachedAudience(audience, false, true)).toBeNull();
    // The notice names the email but not the answerers' use.
    expect(reachedAudience("SUBSCRIBERS", true, false)).toBe("SUBSCRIBERS");
    expect(reachedAudience("ANSWERERS", true, false)).toBeNull();
    expect(reachedAudience("BOTH", true, false)).toBe("SUBSCRIBERS");
    // The notice names both: the choice stands.
    for (const audience of RSVP_ASK_AUDIENCES) expect(reachedAudience(audience, true, true)).toBe(audience);
  });

  describe("the union", () => {
    const subscribers = [{ canonicalEmail: "ion@x.test" }, { canonicalEmail: "both@x.test" }, { canonicalEmail: "refused@x.test" }];
    const answerers = [{ canonicalEmail: "ana@x.test" }, { canonicalEmail: "both@x.test" }, { canonicalEmail: "ana@x.test" }, { canonicalEmail: "done@x.test" }, { canonicalEmail: "refused@x.test" }];
    const refused = new Set(["refused@x.test"]);
    const answered = new Set(["done@x.test"]);
    const merge = (audience: (typeof RSVP_ASK_AUDIENCES)[number]) => {
      const out = mergeAskRecipients({ audience, subscribers, answerers, refused, answered });
      return { subscribers: out.subscribers.map((row) => row.canonicalEmail), answerers: out.answerers.map((row) => row.canonicalEmail) };
    };

    it("asks the subscribers alone, less the refusals", () => {
      expect(merge("SUBSCRIBERS")).toEqual({ subscribers: ["ion@x.test", "both@x.test"], answerers: [] });
    });

    it("asks the answerers alone, once each, less those who refused and those who already answered this date", () => {
      expect(merge("ANSWERERS")).toEqual({ subscribers: [], answerers: ["ana@x.test", "both@x.test"] });
    });

    it("asks both, one email per person: someone on both lists is a subscriber; a refusal holds for both lists", () => {
      expect(merge("BOTH")).toEqual({ subscribers: ["ion@x.test", "both@x.test"], answerers: ["ana@x.test"] });
    });

    it("asks nobody when both lists are empty, and keeps the order given", () => {
      expect(mergeAskRecipients({ audience: "BOTH", subscribers: [], answerers: [], refused, answered })).toEqual({ subscribers: [], answerers: [] });
      expect(merge("BOTH").subscribers).toEqual(["ion@x.test", "both@x.test"]);
    });
  });
});

const lang = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));
// The dialogs' road line (§NNN) reads the club's roads once per request: no database here.
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const all = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: lang.current, messages: all[lang.current], namespace: namespace as "Admin" }),
    getLocale: async () => lang.current,
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, children }: { href: string; children: unknown }) => h("a", { href: typeof href === "string" ? href : "/" }, children as string), getPathname: () => "/" };
});
vi.mock("@/app/[locale]/admin/settings/emails/actions", () => ({ updateRsvpAskAudienceAction: async () => null }));

const { default: RsvpAskAudiencePanel } = await import("@/modules/notifications/ui/RsvpAskAudiencePanel");

async function panel(audience: (typeof RSVP_ASK_AUDIENCES)[number], options: { described?: boolean; mayEdit?: boolean; locale?: "ro" | "en" } = {}): Promise<string> {
  const locale = options.locale ?? "ro";
  lang.current = locale;
  const { NextIntlClientProvider } = await import("next-intl");
  const element = (await RsvpAskAudiencePanel({
    locale,
    state: { audience, updatedAt: null },
    answerersDescribed: options.described ?? false,
    mayEdit: options.mayEdit ?? true,
  })) as ReactElement;
  const messages = locale === "ro" ? ro : en;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale, messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

const radios = (markup: string) => [...markup.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map((match) => match[0]);

describe("§823 the card «Cui îi trimitem întrebarea „Vii?”» in «Emailuri»", () => {
  it("draws three radios named audience — a choice, never a toggle — with the one in force checked, a closed fold with a glyph", async () => {
    const markup = await panel("SUBSCRIBERS");
    const inputs = radios(markup);
    expect(inputs).toHaveLength(3);
    for (const input of inputs) expect(input).toContain('name="audience"');
    expect(inputs.map((input) => /value="([A-Z]+)"/.exec(input)?.[1])).toEqual(["SUBSCRIBERS", "ANSWERERS", "BOTH"]);
    expect(inputs.map((input) => /\schecked(=|\s|\/|>)/.test(input))).toEqual([true, false, false]);
    const open = markup.indexOf('data-testid="rsvp-ask-audience"');
    const details = markup.slice(markup.lastIndexOf("<details", open), open + 40);
    expect(details).not.toMatch(/\sopen(=|\s|>)/);
    expect(markup).toMatch(/<summary[\s\S]*?<svg[^>]*aria-hidden="true"[\s\S]*?<\/summary>/);
    expect(markup).toContain(ro.Admin.emails.rsvpAskAudience.option.ANSWERERS);
    expect(markup).not.toMatch(/<button[^>]*aria-pressed/);
  });

  it("checks the choice in force, whichever it is, and says it in the closed line", async () => {
    for (const audience of RSVP_ASK_AUDIENCES) {
      const markup = await panel(audience);
      expect(radios(markup).map((input) => /\schecked(=|\s|\/|>)/.test(input))).toEqual(RSVP_ASK_AUDIENCES.map((choice) => choice === audience));
      expect(markup).toContain(ro.Admin.emails.rsvpAskAudience.aside[audience]);
    }
  });

  it("says nothing about the notice while the subscribers alone are asked, and gates the answerers in words while the notice is silent", async () => {
    expect(await panel("SUBSCRIBERS")).not.toContain('data-testid="rsvp-ask-answerers-gate"');
    for (const audience of ["ANSWERERS", "BOTH"] as const) {
      const silent = await panel(audience, { described: false });
      expect(silent).toContain('data-testid="rsvp-ask-answerers-silent"');
      expect(silent).toContain(ro.Admin.emails.rsvpAskAudience.noticeOpen);
      // The sentence is chosen by the audience: «subscribers are asked as before» is false when only the earlier answerers were chosen.
      expect(silent).toContain(ro.Admin.emails.rsvpAskAudience.noticeSilent[audience]);
      if (audience === "ANSWERERS") expect(silent).not.toContain("abonații sunt întrebați ca până acum");
      expect(silent).toContain('href="/admin/legal"');
      const described = await panel(audience, { described: true });
      expect(described).toContain(ro.Admin.emails.rsvpAskAudience.noticeDone);
      expect(described).not.toContain('data-testid="rsvp-ask-answerers-silent"');
    }
  });

  it("gives a reader who may not change it the words and no form, and says it in English too", async () => {
    const reader = await panel("ANSWERERS", { mayEdit: false });
    expect(reader).not.toContain("<form");
    expect(radios(reader)).toHaveLength(0);
    expect(reader).toContain(ro.Admin.emails.rsvpAskAudience.readOnly);
    const english = await panel("BOTH", { locale: "en", described: true });
    expect(english).toContain(en.Admin.emails.rsvpAskAudience.option.BOTH);
    expect(english).toContain(en.Admin.emails.rsvpAskAudience.noticeDone);
    expect(radios(english)).toHaveLength(3);
  });

  it("keeps both catalogues in step for every choice", () => {
    for (const messages of [ro, en]) {
      const words = messages.Admin.emails.rsvpAskAudience;
      for (const choice of RSVP_ASK_AUDIENCES) {
        expect(words.option[choice], choice).toBeTruthy();
        expect(words.help[choice], choice).toBeTruthy();
        expect(words.aside[choice], choice).toBeTruthy();
        expect(words.inForce[choice], choice).toBeTruthy();
        expect(messages.Admin.emails.rsvpAskWho.long[choice], choice).toBeTruthy();
        expect(messages.Admin.emails.rsvpAskWho.short[choice], choice).toBeTruthy();
      }
    }
  });
});

describe("§823 the question's email: the refusal link is an earlier answerer's alone", () => {
  const data = (extra: Partial<TemplateData> = {}): TemplateData =>
    ({
      eventTitle: "Alergarea de duminică",
      eventUrl: "https://example.test/ro/evenimente/alergare",
      rsvpWithdrawUrl: "https://example.test/ro/vin/withdraw-token",
      newsletterManageUrl: "https://example.test/ro/newsletter/manage",
      rsvpAskDay: "peste 3 zile",
      ...extra,
    }) as TemplateData;
  const build = (locale: "ro" | "en", extra: Partial<TemplateData> = {}) =>
    buildOutgoingEmail({ to: "ana@example.test", locale, idempotencyKey: "rsvp-ask:test", messageType: "RSVP_ASK", data: data(extra), actionUrl: "https://example.test/ro/vin/confirm-token" });

  it("carries «Nu mă mai întreba la seria aceasta» with its link, and the reason it came, for an earlier answerer", () => {
    const message = build("ro", { rsvpAskAnswerer: true, rsvpRefuseUrl: "https://example.test/ro/vin/refuse-token" });
    expect(message.text).toContain("Nu mă mai întreba la seria aceasta");
    expect(message.text).toContain("https://example.test/ro/vin/refuse-token");
    expect(message.text).toContain("ai răspuns „Vin!” la un eveniment anterior din aceeași serie");
    expect(message.html).toContain("https://example.test/ro/vin/refuse-token");
    expect(message.subject).toContain("Vii peste 3 zile la Alergarea de duminică?");
    const english = build("en", { rsvpAskAnswerer: true, rsvpRefuseUrl: "https://example.test/en/vin/refuse-token", rsvpAskDay: "in 3 days" });
    expect(english.text).toContain("Don't ask me again for this series");
    expect(english.text).toContain("https://example.test/en/vin/refuse-token");
  });

  it("leaves it out of a subscriber's question — and out of an answerer's when no link was minted — and never says it without the link", () => {
    for (const message of [build("ro"), build("ro", { rsvpAskAnswerer: true }), build("ro", { rsvpRefuseUrl: "https://example.test/ro/vin/refuse-token" })]) {
      expect(message.text).not.toContain("Nu mă mai întreba la seria aceasta");
      expect(message.text).not.toContain("refuse-token");
      expect(message.text).not.toContain("ai răspuns „Vin!” la un eveniment anterior");
    }
    // The subscriber's way out is the topics page, as before.
    expect(build("ro").text).toContain("https://example.test/ro/newsletter/manage");
  });

  it("fills the club's own words with the day in each half's language: {rsvpAskDay} is a field, so a saved text never freezes «mâine»", () => {
    const overrides = {
      [emailCopyKey("RSVP_ASK", "ro")]: { subject: "Vii {rsvpAskDay} la {eventTitle}?", paragraphs: ["Ne vedem {rsvpAskDay}? Apasă „Vin”."] },
      [emailCopyKey("RSVP_ASK", "en")]: { subject: "Coming {rsvpAskDay} to {eventTitle}?", paragraphs: ["See you {rsvpAskDay}? Press “I'm coming”."] },
    };
    const message = buildOutgoingEmail({
      to: "ana@example.test",
      locale: "ro",
      idempotencyKey: "k",
      messageType: "RSVP_ASK",
      data: data({ rsvpAskDayOther: "in 3 days" }),
      actionUrl: "https://example.test/ro/vin/confirm-token",
      overrides,
    });
    expect(message.subject).toContain("Vii peste 3 zile la Alergarea de duminică?");
    expect(message.subject).toContain("Coming in 3 days to");
    expect(message.text).toContain("Ne vedem peste 3 zile?");
    expect(message.text).toContain("See you in 3 days?");
    expect(message.text).not.toContain("mâine");
  });

  it("says «mâine» when the day is not given, as the question always did", () => {
    const message = buildOutgoingEmail({ to: "ana@example.test", locale: "ro", idempotencyKey: "k", messageType: "RSVP_ASK", data: { ...data(), rsvpAskDay: undefined } as TemplateData });
    expect(message.subject).toContain("Vii mâine la Alergarea de duminică?");
  });
});
