import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { mailLine } from "@/shared/feedback/mail-line";
import { type ConfirmSpec, emailOptOutAnswer, emailOptOutFields, fillFromForm, withEmailOff } from "@/shared/feedback/notice";
import { mailSkippedCount, mailSkippedOf, SEND_EMAIL_FIELD, sendEmailOf, WINDOW_SEND_EMAIL_FIELD } from "@/shared/forms/send-email";

/**
 * «Trimite emailul» (the design «telling the owner about every email a staff press sends», 2026-11-03, slice 4): the one
 * parser of the box, the dialog's answer written into the form, the question as it reads with the box unticked, and the
 * toast's sentence for what the press chose not to send. Pure.
 */

const posted = (entries: readonly [string, string][]) => {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
};

describe("sendEmailOf — the one parser", () => {
  it("sends while any value posted is «on», and when the form offers no choice at all", () => {
    // No field: an older page, a press that offers no box, a form posted without JavaScript before a dialog asked.
    expect(sendEmailOf(posted([]))).toBe(true);
    // A dialog's hidden input, answered.
    expect(sendEmailOf(posted([[SEND_EMAIL_FIELD, "on"]]))).toBe(true);
    expect(sendEmailOf(posted([[SEND_EMAIL_FIELD, "off"]]))).toBe(false);
    // A MailLine's box: ticked posts «on» before its hidden «off»; unticked, the «off» alone.
    expect(sendEmailOf(posted([[SEND_EMAIL_FIELD, "on"], [SEND_EMAIL_FIELD, "off"]]))).toBe(true);
    // The editor's window box has its own field: the save's other boxes never answer for it.
    expect(sendEmailOf(posted([[SEND_EMAIL_FIELD, "off"]]), WINDOW_SEND_EMAIL_FIELD)).toBe(true);
    expect(sendEmailOf(posted([[WINDOW_SEND_EMAIL_FIELD, "off"]]), WINDOW_SEND_EMAIL_FIELD)).toBe(false);
  });

  it("adds `mailSkipped` to an outcome only when the box was unticked: how many emails it kept back, one by default", () => {
    expect(mailSkippedOf(true)).toEqual({});
    expect(mailSkippedOf(true, 3)).toEqual({});
    expect(mailSkippedOf(false)).toEqual({ mailSkipped: "1" });
    // A bulk press: the people it reached.
    expect(mailSkippedOf(false, 3)).toEqual({ mailSkipped: "3" });
    // Unticked over nobody — every address already a member on «Echipa»: no email was kept back, so nothing says one was.
    expect(mailSkippedOf(false, 0)).toEqual({});
    expect(mailSkippedOf(false, -2)).toEqual({});
  });

  it("reads the count back, and nothing the browser rewrote", () => {
    expect(mailSkippedCount("1")).toBe(1);
    expect(mailSkippedCount("21")).toBe(21);
    expect(mailSkippedCount("0")).toBe(0);
    for (const forged of ["yes", "-1", "1.5", "", "1e3", undefined, ["1"]]) expect(mailSkippedCount(forged), String(forged)).toBeNull();
  });
});

