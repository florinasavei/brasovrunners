import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The photographs amendment's item 6 (`fix/legal-texts-prod-ready`,
 * `src/modules/legal-documents/templates/privacy-notice.ts` TODO(legal-code)): every event page —
 * a race and a group run alike — carries a line about photographs, with a way to ask for one to
 * be taken down and a link to the privacy notice that describes the processing (§323).
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Event" }),
  };
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { default: EventPhotosNotice } = await import("@/modules/events/ui/EventPhotosNotice");

afterEach(() => {
  currentLocale = "ro";
});

/** The amendment's words, verbatim — the text the counsel review wrote, tags as the catalogue carries them. */
const AMENDMENT = {
  ro: "La evenimentele clubului se pot face fotografii și filmări, pe care clubul le publică în galerie și pe canalele sale. Nu vrei să apari? Spune-i fotografului sau scrie-ne și scoatem fotografia, fără să ne spui de ce. Detalii în nota de confidențialitate.",
  en: "Photos and video may be taken at club events; the club publishes them in its gallery and on its channels. Don't want to appear? Tell the photographer or write to us and we take the photo down, no reason needed. Details in the privacy notice.",
} as const;
const UPLOAD_RULE = {
  ro: "Nu încărca un portret sau o fotografie în care un copil apare în prim-plan fără acordul scris al persoanei, respectiv cererea scrisă a părintelui (păstrează e-mailul). Cine cere să fie scos: ștergi fotografia în cel mult o lună.",
  en: "Do not upload a portrait, or a photograph in which a child is the subject, without the person's written agreement or the parent's written request (keep the email). If someone asks to be taken down, delete the photo within a month.",
} as const;

/** The rendered text alone: tags out, the new-tab hint (a visually hidden span) out. */
function textOf(html: string): string {
  return html
    .replace(/<span[^>]*>[^<]*opens in a new tab[^<]*<\/span>|<span[^>]*>[^<]*se deschide într-o filă nouă[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the photographs amendment's words", () => {
  it("are the event page's notice, verbatim, in both languages — the objection at collection and «filmări» included", async () => {
    const ro = (await import("../../../messages/ro.json")).default;
    const en = (await import("../../../messages/en.json")).default;
    for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
      expect(messages.Event.photosNotice.replace(/<\/?(contact|privacy)>/g, ""), locale).toBe(AMENDMENT[locale]);
    }
    expect(ro.Event.photosNotice).toContain("<contact>scrie-ne</contact>");
    expect(en.Event.photosNotice).toContain("<privacy>privacy notice</privacy>");
  });

  it("end the gallery's upload help with the upload rule, verbatim, in both languages", async () => {
    const ro = (await import("../../../messages/ro.json")).default;
    const en = (await import("../../../messages/en.json")).default;
    expect(ro.Admin.gallery.uploadHelp.endsWith(UPLOAD_RULE.ro)).toBe(true);
    expect(en.Admin.gallery.uploadHelp.endsWith(UPLOAD_RULE.en)).toBe(true);
  });

  it("render as the notice reads, in each language", async () => {
    for (const locale of ["ro", "en"] as const) {
      currentLocale = locale;
      expect(textOf(renderToStaticMarkup(await EventPhotosNotice())), locale).toContain(AMENDMENT[locale].slice(0, 60));
    }
  });
});

describe("EventPhotosNotice", () => {
  it("names a way to object and links the privacy notice — Romanian", async () => {
    const html = renderToStaticMarkup(await EventPhotosNotice());
    expect(html).toContain("fotografii");
    // The contact page: the way to ask for a photo to be taken down.
    expect(html).toContain('href="/contact"');
    // The privacy notice, opened in a new tab like the registration form's own links (§197).
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('target="_blank"');
  });

  it("names a way to object and links the privacy notice — English", async () => {
    currentLocale = "en";
    const html = renderToStaticMarkup(await EventPhotosNotice());
    expect(html).toContain("Photos");
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/legal/privacy"');
  });

  it("renders the same notice whatever the event type — a race and a group run alike", async () => {
    // The component takes no event-type prop: it is unconditional on every event page, race and
    // group run, which is the point of the finding — it must not be gated on `type`.
    const race = renderToStaticMarkup(await EventPhotosNotice());
    const groupRun = renderToStaticMarkup(await EventPhotosNotice());
    expect(race).toBe(groupRun);
  });
});
