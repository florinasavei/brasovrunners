import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SeriesDraftLine, { type SeriesDraftLineProps } from "@/modules/content/events/ui/SeriesDraftLine";

/**
 * `DECISIONS.md` §341, §351 — the events list's line for a series' draft dates.
 *
 * The owner, 2026-09-24, of "1 dată în ciornă — nu apare pe site: lun., 16 nov. (?)" and the
 * paragraphs behind its "?": "tot nu e clar ce e cu data asta în ciornă… ai pus grămadă de text
 * degeaba în tooltip… practic asta e data din aia de viitor generată automat?". The line now says
 * what the dates are and carries the fix: "Publică" for exactly the drafts it counts, "Publică
 * automat de acum" for the rule, or "Deschide seria" when the source is not published.
 *
 * Two halves. `SeriesDraftLine` itself is rendered to markup (a Server Component with two client
 * islands, which `react-dom/server` renders in Node) — what each form posts is what matters, and
 * it is read from the markup. The page that feeds it is a Server Component with next-intl
 * translations resolved at request time, which the unit suite cannot render, so its wiring —
 * which keys, which drafts, which role — is pinned at the source, like `boxed-disclosure.test.ts`.
 */
const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
const page = read("src/app/[locale]/admin/(list)/page.tsx");

const noop = async () => {};
const BASE: SeriesDraftLineProps = {
  uiLocale: "ro",
  text: "2 date noi, create automat, nu sunt pe site:",
  dates: [
    { id: "d1", label: "Lun., 16 nov. 2026", href: "/ro/admin/evenimente/d1" },
    { id: "d2", label: "Lun., 23 nov. 2026", href: "/ro/admin/evenimente/d2" },
  ],
  more: null,
  hint: "Seria își creează singură datele pe următoarele 8 săptămâni.",
  publish: null,
  autoPublish: null,
  openSource: null,
  cancelLabel: "Renunță",
};
const render = (props: Partial<SeriesDraftLineProps>) => renderToStaticMarkup(createElement(SeriesDraftLine, { ...BASE, ...props }));
const confirmed = { confirmTitle: "Publici 2 date?", confirmBody: "Apar pe site.", confirmLabel: "Publică" };

/** Every `<form>…</form>` in the markup, with its hidden fields as name → values. */
function forms(html: string): Array<{ fields: Map<string, string[]>; html: string }> {
  return [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([markup]) => {
    const fields = new Map<string, string[]>();
    for (const input of markup.matchAll(/<input\b[^>]*>/g)) {
      const name = input[0].match(/\bname="([^"]*)"/)?.[1];
      const value = input[0].match(/\bvalue="([^"]*)"/)?.[1];
      if (!name || value === undefined || !/type="hidden"/.test(input[0])) continue;
      fields.set(name, [...(fields.get(name) ?? []), value]);
    }
    return { fields, html: markup };
  });
}

