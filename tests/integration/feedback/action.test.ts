import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-070-04, `DECISIONS.md` §676 — «Spune-ne ceva»'s one Server Action, `submitFeedbackAction`,
 * on the real clock as the action reads it, with Next's redirect caught where the browser would
 * follow it and the cookie jar held in memory. What the service's own suite cannot see: the address
 * a refusal goes back to — `?tip=` kept, `error=`, `&fields=` the boxes by name, `&since=` the render
 * the corrected form is timed from, the summary's anchor —, the draft written path-scoped to the
 * wizard with what was typed (and never the trap, the clock or the token), `?sent=<slug>` with the
 * draft cleared, and Cloudflare's refusal as `fields=captcha`. Every address is made up.
 */

let db: TestDatabase;
let close: () => Promise<void>;

type Set = { name: string; value: string; options: { path?: string; maxAge?: number } };
const jar = new Map<string, string>();
const sets: Set[] = [];
let turnstile: { on: boolean; verdict: string } = { on: false, verdict: "not_configured" };

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: Set["options"] = {}) => {
      sets.push({ name, value, options });
      jar.set(name, value);
    },
    delete: (name: string) => jar.delete(name),
  }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
}));
vi.mock("@/modules/registrations/bot-check", () => ({ botCheckIsOn: async () => turnstile.on, honeypotIsOn: async () => true }));
vi.mock("@/modules/registrations/turnstile", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  verifyTurnstile: async () => turnstile.verdict,
}));

const { submitFeedbackAction } = await import("@/app/[locale]/contact/feedback/actions");
const { updateFeedbackSettings } = await import("@/modules/feedback/settings");
const { forgetFeedbackLinkMemo } = await import("@/modules/feedback/links");
const { openFormDraft } = await import("@/modules/registrations/form-draft");
const { capturedContactMessages } = await import("@/modules/contact/delivery");

/** As the panel posts it: «O sugestie» and «O reclamație» off, their boxes empty. */
const SETTINGS = {
  howItWent: { on: true, to: "how@example.org" },
  suggestion: { on: false, to: "" },
  complaint: { on: false, to: "" },
  safety: { on: true, to: "safety@example.org", name: "Maria" },
};

let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  forgetFeedbackLinkMemo(db);
  jar.clear();
  sets.length = 0;
  turnstile = { on: false, verdict: "not_configured" };
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  // The platform's notice names `{{feedbackForms}}` in both languages: the door is open.
  const translations = [
    { locale: "ro" as const, title: "Nota de confidențialitate", body: privacyNoticeRo },
    { locale: "en" as const, title: "Privacy notice", body: privacyNoticeEn },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date(Date.now() - 86_400_000),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: new Date(),
  });
  await updateFeedbackSettings(db, admin, SETTINGS, new Date());
});

/** A post as the branch's form makes it, rendered `agoMs` before the press. */
function post(fields: Record<string, string | string[]>, agoMs = 60_000): FormData {
  const form = new FormData();
  const all: Record<string, string | string[]> = { locale: "ro", honeypot: "", renderedAt: new Date(Date.now() - agoMs).toISOString(), ...fields };
  for (const [name, value] of Object.entries(all)) for (const one of Array.isArray(value) ? value : [value]) form.append(name, one);
  return form;
}

/** Where the action sent the browser. */
async function pressed(form: FormData): Promise<string> {
  try {
    await submitFeedbackAction(form);
  } catch (error) {
    const to = (error as { redirectTo?: string }).redirectTo;
    if (to) return to;
    throw error;
  }
  throw new Error("the action returned without a redirect");
}

const lastDraft = () => sets.filter((set) => set.name === "br_form_draft").at(-1);

