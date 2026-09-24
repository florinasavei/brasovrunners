import { createTranslator, IntlErrorCode } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { missingMessagesAreLoud, onIntlError } from "@/i18n/errors";

/**
 * A missing message is loud where somebody can still catch it (§NNN, `src/i18n/errors.ts`).
 *
 * The client providers carry only the keys their islands read now, so "a key left out of the
 * list" is a failure that can exist; the end-to-end suite runs a production build with
 * `APP_ENV=local`, and there it must break the page rather than print "Site.nav.more" where a
 * word should be. On QA and production, next-intl's own quiet fallback stays.
 */
describe("§NNN a missing message", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is loud locally and in tests, and quiet on QA and production", () => {
    expect(missingMessagesAreLoud("local")).toBe(true);
    expect(missingMessagesAreLoud("test")).toBe(true);
    expect(missingMessagesAreLoud("qa")).toBe(false);
    expect(missingMessagesAreLoud("production")).toBe(false);
  });

  it("throws where it is loud — a missing key, and a namespace asked for as a sentence", () => {
    const t = createTranslator({ locale: "ro", messages: { Site: { name: "Brașov Runners" } }, onError: onIntlError(true) });
    expect(t("Site.name")).toBe("Brașov Runners");
    expect(() => t("Site.missing" as never)).toThrow(expect.objectContaining({ code: IntlErrorCode.MISSING_MESSAGE }));
    expect(() => t("Site" as never)).toThrow(expect.objectContaining({ code: IntlErrorCode.INSUFFICIENT_PATH }));
    const inMissingNamespace = createTranslator({
      locale: "ro",
      messages: { Site: { name: "Brașov Runners" } },
      namespace: "Admin" as never,
      onError: onIntlError(true),
    });
    expect(() => inMissingNamespace("pickers.dateTyped" as never)).toThrow();
  });

  it("falls back to the key and logs, as next-intl always did, where it is quiet", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = createTranslator({ locale: "ro", messages: { Site: { name: "Brașov Runners" } }, onError: onIntlError(false) });
    expect(t("Site.missing" as never)).toBe("Site.missing");
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("only logs, even where it is loud, an error that is not about missing words", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = createTranslator({ locale: "ro", messages: { Site: { broken: "{unclosed" } }, onError: onIntlError(true) });
    expect(() => t("Site.broken")).not.toThrow();
    expect(logged).toHaveBeenCalled();
  });
});
