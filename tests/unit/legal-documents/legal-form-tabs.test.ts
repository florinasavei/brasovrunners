import { type ReactNode, createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §847 — a legal text is written in the backoffice's one Română | English strip (`LocaleTabPanels`),
 * as the event editor and the FAQ are, never two boxes stacked: one form, both languages' boxes in
 * it — the hidden panel still posts — and each tab marked «incomplet» while its title or its text is
 * empty. Drawn from the real catalogue.
 */
// The dialogs' road line (§841) reads the club's roads once per request: no database here.
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  return {
    getLocale: async () => "ro",
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Admin" }),
  };
});
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", {}, children),
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/admin/legal/new",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { default: LegalDocumentForm } = await import("@/modules/legal-documents/ui/LegalDocumentForm");

/** The form as the server sends it: streamed, because the token legend inside it is an async Server Component. */
const draw = async (values?: Parameters<typeof LegalDocumentForm>[0]["values"]) => {
  const form = await LegalDocumentForm({
    action: async () => null,
    locale: "ro",
    values,
    submitLabel: "Salvează ciorna",
    pendingLabel: "Se salvează…",
    incompleteHint: "Completează întâi: {field}",
  });
  const stream = await renderToReadableStream(form);
  await stream.allReady;
  return new Response(stream).text();
};

const body = (text: string) => ({ sections: [{ heading: "Secțiunea 1", paragraphs: [text] }] });

describe("§847 the legal text's two languages are one Română | English strip", () => {
  it("draws a tab per language over two panels inside the one form, the English one hidden and still there", async () => {
    const html = await draw({ key: "TERMS", ro: { title: "Termeni", body: body("Un paragraf.") }, en: { title: "Terms", body: body("A paragraph.") } });
    const form = html.slice(html.indexOf("<form"), html.lastIndexOf("</form>"));
    expect(form).toContain('id="legal-text-tab-ro"');
    expect(form).toContain('id="legal-text-tab-en"');
    // The Romanian panel on top, the English one hidden — never unmounted, so a save posts both.
    expect(form).toMatch(/<div[^>]*role="tabpanel"[^>]*id="legal-text-panel-ro"(?![^>]*hidden)[^>]*>/);
    expect(form).toMatch(/<div[^>]*role="tabpanel"[^>]*id="legal-text-panel-en"[^>]*hidden/);
    for (const name of ["roTitle", "roBody", "enTitle", "enBody"]) expect(form, name).toContain(`name="${name}"`);
    // Both titles required, as before: a refused box brings its tab forward (`onInvalid` on the panel).
    expect(form.match(/<input[^>]*name="(ro|en)Title"[^>]*>/g)?.every((input) => / required/.test(input))).toBe(true);
    // Complete in both languages: no tab says it is not.
    expect(form).not.toContain("incomplet");
  });

  it("marks a language whose title or text is empty «incomplet» on its tab", async () => {
    const html = await draw({ key: "TERMS", ro: { title: "Termeni", body: body("Un paragraf.") }, en: { title: "", body: { sections: [] } } });
    const tab = (locale: string) => html.match(new RegExp(`<button[^>]*id="legal-text-tab-${locale}"[\\s\\S]*?</button>`))?.[0] ?? "";
    expect(tab("ro")).not.toContain("incomplet");
    expect(tab("en")).toContain("English · incomplet");
  });

  it("draws no stacked language boxes any more: no «RO» / «EN» overline cards", async () => {
    const html = await draw();
    expect(html).not.toMatch(/MuiTypography-overline[^>]*>(RO|EN)</);
    expect(html).toContain("Română · incomplet");
  });
});