describe("§676 submitFeedbackAction's redirects", () => {
  it("brings a refused post back to its own form: ?tip=, the boxes by name, ?since= the render it corrects, the anchor — and the draft path-scoped with what was typed", async () => {
    const renderedAt = new Date(Date.now() - 60_000).toISOString();
    const to = await pressed(
      post({ branch: "howItWent", event: "", date: "2026-10-04", rating: "4", message: "   ", reasons: ["time", "pace"], reasonOther: "Seara e greu", email: "", renderedAt }),
    );
    const url = new URL(to, "http://club.test");
    expect(url.pathname).toBe("/ro/contact/spune-ne");
    expect(url.searchParams.get("tip")).toBe("cum-a-fost");
    expect(url.searchParams.get("error")).toBe("VALIDATION_ERROR");
    expect(url.searchParams.get("fields")).toBe("message");
    expect(url.searchParams.get("since")).toBe(renderedAt);
    expect(url.hash).toBe("#feedback-errors");
    // Nothing typed rides in the address (AGENTS.md §14.5).
    expect(to).not.toContain("Seara");

    const draft = lastDraft();
    expect(draft?.options.path).toBe("/ro/contact/spune-ne");
    const kept = openFormDraft(draft?.value ?? "");
    expect(kept).toMatchObject({ date: "2026-10-04", rating: "4", reasons: "time,pace", reasonOther: "Seara e greu" });
    // Never the trap, the clock or the token.
    expect(kept).not.toHaveProperty("honeypot");
    expect(kept).not.toHaveProperty("renderedAt");
    expect(kept).not.toHaveProperty("cf-turnstile-response");
  });

  it("refuses «Cu nume și prenume» with no name on the box, and keeps the choice and the way back in the draft, never in the address (§678)", async () => {
    const to = await pressed(post({ branch: "howItWent", identity: "named", name: " ", event: "", date: "", rating: "", message: "Bine.", reasons: [], reasonOther: "", email: "ana@example.org" }));
    const url = new URL(to, "http://club.test");
    expect(url.searchParams.get("fields")).toBe("name");
    expect(to).not.toContain("ana");
    expect(openFormDraft(lastDraft()?.value ?? "")).toMatchObject({ identity: "named", email: "ana@example.org", message: "Bine." });
  });

  it("keeps no name, no way back, no reader and no identity in the draft of an anonymous refused post, even typed into the hidden boxes (§678)", async () => {
    for (const identity of ["anonymous", ""]) {
      const to = await pressed(
        post({ branch: "safety", identity, name: "Ana Pop", email: "ana@example.org", contact: "0700 000 000", audience: "club", message: "", whereWhen: "Parcul, joi" }),
      );
      expect(new URL(to, "http://club.test").searchParams.get("fields")).toBe("message");
      const kept = openFormDraft(lastDraft()?.value ?? "");
      expect(kept).toMatchObject({ whereWhen: "Parcul, joi" });
      for (const box of ["identity", "name", "email", "contact", "audience"]) expect(kept, `${identity}: ${box}`).not.toHaveProperty(box);
    }
  });

  it("reads a named post as anonymous while the notice in force does not name {{feedbackFormsNamed}}: sent with no name, and a refusal keeps none (§678)", async () => {
    const unnamed = (body: unknown) => JSON.parse(JSON.stringify(body).split("{{feedbackFormsNamed}}").join("cu numele"));
    const translations = [
      { locale: "ro" as const, title: "Nota de confidențialitate", body: unnamed(privacyNoticeRo) },
      { locale: "en" as const, title: "Privacy notice", body: unnamed(privacyNoticeEn) },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 2,
      effectiveAt: new Date(Date.now() - 3_600_000),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: new Date(),
    });
    const before = capturedContactMessages().length;
    const named = { branch: "howItWent", identity: "named", name: "Ana Pop", email: "ana@example.org", event: "", date: "", rating: "", reasons: [], reasonOther: "" };
    expect(await pressed(post({ ...named, message: "Foarte frumos." }))).toBe("/ro/contact/spune-ne?sent=cum-a-fost");
    expect(capturedContactMessages().length).toBe(before + 1);
    const [sent] = capturedContactMessages();
    expect(sent.text.split("\n")[0]).toBe("Nume: (anonim)");
    expect(sent.text).not.toContain("Ana");
    expect(sent.replyTo).toBeUndefined();

    await pressed(post({ ...named, message: " " }));
    const kept = openFormDraft(lastDraft()?.value ?? "");
    expect(kept).not.toHaveProperty("name");
    expect(kept).not.toHaveProperty("email");
    expect(kept).not.toHaveProperty("identity");
  });

  it("names the other reader on the sent page: a named safety report the sender gave the club leaves by the SMTP road, «&catre=clubul» (§678)", async () => {
    const before = capturedContactMessages().length;
    const to = await pressed(post({ branch: "safety", identity: "named", name: "Ana Pop", audience: "club", message: "Cineva m-a urmărit.", whereWhen: "", contact: "" }));
    expect(to).toBe("/ro/contact/spune-ne?sent=siguranta&catre=clubul");
    expect(capturedContactMessages().length).toBe(before + 1);
    expect(capturedContactMessages()[0].subject).toContain("Mesaj confidențial de pe site");
    expect(capturedContactMessages()[0].text.split("\n")[0]).toBe("Nume: Ana Pop");
  });

  it("keeps the English path for an English post", async () => {
    const to = await pressed(post({ locale: "en", branch: "safety", message: "", whereWhen: "", contact: "" }));
    expect(to).toMatch(/^\/en\/contact\/tell-us\?tip=siguranta&error=VALIDATION_ERROR&fields=message&since=[^#]+#feedback-errors$/);
    expect(lastDraft()?.options.path).toBe("/en/contact/tell-us");
  });

  it("answers a post that left with ?sent=<the branch's slug>, the draft cleared, the message on the SMTP road", async () => {
    const before = capturedContactMessages().length;
    const to = await pressed(post({ branch: "howItWent", event: "", date: "", rating: "5", message: "Foarte frumos.", reasons: [], reasonOther: "", email: "" }));
    expect(to).toBe("/ro/contact/spune-ne?sent=cum-a-fost");
    const cleared = sets.at(-1);
    expect(cleared?.options).toMatchObject({ path: "/ro/contact/spune-ne", maxAge: 0 });
    expect(capturedContactMessages().length).toBe(before + 1);
    expect(capturedContactMessages()[0].to).toEqual(["how@example.org"]);
  });

  it("answers a branch that is not offered «UNAVAILABLE», on that branch's form, with the text kept", async () => {
    const to = await pressed(post({ branch: "suggestion", message: "Alergări seara.", email: "" }));
    expect(to).toMatch(/^\/ro\/contact\/spune-ne\?tip=sugestie&error=UNAVAILABLE&since=[^#]+#feedback-errors$/);
    expect(openFormDraft(lastDraft()?.value ?? "")).toMatchObject({ message: "Alergări seara." });
  });

  it("answers Cloudflare's refusal as the check to redo: fields=captcha", async () => {
    turnstile = { on: true, verdict: "failed" };
    const to = await pressed(post({ branch: "howItWent", message: "Foarte frumos.", "cf-turnstile-response": "spent" }));
    const url = new URL(to, "http://club.test");
    expect(url.searchParams.get("tip")).toBe("cum-a-fost");
    expect(url.searchParams.get("error")).toBe("VALIDATION_ERROR");
    expect(url.searchParams.get("fields")).toBe("captcha");
  });
});
