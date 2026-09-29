import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { matchesVersionNumber } from "@/modules/legal-documents/domain/confirmation";
import { type DeletionFacts, removalPlan } from "@/modules/legal-documents/domain/deletability";
import {
  nextRetireStep,
  reasonAcceptable,
  relianceKey,
  reliancePhrases,
  RETIRE_REASON_MAX,
} from "@/modules/legal-documents/domain/retire-steps";

/**
 * «Șterge» on a version somebody relied on (`DECISIONS.md` §567): the words of the counts, the two
 * steps, the typed number and which verb a version gets — pure, so without a database.
 */
type Say = (key: string, values: Record<string, string | number>) => string;
/** The catalogue's own translator, read by a key built at run time — as the pages do. */
const translator = (locale: "ro" | "en"): Say =>
  createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Admin" }) as unknown as Say;
const say = (locale: "ro" | "en") => (key: string, values: { count: number }) => translator(locale)(key, values);
const counts = (signatures: number, events: number, acknowledgements: number) => ({ signatures, events, acknowledgements });

describe("§567 the counts in words, without ICU plurals", () => {
  it("says «1 semnătură», never «1 semnături» — the screenshot of 2026-09-29", () => {
    expect(reliancePhrases(say("ro"), counts(1, 0, 0), "ro")).toEqual({
      signatures: "1 semnătură",
      events: "0 evenimente",
      acknowledgements: "0 înscrieri",
    });
  });

  it("takes each noun's three Romanian forms and the two English ones", () => {
    expect(reliancePhrases(say("ro"), counts(2, 1, 1), "ro")).toEqual({ signatures: "2 semnături", events: "1 eveniment", acknowledgements: "1 înscriere" });
    expect(reliancePhrases(say("ro"), counts(20, 21, 101), "ro")).toEqual({
      signatures: "20 de semnături",
      events: "21 de evenimente",
      acknowledgements: "101 înscrieri",
    });
    expect(reliancePhrases(say("en"), counts(1, 0, 2), "en")).toEqual({ signatures: "1 signature", events: "0 events", acknowledgements: "2 registrations" });
    expect(relianceKey("signatures", 0, "ro")).toBe("legal.counted.signatures.few");
  });

  it("builds the row's line and the refusal from the phrases, in both languages", () => {
    const tRo = translator("ro");
    const tEn = translator("en");
    const phrasesRo = reliancePhrases(say("ro"), counts(1, 0, 0), "ro");
    expect(tRo("legal.referencedFull", phrasesRo)).toBe("1 semnătură · 0 evenimente · 0 înscrieri");
    expect(tRo("legal.retireOffered", phrasesRo)).toMatch(/^Nu se poate retrage: 1 semnătură, 0 evenimente și 0 înscrieri depind de ea\./);
    expect(tRo("legal.retire.consequence", phrasesRo)).toMatch(/^1 semnătură, 0 evenimente și 0 înscrieri rămân valabile, iar textul rămâne în arhivă\./);
    expect(tEn("legal.referencedFull", reliancePhrases(say("en"), counts(1, 0, 0), "en"))).toBe("1 signature · 0 events · 0 registrations");
  });
});

describe("§567 the two steps", () => {
  it("goes to the number only with a reason of 3 to 200 characters", () => {
    expect(nextRetireStep("reason", { type: "continue", reason: "" })).toBe("reason");
    expect(nextRetireStep("reason", { type: "continue", reason: "  ok " })).toBe("reason");
    expect(nextRetireStep("reason", { type: "continue", reason: "a".repeat(RETIRE_REASON_MAX + 1) })).toBe("reason");
    expect(nextRetireStep("reason", { type: "continue", reason: "text înlocuit" })).toBe("number");
    expect(reasonAcceptable("a".repeat(RETIRE_REASON_MAX))).toBe(true);
  });

  it("goes back to the reason, and a refusal lands on the step whose box it named", () => {
    expect(nextRetireStep("number", { type: "back" })).toBe("reason");
    expect(nextRetireStep("number", { type: "refused", fields: ["reason"] })).toBe("reason");
    expect(nextRetireStep("reason", { type: "refused", fields: ["typedConfirmation"] })).toBe("number");
    expect(nextRetireStep("reason", { type: "refused", fields: [] })).toBe("number");
  });

  it("reads the typed number as the number only", () => {
    for (const typed of ["6", " 6 ", "v6", "V 6"]) expect(matchesVersionNumber(typed, 6), typed).toBe(true);
    for (const typed of ["", "7", "06", "GDPR 6", "6 6", "șase"]) expect(matchesVersionNumber(typed, 6), typed).toBe(false);
  });
});

describe("§567 which verb «Șterge» is", () => {
  const facts = (overrides: Partial<DeletionFacts>): DeletionFacts => ({
    isApproved: true,
    acceptanceCount: 0,
    eventCount: 0,
    privacyAcknowledgementCount: 0,
    inForce: false,
    terms: null,
    ...overrides,
  });

  it("deletes for real what nothing depends on, and retires what something does", () => {
    expect(removalPlan(facts({}))).toEqual({ kind: "delete" });
    expect(removalPlan(facts({ acceptanceCount: 1 }))).toEqual({
      kind: "retire",
      reliance: { signatures: 1, events: 0, acknowledgements: 0, termsRegistrations: 0 },
    });
    const window = { from: new Date("2026-09-04T08:00:00Z"), until: new Date("2026-09-06T10:00:00Z") };
    expect(removalPlan(facts({ terms: { window, registrations: 3 } }))).toEqual({
      kind: "retire",
      reliance: { signatures: 0, events: 0, acknowledgements: 0, termsRegistrations: 3 },
    });
  });

  it("refuses a draft, the version in force — signed or not — and one already deleted", () => {
    expect(removalPlan(facts({ isApproved: false }))).toEqual({ kind: "refused", reason: "draft" });
    expect(removalPlan(facts({ inForce: true }))).toEqual({ kind: "refused", reason: "inForce" });
    expect(removalPlan(facts({ inForce: true, acceptanceCount: 4 }))).toEqual({ kind: "refused", reason: "inForce" });
    expect(removalPlan(facts({ deleted: true, acceptanceCount: 1 }))).toEqual({ kind: "refused", reason: "alreadyDeleted" });
  });
});
