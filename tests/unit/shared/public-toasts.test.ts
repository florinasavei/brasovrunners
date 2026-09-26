import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { flashPublic, readFlash, readPublicFlash } from "@/shared/feedback/flash";
import FlashToast from "@/shared/feedback/FlashToast";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { decodeFlash, encodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import { flashCookiePresent, isPublicToastKey, PUBLIC_TOAST_KEYS } from "@/shared/feedback/public-toasts";

/**
 * §NNN — the public site's three flows say their outcome in a toast, through §384's flash: the
 * contact form sent, a registration cancelled from the participant's own link, the declaration
 * signed (confirmed, or on the waiting list).
 *
 * What Node can hold down: every key has its sentence in both languages; the flash a public
 * action writes carries the key and nothing else; the island shows a toast only while the cookie
 * is still there; and the mechanism is mounted where a flow lands and nowhere else — no layout, no
 * catalogue shipped for it. The browser side is `tests/e2e/contact.spec.ts` and
 * `tests/e2e/declaration-signature.spec.ts`.
 */
/** The request's cookie jar, as the actions write it and the pages read it. */
const jar = vi.hoisted(() => new Map<string, { value: string; options: Record<string, unknown> }>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => jar.set(name, { value, options }),
  }),
}));

const ROOT = path.resolve(__dirname, "../../..");
const APP = path.join(ROOT, "src/app/[locale]");

function filesUnder(directory: string, keep: (name: string) => boolean): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return filesUnder(full, keep);
    return keep(entry) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

describe("§NNN the public toasts' sentences", () => {
  type Catalogue = { Feedback: { close: string; public: Record<string, unknown> } };
  const catalogues = { ro: (ro as unknown as Catalogue).Feedback, en: (en as unknown as Catalogue).Feedback };

  it("has one plain sentence per key in both languages, and no key the list does not name", () => {
    for (const [locale, feedback] of Object.entries(catalogues)) {
      expect(Object.keys(feedback.public).sort(), locale).toEqual([...PUBLIC_TOAST_KEYS].sort());
      for (const key of PUBLIC_TOAST_KEYS) {
        const sentence = feedback.public[key];
        expect(typeof sentence, `${locale}: Feedback.public.${key}`).toBe("string");
        // Nothing to fill in: the flash carries no values, so a placeholder would print raw.
        expect(sentence as string, `${locale}: Feedback.public.${key}`).not.toMatch(/[{}<]/);
      }
      expect(typeof feedback.close).toBe("string");
    }
  });

  it("says each outcome differently in each language — never the Romanian sentence under English", () => {
    for (const key of PUBLIC_TOAST_KEYS) expect(catalogues.en.public[key], key).not.toBe(catalogues.ro.public[key]);
    expect(new Set(PUBLIC_TOAST_KEYS.map((key) => catalogues.ro.public[key])).size).toBe(PUBLIC_TOAST_KEYS.length);
  });
});

describe("§NNN the flash a public action writes", () => {
  it("is a key the list names and nothing else — no count, no name, no address", () => {
    for (const key of PUBLIC_TOAST_KEYS) {
      expect(isPublicToastKey(key)).toBe(true);
      expect(decodeFlash(encodeFlash({ kind: "success", key }))).toEqual({ kind: "success", key });
    }
    // A backoffice code is not the public page's to show, and the cookie is the browser's to rewrite.
    for (const other of ["saved", "event", "registrationConfirmed", "", "contactSent.x"]) expect(isPublicToastKey(other), other).toBe(false);
  });

  it("is written by the four public actions, each key by at least one, and only after a success", () => {
    const actions = filesUnder(APP, (name) => name === "actions.ts").filter((file) => !relative(file).includes("/admin/"));
    const written = new Map<string, string[]>();
    for (const file of actions) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/flashPublic\(([^;]*?)\);/g)) {
        // The keys, not the status a ternary compares against (`status === "WAITLISTED" ? … : …`).
        for (const key of match[1].matchAll(/(?<!=== )"([A-Za-z]+)"/g)) (written.get(key[1]) ?? written.set(key[1], []).get(key[1])!).push(relative(file));
      }
    }
    expect([...written.keys()].sort()).toEqual([...PUBLIC_TOAST_KEYS].sort());
    expect(new Set([...written.values()].flat())).toEqual(
      new Set([
        "src/app/[locale]/contact/actions.ts",
        "src/app/[locale]/registrations/manage/[token]/actions.ts",
        "src/app/[locale]/registrations/mine/[token]/actions.ts",
        "src/app/[locale]/registrations/declare/[token]/actions.ts",
      ]),
    );
    // A cancel flashes only when the link did it: a refused link says so on the page, not in a toast.
    for (const file of ["registrations/manage/[token]/actions.ts", "registrations/mine/[token]/actions.ts"]) {
      expect(readFileSync(path.join(APP, file), "utf8"), file).toContain('if (result.ok) await flashPublic("unregistered");');
    }
  });
});

