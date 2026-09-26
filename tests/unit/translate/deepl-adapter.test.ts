import { describe, expect, it } from "vitest";
import { isTranslatorError } from "@/infrastructure/translate/adapter";
import { createDeeplTranslator, deeplBatches, deeplHostFor } from "@/infrastructure/translate/deepl-adapter";
import { createTranslatorForEnvironment, isTranslationConfigured } from "@/infrastructure/translate/translator";

/**
 * §NNN — the DeepL adapter, against a fake `fetch`: no request ever leaves a test. The host is the
 * free one for a free key, the key goes in the header DeepL requires, rich text asks for tag
 * handling, the glossary rides as `context`, long lists are cut into DeepL's 50-text requests, and
 * each of DeepL's refusals becomes the failure the screen words.
 */

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

function fakeFetch(answer: (body: Record<string, unknown>) => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, init, body });
    return answer(body);
  };
  return { calls, fetchImpl };
}

const echo = (body: Record<string, unknown>) =>
  new Response(JSON.stringify({ translations: (body.text as string[]).map((text) => ({ detected_source_language: "RO", text: `EN:${text}` })) }), {
    status: 200,
  });

describe("§NNN DeepL", () => {
  it("sends a free key to the free host and a paid key to the other", () => {
    expect(deeplHostFor("abc:fx")).toBe("https://api-free.deepl.com");
    expect(deeplHostFor("abc")).toBe("https://api.deepl.com");
  });

  it("asks for Romanian to British English, the key in the header, the glossary as context", async () => {
    const { calls, fetchImpl } = fakeFetch(echo);
    const translator = createDeeplTranslator({ apiKey: "test-key:fx", fetchImpl });
    const answer = await translator.translate({ from: "ro", to: "en", format: "html", texts: ["<b>Salut</b>", "lume"], context: "glosar" });
    expect(answer).toEqual(["EN:<b>Salut</b>", "EN:lume"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api-free.deepl.com/v2/translate");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("DeepL-Auth-Key test-key:fx");
    expect(calls[0]?.body).toMatchObject({ source_lang: "RO", target_lang: "EN-GB", tag_handling: "html", context: "glosar" });
  });

  it("does not ask for tag handling on plain words", async () => {
    const { calls, fetchImpl } = fakeFetch(echo);
    await createDeeplTranslator({ apiKey: "k:fx", fetchImpl }).translate({ from: "ro", to: "en", format: "text", texts: ["a < b"] });
    expect(calls[0]?.body.tag_handling).toBeUndefined();
  });

  it("cuts a long list into requests of at most fifty texts and keeps the order", async () => {
    const texts = Array.from({ length: 120 }, (_, index) => `t${index}`);
    expect(deeplBatches(texts).map((batch) => batch.length)).toEqual([50, 50, 20]);
    const { calls, fetchImpl } = fakeFetch(echo);
    const answer = await createDeeplTranslator({ apiKey: "k:fx", fetchImpl }).translate({ from: "ro", to: "en", format: "text", texts });
    expect(calls).toHaveLength(3);
    expect(answer).toEqual(texts.map((text) => `EN:${text}`));
  });

  it("words DeepL's refusals: 456 quota, 403 a wrong key, anything else unavailable", async () => {
    for (const [status, failure] of [
      [456, "quota"],
      [403, "refused"],
      [429, "unavailable"],
      [503, "unavailable"],
    ] as const) {
      const { fetchImpl } = fakeFetch(() => new Response("{}", { status }));
      const error = await createDeeplTranslator({ apiKey: "k:fx", fetchImpl })
        .translate({ from: "ro", to: "en", format: "text", texts: ["x"] })
        .catch((caught: unknown) => caught);
      expect(isTranslatorError(error) && error.failure, String(status)).toBe(failure);
    }
  });

  it("refuses an answer with a different number of texts rather than misplace one", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(JSON.stringify({ translations: [] }), { status: 200 }));
    const error = await createDeeplTranslator({ apiKey: "k:fx", fetchImpl })
      .translate({ from: "ro", to: "en", format: "text", texts: ["x"] })
      .catch((caught: unknown) => caught);
    expect(isTranslatorError(error) && error.failure).toBe("unavailable");
  });

  it("exists only with the provider on and a key set", () => {
    expect(isTranslationConfigured({ TRANSLATE_PROVIDER: "deepl", DEEPL_API_KEY: undefined })).toBe(false);
    expect(isTranslationConfigured({ TRANSLATE_PROVIDER: "off", DEEPL_API_KEY: "k:fx" })).toBe(false);
    expect(isTranslationConfigured({ TRANSLATE_PROVIDER: "deepl", DEEPL_API_KEY: "k:fx" })).toBe(true);
    expect(createTranslatorForEnvironment({ TRANSLATE_PROVIDER: "off", DEEPL_API_KEY: "k:fx" })).toBeNull();
    expect(createTranslatorForEnvironment({ TRANSLATE_PROVIDER: "deepl", DEEPL_API_KEY: "k:fx" })?.provider).toBe("deepl");
  });
});
