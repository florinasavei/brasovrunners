import { describe, expect, it } from "vitest";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import {
  createEmailSender,
  decideDelivery,
  markSubjectForEnvironment,
  QA_SUBJECT_PREFIX,
} from "@/infrastructure/email/delivery";

/**
 * BR-REQ-080-03 criteria 1 and 2, as pure rules. The integration test runs them through a real
 * outbox batch; these state what "captured", "allowlisted" and "marked" mean.
 */
describe("BR-REQ-080-03 which recipients may be transmitted to", () => {
  const allowlist = ["qa.tester@example.ro", "ana@gmail.com"];

  it("captures everything in capture mode, allowlist or not", () => {
    expect(decideDelivery("capture", "qa.tester@example.ro", allowlist)).toBe("capture");
    expect(decideDelivery("capture", "stranger@example.ro", allowlist)).toBe("capture");
  });

  it("sends everything in live mode", () => {
    expect(decideDelivery("live", "stranger@example.ro", [])).toBe("send");
  });

  it("sends to an allowlisted address and captures the rest", () => {
    expect(decideDelivery("allowlist", "qa.tester@example.ro", allowlist)).toBe("send");
    expect(decideDelivery("allowlist", "stranger@example.ro", allowlist)).toBe("capture");
  });

  it("compares by canonical identity, not by string", () => {
    // AGENTS.md §10.4 and the rule table in CLAUDE.md: never a raw string compare. All three
    // of these reach the same inbox as the allowlisted `ana@gmail.com`.
    expect(decideDelivery("allowlist", "a.n.a@gmail.com", allowlist)).toBe("send");
    expect(decideDelivery("allowlist", "ana+qa@googlemail.com", allowlist)).toBe("send");
    expect(decideDelivery("allowlist", "  ANA@GMAIL.COM  ", allowlist)).toBe("send");
  });

  it("does not treat a dotted custom-domain address as the same person", () => {
    // On a custom domain those may be two humans, so the allowlist must not widen.
    expect(decideDelivery("allowlist", "qa.tester@example.ro", ["qatester@example.ro"])).toBe(
      "capture",
    );
  });

  it("captures an address it cannot canonicalize rather than attempting to send", () => {
    expect(decideDelivery("allowlist", "not-an-address", allowlist)).toBe("capture");
    expect(decideDelivery("allowlist", "", allowlist)).toBe("capture");
  });

  it("captures everything when the allowlist is empty", () => {
    expect(decideDelivery("allowlist", "qa.tester@example.ro", [])).toBe("capture");
  });

  it("ignores a malformed allowlist entry instead of failing open", () => {
    expect(decideDelivery("allowlist", "qa.tester@example.ro", ["not-an-address"])).toBe("capture");
  });
});

describe("BR-REQ-080-03 criterion 2 — a QA message is visibly marked", () => {
  it("prefixes the subject in QA", () => {
    expect(markSubjectForEnvironment("Confirmă-ți înscrierea", "qa")).toBe(
      `${QA_SUBJECT_PREFIX}Confirmă-ți înscrierea`,
    );
  });

  it("leaves every other environment's subject alone", () => {
    for (const appEnv of ["local", "test", "production"] as const) {
      expect(markSubjectForEnvironment("Confirmă-ți înscrierea", appEnv)).toBe(
        "Confirmă-ți înscrierea",
      );
    }
  });

  it("does not stack prefixes when a QA message is resent", () => {
    const once = markSubjectForEnvironment("Confirmă-ți înscrierea", "qa");

    expect(markSubjectForEnvironment(once, "qa")).toBe(once);
  });
});

/**
 * `DECISIONS.md` §163 — the one allowlist entry that is not an address.
 */
describe("BR-REQ-080-03 the allowlist's escape hatch", () => {
  it("sends to anyone when the list is a star, and still captures a malformed recipient", () => {
    expect(decideDelivery("allowlist", "stranger@example.org", ["*"])).toBe("send");
    expect(decideDelivery("allowlist", "stranger@example.org", ["ana@dev.test", "*"])).toBe("send");
    expect(decideDelivery("allowlist", "not-an-address", ["*"])).toBe("capture");
    // Without it, nothing changes.
    expect(decideDelivery("allowlist", "stranger@example.org", ["ana@dev.test"])).toBe("capture");
    // Capture still captures, whatever the list says.
    expect(decideDelivery("capture", "ana@dev.test", ["*"])).toBe("capture");
  });
});

/**
 * `DECISIONS.md` §244 — a copy is a recipient.
 *
 * The declaration's archive copy may carry a Cc and a Bcc, and outside production each of
 * those addresses has to face the allowlist on its own. The failure this prevents is the
 * quiet one: an authorized archive mailbox on the "to" line carrying a colleague's address in
 * Bcc, and QA mailing a participant's signed declaration to somebody nobody authorized.
 */
describe("DECISIONS.md §244 the club's copies face the allowlist too", () => {
  const authorized = "qa.tester@example.ro";
  const stranger = "stranger@example.org";

  const senderWith = (mode: "allowlist" | "live" | "capture") => {
    const sent: OutgoingEmail[] = [];
    const adapter = {
      name: "spy",
      async send(message: OutgoingEmail): Promise<SendResult> {
        sent.push(message);
        return { outcome: "sent" as const, providerMessageId: "spy:1" };
      },
    };
    const sender = createEmailSender({
      appEnv: mode === "live" ? "production" : "qa",
      mode,
      allowlist: [authorized],
      capture: adapter,
      live: () => adapter,
    });
    return { sender, sent };
  };

  const message = (): OutgoingEmail => ({
    to: authorized,
    subject: "Declarație semnată",
    html: "<p>x</p>",
    text: "x",
    locale: "ro",
    idempotencyKey: "registration:1:declaration-archive",
    cc: [stranger, authorized],
    bcc: [stranger],
  });

  it("drops an unauthorized copy and keeps the authorized one", async () => {
    const { sender, sent } = senderWith("allowlist");
    await sender.send(message());
    expect(sent[0].cc).toEqual([authorized]);
    expect(sent[0].bcc).toEqual([]);
  });

  it("sends every copy on production, where the allowlist is not consulted", async () => {
    const { sender, sent } = senderWith("live");
    await sender.send(message());
    expect(sent[0].cc).toEqual([stranger, authorized]);
    expect(sent[0].bcc).toEqual([stranger]);
  });

  it("leaves a captured message's lists untouched, so the local record shows what would have gone", async () => {
    const { sender, sent } = senderWith("capture");
    await sender.send(message());
    expect(sent[0].cc).toEqual([stranger, authorized]);
    expect(sent[0].bcc).toEqual([stranger]);
  });

  it("says nothing about copies for a message that has none", async () => {
    const { sender, sent } = senderWith("allowlist");
    const { cc, bcc, ...plain } = message();
    void cc;
    void bcc;
    await sender.send(plain);
    expect(sent[0]).not.toHaveProperty("cc");
    expect(sent[0]).not.toHaveProperty("bcc");
  });
});
