import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §341 — the events list's status column wires `seriesDrafts` and
 * `draftExplanation` (`src/modules/events/domain/series-drafts.ts`, both proven directly in
 * `tests/unit/events/series-drafts.test.ts`) into `SeriesDraftLine`.
 *
 * Source-level, like `boxed-disclosure.test.ts`: the page is a Server Component with next-intl
 * translations resolved at request time, which the unit suite (Node, no database, no DOM) has
 * no way to render. What has to stay true is which keys and which values reach the component —
 * a wrong key here is a visitor-facing string nobody sees fail until the list is open.
 */
const ROOT = process.cwd();
const PAGE = "src/app/[locale]/admin/(list)/page.tsx";
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const source = read(PAGE);

describe("§341 the events list's series-drafts line", () => {
  it("hides the bare 'Ciornă · N date' chip for a series — the line replaces it", () => {
    expect(source).toContain('.filter(([status]) => !(isSeries && status === "DRAFT"))');
  });

  it("derives the drafts and the reason from the members' own events, only for a series", () => {
    expect(source).toContain("seriesDrafts(members.map((member) => member.event), now)");
    // A single event (no series) gets no drafts line at all: the fallback is empty and reasonless.
    expect(source).toContain("isSeries ? seriesDrafts(members.map((member) => member.event), now) : { drafts: [], reason: null };");
  });

  it("renders the line only when there is at least one draft date", () => {
    expect(source).toContain("drafts.length > 0 && (");
    expect(source).toContain("<SeriesDraftLine");
  });

  it("picks the singular sentence for exactly one draft, the plural otherwise", () => {
    expect(source).toContain("drafts.length === 1");
    expect(source).toContain('? t("events.seriesDraftsOne", { dates: datesWords(1) })');
    expect(source).toContain(': t("events.seriesDraftsMany", { dates: datesWords(drafts.length) })');
  });

  it("links every listed date to its own editor, and folds the rest behind a count", () => {
    expect(source).toContain('href: getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: draft.id } } })');
    expect(source).toContain('more={drafts.length > DRAFT_LINKS ? t("events.seriesDraftsMore", { count: drafts.length - DRAFT_LINKS }) : null}');
  });

  it("gives the hint the general sentence always, and the named reason's sentence beside it", () => {
    expect(source).toContain("explanation={draftExplanation(reason, {");
    expect(source).toContain('always: t("events.seriesDraftsAlways", { button: t("events.bulkPublishAction") }),');
    expect(source).toContain('autoPublishOff: t("events.seriesDraftsWhyOff", {');
    expect(source).toContain('section: t("editor.boxes.recurrence.title"),');
    expect(source).toContain('tick: t("editor.repeatPublishAuto"),');
    expect(source).toContain('button: t("editor.repeatPublishSave"),');
    expect(source).toContain('sourceNotPublished: t("events.seriesDraftsWhySource"),');
  });

  /**
   * Integration review (§341 hints): the first wording sent the reader to "the series' settings",
   * which do not exist — the switch is a tick and its own save in the "Recurență" box, on any
   * date of the series since the editor's boxes (§NNN) — and offered to publish one date "from
   * the list, by ticking it", when the list's tick on a series ticks every date (§113). Each
   * sentence now names what is actually on the screen, by the catalogue's own words for it.
   */
  it("names the real place of the switch and what the list's tick really does, in both languages", () => {
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      const { Admin } = JSON.parse(read(file));
      const whyOff: string = Admin.events.seriesDraftsWhyOff;
      const always: string = Admin.events.seriesDraftsAlways;
      expect(whyOff, file).toContain("{section}");
      expect(whyOff, file).toContain("{tick}");
      expect(whyOff, file).toContain("{button}");
      expect(whyOff, file).not.toMatch(/setările seriei|series' settings/);
      expect(always, file).toContain("{button}");
      expect(always, file).not.toMatch(/bifând-o|by ticking it/);
    }
    // The words the placeholders are filled with are the controls' own labels.
    const ro = JSON.parse(read("messages/ro.json")).Admin;
    expect(ro.editor.boxes.recurrence.title).toBe("Recurență");
    expect(ro.editor.repeatPublishAuto).toBe("Publică datele noi automat");
    expect(ro.editor.repeatPublishSave).toBe("Salvează setarea");
    expect(ro.events.bulkPublishAction).toBe("Publică cele bifate");
  });

  it("has every key it asks for, in both catalogues, and none of them empty", () => {
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      const catalogue = JSON.parse(read(file));
      for (const key of ["seriesDraftsOne", "seriesDraftsMany", "seriesDraftsMore", "seriesDraftsAlways", "seriesDraftsWhyOff", "seriesDraftsWhySource"]) {
        expect(catalogue.Admin.events[key], `${file}: Admin.events.${key}`).toBeTruthy();
      }
    }
  });
});

/**
 * The running series' publish switch (`setRepeatPublish`, proven directly in
 * `tests/integration/cms/repeat-publish.test.ts`): the Recurență box's own words for the three
 * states (`on`, `waiting`, `off`), the tick and its "Salvează setarea", and the alert after
 * each press. Since the editor's boxes (§NNN) it lives in `RecurrenceSeriesPanel`, on every date
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
    expect(panel).toContain("<form action={actions.setRepeatPublish}>");
    expect(editor).toContain("actions={{ setRepeatPublish: setRepeatPublishAction, stopRepeat: stopRepeatAction }}");
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
