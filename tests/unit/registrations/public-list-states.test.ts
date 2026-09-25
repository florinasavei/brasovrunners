import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { registrationStatus } from "@/db/schema/registrations";
import { othersPhrases } from "@/modules/events/ui/counted-phrases";
import { describesListStates, isMergeField, mergeText } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import {
  LIST_STATE_KEYS,
  PENDING_LIST_STATUSES,
  PUBLIC_LIST_GROUPS,
  publicListGroupOf,
  WAITLISTED_LIST_STATUSES,
} from "@/modules/registrations/domain/public-list-states";
import { startListPage } from "@/modules/registrations/domain/start-list-page";
import { listStatesClause, listStatesMergeValues, listStateWords } from "@/modules/registrations/list-state-words";

/**
 * BR-REQ-039-01, `DECISIONS.md` §NNN (amending §32 and §143) — the public list says where each
 * registration stands, and lists the pending and the waiting list too, once the privacy notice in
 * force describes it. The pure half: which state is which group, which words, which states never
 * appear, and the marker that switches it on.
 */
function translator(locale: "ro" | "en") {
  return createTranslator({ locale, messages: locale === "ro" ? ro.Event : en.Event, namespace: undefined }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
}

describe("§NNN the three groups", () => {
  it("shows the confirmed, the pending and the waiting — and no other state", () => {
    const groups = Object.fromEntries(registrationStatus.enumValues.map((status) => [status, publicListGroupOf(status)]));
    expect(groups).toEqual({
      PENDING_EMAIL_CONFIRMATION: null,
      PENDING_DECLARATION: "PENDING",
      WAITLISTED: "WAITLISTED",
      WAITLIST_OFFERED: "PENDING",
      CONFIRMED: "CONFIRMED",
      CANCELLED: null,
      EXPIRED: null,
    });
    // The repository's filters read these lists: none of them may name a withdrawal or an
    // address nobody has proved.
    for (const never of ["PENDING_EMAIL_CONFIRMATION", "CANCELLED", "EXPIRED"]) {
      expect([...PENDING_LIST_STATUSES, ...WAITLISTED_LIST_STATUSES]).not.toContain(never);
    }
    expect(PUBLIC_LIST_GROUPS).toEqual(["CONFIRMED", "PENDING", "WAITLISTED"]);
  });

  it("names each group in the owner's words, in both catalogues, under the same keys", () => {
    expect(ro.Event.startList.states).toEqual({
      confirmed: "Confirmat",
      pending: "Înscris, în așteptarea confirmării",
      waitlisted: "Pe lista de așteptare",
    });
    expect(en.Event.startList.states).toEqual({
      confirmed: "Confirmed",
      pending: "Registered, awaiting confirmation",
      waitlisted: "On the waiting list",
    });
    for (const group of PUBLIC_LIST_GROUPS) {
      expect(listStateWords("ro")[LIST_STATE_KEYS[group]]).toBe(ro.Event.startList.states[LIST_STATE_KEYS[group]]);
      expect(listStateWords("en")[LIST_STATE_KEYS[group]]).toBe(en.Event.startList.states[LIST_STATE_KEYS[group]]);
    }
  });
});

describe("§NNN the privacy notice's marker", () => {
  const text = (paragraph: string) => ({ sections: [{ paragraphs: [paragraph] }] });

  it("is a merge field the platform's notice and terms carry, in both languages", () => {
    expect(isMergeField("participantListStates")).toBe(true);
    expect(describesListStates(privacyNoticeRo)).toBe(true);
    expect(describesListStates(privacyNoticeEn)).toBe(true);
    // The terms say it too, so the two texts the club approves together agree.
    expect(describesListStates(termsRo)).toBe(true);
    expect(describesListStates(termsEn)).toBe(true);
    // The legal editor's legend lists it, with the words it becomes.
    const legend = DECLARATION_TOKENS.find((entry) => entry.token === "{{participantListStates}}");
    expect(legend?.example).toEqual({ ro: listStatesClause("ro"), en: listStatesClause("en") });
  });

  it("is off for a text that does not name it — an older notice, an unreadable body", () => {
    expect(describesListStates(text("Lista publică arată doar numele participanților confirmați."))).toBe(false);
    expect(describesListStates("not a body")).toBe(false);
    expect(describesListStates({ sections: [] })).toBe(false);
    // Spaced inside the braces, or in a heading: wherever the merge would fill it.
    expect(describesListStates(text("Stadiul: {{ participantListStates }}."))).toBe(true);
    expect(describesListStates({ sections: [{ heading: "{{participantListStates}}", paragraphs: [] }] })).toBe(true);
    // A near miss is not the marker.
    expect(describesListStates(text("{{participantListState}}"))).toBe(false);
  });

  it("is filled with the three words the list prints, quoted, in the notice's language", () => {
    expect(listStatesClause("ro")).toBe("„Confirmat”, „Înscris, în așteptarea confirmării” sau „Pe lista de așteptare”");
    expect(listStatesClause("en")).toBe("“Confirmed”, “Registered, awaiting confirmation” or “On the waiting list”");
    const merged = mergeText("stadiul — {{participantListStates}} —", listStatesMergeValues("ro"));
    expect(merged).toBe("stadiul — „Confirmat”, „Înscris, în așteptarea confirmării” sau „Pe lista de așteptare” —");
    // The platform's notice, merged, carries every word and no dotted blank where the marker was.
    for (const [locale, body] of [["ro", privacyNoticeRo], ["en", privacyNoticeEn]] as const) {
      const all = body.sections.flatMap((section) => section.paragraphs).map((paragraph) => mergeText(paragraph, listStatesMergeValues(locale))).join(" ");
      for (const word of Object.values(listStateWords(locale))) expect(all).toContain(word);
      expect(all).not.toContain("{{participantListStates}}");
    }
  });
});

describe("§NNN the counted line for the rows after the confirmed ones", () => {
  it("names each group with a count, and leaves out a group with nobody in it", () => {
    const ro_ = translator("ro");
    expect(othersPhrases(ro_, "ro", { pending: 1, waitlisted: 3 })).toEqual([
      "1 înscris în așteptarea confirmării",
      "3 pe lista de așteptare",
    ]);
    expect(othersPhrases(ro_, "ro", { pending: 20, waitlisted: 0 })).toEqual(["20 de înscriși în așteptarea confirmării"]);
    expect(othersPhrases(ro_, "ro", { pending: 0, waitlisted: 0 })).toEqual([]);
    const en_ = translator("en");
    expect(othersPhrases(en_, "en", { pending: 2, waitlisted: 1 })).toEqual([
      "2 registered, awaiting confirmation",
      "1 on the waiting list",
    ]);
  });
});

describe("§NNN the pending and waiting rows page after every confirmed one", () => {
  it("asks for none of them while a page is full of confirmed rows", () => {
    expect(startListPage(40, 10, "1", 50, 7)).toMatchObject({ pages: 2, namedLimit: 40, anonymousOnPage: 10, othersLimit: 0, confirmed: 50, total: 57 });
    expect(startListPage(40, 10, "2", 50, 7)).toMatchObject({ namedLimit: 0, anonymousOnPage: 0, othersOffset: 0, othersLimit: 7 });
  });

  it("fills the room the confirmed rows leave, and carries the rest to the next page", () => {
    const first = startListPage(30, 5, "1", 50, 40);
    expect(first).toMatchObject({ pages: 2, namedLimit: 30, anonymousOnPage: 5, othersOffset: 0, othersLimit: 15 });
    const second = startListPage(30, 5, "2", 50, 40);
    expect(second).toMatchObject({ namedLimit: 0, anonymousOnPage: 0, othersOffset: 15, othersLimit: 25 });
    // Nobody twice, nobody dropped.
    expect(first.othersLimit + second.othersLimit).toBe(40);
  });

  it("is today's arithmetic when there are none — the gate off", () => {
    expect(startListPage(48, 5, "1", 50)).toMatchObject({ namedLimit: 48, anonymousOnPage: 2, othersLimit: 0, confirmed: 53, total: 53 });
    // A list of only pending or waiting rows is still a list.
    expect(startListPage(0, 0, "1", 50, 3)).toMatchObject({ pages: 1, othersLimit: 3, confirmed: 0, total: 3 });
  });
});
