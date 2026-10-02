import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { hiddenListBibStartOf, hiddenListCounting } from "@/modules/registrations/domain/hidden-list";
import HiddenListChip from "@/modules/registrations/ui/HiddenListChip";
import HiddenListRadio from "@/modules/registrations/ui/HiddenListRadio";
import IncognitoIcon from "@/shared/ui/IncognitoIcon";

/**
 * §NNN — «Lista ascunsă» (amending §643): the name, the incognito glyph, the radio, and the event's
 * settings as the rest of the code reads them.
 */
const ROOT = path.resolve(__dirname, "../../..");
/** The radio input of a value, as rendered, whatever the order of its attributes. */
const radio = (html: string, value: string) => (html.match(/<input[^>]*>/g) ?? []).find((tag) => tag.includes(`value="${value}"`)) ?? "";
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

describe("§NNN the event's settings, as read", () => {
  it("the hidden list acts only while «Folosește lista ascunsă» is on; «Arată public numărătoarea» on every event", () => {
    expect(hiddenListCounting(null)).toEqual({ countPublic: true, countHidden: false });
    // «Arată public numărătoarea» acts on every event; «Numără și lista ascunsă» only with the switch on.
    expect(hiddenListCounting({ hiddenListEnabled: false, participantCountPublic: false, hiddenListCounted: true })).toEqual({ countPublic: false, countHidden: false });
    expect(hiddenListCounting({ hiddenListEnabled: false, participantCountPublic: true, hiddenListCounted: true })).toEqual({ countPublic: true, countHidden: false });
    expect(hiddenListCounting({ hiddenListEnabled: true, participantCountPublic: false, hiddenListCounted: true })).toEqual({ countPublic: false, countHidden: true });
    expect(hiddenListCounting({ hiddenListEnabled: true, participantCountPublic: true, hiddenListCounted: false })).toEqual({ countPublic: true, countHidden: false });
    expect(hiddenListBibStartOf({ hiddenListEnabled: true, hiddenListBibStart: 900, participantCountPublic: true, hiddenListCounted: false })).toBe(900);
    expect(hiddenListBibStartOf({ hiddenListEnabled: false, hiddenListBibStart: 900, participantCountPublic: true, hiddenListCounted: false })).toBeNull();
    expect(hiddenListBibStartOf({ hiddenListEnabled: true, hiddenListBibStart: null, participantCountPublic: true, hiddenListCounted: false })).toBeNull();
  });
});

describe("§NNN the name, in both languages", () => {
  it("says «Lista ascunsă» on the chip, the pill, the verbs, the column, the audit label and the guide", () => {
    expect(ro.Admin.registrations.outside.chip).toBe("Lista ascunsă");
    expect(en.Admin.registrations.outside.chip).toBe("Hidden list");
    expect(ro.Admin.registrations.outside.pill).toBe("Lista ascunsă: {count}");
    expect(ro.Admin.registrations.outside.mark).toBe("Pune pe lista ascunsă");
    expect(ro.Admin.registrations.outside.unmark).toBe("Scoate de pe lista ascunsă");
    expect(en.Admin.registrations.outside.mark).toBe("Put on the hidden list");
    expect(en.Admin.registrations.outside.unmark).toBe("Take off the hidden list");
    expect(ro.Admin.editor.boxes.received.outside).toBe("pe lista ascunsă: {count}");
    expect(ro.Admin.guide.sections[4].tasks[10].title).toBe("Lista ascunsă: organizatori, pacemakeri, invitați");
    expect(ro.Admin.registrations.audit.registration.outside_capacity_changed).toContain("lista ascunsă");
    // No string calls it «În afara locurilor» any more — the backoffice's toasts and dialogs included.
    // The public words «în afara locurilor anunțate» are the visitor's (§NNN), not the old name.
    expect(JSON.stringify(ro)).not.toMatch(/în afara locurilor(?! anunțate)/i);
    expect(JSON.stringify(en)).not.toMatch(/outside the places/i);
    expect(read("src/modules/registrations/csv.ts")).toContain('"Hidden list",');
    expect(read("src/modules/registrations/workbook.ts")).toContain('header: "Hidden list"');
  });

  it("keeps the four editor helps under 200 characters, in both languages", () => {
    for (const catalogue of [ro, en]) {
      for (const key of ["hiddenListEnabledHelp", "hiddenListBibStartHelp", "participantCountPublicHelp", "hiddenListCountedHelp"] as const) {
        expect(catalogue.Admin.editor[key].length, key).toBeLessThan(200);
      }
    }
    expect(ro.Admin.editor.hiddenListEnabled).toBe("Folosește lista ascunsă");
    expect(ro.Admin.editor.hiddenListBibStart).toBe("Numerele listei ascunse încep de la");
    expect(ro.Admin.editor.participantCountPublic).toBe("Arată public numărătoarea");
    expect(ro.Admin.editor.hiddenListCounted).toBe("Numără și lista ascunsă");
  });
});

