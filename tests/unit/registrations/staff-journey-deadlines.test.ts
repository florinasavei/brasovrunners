import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { journeyOf, type JourneyInput } from "@/modules/registrations/domain/journey";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — every row of «Cine s-a înscris» says, after its step, the deadline its state waits on: a held
 * place «ține locul până …», or past it the kept words (§160); an open offer; the first email's link;
 * a family's reservation (§543). The cell keeps its hover title; the registration's page says the same
 * in the full journey. `next-intl/server` is the real translator over the real catalogues.
 */
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => locale,
}));

const { default: StaffJourney } = await import("@/modules/registrations/ui/StaffJourney");

const NOW = new Date("2026-10-02T09:00:00.000Z");
const SUBMITTED = new Date("2026-10-01T16:00:00.000Z");
const VERIFIED = new Date("2026-10-01T16:10:00.000Z");
const DUE = new Date("2026-11-19T08:00:00.000Z");
const PAST = new Date("2026-10-01T18:00:00.000Z");
const LINK = new Date("2026-10-03T16:42:00.000Z");
const RESERVED = new Date("2026-10-02T09:25:00.000Z");

function row(overrides: Partial<JourneyInput>): JourneyInput {
  return {
    status: "PENDING_EMAIL_CONFIRMATION",
    submittedAt: SUBMITTED,
    cycleStartedAt: SUBMITTED,
    emailVerifiedAt: null,
    emailConfirmedAt: null,
    waitlistedAt: null,
    offerCreatedAt: null,
    holdExpiresAt: null,
    emailLinkExpiresAt: null,
    declarationAcceptedAt: null,
    confirmedAt: null,
    bibNumber: null,
    checkedInAt: null,
    cancelledAt: null,
    expiredAt: null,
    expiryReason: null,
    ...overrides,
  };
}

async function cell(input: JourneyInput, variant: "compact" | "full" = "compact"): Promise<string> {
  const html = renderToStaticMarkup(await StaffJourney({ journey: journeyOf(input), bibNumber: null, variant }));
  // The text a person reads: Emotion's style blocks and the tags gone, entities back.
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}

const day = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  locale = "ro";
});
afterEach(() => vi.useRealTimers());

describe("§NNN the list's step cell names the deadline the row waits on", () => {
  it("a held place, before its deadline: «ține locul până …»", async () => {
    const text = await cell(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: DUE }));
    expect(text).toBe(`3/6 · Loc rezervat · ține locul până ${day(DUE)}`);
  });

  it("a held place past its deadline: kept while nobody asks for it (§160)", async () => {
    const text = await cell(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: PAST }));
    expect(text).toBe("3/6 · Loc rezervat · termen depășit, locul se ține cât nu-l cere nimeni");
  });

  it("an open offer", async () => {
    const text = await cell(row({ status: "WAITLIST_OFFERED", emailVerifiedAt: VERIFIED, waitlistedAt: VERIFIED, offerCreatedAt: SUBMITTED, holdExpiresAt: DUE }));
    expect(text).toBe(`3/6 · Loc rezervat · loc oferit, până ${day(DUE)}`);
  });

  it("an address not confirmed yet: when its link lapses, and that it has", async () => {
    expect(await cell(row({ emailLinkExpiresAt: LINK }))).toBe(`1/6 · Înscriere trimisă · linkul expiră ${day(LINK)}`);
    expect(await cell(row({ emailLinkExpiresAt: PAST }))).toBe("1/6 · Înscriere trimisă · linkul a expirat");
    // A row written before the column (§377): nothing to say rather than a wrong date.
    expect(await cell(row({}))).toBe("1/6 · Înscriere trimisă");
  });

  it("a family's reservation: the place is reserved until its deadline, then the link again (§543)", async () => {
    expect(await cell(row({ emailLinkExpiresAt: LINK, holdExpiresAt: RESERVED }))).toBe(`1/6 · Înscriere trimisă · loc rezervat până ${day(RESERVED)}`);
    expect(await cell(row({ emailLinkExpiresAt: LINK, holdExpiresAt: PAST }))).toBe(`1/6 · Înscriere trimisă · linkul expiră ${day(LINK)}`);
  });

  it("an ended row names no deadline, and the hover title stays", async () => {
    const expired = row({ status: "EXPIRED", emailVerifiedAt: VERIFIED, holdExpiresAt: PAST, expiredAt: NOW, expiryReason: "DECLARATION_HOLD_LAPSED" });
    expect(await cell(expired)).toBe("3/6 · Loc rezervat");
    const html = renderToStaticMarkup(await StaffJourney({ journey: journeyOf(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: DUE })), bibNumber: null, variant: "compact" }));
    expect(html).toContain('title="3 din 6 pași · urmează: Declarație semnată"');
  });

  it("in English", async () => {
    locale = "en";
    expect(await cell(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: DUE }))).toBe(`3/6 · Loc rezervat · holds the place until ${day(DUE)}`);
    expect(await cell(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: PAST }))).toBe(
      "3/6 · Loc rezervat · deadline passed, the place is kept while nobody asks for it",
    );
    expect(await cell(row({ emailLinkExpiresAt: LINK }))).toBe(`1/6 · Înscriere trimisă · the link expires ${day(LINK)}`);
  });

  it("the registration's page says the same in the full journey", async () => {
    const text = await cell(row({ emailLinkExpiresAt: LINK }), "full");
    expect(text).toContain(`linkul expiră ${day(LINK)}`);
    const held = await cell(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: DUE }), "full");
    expect(held).toContain(`ține locul până ${day(DUE)}`);
  });
});