describe("§351 SeriesDraftLine — the words, the dates and the fix on one line", () => {
  it("says what the dates are, links each to its editor, and keeps a short '?'", () => {
    const html = render({});
    expect(html).toContain("2 date noi, create automat, nu sunt pe site:");
    expect(html).toContain('href="/ro/admin/evenimente/d1"');
    expect(html).toContain('href="/ro/admin/evenimente/d2"');
    // The "?" is `Hint`: its text is the button's accessible name.
    expect(html).toContain('aria-label="Seria își creează singură datele pe următoarele 8 săptămâni."');
  });

  it("draws no '?' when the words already say it", () => {
    expect(render({ hint: null })).not.toContain("aria-label=");
  });

  it("posts exactly the drafts it is handed to the bulk publish, as id:version, with the locale", () => {
    // Three refs for two links: the line links the first few and publishes every one (the cap
    // is the page's, `DRAFT_LINKS`; the refs are all the drafts).
    const refs = ["d1:3", "d2:1", "d3:7"];
    const html = render({ publish: { action: noop, refs, label: "Publică", ...confirmed } });
    const [publish, ...others] = forms(html);
    expect(others).toEqual([]);
    expect(publish.fields.get("eventRef")).toEqual(refs);
    expect(publish.fields.get("uiLocale")).toEqual(["ro"]);
    // Asks first: a `ConfirmSubmitButton`, not a bare submit (publishing opens registration).
    expect(publish.html).toContain(">Publică</button>");
  });

  it("switches the SOURCE's rule on and comes back to the list — never the editor, never an address", () => {
    // The switch's form is an `ActionForm` since §384, whose action takes `useActionState`'s two arguments.
    const html = render({ autoPublish: { action: async () => null, sourceId: "source-id", label: "Publică automat de acum", ...confirmed } });
    const [auto] = forms(html);
    expect(Object.fromEntries([...auto.fields].map(([name, values]) => [name, values.join(",")]))).toEqual({
      uiLocale: "ro",
      eventId: "source-id",
      publish: "on",
      returnTo: "list",
    });
    expect(auto.html).toContain(">Publică automat de acum</button>");
  });

  it("opens the source's editor with a link, and posts nothing, when the source is not published", () => {
    const html = render({ openSource: { href: "/ro/admin/evenimente/source-id", label: "Deschide seria" } });
    expect(forms(html)).toEqual([]);
    expect(html).toMatch(/<a [^>]*href="\/ro\/admin\/evenimente\/source-id"[^>]*>[\s\S]*Deschide seria<\/a>/);
  });

  it("draws no button and no form for a viewer who may use none of the fixes", () => {
    const html = render({ publish: null, autoPublish: null, openSource: null });
    expect(forms(html)).toEqual([]);
    // The one button left is the "?" — `type="button"`, which submits nothing.
    expect([...html.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag.match(/type="(\w+)"/)?.[1])).toEqual(["button"]);
    expect(render({ publish: null, autoPublish: null, openSource: null, hint: null })).not.toContain("<button");
    expect(html).not.toContain("Deschide seria");
  });

  it("keeps a thumb's 44 px on every date link on a phone (BR-REQ-041-01 criterion 6)", () => {
    // Every button here is `ConfirmSubmitButton` (44 px floor) or a `GlyphButton` given one; the
    // date links' own span is the line's to size.
    const line = read("src/modules/content/events/ui/SeriesDraftLine.tsx");
    expect(line).toContain("minHeight: { xs: 44, md: 0 }");
    expect(line).toContain('<GlyphButton icon="edit" href={openSource.href} variant="outlined" size="small" sx={{ minHeight: 44 }}>');
  });
});