describe("§NNN the glyph and the radio", () => {
  it("draws the incognito glyph on a 24-unit grid, one path, in the current colour", () => {
    const html = renderToStaticMarkup(createElement(IncognitoIcon));
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html.match(/<path /g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
  });

  it("the chip carries the glyph beside its words; as the list's pill it is a 44-pixel link", () => {
    const chip = renderToStaticMarkup(createElement(HiddenListChip, { label: "Lista ascunsă", testId: "outside-chip" }));
    expect(chip).toContain("Lista ascunsă");
    expect(chip).toContain('viewBox="0 0 24 24"');
    const pill = renderToStaticMarkup(createElement(HiddenListChip, { label: "Lista ascunsă: 2", href: "/ro/admin/registrations?outside=1", active: true }));
    expect(pill).toMatch(/<a [^>]*href="\/ro\/admin\/registrations\?outside=1"/);
    expect(pill).toContain('aria-current="page"');
  });

  it("is two radios, the server's state checked, under a heading with the glyph; the Organizer's are disabled", () => {
    const props = { headingId: "hidden-list-title", heading: "Lista ascunsă", countedLabel: ro.Admin.registrations.outside.optionCounted, hiddenLabel: ro.Admin.registrations.outside.optionHidden };
    const counted = renderToStaticMarkup(createElement(HiddenListRadio, { ...props, onList: false }));
    expect(counted.match(/type="radio"/g)).toHaveLength(2);
    expect(radio(counted, "counted")).toContain('checked=""');
    expect(radio(counted, "hidden")).not.toContain('checked=""');
    expect(counted).toContain('aria-labelledby="hidden-list-title"');
    expect(counted).toContain("Se numără între locurile evenimentului");
    expect(counted).toContain('viewBox="0 0 24 24"');
    expect(counted).not.toMatch(/<input[^>]*disabled=""/);

    const hidden = renderToStaticMarkup(createElement(HiddenListRadio, { ...props, onList: true, disabled: true }));
    expect(radio(hidden, "hidden")).toContain('checked=""');
    expect(hidden.match(/<input[^>]*disabled=""/g)).toHaveLength(2);
  });

  it("asks the form's confirm on a change and listens for its «Anulează»", () => {
    const island = read("src/modules/registrations/ui/HiddenListRadio.tsx");
    expect(island.split("\n")[0]).toBe('"use client";');
    expect(island).toContain("requestSubmit()");
    expect(island).toContain("CONFIRM_CANCEL_EVENT");
    expect(read("src/shared/forms/ActionFormIsland.tsx")).toContain("dispatchEvent(new Event(CONFIRM_CANCEL_EVENT))");
    // The page passes the radio strings and a boolean, never an element (§370).
    const page = read("src/app/[locale]/admin/registrations/[id]/page.tsx");
    expect(page).toContain("<HiddenListRadio");
    expect(page).not.toContain('icon={registration.outsideCapacity ? "turnOff" : "turnOn"}');
  });
});
