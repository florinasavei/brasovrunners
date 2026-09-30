import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isStaticPublicAnswer } from "@/i18n/live-twin";
import { routing } from "@/i18n/routing";
import { readPreviewMessage } from "@/modules/content/events/ui/draft-preview-messages";
import { canPreviewEventDraft, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { isPrivatePath } from "@/shared/security/private-paths";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §579 — «Previzualizare» before saving, the parts that need no database: who may preview, that the
 * frame is a staff path served `private, no-store` and never indexed, the frame's words in both
 * languages, and the two islands' protocol. The render itself, the refusals and "nothing written"
 * are `tests/integration/cms/event-draft-preview.test.ts`.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("§579 who may preview an unsaved event", () => {
  it("is the Redactor, the Organizer and the Administrators — never the Tehnic, the volunteer or a member", () => {
    const allowed = STAFF_ROLES.filter((role) => canPreviewEventDraft(role));
    expect(allowed).toEqual(["COPYWRITER", "MODERATOR", "ADMIN", "SUPERADMIN"]);
  });

  it("is asserted by the action and by the frame's page, not by the card that offers the button (BR-REQ-060-01)", () => {
    expect(read("src/modules/content/events/draft-preview.tsx")).toContain("if (!canPreviewEventDraft(input.actor.role)) return { outcome: \"forbidden\" };");
    expect(read("src/app/[locale]/preview/draft/page.tsx")).toContain("if (!staffUser || !canPreviewEventDraft(staffUser.role)) notFound();");
    const action = read("src/app/[locale]/admin/actions.ts");
    const body = action.slice(action.indexOf("export async function previewEventDraftAction"), action.indexOf("export async function createEventAction"));
    expect(body).toContain("actor = await requireStaff();");
    expect(body).toContain("renderEventDraftPreview(getDb(), {");
  });
});

describe("§579 the frame is never public and never cached", () => {
  it("lives at a staff address in both languages, which the proxy answers private, no-store and noindex", () => {
    const pathnames = routing.pathnames as unknown as Record<string, { ro: string; en: string }>;
    expect(pathnames["/preview/draft"]).toEqual({ ro: "/previzualizare/ciorna", en: "/preview/draft" });
    expect(isPrivatePath("/ro/previzualizare/ciorna")).toBe(true);
    expect(isPrivatePath("/en/preview/draft")).toBe(true);
    // The header itself, on every private path (`proxy.ts`): no shared cache, no browser cache.
    expect(read("src/proxy.ts")).toContain('response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");');
  });

  it("is rendered per request and asks not to be indexed", () => {
    const page = read("src/app/[locale]/preview/draft/page.tsx");
    expect(page).toContain('export const dynamic = "force-dynamic";');
    expect(page).toContain("robots: { index: false, follow: false, nocache: true }");
    expect(page).not.toMatch(/export const revalidate/);
  });

  it("is kept out of the sitemap and out of the public cache (§549), and no public page links it", () => {
    for (const path of ["/ro/preview/draft", "/en/preview/draft"]) {
      expect(isStaticPublicAnswer(path, new URLSearchParams(), false)).toBe(false);
      expect(isStaticPublicAnswer(path, new URLSearchParams(), true)).toBe(false);
    }
    expect(read("src/app/robots.ts")).toContain('"/ro/previzualizare",');
    expect(read("src/app/sitemap.ts")).not.toMatch(/preview/);
    // Its one link is the editor's frame, behind the same role (`PreviewBox`, offered by `canPreviewEventDraft`).
    expect(read("src/app/[locale]/admin/events/[id]/page.tsx")).toContain("canPreviewEventDraft(staffUser.role) && <PreviewBox");
  });

  it("writes nothing and expires nothing: no transaction, no revalidation, no job, no poster in the draft's path", () => {
    const service = read("src/modules/content/events/service.ts");
    const draft = service.slice(service.indexOf("export async function draftEvent"), service.indexOf("export function textsOwedInOneLanguage"));
    for (const write of ["transaction(", "revalidatePublicContent", "wakeJobs", "attachPosters", ".insert(", ".update(", "recordAuditEvent"]) {
      expect(draft).not.toContain(write);
    }
    const render = read("src/modules/content/events/draft-preview.tsx");
    expect(render).not.toMatch(/cached[A-Z]|forecastForEvent|revalidate/);
  });
});

describe("§579 the editor's words, in both languages", () => {
  const words = (catalogue: typeof ro) => catalogue.Admin.editor.draftPreview;

  it("has every word in Română and English, plain and short", () => {
    expect(Object.keys(words(en)).sort()).toEqual(Object.keys(words(ro)).sort());
    for (const catalogue of [ro, en]) {
      for (const text of Object.values(words(catalogue))) {
        expect(text.length).toBeLessThanOrEqual(200);
        expect(text).not.toMatch(/platform|de obicei/i);
      }
    }
    // The card, the page and, since the form joined them (amending §579), the registration form.
    expect(ro.Admin.editor.boxes.preview.summary).toBe("Cum arată pe site — cardul, pagina și formularul, fără să salvezi");
    expect(ro.Event.previewDoor).toBe("previzualizare");
    expect(en.Event.previewDoor).toBe("preview");
  });

  it("offers the language toggle in the site's own words, «RO» | «EN»", () => {
    expect(read("src/modules/content/events/ui/boxes/PreviewBox.tsx")).toContain("languageCodes={perLocale((locale) => tSite(`languageCode.${locale}`))}");
    expect([ro.Site.languageCode.ro, ro.Site.languageCode.en]).toEqual(["RO", "EN"]);
  });

  it("wears a glyph on the fold, the button and every toggle (§521)", () => {
    expect(read("src/modules/content/events/ui/boxes/PreviewBox.tsx")).toContain('glyph="preview"');
    const island = read("src/modules/content/events/ui/EventDraftPreview.tsx");
    expect(island).toContain("startIcon={<VisibilityIcon />}");
    // Card, Pagina, Formular (amending §579), the language (one per language), Telefon, Desktop.
    expect(island.match(/<ToggleButton [^>]*>\s*<[A-Za-z]+Icon aria-hidden="true"/g)?.length).toBe(6);
    expect(island).toMatch(/<ToggleButton value="form"[^>]*>\s*<PersonAddIcon aria-hidden="true"/);
    // The language toggle draws one button per language, each with its glyph.
    expect(island).toMatch(/<ToggleButton key=\{code\}[^>]*>\s*<TranslateIcon aria-hidden="true"/);
  });
});

describe("§579 the editor and its frame speak only to each other", () => {
  it("reads only its own messages", () => {
    expect(readPreviewMessage({ type: "br-draft-preview:ready" })).toEqual({ type: "br-draft-preview:ready" });
    expect(readPreviewMessage({ type: "webpackOk" })).toBeNull();
    expect(readPreviewMessage("br-draft-preview:ready")).toBeNull();
    expect(readPreviewMessage(null)).toBeNull();
  });

  it("checks the origin and the window on both sides, and posts to its own origin only", () => {
    const frame = read("src/modules/content/events/ui/EventDraftFrame.tsx");
    expect(frame).toContain("if (event.origin !== window.location.origin || event.source !== parent) return;");
    const editor = read("src/modules/content/events/ui/EventDraftPreview.tsx");
    expect(editor).toContain("if (event.origin !== window.location.origin) return;");
    expect(editor).toContain('sandbox="allow-scripts allow-same-origin"');
    for (const island of [frame, editor]) expect(island).not.toContain('postMessage(message, "*")');
  });

  it("asks nothing while nobody presses: no request on a timer, none on a keystroke (§371)", () => {
    const editor = read("src/modules/content/events/ui/EventDraftPreview.tsx");
    expect(editor).not.toMatch(/setInterval|setTimeout|addEventListener\("input"|addEventListener\("change"/);
    const frame = read("src/modules/content/events/ui/EventDraftFrame.tsx");
    expect(frame).not.toMatch(/setInterval|setTimeout/);
  });
});