describe("§341 §351 the events list's wiring of the draft line", () => {
  it("hides the bare 'Ciornă · N date' chip for a series — the line replaces it", () => {
    expect(page).toContain('.filter(([status]) => !(isSeries && status === "DRAFT"))');
  });

  it("derives the drafts, the reason and the source from the members' own events, only for a series", () => {
    expect(page).toContain("const { drafts, reason, source } = isSeries\n          ? seriesDrafts(members.map((member) => member.event), now)\n          : { drafts: [], reason: null, source: null };");
    expect(page).toContain("const remedies = draftRemedies(reason);");
  });

  it("renders the line only when there is at least one draft date", () => {
    expect(page).toContain("drafts.length > 0 && (");
    expect(page).toContain("<SeriesDraftLine");
  });

  it("opens with the words for its reason, the verb agreeing with the count", () => {
    expect(page).toContain("text={draftLineText(reason, drafts.length)}");
    expect(page).toContain('count === 1 ? t("events.seriesDraftsNewOne", { dates }) : t("events.seriesDraftsNewMany", { dates })');
    expect(page).toContain('count === 1 ? t("events.seriesDraftsSourceOne", { dates }) : t("events.seriesDraftsSourceMany", { dates })');
    expect(page).toContain('count === 1 ? t("events.seriesDraftsOne", { dates }) : t("events.seriesDraftsMany", { dates })');
    // "1 dată nouă" / "2 date noi" / "20 de date noi": the counted noun with its adjective.
    expect(page).toContain("t(`events.seriesNewDates.${countForm(count, locale)}`, { count })");
  });

  it("links every listed date to its own editor, and folds the rest behind a count", () => {
    expect(page).toContain('href: getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: draft.id } } })');
    expect(page).toContain('more={drafts.length > DRAFT_LINKS ? t("events.seriesDraftsMore", { count: drafts.length - DRAFT_LINKS }) : null}');
  });

  it("keeps one short sentence behind the '?' for a named reason, and none for drafts made by hand", () => {
    // The horizon in the club's words (§377), "8 săptămâni" unless changed.
    expect(page).toContain('? t("events.seriesDraftsHintNew", { horizon })');
    expect(page).toContain(': reason === "sourceNotPublished"\n                      ? t("events.seriesDraftsHintSource")\n                      : null');
  });

  it("publishes every upcoming draft the line counts — not only the linked ones — through the list's bulk verb", () => {
    expect(page).toContain("action: bulkPublishEventsAction,");
    expect(page).toContain("refs: drafts.map((draft) => refOf(draft)),");
    // Not the capped slice the links are drawn from.
    expect(page).not.toMatch(/refs: drafts\.slice/);
  });

  it("switches the rule from the series' source, with the action that can come back to the list", () => {
    expect(page).toContain("action: setRepeatPublishAction,");
    expect(page).toContain("sourceId: source.id,");
    expect(page).toContain('href: getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: source.id } } }),');
  });

  it("offers each fix only to a role the server lets use it (BR-REQ-060-01)", () => {
    expect(page).toContain('const mayPublish = canTransition(staffUser.role, "IN_REVIEW", "PUBLISHED", false);');
    expect(page).toContain("const maySwitchSeries = canCreateEvent(staffUser.role) && mayPublish;");
    expect(page).toContain("remedies.publish && mayPublish");
    expect(page).toContain("remedies.autoPublish && source && maySwitchSeries");
    expect(page).toContain("remedies.openSource && source && mayPublish");
  });

  it("names the switch's outcome on the list, and the generic banner does not repeat it", () => {
    expect(page).toContain('{saved === "repeatPublishOn" && (');
    expect(page).toContain('t("events.seriesAutoPublishStarted", { button: t("events.seriesDraftsPublish") })');
    expect(page).toContain('"eventErased", "repeatPublishOn"].includes(saved)');
  });

  it("has every key it asks for, in both catalogues, none empty — and the paragraphs it replaced are gone", () => {
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      const events = JSON.parse(read(file)).Admin.events;
      for (const key of [
        "seriesDraftsOne",
        "seriesDraftsMany",
        "seriesDraftsNewOne",
        "seriesDraftsNewMany",
        "seriesDraftsSourceOne",
        "seriesDraftsSourceMany",
        "seriesDraftsMore",
        "seriesDraftsHintNew",
        "seriesDraftsHintSource",
        "seriesDraftsPublish",
        "seriesDraftsPublishTitle",
        "seriesDraftsPublishBody",
        "seriesDraftsAutoPublish",
        "seriesDraftsAutoPublishTitle",
        "seriesDraftsAutoPublishBody",
        "seriesDraftsAutoPublishConfirm",
        "seriesDraftsOpenSource",
        "seriesAutoPublishStarted",
      ]) {
        expect(events[key], `${file}: Admin.events.${key}`).toBeTruthy();
      }
      for (const form of ["one", "few", "other"]) expect(events.seriesNewDates[form], `${file}: seriesNewDates.${form}`).toContain("{count}");
      for (const gone of ["seriesDraftsAlways", "seriesDraftsWhyOff", "seriesDraftsWhySource"]) {
        expect(events[gone], `${file}: Admin.events.${gone} is orphaned`).toBeUndefined();
      }
    }
  });

  it("keeps each '?' to one short sentence (the owner: 'grămadă de text degeaba')", () => {
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      const events = JSON.parse(read(file)).Admin.events;
      for (const key of ["seriesDraftsHintNew", "seriesDraftsHintSource"]) {
        const sentence: string = events[key];
        expect(sentence.split(/\s+/).length, `${file}: ${key}`).toBeLessThanOrEqual(25);
        expect(sentence.match(/[.!?](\s|$)/g)?.length, `${file}: ${key} is one sentence`).toBe(1);
      }
    }
  });

  it("reads as Romanian for one, a few and many dates the series made", () => {
    const events = JSON.parse(read("messages/ro.json")).Admin.events;
    const fill = (template: string, values: Record<string, string | number>) =>
      template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
    const newDates = (form: "one" | "few" | "other", count: number) => fill(events.seriesNewDates[form], { count });
    expect(fill(events.seriesDraftsNewOne, { dates: newDates("one", 1) })).toBe("1 dată nouă, creată automat, nu e pe site:");
    expect(fill(events.seriesDraftsNewMany, { dates: newDates("few", 3) })).toBe("3 date noi, create automat, nu sunt pe site:");
    expect(fill(events.seriesDraftsNewMany, { dates: newDates("other", 20) })).toBe("20 de date noi, create automat, nu sunt pe site:");
  });
});

