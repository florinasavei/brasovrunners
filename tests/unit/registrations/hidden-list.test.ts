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
 * §647 — «Lista ascunsă» (amending §643): the name, the incognito glyph, the radio, and the event's
 * settings as the rest of the code reads them. §NNN — on screen it is «Lista de invitați speciali»
 * («Special guests list»), each screen saying what it does; the column, the identifiers and the audit
 * action keep their names.
 */
const ROOT = path.resolve(__dirname, "../../..");
/** The radio input of a value, as rendered, whatever the order of its attributes. */
const radio = (html: string, value: string) => (html.match(/<input[^>]*>/g) ?? []).find((tag) => tag.includes(`value="${value}"`)) ?? "";
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

describe("§647 the event's settings, as read", () => {
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

describe("§NNN the name, in both languages: «Lista de invitați speciali»", () => {
  it("says «Invitat special» / «Lista de invitați speciali» on the chip, the pill, the radio, the verbs, the column, the audit label and the guide", () => {
    expect(ro.Admin.registrations.outside.title).toBe("Lista de invitați speciali");
    expect(en.Admin.registrations.outside.title).toBe("Special guests list");
    expect(ro.Admin.registrations.outside.chip).toBe("Invitat special");
    expect(en.Admin.registrations.outside.chip).toBe("Special guest");
    expect(ro.Admin.registrations.outside.pill).toBe("Invitați speciali: {count}");
    expect(en.Admin.registrations.outside.pill).toBe("Special guests: {count}");
    expect(ro.Admin.registrations.outside.optionCounted).toBe("Se numără între locurile evenimentului");
    expect(ro.Admin.registrations.outside.optionHidden).toBe("Invitat special — nu ocupă un loc");
    expect(en.Admin.registrations.outside.optionCounted).toBe("Counted among the event's places");
    expect(en.Admin.registrations.outside.optionHidden).toBe("Special guest — takes no place");
    expect(ro.Admin.registrations.outside.mark).toBe("Pune pe lista de invitați speciali");
    expect(ro.Admin.registrations.outside.unmark).toBe("Scoate de pe lista de invitați speciali");
    expect(en.Admin.registrations.outside.mark).toBe("Put on the special guests list");
    expect(en.Admin.registrations.outside.unmark).toBe("Take off the special guests list");
    expect(ro.Admin.registrations.outside.hint).toBe("Invitat special: nu ocupă unul dintre locurile anunțate");
    expect(en.Admin.registrations.outside.hint).toBe("Special guest: takes none of the announced places");
    // The caption under the radios says all three facts, not only the place: the declaration and number kept,
    // the public list unchanged, the public count only with the event's tick.
    expect(ro.Admin.registrations.outside.help).toContain("își păstrează declarația și numărul");
    expect(ro.Admin.registrations.outside.help).toContain("rămâne pe lista publică dacă a bifat");
    expect(ro.Admin.registrations.outside.help).toContain("intră în numărătoarea publică doar cu bifa evenimentului");
    expect(en.Admin.registrations.outside.help).toContain("keeps the declaration and the race number");
    expect(en.Admin.registrations.outside.help).toContain("stays on the public list if they ticked it");
    expect(en.Admin.registrations.outside.help).toContain("enters the public count only with the event's tick");
    for (const help of [ro.Admin.registrations.outside.help, en.Admin.registrations.outside.help]) expect(help.length).toBeLessThan(200);
    expect(ro.Admin.editor.boxes.received.outside).toBe("invitați speciali: {count}");
    expect(ro.Admin.guide.sections[4].tasks[10].title).toBe("Invitați speciali: organizatori, pacemakeri, voluntari");
    expect(en.Admin.guide.sections[4].tasks[10].title).toBe("Special guests: organizers, pacemakers, volunteers");
    expect(ro.Admin.registrations.audit.registration.outside_capacity_changed).toContain("lista de invitați speciali");
    expect(ro.Admin.invitations.outsideLabel).toBe("Pe lista de invitați speciali (nu ocupă un loc)");
    expect(en.Admin.invitations.outsideLabel).toBe("On the special guests list (takes no place)");
    // The old name is gone from every string the club reads, in both languages (the public words never had it).
    expect(JSON.stringify(ro)).not.toMatch(/lista ascuns|listei ascunse/i);
    expect(JSON.stringify(en)).not.toMatch(/hidden list/i);
    // No string calls it «În afara locurilor» any more — the backoffice's toasts and dialogs included.
    // The public words «în afara locurilor anunțate» are the visitor's (§647), not the old name.
    expect(JSON.stringify(ro)).not.toMatch(/în afara locurilor(?! anunțate)/i);
    expect(JSON.stringify(en)).not.toMatch(/outside the places/i);
    expect(read("src/modules/registrations/csv.ts")).toContain('"Special guest",');
    expect(read("src/modules/registrations/workbook.ts")).toContain('header: "Special guest"');
  });

  it("calls the public participant list «nepublică» in the editor's summaries, never «lista ascunsă»", () => {
    expect(ro.Admin.editor.boxes.summary.registration.listHidden).toBe("listă nepublică");
    expect(en.Admin.editor.boxes.summary.registration.listHidden).toBe("public list off");
    expect(ro.Admin.editor.boxes.summary.startList.hidden).toBe("Nepublică");
    expect(en.Admin.editor.boxes.summary.startList.hidden).toBe("Not public");
  });

  it("opens the guide with what the list is for and what it is not, then splits the counting into two steps, each under 200 characters", () => {
    for (const catalogue of [ro, en]) {
      const steps = catalogue.Admin.guide.sections[4].tasks[10].steps as string[];
      for (const step of steps) expect(step.length, step).toBeLessThan(200);
    }
    const steps = ro.Admin.guide.sections[4].tasks[10].steps as string[];
    expect(steps.findIndex((step) => step.includes("«Numără și invitații speciali»"))).toBeLessThan(steps.findIndex((step) => step.startsWith("«Arată public numărătoarea»")));
    expect(steps[0]).toContain("Nu e pentru un participant obișnuit");
    expect((en.Admin.guide.sections[4].tasks[10].steps as string[])[0]).toContain("It is not for an ordinary participant");
  });

  it("says in the switch's help what ticking shows and what unticking keeps, and behind its «?» the difference from «Invitații»", () => {
    expect(ro.Admin.editor.hiddenListEnabledHelp).toContain("«Invitat special — nu ocupă un loc»");
    expect(ro.Admin.editor.hiddenListEnabledHelp).toContain("nimeni nou nu intră pe listă");
    expect(ro.Admin.editor.hiddenListEnabledHelp).toContain("pagina îi anunță cât timp au loc");
    expect(en.Admin.editor.hiddenListEnabledHelp).toContain("nobody new goes on the list");
    expect(en.Admin.editor.hiddenListEnabledHelp).toContain("the page mentions them while they hold a place");
    for (const catalogue of [ro, en]) {
      for (const key of ["hiddenListEnabledMoreFor", "hiddenListEnabledMoreSettings", "hiddenListEnabledMoreEmail", "hiddenListEnabledMoreDifference"] as const) {
        expect(catalogue.Admin.editor[key].length, key).toBeLessThan(200);
      }
      for (const key of ["infoFor", "infoKeeps", "infoNot", "help", "hint"] as const) {
        expect(catalogue.Admin.registrations.outside[key].length, key).toBeLessThan(200);
      }
    }
    expect(ro.Admin.editor.hiddenListEnabledMoreEmail).toContain("O invitație pe email");
    expect(ro.Admin.editor.hiddenListEnabledMoreDifference).toContain("«Pe lista de invitați speciali»");
    expect(ro.Admin.registrations.outside.infoNot).toBe("Un participant obișnuit nu se pune aici.");
    const editor = read("src/modules/content/events/ui/boxes/StartListBox.tsx");
    expect(editor).toContain('t("editor.hiddenListEnabledMoreDifference")');
    expect(editor).toContain("<IncognitoIcon");
  });

  it("keeps the four editor helps under 200 characters, in both languages", () => {
    for (const catalogue of [ro, en]) {
      for (const key of ["hiddenListEnabledHelp", "hiddenListBibStartHelp", "participantCountPublicHelp", "hiddenListCountedHelp"] as const) {
        expect(catalogue.Admin.editor[key].length, key).toBeLessThan(200);
      }
    }
    expect(ro.Admin.editor.hiddenListTitle).toBe("Lista de invitați speciali");
    expect(ro.Admin.editor.hiddenListEnabled).toBe("Folosește lista de invitați speciali");
    expect(ro.Admin.editor.hiddenListBibStart).toBe("Numerele invitaților speciali încep de la");
    expect(ro.Admin.editor.participantCountPublic).toBe("Arată public numărătoarea");
    expect(ro.Admin.editor.hiddenListCounted).toBe("Numără și invitații speciali");
    expect(en.Admin.editor.hiddenListEnabled).toBe("Use the special guests list");
    expect(en.Admin.editor.hiddenListCounted).toBe("Count the special guests too");
  });
});

describe("§647 the glyph and the radio", () => {
  it("draws the incognito glyph on a 24-unit grid, one path, in the current colour", () => {
    const html = renderToStaticMarkup(createElement(IncognitoIcon));
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html.match(/<path /g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
  });

  it("the chip carries the glyph beside its words; as the list's pill it is a 44-pixel link", () => {
    const chip = renderToStaticMarkup(createElement(HiddenListChip, { label: "Invitat special", hint: ro.Admin.registrations.outside.hint, testId: "outside-chip" }));
    expect(chip).toContain("Invitat special");
    expect(chip).toContain(`title="${ro.Admin.registrations.outside.hint}"`);
    expect(chip).toContain('viewBox="0 0 24 24"');
    const pill = renderToStaticMarkup(createElement(HiddenListChip, { label: "Invitați speciali: 2", hint: ro.Admin.registrations.outside.hint, href: "/ro/admin/registrations?outside=1", active: true }));
    expect(pill).toMatch(/<a [^>]*href="\/ro\/admin\/registrations\?outside=1"/);
    // The link is named by its visible words first, then what a special guest is.
    expect(pill).toContain(`aria-label="Invitați speciali: 2 — ${ro.Admin.registrations.outside.hint}"`);
    expect(pill).toContain('aria-current="page"');
    expect(pill).toContain("MuiChip-colorPrimary");
    // Unpressed, it looks like every other summary pill (`ChipLink`): the default colour, outlined.
    const unpressed = renderToStaticMarkup(createElement(HiddenListChip, { label: "Invitați speciali: 2", href: "/ro/admin/registrations?outside=1" }));
    expect(unpressed).toContain("MuiChip-colorDefault");
    expect(unpressed).toContain("MuiChip-outlined");
    expect(unpressed).not.toContain("MuiChip-colorSecondary");
    // The row's plain chip keeps the secondary colour that marks the row.
    expect(chip).toContain("MuiChip-colorSecondary");
  });

  it("is two radios, the server's state checked, under a heading with the glyph and its «i»; the Organizer's are disabled", () => {
    const info = [ro.Admin.registrations.outside.infoFor, ro.Admin.registrations.outside.infoKeeps, ro.Admin.registrations.outside.infoNot].join("\n");
    const props = { headingId: "hidden-list-title", heading: ro.Admin.registrations.outside.title, countedLabel: ro.Admin.registrations.outside.optionCounted, hiddenLabel: ro.Admin.registrations.outside.optionHidden, info };
    const counted = renderToStaticMarkup(createElement(HiddenListRadio, { ...props, onList: false }));
    expect(counted.match(/type="radio"/g)).toHaveLength(2);
    expect(radio(counted, "counted")).toContain('checked=""');
    expect(radio(counted, "hidden")).not.toContain('checked=""');
    expect(counted).toContain('aria-labelledby="hidden-list-title"');
    expect(counted).toContain("Se numără între locurile evenimentului");
    expect(counted).toContain('viewBox="0 0 24 24"');
    expect(counted).not.toMatch(/<input[^>]*disabled=""/);
    // The «i» is a button beside the heading, not inside it: the radio group's name stays the heading's words.
    expect(counted).toMatch(/<h3[^>]*id="hidden-list-title"[^>]*>(?:(?!<\/h3>)[\s\S])*Lista de invitați speciali<\/h3>/);
    expect(counted).toMatch(/<button[^>]*aria-label="Pentru organizatori, voluntari, pacemakeri și sportivi invitați/);
    expect(counted).toContain("Un participant obișnuit nu se pune aici.");

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