describe("the dialog's box", () => {
  const spec: ConfirmSpec = {
    title: "Anulezi?",
    body: "b",
    confirmLabel: "Da",
    cancelLabel: "Nu",
    email: "Pleacă 1 email către {name}: „Înscriere anulată”.",
    road: { group: "confirmations", current: "mailgun", gmail: true, labels: { mailgun: "Mailgun", gmail: "Gmail" }, recommended: "mailgun", why: "w", label: "l" } as unknown as ConfirmSpec["road"],
    also: [{ text: "Și 2 emailuri pentru căsuțele clubului.", withEmail: true }, { text: "Locul eliberat se oferă primului de pe lista de așteptare." }],
    emailOptOut: { field: SEND_EMAIL_FIELD, label: "Trimite emailul", offLine: "Nu pleacă niciun email către {name}." },
    fillFrom: ["name"],
  };

  it("unticked, says the off line, offers no road and drops the email's own lines — the next in line's offer stays", () => {
    const off = withEmailOff(spec, true);
    expect(off.email).toBe("Nu pleacă niciun email către {name}.");
    expect(off.road).toBeUndefined();
    expect(off.also?.map((line) => line.text)).toEqual(["Locul eliberat se oferă primului de pe lista de așteptare."]);
    // Ticked, or a question without the box: the question as worded.
    expect(withEmailOff(spec, false)).toBe(spec);
    const without: ConfirmSpec = { ...spec, emailOptOut: undefined };
    expect(withEmailOff(without, true)).toBe(without);
  });

  it("writes «on» or «off» into its field on «yes», and nothing for a question without the box", () => {
    expect(emailOptOutAnswer(spec, false)).toEqual({ field: SEND_EMAIL_FIELD, value: "on" });
    expect(emailOptOutAnswer(spec, true)).toEqual({ field: SEND_EMAIL_FIELD, value: "off" });
    const without: ConfirmSpec = { ...spec, emailOptOut: undefined };
    expect(emailOptOutAnswer(without, true)).toBeNull();
  });

  it("names every field the questions of one form may answer, once — the refusal's question, with no box, adds none", () => {
    const refusal: ConfirmSpec = { ...spec, emailOptOut: undefined, when: [{ field: "refusedByOrganizer", equals: "on" }] };
    expect(emailOptOutFields([refusal, spec, spec])).toEqual([SEND_EMAIL_FIELD]);
    expect(emailOptOutFields(spec)).toEqual([SEND_EMAIL_FIELD]);
    expect(emailOptOutFields(undefined)).toEqual([]);
  });

  it("fills the person typed into the off line too", () => {
    const filled = fillFromForm(spec, (field) => (field === "name" ? "Ana Pop" : null));
    expect(filled.emailOptOut?.offLine).toBe("Nu pleacă niciun email către Ana Pop.");
  });
});

describe("the toast says what the press chose not to send", () => {
  const words = (locale: "ro" | "en") => {
    const catalogue = locale === "ro" ? ro : en;
    const t = createTranslator({ locale, messages: catalogue.Feedback as never }) as unknown as (key: string, values?: Record<string, string>) => string;
    const types = catalogue.Admin.emails.types as Record<string, string>;
    return { t: (key: string, values?: Record<string, string>) => t(key, values), typeName: (type: string) => types[type] ?? null };
  };
  const line = (values: Record<string, string>, locale: "ro" | "en" = "ro") => {
    const { t, typeName } = words(locale);
    return mailLine(values, t, typeName, locale);
  };

  it("says the email was kept back first, then what else left — the offer to the next in line", () => {
    expect(line({ mailSkipped: "1" })).toBe("1 email nu a plecat: ai debifat „Trimite…”.");
    expect(line({ mailSkipped: "1" }, "en")).toBe("1 email did not go: you unticked “Send…”.");
    // The freed place's offer, the one email the press still sent — to another person.
    const withOffer = line({ mailSkipped: "1", mail: "now", mailTo: "others", mailPeople: "1", mailPressedAt: "2026-11-04T08:00:00.000Z", mailType: "WAITLIST_SPOT_OFFER" });
    expect(withOffer).toBe("1 email nu a plecat: ai debifat „Trimite…”. Pleacă acum: „S-a eliberat un loc” către 1 altă persoană.");
  });

  it("counts the emails a bulk press kept back, in the count's own form — and says nothing when it kept none back", () => {
    expect(line({ mailSkipped: "3" })).toBe("3 emailuri nu au plecat: ai debifat „Trimite…”.");
    expect(line({ mailSkipped: "21" })).toBe("21 de emailuri nu au plecat: ai debifat „Trimite…”.");
    expect(line({ mailSkipped: "3" }, "en")).toBe("3 emails did not go: you unticked “Send…”.");
    expect(line({ mailSkipped: "0" })).toBeNull();
  });

  it("says a publication's new-event alert last: left to the job's next pass, or not sent at all", () => {
    expect(line({ mailAlert: "later" })).toBe(ro.Feedback.mail.alertLater);
    expect(line({ mailAlert: "skipped" }, "en")).toBe(en.Feedback.mail.alertSkipped);
    // A value the browser rewrote is no line.
    expect(line({ mailAlert: "soon", mailSkipped: "yes" })).toBeNull();
  });
});
