import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";

/**
 * §421, finding (5) of the fix round on `feat/registration-consent-and-terms`: this branch's
 * `DEADLINE_MERGE_FIELDS` is the single source for `{{publicListPeriod}}`, fed from "Termene"
 * (`deadlineMergeValues`). The texts chain's second registration of the same field, with a
 * constant default spread after this one, was removed when the two branches met; a second
 * registration would silently win and put back the constant. This proves the page a reader actually sees follows the club's
 * *setting*, not a default, end to end: the merge the privacy page performs, not only the merge
 * function in isolation (`tests/unit/deadlines/duration-words.test.ts` already covers that).
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string | { namespace: string }) => {
    const ns = typeof namespace === "string" ? namespace : namespace.namespace;
    const messages = (ro as Record<string, object>)[ns] as Record<string, string>;
    return createTranslator({ locale: "ro", messages, namespace: undefined });
  },
  setRequestLocale: () => {},
}));

vi.mock("@/modules/resilience/last-good", () => ({
  readWithLastGood: async (_key: string, read: () => Promise<unknown>) => ({ value: await read(), state: "live" }),
}));
vi.mock("@/modules/resilience/ui/LastGoodNotice", () => ({ default: () => null }));

// The default is 30 (`DEFAULT_DEADLINES.publicListDays`). 45 rather than a multiple of 7, so
// `daysPhrase` does not fold it into weeks and the assertion stays a plain "45 de zile".
const NON_DEFAULT_PUBLIC_LIST_DAYS = 45;

vi.mock("@/modules/public-cache/reads", () => ({
  cachedCurrentApprovedDocument: async () => ({
    title: "Nota de confidențialitate",
    version: 3,
    effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
    body: {
      sections: [{ heading: "4. Lista publică", paragraphs: ["Lista publică rămâne activă cel mult {{publicListPeriod}} după eveniment."] }],
    },
  }),
  cachedDeadlines: async () => ({
    confirmationHours: 48,
    holdMinutes: 30,
    offerHours: 24,
    reminderHours: 48,
    selfCheckinHours: 24,
    raceWeekDays: 7,
    seriesHorizonDays: 56,
    publicListDays: NON_DEFAULT_PUBLIC_LIST_DAYS,
  }),
}));

const { default: PrivacyNoticePage } = await import("@/app/[locale]/legal/privacy/page");

describe("the privacy page's merged value follows a non-default publicListDays", () => {
  it("prints the club's own setting (45 de zile), never the default (30 de zile)", async () => {
    const html = renderToStaticMarkup(await PrivacyNoticePage({ params: Promise.resolve({ locale: "ro" }) }));
    expect(html).toContain("cel mult 45 de zile după eveniment");
    expect(html).not.toContain("cel mult 30 de zile după eveniment");
    // The field name itself must never leak into the rendered text.
    expect(html).not.toContain("{{publicListPeriod}}");
  });
});