describe("§NNN the flash is read by the page it was written for", () => {
  it("a public flash is the public slot's, never the backoffice's generic 'Salvat.'", async () => {
    jar.clear();
    await flashPublic("declarationConfirmed");
    const written = jar.get(FLASH_COOKIE)!;
    // A minute, readable by the island that clears it, never a name or an address in it.
    expect(written.options).toMatchObject({ path: "/", maxAge: 60, httpOnly: false, sameSite: "lax" });
    expect(decodeFlash(written.value)).toEqual({ kind: "success", key: "declarationConfirmed" });

    expect(await readPublicFlash()).toEqual({ kind: "success", key: "declarationConfirmed" });
    expect(await readFlash()).toBeNull();
  });

  it("a backoffice flash is the admin layout's, never a public page's", async () => {
    jar.clear();
    jar.set(FLASH_COOKIE, { value: encodeFlash({ kind: "success", key: "event" }), options: {} });
    expect(await readPublicFlash()).toBeNull();
    expect(await readFlash()).toEqual({ kind: "success", key: "event" });

    jar.clear();
    expect(await readPublicFlash()).toBeNull();
    expect(await readFlash()).toBeNull();
  });

  it("no backoffice sentence shares a public key — the two lists never overlap", () => {
    const toast = (ro as unknown as { Feedback: { toast: Record<string, unknown> } }).Feedback.toast;
    expect(PUBLIC_TOAST_KEYS.filter((key) => key in toast)).toEqual([]);
  });
});

describe("§NNN the toast is shown once", () => {
  it("only while the browser still holds the flash cookie", () => {
    expect(flashCookiePresent(`${FLASH_COOKIE}=${encodeFlash({ kind: "success", key: "contactSent" })}`, FLASH_COOKIE)).toBe(true);
    expect(flashCookiePresent(`theme=dark; ${FLASH_COOKIE}=abc; other=1`, FLASH_COOKIE)).toBe(true);
    // Cleared (the island's own `Max-Age=0` leaves nothing, or an empty value in some browsers).
    expect(flashCookiePresent("", FLASH_COOKIE)).toBe(false);
    expect(flashCookiePresent(`${FLASH_COOKIE}=`, FLASH_COOKIE)).toBe(false);
    expect(flashCookiePresent("theme=dark", FLASH_COOKIE)).toBe(false);
    // A cookie whose name merely contains the flash's is not it.
    expect(flashCookiePresent(`x-${FLASH_COOKIE}=abc`, FLASH_COOKIE)).toBe(false);
  });
});

describe("§NNN the island", () => {
  it("renders the live region empty on the server — the toast arrives after the paint, so it is announced", () => {
    const html = renderToStaticMarkup(createElement(FlashToast, { kind: "success", sentence: "Mesaj trimis clubului.", closeLabel: "Închide" }));
    expect(html).toBe('<div role="status" aria-live="polite" data-testid="toast-live"></div>');
  });

  it("shows the sentence from an effect, only while the cookie is there, and clears it", () => {
    const source = readFileSync(path.join(ROOT, "src/shared/feedback/FlashToast.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(source).toMatch(/useEffect\(\(\) => \{[\s\S]*flashCookiePresent\(document\.cookie, FLASH_COOKIE\)/);
    expect(source).toContain("if (present) document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/`;");
    expect(source).toContain("if (present) setToast(");
  });
});

describe("§NNN mounted only where a flow lands", () => {
  const sources = filesUnder(path.join(ROOT, "src"), (name) => /\.tsx?$/.test(name));
  const importers = (module: string) =>
    sources.filter((file) => new RegExp(`from "@/shared/feedback/${module}"|from "\\./${module}"`).test(readFileSync(file, "utf8"))).map(relative).sort();

  it("the slot is in the four pages the flows land on, in their success branch, and in no layout", () => {
    expect(importers("PublicFlash")).toEqual([
      "src/app/[locale]/contact/page.tsx",
      "src/app/[locale]/registrations/declare/[token]/page.tsx",
      "src/app/[locale]/registrations/manage/[token]/page.tsx",
      "src/app/[locale]/registrations/mine/[token]/page.tsx",
    ]);
    const accepted = new Set<string>();
    for (const page of importers("PublicFlash")) {
      const text = readFileSync(path.join(ROOT, page), "utf8");
      const slots = [...text.matchAll(/<PublicFlash accept=\{\[([^\]]*)\]\} \/>/g)];
      expect(slots, page).toHaveLength(1);
      for (const key of slots[0][1].matchAll(/(?<!=== )"([A-Za-z]+)"/g)) accepted.add(key[1]);
    }
    expect([...accepted].sort()).toEqual([...PUBLIC_TOAST_KEYS].sort());
  });

  it("the island reads no catalogue and pulls in no backoffice provider — a public page ships only the sentence", () => {
    expect(importers("FlashToast")).toEqual(["src/shared/feedback/PublicFlash.tsx"]);
    for (const file of ["FlashToast.tsx", "ToastRegion.tsx", "public-toasts.ts"]) {
      const text = readFileSync(path.join(ROOT, "src/shared/feedback", file), "utf8");
      expect(text, file).not.toMatch(/from "next-intl|from "\.\/ToastProvider"|action-icons/);
    }
    // The one drawing both islands share: the backoffice's provider and the public toast.
    expect(importers("ToastRegion")).toEqual(["src/shared/feedback/FlashToast.tsx", "src/shared/feedback/ToastProvider.tsx"]);
  });
});
