import { describe, expect, it, vi } from "vitest";

/** What `cookies().set` was asked to do, recorded by the jar below. */
const cookieWrites: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => cookieWrites.push({ name, value, options }),
    delete: () => undefined,
    get: () => undefined,
  }),
}));

const { draftValuesOf, firstNameOf, openFormDraft, sealFormDraft, stashFormDraft } = await import("@/modules/registrations/form-draft");

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

  /**
   * §NNN — the cookie the privacy notice now describes: ten minutes, out of the page's scripts'
   * reach, and never sent by another site's request. What the notice says is what this sets.
   */
  it("is set for ten minutes, httpOnly and sameSite, on the form's own path", async () => {
    cookieWrites.length = 0;
    await stashFormDraft(form, "/ro/evenimente/tura-pe-tampa/inscriere");

    expect(cookieWrites).toHaveLength(1);
    const [write] = cookieWrites;
    expect(write.name).toBe("br_form_draft");
    expect(write.options).toMatchObject({
      maxAge: 600,
      httpOnly: true,
      sameSite: "lax",
      path: "/ro/evenimente/tura-pe-tampa/inscriere",
    });
    expect(write.value).not.toContain("Astm");
  });
});

/**
 * `DECISIONS.md` §224 and the screen after it — the sealed cookie that names the inbox to open
 * now carries the first name the screen greets with ("Aproape gata, Ana!"). The name is the
 * first word of the first-name box, or nothing: a greeting to a blank is worse than none.
 */
describe("§224 the facts the check-your-email screen greets with", () => {
  it("greets by the first word of the first name, or by nobody", () => {
    expect(firstNameOf("Ana")).toBe("Ana");
    expect(firstNameOf("  Ana Maria ")).toBe("Ana");
    expect(firstNameOf("Ana-Maria")).toBe("Ana-Maria");
    expect(firstNameOf("   ")).toBeNull();
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });

  it("seals the address and the name together and reads neither without the secret", () => {
    const sealed = sealFormDraft({ email: "ana@example.ro", firstName: firstNameOf("Ana Maria") ?? "" }, "secret-one");
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain("ana@example.ro");
    expect(sealed).not.toContain("Ana");
    expect(openFormDraft(sealed as string, "secret-one")).toEqual({ email: "ana@example.ro", firstName: "Ana" });
    expect(openFormDraft(sealed as string, "secret-two")).toBeNull();
  });
});
