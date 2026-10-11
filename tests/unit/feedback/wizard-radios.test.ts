import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN (amending §678) — each question of «Spune-ne ceva» is one native
 * radio group: one `name`, exactly one checked, so picking the other unchecks it in the browser alone.
 * The owner saw both drawn selected when the options were MUI radios outside a `RadioGroup`.
 */
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Tell" }),
}));

const { default: IdentityChoice } = await import("@/modules/feedback/ui/IdentityChoice");

function groups(html: string) {
  const byName = new Map<string, { value: string; checked: boolean }[]>();
  for (const [tag] of html.matchAll(/<input[^>]*type="radio"[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(tag)![1];
    const row = { value: /value="([^"]*)"/.exec(tag)![1], checked: /\schecked(=""|\s|\/|>)/.test(tag) };
    byName.set(name, [...(byName.get(name) ?? []), row]);
  }
  return byName;
}

describe("the wizard's radios are one group each (§NNN)", () => {
  for (const inLocale of ["ro", "en"] as const) {
    for (const wayBack of ["email", "contact"] as const) {
      for (const named of [false, true]) {
        it(`${inLocale}, ${wayBack}, ${named ? "named" : "anonymous"}: two groups, one checked each, native inputs`, async () => {
          locale = inLocale;
          const html = renderToStaticMarkup(
            await IdentityChoice({
              wayBack,
              named,
              invalid: new Set(),
              kept: () => undefined,
              safetyName: "Maria",
              audiences: ["club", "person"],
              audience: "club",
            }),
          );
          const found = groups(html);
          expect([...found.keys()]).toEqual(["identity", "audience"]);
          for (const rows of found.values()) {
            expect(rows).toHaveLength(2);
            expect(new Set(rows.map((r) => r.value)).size).toBe(2);
            expect(rows.filter((r) => r.checked)).toHaveLength(1);
          }
          expect(found.get("identity")!.find((r) => r.checked)!.value).toBe(named ? "named" : "anonymous");
          expect(found.get("audience")!.find((r) => r.checked)!.value).toBe("club");
          // No MUI Radio: it keeps its own checked state and drew both selected.
          expect(html).not.toContain("MuiRadio");
        });
      }
    }
  }
});
