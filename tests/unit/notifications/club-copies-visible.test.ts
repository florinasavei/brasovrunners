import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addressListRefusal,
  CONTACT_RECIPIENTS_MAX,
  invalidAddresses,
  parseAddressList,
} from "@/modules/contact/domain/recipients";
import {
  CLUB_NOTICE_BOXES,
  CLUB_NOTICE_RECIPIENTS_MAX,
  clubNoticeBoxesOf,
  clubNoticesSchema,
  mailboxesReceivingCopies,
} from "@/modules/notifications/domain/club-notices";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §NNN — the club's copies (Bcc) on `/admin/emails` are shown back and can be
 * saved, with a visible reason when refused. The owner, 2026-09-26: "trebuie să pot vedea pe
 * cine am pus în BCC, nu pot salva aparent...".
 *
 * Three causes, one test each: addresses separated by a space or a line were one invalid entry;
 * the refusal named `participants`, which is no box, under "check what you entered"; and the
 * declaration's Cc and Bcc, saved while no archive address is set, were named nowhere on the
 * panel ("Nicio adresă"), so a save that had worked read as one that had not.
 */
const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("§NNN the club's copies are shown back and can be saved", () => {
  it("reads spaces and line breaks as separators, since no address can hold one", () => {
    expect(parseAddressList("arhiva@example.ro presedinte@example.ro")).toEqual(["arhiva@example.ro", "presedinte@example.ro"]);
    expect(parseAddressList("arhiva@example.ro\r\npresedinte@example.ro\n\n")).toEqual(["arhiva@example.ro", "presedinte@example.ro"]);
    expect(parseAddressList(" arhiva@example.ro ,\tpresedinte@example.ro; ")).toEqual(["arhiva@example.ro", "presedinte@example.ro"]);
    // What the owner typed now saves: the schema accepts the list the parser makes of it.
    const parsed = clubNoticesSchema.safeParse({ participants: { bcc: parseAddressList("arhiva@example.ro\npresedinte@example.ro") } });
    expect(parsed.success && parsed.data.participants.bcc).toEqual(["arhiva@example.ro", "presedinte@example.ro"]);
  });

  it("names the entries that are not addresses, each once, in the order typed", () => {
    expect(invalidAddresses(["arhiva@example.ro", "Ana", "arhiva", "Ana", "", `${"a".repeat(64)}@${"b".repeat(260)}.ro`])).toEqual([
      "Ana",
      "arhiva",
      `${"a".repeat(64)}@${"b".repeat(260)}.ro`,
    ]);
    expect(invalidAddresses(["arhiva@example.ro", "Presedinte@Example.ro"])).toEqual([]);
  });

  it("says why a list was refused: the entries first, then the ceiling, else nothing", () => {
    expect(addressListRefusal([["arhiva@example.ro"], ["nope", "x@"]], CLUB_NOTICE_RECIPIENTS_MAX)).toEqual({
      error: "INVALID_ADDRESSES",
      errorValues: { addresses: "nope, x@" },
    });
    const eleven = Array.from({ length: CONTACT_RECIPIENTS_MAX + 1 }, (_, index) => `club${index}@example.ro`);
    expect(addressListRefusal([[], eleven], CONTACT_RECIPIENTS_MAX)).toEqual({
      error: "TOO_MANY_ADDRESSES",
      errorValues: { max: String(CONTACT_RECIPIENTS_MAX) },
    });
    expect(addressListRefusal([["arhiva@example.ro"]], CLUB_NOTICE_RECIPIENTS_MAX)).toBeNull();
  });

  it("maps every list the schema validates to the box the panel posts", () => {
    // Every list path the schema can refuse has a box, and every box is one the panel draws.
    const panel = read("src/modules/notifications/ui/ClubNoticesPanel.tsx");
    for (const [listPath, box] of Object.entries(CLUB_NOTICE_BOXES)) {
      const [group, list] = listPath.split(".");
      const refused = clubNoticesSchema.safeParse({ [group]: { [list]: list === "to" && group === "declarations" ? "nope" : ["nope"] } });
      expect(refused.success, listPath).toBe(false);
      if (!refused.success) expect(refused.error.issues.map((issue) => issue.path.slice(0, 2).join("."))).toContain(listPath);
      expect(panel, box).toContain(`name="${box}"`);
    }
    expect(clubNoticeBoxesOf(["participants.bcc", "declarations.cc", "participants.bcc"])).toEqual(["participantsBcc", "declarationsCc"]);
    // A path with no box names nothing, rather than a link to nowhere.
    expect(clubNoticeBoxesOf(["participants", "declarations"])).toEqual([]);
  });

  it("the action maps the refusal to the boxes and says which entry, for both address forms", () => {
    const actions = read("src/app/[locale]/admin/emails/actions.ts");
    expect(actions).toContain("fieldNames: (domain) => clubNoticeBoxesOf(domain.fields)");
    expect(actions).toContain("addressListRefusal(lists, CLUB_NOTICE_RECIPIENTS_MAX)");
    expect(actions).toContain('addressListRefusal([list("to"), list("cc"), list("bcc")], CONTACT_RECIPIENTS_MAX)');
    expect(actions).toContain('error: "ONE_ADDRESS_ONLY", fields: ["declarationsTo"]');
    // The one-address check runs after the role is asserted, never before it.
    const body = actions.slice(actions.indexOf("export async function updateClubNoticesAction"));
    expect(body.indexOf('requireStaffRole("ADMIN")')).toBeLessThan(body.indexOf("ONE_ADDRESS_ONLY"));
  });

  it("the panel names every list in force, the idle declaration copies, and the mailboxes on the closed fold", () => {
    const panel = read("src/modules/notifications/ui/ClubNoticesPanel.tsx");
    expect(panel).toContain('t("emails.clubNotices.confirmationsInForce"');
    expect(panel).toContain('t("emails.clubNotices.participantsInForce"');
    expect(panel).toContain('t("emails.clubNotices.declarationCopiesIdle"');
    expect(panel).toContain("declarations.to === null && declarations.cc.length + declarations.bcc.length > 0");
    expect(panel).toContain('t("emails.clubNotices.asideNames"');
    // The four list boxes grow with what they hold.
    expect(panel.match(/\{\.\.\.listBox\}/g)).toHaveLength(4);
  });

  it("the closed fold names only the mailboxes that receive something: idle declaration Cc/Bcc are left out", () => {
    const notices = { confirmations: { to: ["Anunt@example.ro"] }, participants: { bcc: ["presedinte@example.ro", "anunt@example.ro"] } };
    // No archive address: the declaration's Cc and Bcc are kept but nothing sends them (§244).
    const idle = { to: null, cc: ["cc@example.ro"], bcc: ["bcc@example.ro"], source: "none" } as const;
    expect(mailboxesReceivingCopies(idle, notices)).toEqual(["Anunt@example.ro", "presedinte@example.ro"]);
    // With an archive address they receive the copy, and are named.
    const live = { ...idle, to: "arhiva@example.ro", source: "setting" } as const;
    expect(mailboxesReceivingCopies(live, notices)).toEqual([
      "arhiva@example.ro",
      "cc@example.ro",
      "bcc@example.ro",
      "Anunt@example.ro",
      "presedinte@example.ro",
    ]);
    const nobody = { confirmations: { to: [] }, participants: { bcc: [] } };
    expect(mailboxesReceivingCopies(idle, nobody)).toEqual([]);
  });

  it("one archive address with a trailing separator is that address, not a refusal", () => {
    for (const typed of ["arhiva@example.ro;", "arhiva@example.ro,", " arhiva@example.ro\n"]) {
      const to = parseAddressList(typed)[0] ?? "";
      expect(to, typed).toBe("arhiva@example.ro");
      expect(clubNoticesSchema.safeParse({ declarations: { to } }).success, typed).toBe(true);
    }
    const actions = read("src/app/[locale]/admin/emails/actions.ts");
    expect(actions).toContain('to: list("declarationsTo")[0] ?? ""');
  });

  it("every new sentence exists in both languages, with the same placeholders", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of ["INVALID_ADDRESSES", "TOO_MANY_ADDRESSES", "ONE_ADDRESS_ONLY"] as const) {
      expect(ro.Admin.errors[key], key).toBeTruthy();
      expect(placeholders(ro.Admin.errors[key])).toEqual(placeholders(en.Admin.errors[key]));
    }
    for (const key of ["asideNames", "confirmationsInForce", "declarationCopiesIdle"] as const) {
      expect(ro.Admin.emails.clubNotices[key], key).toBeTruthy();
      expect(placeholders(ro.Admin.emails.clubNotices[key])).toEqual(placeholders(en.Admin.emails.clubNotices[key]));
    }
    // The closed fold's sentence still starts as the end-to-end suite reads it.
    expect(ro.Admin.emails.clubNotices.asideNames.startsWith("Adrese care primesc copii: {count}")).toBe(true);
    expect(ro.Admin.errors.INVALID_ADDRESSES).toContain("{addresses}");
    expect(ro.Admin.errors.TOO_MANY_ADDRESSES).toContain("{max}");
  });
});
