import { describe, expect, it, vi } from "vitest";
import { TranslatorError } from "@/infrastructure/translate/adapter";
import { readDeeplUsage } from "@/infrastructure/translate/deepl-adapter";
import { readTranslationUsageForEnvironment } from "@/infrastructure/translate/translator";
import { CREDIT_LOW_SHARE, CREDIT_WATCH_SHARE, creditAllows, creditIsSpent, translationCredit } from "@/modules/translate/domain/credit";

const cache = vi.hoisted(() => ({ revalidated: [] as string[], keys: [] as string[][] }));
vi.mock("next/cache", () => ({
  // The data cache is Next's; here every read goes to the reader, which is what is under test.
  unstable_cache: (load: () => Promise<unknown>, keys: string[]) => {
    cache.keys.push(keys);
    return load;
  },
  revalidateTag: (tag: string) => {
    cache.revalidated.push(tag);
  },
}));

const { FAILURE_MEMO_MS, creditCacheKey, forgetTranslationCredit, readTranslationCredit } = await import("@/modules/translate/credit");

/**
 * §NNN — the DeepL credit read from DeepL's own meter (`GET /v2/usage`) as the one-time credit it
 * is: used, left, and four levels (ok, watch at 80 %, low at 95 %, spent), against a fake `fetch`
 * so no request leaves a test.
 */

type Call = { url: string; init: RequestInit };

function fakeFetch(answer: () => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  };
  return { calls, fetchImpl };
}

const usage = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

describe("§NNN the credit's levels", () => {
  it("is ok under 80 %, watch from 80 %, low from 95 %, spent at nothing left", () => {
    expect(CREDIT_WATCH_SHARE).toBe(0.8);
    expect(CREDIT_LOW_SHARE).toBe(0.95);
    expect(translationCredit({ used: 0, limit: 1_000_000 })).toEqual({ used: 0, limit: 1_000_000, remaining: 1_000_000, share: 0, level: "ok" });
    expect(translationCredit({ used: 799_999, limit: 1_000_000 }).level).toBe("ok");
    expect(translationCredit({ used: 800_000, limit: 1_000_000 }).level).toBe("watch");
    expect(translationCredit({ used: 949_999, limit: 1_000_000 }).level).toBe("watch");
    expect(translationCredit({ used: 950_000, limit: 1_000_000 }).level).toBe("low");
    expect(translationCredit({ used: 1_000_000, limit: 1_000_000 })).toMatchObject({ remaining: 0, share: 1, level: "spent" });
    // DeepL may count past its limit; and a key with no allowance at all translates nothing.
    expect(translationCredit({ used: 1_000_050, limit: 1_000_000 })).toMatchObject({ remaining: 0, share: 1, level: "spent" });
    expect(translationCredit({ used: 0, limit: 0 })).toMatchObject({ remaining: 0, share: 1, level: "spent" });
  });

  it("lets a press through only while it fits what is left", () => {
    const credit = translationCredit({ used: 999_990, limit: 1_000_000 });
    expect(creditAllows(credit, 10)).toBe(true);
    expect(creditAllows(credit, 11)).toBe(false);
    expect(creditAllows(translationCredit({ used: 5, limit: 5 }), 0)).toBe(false);
  });

  it("is spent at 100 % on the meter, or when the usage read itself answered 456", () => {
    const at = (used: number) => ({ ok: true as const, credit: translationCredit({ used, limit: 1_000_000 }) });
    expect(creditIsSpent(at(1_000_000))).toBe(true);
    expect(creditIsSpent({ ok: false, reason: "quota" })).toBe(true);
    expect(creditIsSpent(at(999_999))).toBe(false);
    for (const reason of ["unconfigured", "refused", "unavailable"]) expect(creditIsSpent({ ok: false, reason })).toBe(false);
  });
});

