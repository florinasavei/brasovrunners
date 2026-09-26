import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReadAndAgree from "@/modules/registrations/ui/ReadAndAgree";

/**
 * `ReadAndAgree` without JavaScript (review of fix/register-rules-checkbox-and-missing-list,
 * finding 2): the branch `useSyncExternalStore`'s server snapshot of `false` takes before
 * hydration, the same one `renderToStaticMarkup` exercises (the pattern `pickers-js-off.test.ts`
 * uses for the same shape of island).
 *
 * The component's own doc comment promises this is "the plain, tickable checkbox" — required,
 * not read-only, ticked by the same press a mouse gives it — plus a link to the conditions on
 * their own page. This is the regression proof: no script means no dialog, no gate, and still a
 * working, required box under the field's own name.
 */
describe("ReadAndAgree without JavaScript", () => {
  const html = renderToStaticMarkup(
    createElement(ReadAndAgree, {
      name: "rulesAcknowledged",
      fieldId: "f-rulesAcknowledged",
      title: "Cros de toamnă",
      openLabel: "Citește condițiile concursului",
      readingLabel: "Apasă pe căsuță sau pe buton…",
      agreedLabel: "Ai citit condițiile concursului și ești de acord cu ele.",
      agreeButtonLabel: "Am citit și sunt de acord",
      keepReadingLabel: "Derulează până la sfârșit ca să poți confirma.",
      closeLabel: "Închide",
      plainLabel: "Am citit și sunt de acord cu condițiile concursului:",
      tickLabel: "Am citit și sunt de acord cu condițiile concursului",
      href: "/ro/evenimente/cros-de-toamna#rules",
      document: { type: "doc", content: [] },
    }),
  );

  it("is a plain checkbox under the field's own name, required and not read-only", () => {
    expect(html).toContain('name="rulesAcknowledged"');
    expect(html).toContain('id="f-rulesAcknowledged"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("required");
    // No dialog, no gate: none of the panel's own markup is on the page.
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("rules-gate");
  });

  it("is unchecked by default and carries no readOnly or disabled attribute on the input itself", () => {
    const input = html.match(/<input[^>]*name="rulesAcknowledged"[^>]*>/)?.[0] ?? "";
    expect(input).not.toBe("");
    expect(input).not.toMatch(/\bchecked(=|\/|>|\s)/);
    expect(input).not.toMatch(/\breadonly/i);
    expect(input).not.toMatch(/\bdisabled/i);
  });

  it("carries a link to the conditions on their own page, opening in a new tab", () => {
    expect(html).toContain('href="/ro/evenimente/cros-de-toamna#rules"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Citește condițiile concursului");
  });

  it("comes back ticked when a refused submission's draft says it was already agreed to", () => {
    const again = renderToStaticMarkup(
      createElement(ReadAndAgree, {
        name: "rulesAcknowledged",
        fieldId: "f-rulesAcknowledged",
        title: "Cros de toamnă",
        openLabel: "Citește condițiile concursului",
        readingLabel: "Apasă pe căsuță sau pe buton…",
        agreedLabel: "Ai citit condițiile concursului și ești de acord cu ele.",
        agreeButtonLabel: "Am citit și sunt de acord",
        keepReadingLabel: "Derulează până la sfârșit ca să poți confirma.",
        closeLabel: "Închide",
        plainLabel: "Am citit și sunt de acord cu condițiile concursului:",
        tickLabel: "Am citit și sunt de acord cu condițiile concursului",
        href: "/ro/evenimente/cros-de-toamna#rules",
        document: { type: "doc", content: [] },
        defaultAgreed: true,
      }),
    );
    const input = again.match(/<input[^>]*name="rulesAcknowledged"[^>]*>/)?.[0] ?? "";
    expect(input).toMatch(/\bchecked(=|\/|>|\s)/);
  });
});
