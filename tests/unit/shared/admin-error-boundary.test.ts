import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import { forgetSubmission, rememberSubmission, type Submission } from "@/shared/forms/save-fallback";

/**
 * §NNN — the backoffice's own error boundary (`app/[locale]/admin/error.tsx`) takes an error for a
 * blocked save only right after a press the guard remembered AND only when the error is the
 * transport's own. Rendered for real: a plain `TypeError` from a render — the kind a null read
 * throws — must leave it, thrown on to `[locale]/error.tsx` with its reference number (§52), even
 * one second after a press; and a fetch failure after a press draws the offer, never a send.
 */

// The notice's link to the network check needs a request for next-intl's navigation; a plain
// anchor stands in, since the words and the button are what this test reads.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}));

const { default: AdminError } = await import("@/app/[locale]/admin/error");

function press(at: number): Submission {
  return { entries: [["order", "1"]], url: "/ro/admin/pages", key: "k", formId: null, ordinal: 0, siblings: 1, submitter: null, at };
}

function render(error: Error): string {
  const boundary = createElement(AdminError, { error, reset: () => {} });
  // The provider's props type its children as required, so they travel inside its props.
  const provider: ComponentProps<typeof NextIntlClientProvider> = { locale: "ro", messages: ro, timeZone: "Europe/Bucharest", children: boundary };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, provider));
}

describe("§NNN the admin boundary", () => {
  beforeEach(() => forgetSubmission());

  it("rethrows a plain TypeError from a render to the backoffice boundary (§52), even right after a press", () => {
    rememberSubmission(press(Date.now() - 1000));
    const bug = new TypeError("Cannot read properties of null (reading 'title')");
    expect(() => render(bug)).toThrow(bug);
  });

  it("rethrows a fetch failure that followed no press", () => {
    const failure = new TypeError("Failed to fetch");
    expect(() => render(failure)).toThrow(failure);
  });

  it("offers the simple way for a fetch failure right after a press — a button, nothing sent", () => {
    rememberSubmission(press(Date.now() - 1000));
    const markup = render(new TypeError("Failed to fetch"));
    expect(markup).toContain('data-testid="save-blocked"');
    expect(markup).toContain("Trimite pe calea simplă");
    expect(markup).toContain("Dacă ai primit deja mesajul că s-a salvat, nu apăsa — verifică pagina.");
  });
});
