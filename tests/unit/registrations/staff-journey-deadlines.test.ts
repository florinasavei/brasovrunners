import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { journeyOf, type JourneyInput } from "@/modules/registrations/domain/journey";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §635 — the registration's page says, in its full journey, the deadline the row's state waits on: a held
 * place «ține locul până …», or past it the kept words (§160); an open offer; the first email's link;
 * a family's reservation (§543). Since §NNN the list says it in its own column, «Termen»
 * (`row-deadline.test.ts`), and the list's step cell says the step alone, with its hover title.
 * `next-intl/server` is the real translator over the real catalogues.
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

describe("§635, §NNN the list's step cell says the step; its deadline is the «Termen» column's", () => {
  it("a held place, before and past its deadline, an open offer: the step alone", async () => {
    expect(await cell(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: DUE }))).toBe("3/6 · Loc rezervat");
    expect(await cell(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: PAST }))).toBe("3/6 · Loc rezervat");
    expect(await cell(row({ status: "WAITLIST_OFFERED", emailVerifiedAt: VERIFIED, waitlistedAt: VERIFIED, offerCreatedAt: SUBMITTED, holdExpiresAt: DUE }))).toBe(
      "3/6 · Loc rezervat",
    );
  });

  it("an address not confirmed yet, a family's reservation: the step alone", async () => {
    expect(await cell(row({ emailLinkExpiresAt: LINK }))).toBe("1/6 · Înscriere trimisă");
    expect(await cell(row({ emailLinkExpiresAt: LINK, holdExpiresAt: RESERVED }))).toBe("1/6 · Înscriere trimisă");
  });

  it("the full journey still says the reservation and the link (§543)", async () => {
    expect(await cell(row({ emailLinkExpiresAt: LINK, holdExpiresAt: RESERVED }), "full")).toContain(`loc rezervat până ${day(RESERVED)}`);
    expect(await cell(row({ emailLinkExpiresAt: PAST }), "full")).toContain("linkul a expirat");
    expect(await cell(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: PAST }), "full")).toContain(
      "termen depășit, locul se ține cât nu-l cere nimeni",
    );
  });

  it("an ended row names no deadline, and the hover title stays", async () => {
    const expired = row({ status: "EXPIRED", emailVerifiedAt: VERIFIED, holdExpiresAt: PAST, expiredAt: NOW, expiryReason: "DECLARATION_HOLD_LAPSED" });
    expect(await cell(expired)).toBe("3/6 · Loc rezervat");
    const html = renderToStaticMarkup(await StaffJourney({ journey: journeyOf(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: DUE })), bibNumber: null, variant: "compact" }));
    expect(html).toContain('title="3 din 6 pași · urmează: Declarație semnată"');
  });

  it("in English, the full journey", async () => {
    locale = "en";
    expect(await cell(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: DUE }), "full")).toContain(`holds the place until ${day(DUE)}`);
    expect(await cell(row({ emailLinkExpiresAt: LINK }), "full")).toContain(`the link expires ${day(LINK)}`);
  });

  it("the registration's page says the same in the full journey", async () => {
    const text = await cell(row({ emailLinkExpiresAt: LINK }), "full");
    expect(text).toContain(`linkul expiră ${day(LINK)}`);
    const held = await cell(row({ status: "PENDING_DECLARATION", emailVerifiedAt: VERIFIED, holdExpiresAt: DUE }), "full");
    expect(held).toContain(`ține locul până ${day(DUE)}`);
  });
});
