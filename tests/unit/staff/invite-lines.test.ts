import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { INVITE_LINE_KEYS, inviteLineOf } from "@/modules/staff-identity/domain/invite-lines";

/**
 * §NNN — «Echipa»'s one line after «Adaugă» or «Retrimite invitația» (the owner, 2026-11-19: «cumva trebuie un delay intre
 * mailurile de logare, sau sa fie instructiunile mai clare»): what the person receives — two emails, Zitadel's first, or
 * the club's alone — for each answer Zitadel gives, in both languages.
 */
const staff = { ro: ro.Admin.staff as Record<string, unknown>, en: en.Admin.staff as Record<string, unknown> };

describe("§NNN the inviter's one line after a press", () => {
  it("says two emails, Zitadel's first, for an account made or found without a password", () => {
    expect(inviteLineOf("invited", "invited")).toEqual({ key: "inviteSent", severity: "success" });
    expect(inviteLineOf("invited", "exists")).toEqual({ key: "inviteExists", severity: "success" });
    expect(inviteLineOf("reinvited", "invited")).toEqual({ key: "resendSent", severity: "success" });
    expect(inviteLineOf("reinvited", "exists")).toEqual({ key: "resendSent", severity: "success" });
  });

  it("says the club's email alone for an account that already signs in, for no key, and for a refusal", () => {
    expect(inviteLineOf("invited", "ready")).toEqual({ key: "inviteReady", severity: "success" });
    expect(inviteLineOf("reinvited", "ready")).toEqual({ key: "resendReady", severity: "success" });
    expect(inviteLineOf("invited", "unconfigured")).toEqual({ key: "inviteManual", severity: "success" });
    expect(inviteLineOf("reinvited", "unconfigured")).toEqual({ key: "resendManual", severity: "info" });
    expect(inviteLineOf("invited", "failed")).toEqual({ key: "inviteFailed", severity: "warning" });
    expect(inviteLineOf("reinvited", "failed")).toEqual({ key: "resendFailed", severity: "warning" });
  });

  it("says nothing where Zitadel gave no answer: «… fără invitație», the members' press, an answer it does not know", () => {
    expect(inviteLineOf("invited", undefined)).toBeNull();
    expect(inviteLineOf("membersInvited", "invited")).toBeNull();
    expect(inviteLineOf(undefined, "invited")).toBeNull();
    expect(inviteLineOf("invited", "missing")).toBeNull();
  });

  it("has every line in both languages, each naming who sends the person what", () => {
    for (const key of INVITE_LINE_KEYS) {
      for (const locale of ["ro", "en"] as const) {
        const line = staff[locale][key];
        expect(typeof line, `${locale} staff.${key}`).toBe("string");
        expect((line as string).length, `${locale} staff.${key}`).toBeLessThanOrEqual(200);
      }
    }
    // Two emails and who sends which — never an order, which neither Zitadel nor the outbox promises (the review, §NNN).
    expect(staff.ro.inviteSent).toBe("Adăugat. Primește două emailuri: unul de la Zitadel, cu butonul „Acceptare invitație”, pentru parolă, și unul de la noi, cu pașii.");
    expect(staff.en.inviteSent).toBe("Added. They get two emails: one from Zitadel, with the “Accept invite” button, for the password, and one from us, with the steps.");
    for (const key of ["inviteExists", "resendSent"]) {
      expect(staff.ro[key], key).toContain("unul de la Zitadel");
      expect(staff.en[key], key).toContain("one from Zitadel");
    }
    for (const key of ["inviteSent", "inviteExists", "resendSent"]) {
      expect(staff.ro[key], key).not.toContain("întâi");
      expect(staff.en[key], key).not.toContain("first from");
    }
    for (const key of ["inviteReady", "inviteFailed", "resendFailed"]) {
      expect(staff.ro[key], key).toContain("doar emailul nostru");
      expect(staff.en[key], key).toMatch(/only our email|only ours/);
    }
    for (const key of ["inviteManual", "resendManual"]) {
      expect(staff.ro[key], key).toContain("un singur email, de la noi");
      expect(staff.en[key], key).toContain("one email, from us");
    }
    // A refusal says Zitadel's own reason, in both languages.
    for (const key of ["inviteFailed", "resendFailed"]) {
      expect(staff.ro[key], key).toContain("{reason}");
      expect(staff.en[key], key).toContain("{reason}");
    }
  });

  it("is the page's one alert for an invitation, read from Zitadel's answer on the redirect", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/staff/page.tsx"), "utf8");
    expect(page).toContain("const inviteLine = inviteLineOf(saved, invite);");
    expect(page).toContain("t(`staff.${inviteLine.key}`, { reason: reason ?? \"\" })");
    // The per-answer alerts it replaced are gone.
    expect(page).not.toContain('t("staff.inviteSent")');
    expect(page).not.toContain('t("staff.resendFailed"');
  });

  it("words the members' report the same way, a line per answer, «ready» among them", () => {
    const outcomes = (locale: "ro" | "en") => staff[locale].membersOutcome as Record<string, string>;
    for (const locale of ["ro", "en"] as const) {
      expect(Object.keys(outcomes(locale)).sort()).toEqual(["created", "failed", "invited", "ready", "unconfigured"]);
    }
    expect(outcomes("ro").created).toContain("întâi de la Zitadel");
    expect(outcomes("ro").ready).toBe("are deja cont, cu parolă: doar emailul nostru");
    expect(outcomes("en").ready).toBe("already has an account with a password: only our email");
  });
});