describe("§NNN DeepL's usage endpoint", () => {
  it("asks GET /v2/usage on the key's own host, with the key in the header, and reads the two counts", async () => {
    const { calls, fetchImpl } = fakeFetch(usage({ character_count: 1234, character_limit: 1_000_000 }));
    expect(await readDeeplUsage({ apiKey: "abc:fx", fetchImpl })).toEqual({ used: 1234, limit: 1_000_000 });
    expect(calls[0]?.url).toBe("https://api-free.deepl.com/v2/usage");
    expect(calls[0]?.init.method).toBe("GET");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("DeepL-Auth-Key abc:fx");

    const pro = fakeFetch(usage({ character_count: 0, character_limit: 1_000_000, start_time: "2026-09-27T00:00:00Z" }));
    expect(await readDeeplUsage({ apiKey: "abc", fetchImpl: pro.fetchImpl })).toEqual({ used: 0, limit: 1_000_000 });
    expect(pro.calls[0]?.url).toBe("https://api.deepl.com/v2/usage");
  });

  it("turns DeepL's refusals and a malformed answer into the three failures", async () => {
    const failure = async (answer: () => Response) => {
      try {
        await readDeeplUsage({ apiKey: "abc", fetchImpl: fakeFetch(answer).fetchImpl });
        return "none";
      } catch (error) {
        return (error as TranslatorError).failure;
      }
    };
    expect(await failure(usage({}, 403))).toBe("refused");
    expect(await failure(usage({}, 456))).toBe("quota");
    expect(await failure(usage({}, 500))).toBe("unavailable");
    expect(await failure(usage({ character_count: "12", character_limit: 100 }))).toBe("unavailable");
    expect(await failure(() => new Response("not json", { status: 200 }))).toBe("unavailable");
    const unreachable = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(readDeeplUsage({ apiKey: "abc", fetchImpl: unreachable })).rejects.toMatchObject({ failure: "unavailable" });
  });

  it("asks nothing without a configured translator", async () => {
    const { calls, fetchImpl } = fakeFetch(usage({ character_count: 0, character_limit: 1 }));
    expect(await readTranslationUsageForEnvironment({ TRANSLATE_PROVIDER: "off", DEEPL_API_KEY: "abc" }, fetchImpl)).toBeNull();
    expect(await readTranslationUsageForEnvironment({ TRANSLATE_PROVIDER: "deepl" }, fetchImpl)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("§NNN the credit reading the pages share", () => {
  const configured = { TRANSLATE_PROVIDER: "deepl" as const, DEEPL_API_KEY: "abc" };

  it("reads the credit through the reader, and says `unconfigured` without asking when there is no key", async () => {
    const read = vi.fn(async () => ({ used: 960_000, limit: 1_000_000 }));
    expect(await readTranslationCredit(configured, read)).toEqual({
      ok: true,
      credit: { used: 960_000, limit: 1_000_000, remaining: 40_000, share: 0.96, level: "low" },
    });
    const never = vi.fn(async () => ({ used: 0, limit: 1 }));
    expect(await readTranslationCredit({ TRANSLATE_PROVIDER: "deepl" }, never)).toEqual({ ok: false, reason: "unconfigured" });
    expect(await readTranslationCredit({ TRANSLATE_PROVIDER: "off", DEEPL_API_KEY: "abc" }, never)).toEqual({ ok: false, reason: "unconfigured" });
    expect(never).not.toHaveBeenCalled();
  });

  it("carries the provider's refusal as the reason, and anything else as `unavailable`", async () => {
    const refusing = async () => {
      throw new TranslatorError("refused", "403");
    };
    expect(await readTranslationCredit(configured, refusing)).toEqual({ ok: false, reason: "refused" });
    forgetTranslationCredit();
    const broken = async () => {
      throw new Error("boom");
    };
    expect(await readTranslationCredit(configured, broken)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("remembers a failure for a minute, so an unreachable DeepL does not hold every page", async () => {
    forgetTranslationCredit();
    let clock = 1_000_000;
    const now = () => clock;
    const slow = vi.fn(async () => {
      throw new TranslatorError("unavailable", "timeout");
    });
    expect(await readTranslationCredit(configured, slow, now)).toEqual({ ok: false, reason: "unavailable" });
    clock += FAILURE_MEMO_MS - 1;
    expect(await readTranslationCredit(configured, slow, now)).toEqual({ ok: false, reason: "unavailable" });
    expect(slow).toHaveBeenCalledTimes(1);
    // After the minute, or after a press that reached DeepL, it asks again.
    clock += 1;
    const fine = vi.fn(async () => ({ used: 10, limit: 1_000_000 }));
    expect((await readTranslationCredit(configured, fine, now)).ok).toBe(true);
    expect(fine).toHaveBeenCalledTimes(1);
    await readTranslationCredit(configured, slow, now);
    forgetTranslationCredit();
    expect((await readTranslationCredit(configured, fine, now)).ok).toBe(true);
  });

  it("keys the cached figure by the host kind and a short fingerprint of the key, never the key", async () => {
    forgetTranslationCredit();
    cache.keys.length = 0;
    const secret = "not-a-real-key-secret:fx";
    await readTranslationCredit({ TRANSLATE_PROVIDER: "deepl", DEEPL_API_KEY: secret }, async () => ({ used: 1, limit: 10 }));
    const key = cache.keys.at(-1) ?? [];
    expect(key.join("|")).not.toContain(secret);
    expect(key.join("|")).not.toContain("secret");
    expect(creditCacheKey(secret)).toMatch(/^free-[0-9a-f]{8}$/);
    expect(creditCacheKey("abc")).toMatch(/^pro-[0-9a-f]{8}$/);
    expect(key).toContain(creditCacheKey(secret));
    // A replaced key of the same kind reads its own credit, not the old key's cached one.
    expect(creditCacheKey("another-key:fx")).not.toBe(creditCacheKey(secret));
    expect(creditCacheKey(` ${secret} `)).toBe(creditCacheKey(secret));
  });

  it("expires the cached figure after a press", () => {
    cache.revalidated.length = 0;
    forgetTranslationCredit();
    expect(cache.revalidated).toEqual(["br-translation-credit"]);
  });
});
