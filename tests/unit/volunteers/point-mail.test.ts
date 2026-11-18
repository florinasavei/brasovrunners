import { describe, expect, it } from "vitest";
import { emailMessageType, emailOutboxStatus } from "@/db/schema/email-outbox";
import { CANNOT_COME_MESSAGES } from "@/modules/notifications/domain/cannot-come";
import { isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import { audienceOf, isClubSide, recipientRoleOf } from "@/modules/notifications/domain/email-audience";
import { emailCopyKey, emailCopySchema } from "@/modules/notifications/domain/email-copy";
import { isWaitedFor } from "@/modules/notifications/domain/email-delay";
import { EMAIL_GROUP_OF, emailGroupOf } from "@/modules/notifications/domain/email-transport";
import { isJobCause, mainTypesOf, PRESS_CAUSE_NAMES } from "@/modules/notifications/domain/press-causes";
import { isRelayMessage } from "@/modules/notifications/domain/relay";
import { emailCopyPrefill, emailSampleFor, placeholdersFilledBy, placeholdersUsedBy } from "@/modules/notifications/email-copy-fields";
import { renderBilingual, type TemplateData } from "@/modules/notifications/templates";
import { alreadyTold, type PointMailRow, volunteerPointKey } from "@/modules/volunteers/point-mail";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §956, BR-REQ-080-02 — «Trimite fiecăruia punctul lui» writes to nobody twice, and its memory is the outbox's own rows:
 * `alreadyTold` is the whole rule, pure, over one person's `VOLUNTEER_POINT` rows. Told is a message that reached them, or
 * the newest one still waiting to leave, naming the point they stand at now at the address their row holds now. Not told is
 * everything else — and above all a message that failed, was refused by the receiving server, or was withdrawn at the send
 * (the outbox deletes that row, so it is simply not among them). What the press does with the answer, from a real
 * database, is `tests/integration/volunteers/plan-mail.test.ts`.
 *
 * Then the message type itself (BR-REQ-080-01): classed like `VOLUNTEER_ROLE_ASSIGNED` — its road, its audience, no wait,
 * no club copy — with one press that queues it, its words on «Emailuri» in both languages, and the club's own text taken
 * between the platform's lines about the point, never instead of them.
 */
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ADDRESS = "ana.pop@example.test";
const person = { checkpointId: A, canonicalEmail: ADDRESS };
const row = (over: Partial<PointMailRow> = {}): PointMailRow => ({ checkpointId: A, round: 1, status: "SENT", recipientEmail: ADDRESS, ...over });

describe("§956 whether a volunteer was already told the point they stand at", () => {
  it("is not told with no message at all — never queued, or the one queued was withdrawn at the send and deleted", () => {
    expect(alreadyTold(person, [])).toBe(false);
  });

  it("is told by a message that left for that point at that address, and by one the person then marked as spam", () => {
    expect(alreadyTold(person, [row({ status: "SENT" })])).toBe(true);
    // A complaint is the person's own word about a message that reached their inbox: they were told.
    expect(alreadyTold(person, [row({ status: "COMPLAINED" })])).toBe(true);
  });

  it("is told by the newest message while it waits to leave: queued, or being sent", () => {
    expect(alreadyTold(person, [row({ status: "PENDING" })])).toBe(true);
    expect(alreadyTold(person, [row({ status: "PROCESSING" })])).toBe(true);
  });

  it("is not told by a message that failed for good or was refused by the receiving server: it reached nobody", () => {
    expect(alreadyTold(person, [row({ status: "FAILED" })])).toBe(false);
    expect(alreadyTold(person, [row({ status: "BOUNCED" })])).toBe(false);
    // …and an earlier failure does not unsay a later message that did leave, nor an earlier success outlive a newer waiting one.
    expect(alreadyTold(person, [row({ round: 1, status: "FAILED" }), row({ round: 2, status: "SENT" })])).toBe(true);
    expect(alreadyTold(person, [row({ round: 1, status: "BOUNCED" }), row({ round: 2, status: "PENDING" })])).toBe(true);
    // A failure after a message that reached them: the point is still the one they were told.
    expect(alreadyTold(person, [row({ round: 1, status: "SENT" }), row({ round: 2, status: "FAILED" })])).toBe(true);
  });

  it("decides every status the outbox has: a new one must be classified here before it ships", () => {
    const told = emailOutboxStatus.enumValues.filter((status) => alreadyTold(person, [row({ status })]));
    expect(told.sort()).toEqual(["COMPLAINED", "PENDING", "PROCESSING", "SENT"]);
    expect([...emailOutboxStatus.enumValues].sort()).toEqual(["BOUNCED", "COMPLAINED", "FAILED", "PENDING", "PROCESSING", "SENT"]);
  });

  it("is not told the point they stand at now by a message about another point: moved since", () => {
    expect(alreadyTold(person, [row({ checkpointId: B })])).toBe(false);
    expect(alreadyTold(person, [row({ checkpointId: B, status: "PENDING" })])).toBe(false);
    expect(alreadyTold(person, [row({ checkpointId: null })])).toBe(false);
  });

  it("goes by the last thing the person heard: told A, then B, then moved back to A is not told A", () => {
    const heardBLast = [row({ round: 1, checkpointId: A }), row({ round: 2, checkpointId: B })];
    expect(alreadyTold(person, heardBLast)).toBe(false);
    // The rows in whatever order the database returns them.
    expect(alreadyTold(person, [...heardBLast].reverse())).toBe(false);
    // Told again since: told.
    expect(alreadyTold(person, [...heardBLast, row({ round: 3, checkpointId: A })])).toBe(true);
  });

  it("keeps a point told earlier while the newer message about another point never left: moved to B and back before the send", () => {
    // Round 2 (for B) still waits and will be withdrawn at the send — the person stands at A again, which round 1 told them.
    expect(alreadyTold(person, [row({ round: 1, checkpointId: A, status: "SENT" }), row({ round: 2, checkpointId: B, status: "PENDING" })])).toBe(true);
    // …but while they stand at B, the waiting message for B is the telling.
    expect(alreadyTold({ ...person, checkpointId: B }, [row({ round: 1, checkpointId: A, status: "SENT" }), row({ round: 2, checkpointId: B, status: "PENDING" })])).toBe(true);
  });

  it("only counts the newest message as on its way: an older one still waiting is withdrawn at the send", () => {
    // Round 1 waits for A, round 2 was queued for B and failed: nothing naming A will leave (the send withdraws round 1).
    expect(alreadyTold(person, [row({ round: 1, checkpointId: A, status: "PENDING" }), row({ round: 2, checkpointId: B, status: "FAILED" })])).toBe(false);
  });

  it("is not told at an address corrected since — and compares addresses through the canonicalizer, never as typed", () => {
    expect(alreadyTold(person, [row({ recipientEmail: "ana.veche@example.test" })])).toBe(false);
    expect(alreadyTold(person, [row({ recipientEmail: "ana.veche@example.test", status: "PENDING" })])).toBe(false);
    // The same mailbox, typed in capitals with a space after it: one identity (AGENTS.md §10.4).
    expect(alreadyTold(person, [row({ recipientEmail: " Ana.Pop@Example.TEST " })])).toBe(true);
    // An address that is none is nobody's.
    expect(alreadyTold(person, [row({ recipientEmail: "not an address" })])).toBe(false);
  });
});

describe("§956 `VOLUNTEER_POINT`: a message type classed like the role's own", () => {
  it("is a value of the enum, takes the role message's road and audience, and is waited for by nobody on a page", () => {
    expect(emailMessageType.enumValues).toContain("VOLUNTEER_POINT");
    expect(isRelayMessage("VOLUNTEER_POINT")).toBe(false);
    // The road (§443): the confirmations', as the organizers' other answer to the person's offer.
    expect(EMAIL_GROUP_OF.VOLUNTEER_POINT).toBe("confirmations");
    expect(EMAIL_GROUP_OF.VOLUNTEER_POINT).toBe(EMAIL_GROUP_OF.VOLUNTEER_ROLE_ASSIGNED);
    expect(emailGroupOf("VOLUNTEER_POINT", false)).toBe(emailGroupOf("VOLUNTEER_ROLE_ASSIGNED", false));
    // The audience: a person of the public — no registration behind it, never the club's mailbox or the staff's.
    expect(audienceOf("VOLUNTEER_POINT")).toBe("public");
    expect(audienceOf("VOLUNTEER_POINT")).toBe(audienceOf("VOLUNTEER_ROLE_ASSIGNED"));
    expect(recipientRoleOf("VOLUNTEER_POINT", false)).toBe(recipientRoleOf("VOLUNTEER_ROLE_ASSIGNED", false));
    expect(isClubSide("VOLUNTEER_POINT", false)).toBe(false);
    // It leaves at an organizer's press, to people on no page: the public delay line never counts it.
    expect(isWaitedFor("VOLUNTEER_POINT", false)).toBe(false);
    // No registration behind it: no club copy a message (§320), no «Nu mai pot ajunge».
    expect(isParticipantMessage("VOLUNTEER_POINT")).toBe(false);
    expect(CANNOT_COME_MESSAGES.has("VOLUNTEER_POINT")).toBe(false);
  });

  it("has one press, its own cause, and its words on «Emailuri» and «Emailuri azi» in both languages", () => {
    expect(mainTypesOf("volunteers.sendPoints")).toEqual(["VOLUNTEER_POINT"]);
    expect(isJobCause("volunteers.sendPoints")).toBe(false);
    // No other press or job names it: nothing else may queue it.
    expect(PRESS_CAUSE_NAMES.filter((cause) => mainTypesOf(cause).includes("VOLUNTEER_POINT"))).toEqual(["volunteers.sendPoints"]);
    for (const catalogue of [ro, en]) {
      const emails = catalogue.Admin.emails;
      for (const words of [emails.types, emails.when, emails.whenShort, emails.whenMore]) expect(words.VOLUNTEER_POINT).toEqual(expect.any(String));
      expect(emails.causes.volunteers.sendPoints).toBe(catalogue.Admin.volunteers.plan.mail.send);
      expect(catalogue.Admin.confirm.mail.audience.volunteersNotTold).toEqual(expect.any(String));
      expect(catalogue.Admin.confirm.mail.audience.volunteersAtPoints).toEqual(expect.any(String));
    }
  });

  it("carries the fields the role's message carries, and starts the club's editor from words that name the event alone", () => {
    expect(placeholdersFilledBy("VOLUNTEER_POINT")).toEqual(placeholdersFilledBy("VOLUNTEER_ROLE_ASSIGNED"));
    for (const locale of ["ro", "en"] as const) {
      expect(placeholdersUsedBy("VOLUNTEER_POINT", locale)).toEqual(["eventTitle"]);
      const prefill = emailCopyPrefill("VOLUNTEER_POINT", locale);
      expect(prefill.subject).toContain("{eventTitle}");
      // The point, the roles and the picture are the platform's own lines: no word of them is the club's to keep in a text.
      expect(prefill.paragraphs.join("\n")).not.toMatch(/km|Rolul|role|poz|picture/i);
    }
  });

  it("keeps the point, its note, the roles and the picture whoever wrote the words: the club's own text goes between them", () => {
    const copy = emailCopySchema.parse({
      [emailCopyKey("VOLUNTEER_POINT", "ro")]: { subject: "Unde stai la {eventTitle}", paragraphs: ["Ne vedem sâmbătă la {eventTitle}. Adu frontala."] },
    });
    const data: TemplateData = {
      ...emailSampleFor("VOLUNTEER_POINT", "ro"),
      volunteer: { name: "Ana Popescu", roleRo: "Direcționare (Traseu)", roleEn: "Guidance (Route)", roleCount: 1, roleDescriptionRo: "Arăți drumul.", roleDescriptionEn: "Show the way.", chosenRo: [], chosenEn: [] },
      volunteerPoint: {
        number: 3,
        nameRo: "Apă la cabană",
        nameEn: "Water at the hut",
        km: 5.5,
        noteRo: "Pahare în cutia albastră.",
        noteEn: "Cups in the blue box.",
        pictures: [{ displayUrl: "https://media.example.test/plan/1280w.webp", fullUrl: "https://media.example.test/plan/web.webp", width: 2400, height: 1600 }],
        // The plan's links (§978): one with its label, one with none — said by its host.
        links: [
          { url: "https://maps.example.test/d/viewer?mid=1", label: "Harta voluntarilor", host: "maps.example.test" },
          { url: "https://docs.example.test/plan", label: null, host: "docs.example.test" },
        ],
      },
    };
    const message = renderBilingual("VOLUNTEER_POINT", "ro", data, undefined, copy);
    const [roHalf, enHalf] = message.text.split("\n— — —\n");
    expect(message.subject).toContain("Unde stai la Crosul de toamnă");
    // The club's words…
    expect(roHalf).toContain("Ne vedem sâmbătă la Crosul de toamnă. Adu frontala.");
    expect(roHalf).not.toContain("Organizatorii te-au pus la un punct");
    // …between the platform's own lines, in the order a reader needs them: the point, its note, the role, then the words, then the picture.
    const order = ["▶ Punctul tău la Crosul de toamnă: 3. 5,5 km — Apă la cabană", "De știut la acest punct\nPahare în cutia albastră.", "Rolul tău: Direcționare (Traseu).", "Ce presupune rolul: Arăți drumul.", "Ne vedem sâmbătă", "Planul voluntarilor pe traseu, ca poză: https://media.example.test/plan/web.webp", "Hărțile și linkurile planului\nHarta voluntarilor: https://maps.example.test/d/viewer?mid=1\ndocs.example.test: https://docs.example.test/plan"];
    const positions = order.map((part) => roHalf.indexOf(part));
    expect(positions.every((position) => position >= 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // The English half keeps the platform's words — the club rewrote the Romanian ones alone — and the same lines.
    expect(enHalf).toContain("The organizers have put you at a point of the route");
    expect(enHalf).toContain("▶ Your point at The autumn cross: 3. 5.5 km — Water at the hut");
    expect(enHalf).toContain("Your role: Guidance (Route).");
    // The picture once, in the first half; the link to the whole of it in both.
    expect(message.html.match(/<img src="https:\/\/media\.example\.test\/plan\/1280w\.webp"/g)).toHaveLength(1);
    expect(message.html.match(/href="https:\/\/media\.example\.test\/plan\/web\.webp"/g)).toHaveLength(3);
    expect(message.html).toContain('width="550"');
    // The links in both halves (§978), each its label or its host, linked; the plain text writes the addresses out.
    expect(message.html.match(/<a href="https:\/\/maps\.example\.test\/d\/viewer\?mid=1"[^>]*>Harta voluntarilor<\/a>/g)).toHaveLength(2);
    expect(message.html.match(/<a href="https:\/\/docs\.example\.test\/plan"[^>]*>docs\.example\.test<\/a>/g)).toHaveLength(2);
    expect(enHalf).toContain("The plan's maps and links\nHarta voluntarilor: https://maps.example.test/d/viewer?mid=1");
  });

  it("carries every picture of the plan in its order, each named by its number, and none of them twice (§978)", () => {
    const pictures = [1, 2, 3].map((n) => ({ displayUrl: `https://media.example.test/p${n}/1280w.webp`, fullUrl: `https://media.example.test/p${n}/web.webp`, width: 1600, height: 1200 }));
    const sample = emailSampleFor("VOLUNTEER_POINT", "ro");
    const data: TemplateData = { ...sample, volunteerPoint: { ...sample.volunteerPoint!, pictures, links: [] } };
    const message = renderBilingual("VOLUNTEER_POINT", "ro", data, undefined, null);
    // The first half: each picture once, in the plan's order; the second half the links to them alone.
    const images = [...message.html.matchAll(/<img src="https:\/\/media\.example\.test\/(p\d)\/1280w\.webp"/g)].map((match) => match[1]);
    expect(images).toEqual(["p1", "p2", "p3"]);
    expect(message.html).toContain("Deschide poza 2 din 3 a planului (întreagă)");
    expect(message.html).toContain("Open picture 3 of 3 of the plan (the whole of it)");
    expect(message.html).not.toContain('data-email-part="volunteer-plan-links"');
    const [roHalf] = message.text.split("\n— — —\n");
    expect(roHalf).toContain("Planul voluntarilor, poza 1 din 3: https://media.example.test/p1/web.webp");
    expect(roHalf.indexOf("poza 1 din 3")).toBeLessThan(roHalf.indexOf("poza 3 din 3"));
  });

  it("previews on «Emailuri» with a made-up point, its note, one picture and one link — no role, nothing of a volunteer's", () => {
    const preview = renderBilingual("VOLUNTEER_POINT", "ro", emailSampleFor("VOLUNTEER_POINT", "ro"), undefined, null);
    expect(preview.text).toContain("▶ Punctul tău la Crosul de toamnă: 3. 5,5 km — Apă la cabană");
    expect(preview.text).toContain("▶ Your point at The autumn cross: 3. 5.5 km — Water at the hut");
    expect(preview.text).toContain("De știut la acest punct");
    expect(preview.text).not.toMatch(/Rolul tău|Your role|Ce presupune|What the role/);
    // One picture and one link of the plan (§978), at the site's own address: none of the club's stored pictures. The
    // picture's part stands in both halves — drawn in the first, its link alone in the second —, the links' too.
    expect(preview.html.match(/data-email-part="volunteer-plan-picture"/g)).toHaveLength(2);
    expect(preview.html.match(/<img src="[^"]*\/brand\/logo-email-banner\.png" alt="Planul voluntarilor desenat pe traseu"/g)).toHaveLength(1);
    expect(preview.html.match(/data-email-part="volunteer-plan-links"/g)).toHaveLength(2);
    expect(preview.text).toMatch(/Harta voluntarilor \(Google My Maps\): https?:\/\/\S+\/ro\/EXAMPLE-map/);
    // The sample's point is that one message's alone: the role's own preview never shows it.
    const role = renderBilingual("VOLUNTEER_ROLE_ASSIGNED", "ro", emailSampleFor("VOLUNTEER_ROLE_ASSIGNED", "ro"), undefined, null);
    expect(role.text).not.toMatch(/Apă la cabană|Water at the hut|Punctul tău|Your point/);
  });
});

describe("§956 the outbox key of one telling", () => {
  it("is one key a person, a point and a telling: the unique key keeps it one row", () => {
    expect(volunteerPointKey("v1", "p1", 1)).toBe("volunteer-point:v1:p1:1");
    const keys = [volunteerPointKey("v1", "p1", 1), volunteerPointKey("v1", "p1", 2), volunteerPointKey("v1", "p2", 1), volunteerPointKey("v2", "p1", 1)];
    expect(new Set(keys).size).toBe(4);
    // The same telling asked twice is the same key: the second insert is the database's own refusal.
    expect(volunteerPointKey("v1", "p1", 1)).toBe(keys[0]);
  });
});
