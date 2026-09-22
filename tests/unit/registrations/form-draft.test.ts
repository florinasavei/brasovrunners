import { describe, expect, it } from "vitest";
import { draftValuesOf, openFormDraft, sealFormDraft } from "@/modules/registrations/form-draft";

/**
 * BR-REQ-041-01 criterion 10 (`DECISIONS.md` §142) — what a participant typed survives a rejected
 * submit in an encrypted, short-lived cookie: readable only with the deployment's secret,
 * never carrying the bot fields, dropped when too big.
 *
 * The consent used to be left out too, on the reasoning that it must be given deliberately every
 * time. §286 reversed that: the tick that counts is the one on the submission that succeeds, and
 * making somebody re-tick three boxes to recover from a refusal about none of them is friction
 * charged to the wrong person — the owner, watching it happen: "vreau sa persist inclusiv bifele".
 */
describe("BR-REQ-041-01 criterion 10 the form draft", () => {
  const form = new FormData();
  form.set("firstName", "Ana");
  form.set("healthNotes", "Astm");
  form.set("sex", "FEMALE");
  form.set("clubMemberDeclared", "on");
  form.set("privacyAcknowledged", "on");
  form.set("honeypot", "");
  form.set("renderedAt", "2026-09-19T10:00:00.000Z");
  form.set("cf-turnstile-response", "token");
  form.set("locale", "ro");
  form.set("slug", "tura-pe-tampa");
  form.set("$ACTION_ID", "x");

  it("keeps what was typed and leaves out the bot fields, the address and the consent", () => {
    expect(draftValuesOf(form)).toEqual({
      firstName: "Ana",
      healthNotes: "Astm",
      sex: "FEMALE",
      clubMemberDeclared: "on",
      // Kept since §286, so one press finishes a submission the anti-bot check refused.
      privacyAcknowledged: "on",
    });
  });

  it("round-trips under the secret and is unreadable without it", () => {
    const sealed = sealFormDraft(draftValuesOf(form), "secret-one");
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain("Astm");
    expect(openFormDraft(sealed as string, "secret-one")).toEqual({
      firstName: "Ana",
      healthNotes: "Astm",
      sex: "FEMALE",
      clubMemberDeclared: "on",
      privacyAcknowledged: "on",
    });
    expect(openFormDraft(sealed as string, "secret-two")).toBeNull();
    expect(openFormDraft("not-a-draft", "secret-one")).toBeNull();
    // No secret configured: a key drawn for the process, so a laptop still gets its draft back.
    const local = sealFormDraft({ a: "b" });
    expect(openFormDraft(local as string)).toEqual({ a: "b" });
    expect(openFormDraft(local as string, "secret-one")).toBeNull();
  });

  it("drops a draft the cookie could not hold", () => {
    expect(sealFormDraft({ healthNotes: "x".repeat(5_000) }, "secret-one")).toBeNull();
  });
});