/**
 * The running series' publish switch (`setRepeatPublish`, proven directly in
 * `tests/integration/cms/repeat-publish.test.ts`): the Recurență box's own words for the three
 * states (`on`, `waiting`, `off`), the tick and its "Salvează setarea", and the alert after
 * each press. Since the editor's boxes (§350) it lives in `RecurrenceSeriesPanel`, on every date
 * of the series, and it is a tick rather than two buttons.
 */
describe("§341 the editor's repeat-publish switch", () => {
  const editor = read("src/app/[locale]/admin/events/[id]/page.tsx");
  const panel = read("src/modules/content/events/ui/RecurrenceSeriesPanel.tsx");

  it("shows one of three sentences, by the rule's flag and whether the source is live", () => {
    expect(panel).toContain('publish ? (sourceLive ? t("editor.repeatPublishOn") : t("editor.repeatPublishWaiting")) : t("editor.repeatPublishOff")');
  });

  it("posts the tick as the rule's new flag, ticked as the rule is now", () => {
    expect(panel).toContain('<CheckboxField name="publish" defaultChecked={publish}>');
    // An `ActionForm` since §384, so the save toasts; turning it on asks, as the list's
    // "Publică automat de acum" does — turning it off, or saving it as it was, asks nothing.
    expect(panel).toContain("action={actions.setRepeatPublish}");
    expect(panel).toContain('when: [{ field: "publish", equals: "on" }],');
    expect(panel).toMatch(/confirm=\{\s*publish\s*\? undefined/);
    expect(editor).toContain("actions={{ setRepeatPublish: setRepeatPublishAction, stopRepeat: stopRepeatAction }}");
    // The box posts no `returnTo`, so its press still lands on the editor (§351).
    expect(panel).not.toContain('name="returnTo"');
  });

  it("labels the tick, its save and the pending state, each its own key", () => {
    expect(panel).toContain('{t("editor.repeatPublishAuto")}');
    expect(panel).toContain('label={t("editor.repeatPublishSave")} pendingLabel={t("editor.repeatPublishPending")} icon="save"');
  });

  it("names the outcome after each press, and the redirect recognises both", () => {
    expect(editor).toContain('{saved === "repeatPublishOn" && <Alert severity="success">{t("editor.repeatPublishStarted")}</Alert>}');
    expect(editor).toContain('{saved === "repeatPublishOff" && <Alert severity="success">{t("editor.repeatPublishStopped")}</Alert>}');
  });

  it("has every key it asks for, in both catalogues, and none of them empty", () => {
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      const catalogue = JSON.parse(read(file));
      for (const key of [
        "repeatPublishOn",
        "repeatPublishWaiting",
        "repeatPublishOff",
        "repeatPublishAuto",
        "repeatPublishSave",
        "repeatPublishPending",
        "repeatPublishStarted",
        "repeatPublishStopped",
      ]) {
        expect(catalogue.Admin.editor[key], `${file}: Admin.editor.${key}`).toBeTruthy();
      }
    }
  });
});
