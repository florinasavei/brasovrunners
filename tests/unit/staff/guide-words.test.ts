import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { isBackofficeRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-060-01 criterion 38 — the guide's «words» are the screen's words (§441).
 *
 * The guide was rewritten as numbered steps "with the exact button words" for the colleagues who
 * run the backoffice while the owner is away. The previous one had drifted: it sent the desk to
 * press "Prezent", "Confirmă aici" and "Descarcă foaia (PDF)", none of which any screen said any
 * more. A guide read with a phone in one hand fails at exactly the word that does not exist.
 *
 * So every «…» in a step, a task title, a section line or the intro must be a string the
 * backoffice (or the public page, or an email's button) actually shows, in that language:
 * - a catalogue value of the same locale, whole — or its text before the first `{placeholder}`,
 *   or without a trailing "({count})", an arrow or an ellipsis;
 * - or one of the backoffice's Romanian-only labels (`staff-labels.ts`, §35), which the English
 *   guide quotes in Romanian because that is what the English screen says too;
 * - or an email's button (`templates.ts`, `action: "…"`).
 * A quote ending in "…" names the start of a longer label, as the guide abbreviates a long tick.
 */

type Catalogue = Record<string, unknown>;
type GuideTask = { title: string; steps: string[] };
type GuideSection = { key?: string; title: string; who: string; roles: string[]; tasks: GuideTask[] };
type Guide = { intro: string; sections: GuideSection[] };

const root = process.cwd();

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const child of Object.values(value)) strings(child, out);
  return out;
}

/** Every way a label may be quoted: whole, before its first placeholder, without its decorations. */
function shapes(label: string): string[] {
  const whole = label.trim();
  const beforePlaceholder = whole.split("{")[0].trim();
  // «(…{count})» or «({count} din {total})» (§555): the count in brackets, whatever words hold it.
  const withoutCount = whole.replace(/\s*\(\{[^)]*\)/g, "").trim();
  return [whole, beforePlaceholder, withoutCount]
    .flatMap((shape) => [shape, shape.replace(/^←\s*/, "").replace(/\s*→$/, "").replace(/…$/, "").trim()])
    .filter((shape) => shape.length > 0);
}

const sourceLabels = (() => {
  const staffLabels = readFileSync(path.join(root, "src/modules/staff-identity/domain/staff-labels.ts"), "utf8");
  const templates = readFileSync(path.join(root, "src/modules/notifications/templates.ts"), "utf8");
  return [
    // The repository is CRLF on Windows and LF on CI: `\r?` before the line's end.
    ...[...staffLabels.matchAll(/^\s+[A-Z_]+: "([^"]+)",\r?$/gm)].map((match) => match[1]),
    ...[...templates.matchAll(/^\s+action: "([^"]+)",\r?$/gm)].map((match) => match[1]),
    // «Nu mai pot ajunge», the button of every email about a live registration (§558).
    ...[...templates.matchAll(/^\s+cannotCome: \{\s+label: "([^"]+)"/gm)].map((match) => match[1]),
  ];
})();

function screenWords(catalogue: Catalogue): { exact: Set<string>; all: string[] } {
  // The guide itself is not the screen: a quote may never be vouched for by the guide's own lines.
  const { guide: _guide, ...admin } = catalogue.Admin as Record<string, unknown>;
  void _guide;
  const all = [...strings({ ...catalogue, Admin: admin }), ...sourceLabels];
  return { exact: new Set(all.flatMap(shapes)), all };
}

function quotes(text: string): string[] {
  return [...text.matchAll(/«([^»]+)»/g)].map((match) => match[1]);
}

function guideOf(catalogue: Catalogue): Guide {
  return (catalogue.Admin as { guide: Guide }).guide;
}

/** Not the intro: it shows the notation itself, «like this», and quotes no screen. */
function everyText(guide: Guide): { where: string; text: string }[] {
  return [
    ...guide.sections.flatMap((section, s) => [
      { where: `section ${s} title`, text: section.title },
      { where: `section ${s} who`, text: section.who },
      ...section.tasks.flatMap((task, k) => [
        { where: `section ${s} task ${k} title`, text: task.title },
        ...task.steps.map((step, n) => ({ where: `section ${s} task ${k} step ${n + 1}`, text: step })),
      ]),
    ]),
  ];
}

const locales = { ro: ro as Catalogue, en: en as Catalogue };

describe("BR-REQ-060-01 criterion 38 the guide quotes the screen's own words", () => {
  for (const [locale, catalogue] of Object.entries(locales)) {
    it(`${locale}: every «…» is a label the backoffice shows`, () => {
      const guide = guideOf(catalogue);
      const { exact, all } = screenWords(catalogue);
      const unknown: string[] = [];
      let quoted = 0;
      for (const { where, text } of everyText(guide)) {
        for (const quote of quotes(text)) {
          quoted += 1;
          const found = quote.endsWith("…")
            ? all.some((label) => label.startsWith(quote.slice(0, -1).trim()))
            : exact.has(quote);
          if (!found) unknown.push(`${where}: «${quote}»`);
        }
      }
      // The guide is made of button words; a rewrite that dropped them would pass vacuously.
      expect(quoted).toBeGreaterThan(200);
      expect(unknown).toEqual([]);
    });
  }

  it("each task is a title and at least one numbered step, in every section", () => {
    for (const catalogue of Object.values(locales)) {
      const guide = guideOf(catalogue);
      expect(guide.sections.length).toBeGreaterThan(0);
      for (const section of guide.sections) {
        expect(section.tasks.length, section.title).toBeGreaterThan(0);
        for (const task of section.tasks) {
          expect(task.title.trim(), section.title).not.toBe("");
          expect(task.steps.length, task.title).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the two languages are the same guide: sections, roles, tasks, steps, quotes and placeholders", () => {
    const [roGuide, enGuide] = [guideOf(locales.ro), guideOf(locales.en)];
    expect(enGuide.sections.map((section) => [section.key ?? null, section.roles])).toEqual(
      roGuide.sections.map((section) => [section.key ?? null, section.roles]),
    );
    roGuide.sections.forEach((section, s) => {
      const other = enGuide.sections[s];
      expect(other.tasks.map((task) => task.steps.length), section.title).toEqual(section.tasks.map((task) => task.steps.length));
      section.tasks.forEach((task, k) => {
        task.steps.forEach((step, n) => {
          const twin = other.tasks[k].steps[n];
          const where = `${section.title} / ${task.title} / step ${n + 1}`;
          expect(quotes(twin).length, where).toBe(quotes(step).length);
          const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
          expect(placeholders(twin), where).toEqual(placeholders(step));
        });
      });
    });
  });

  it("names only roles that exist, and gives every role at least one section of its own", () => {
    const guide = guideOf(locales.ro);
    for (const section of guide.sections) for (const role of section.roles) expect(STAFF_ROLES).toContain(role);
    // Every staff role: a club member (§524) has no backoffice, so no guide to open.
    for (const role of STAFF_ROLES.filter(isBackofficeRole)) {
      expect(guide.sections.some((section) => section.roles.includes(role)), role).toBe(true);
    }
  });

  /*
    A job only a Superadministrator can do — the platform settings that can stop the service
    (`canManagePlatform`, §450: the jobs' interval, the database's limits, the month's budget
    thresholds, the anti-bot check) — says so in its first line, so an Administrator knows to ask
    before walking the steps into a missing button. The legal texts (`canWriteLegalTexts`) and
    «Echipa» (`canManageStaff`) are the Administrator's since §450, so their jobs carry no such line.
  */
  it("a job that needs a Superadministrator says so in its first line, and only such a job", () => {
    const platform = {
      // «Setări» since §516: the costs and the anti-robot check moved out of «Sarcini».
      ro: ["«Setări» → «Costuri» → «Cât de des verifică site-ul»", "«Setări» → «Costuri» → «Limitele bazei de date»", "«Setări» → «Costuri» → «Bugetul lunii»", "«Setări» → «Anti-robot»"],
      en: ["«Settings» → «Costs» → «How often the site checks»", "«Settings» → «Costs» → «The database's limits»", "«Settings» → «Costs» → «This month's budget»", "«Settings» → «Anti-bot»"],
    };
    const club = { ro: ["→ «Versiune nouă»", "«Echipa» → «Adaugă o persoană»"], en: ["→ «New version»", "«Staff» → «Add someone»"] };
    const lead = { ro: "Rol necesar: Superadministrator.", en: "Role needed: Superadministrator." };
    for (const [locale, catalogue] of Object.entries(locales) as ["ro" | "en", Catalogue][]) {
      const tasks = guideOf(catalogue).sections.flatMap((section) => section.tasks);
      const platformJobs = tasks.filter((task) => task.steps.some((step) => platform[locale].some((mark) => step.startsWith(mark))));
      expect(platformJobs.length, locale).toBeGreaterThanOrEqual(4);
      for (const job of platformJobs) expect(job.steps[0].startsWith(lead[locale]), `${locale}: ${job.title}`).toBe(true);
      const clubJobs = tasks.filter((task) => task.steps.some((step) => club[locale].some((mark) => step.includes(mark))));
      expect(clubJobs.length, locale).toBeGreaterThanOrEqual(2);
      for (const job of clubJobs) expect(job.steps[0].startsWith(lead[locale]), `${locale}: ${job.title}`).toBe(false);
    }
  });

  /*
    The members' texts (§524): the guide said «Pagini» → «Membri», and «Membri» matched some other
    label in the catalogue while no such entry was on the row. So the path is pinned to the
    sub-navigation's own words, in their order: the main tab, the group's caption, the entry.
  */
  it("names the members' texts by the sub-navigation's own path (§524)", () => {
    for (const catalogue of Object.values(locales)) {
      const admin = catalogue.Admin as { nav: { pages: string }; pages: { groupStandard: string; tabMembers: string } };
      const path = `«${admin.nav.pages}» → «${admin.pages.groupStandard}» → «${admin.pages.tabMembers}»`;
      const steps = guideOf(catalogue).sections.flatMap((section) => section.tasks.flatMap((task) => task.steps));
      expect(steps.some((step) => step.includes(path)), path).toBe(true);
    }
  });

  /*
    The legal texts' task walks the batch presses over every text of the catalogue. It was titled
    «Cele cinci texte» when the catalogue had grown to six: a count in a title goes stale the day a
    text is added, so the task is named without one, and no task title counts the texts.
  */
  it("names the legal texts' task without a count that goes stale", () => {
    const titles = { ro: "Textele legale ale clubului", en: "The club's legal texts" } as const;
    for (const [locale, catalogue] of Object.entries(locales)) {
      const tasks = guideOf(catalogue).sections.flatMap((section) => section.tasks.map((task) => task.title));
      expect(tasks, locale).toContain(titles[locale as keyof typeof titles]);
      expect(tasks.filter((title) => /(cinci|șase|five|six) (texte|texts)/i.test(title)), locale).toEqual([]);
    }
  });

  /*
    The October releases (§620): the owner, 2026-10-01, «Trebuie să actualizăm și documentația live
    pt voluntari». The hourly limit and the Gmail road, the bulk resend and the chosen offers are
    the Administrator's jobs, each named by the screen's own button; and the hard limits say that
    nobody is seated without their own signature. Pinned so a later rewrite cannot drop them quietly.
  */
  it("carries the October jobs, each with the screen's own words, in both languages (§620)", () => {
    const jobs = {
      ro: {
        "Planul Mailgun, înainte și după cursă": ["«Limita pe oră»", "«Prin ce pleacă emailurile: Mailgun sau Gmail-ul clubului»", "«Cât costă»"],
        "Emailurile întârzie sau Mailgun a refuzat": ["«Trimise în ultima oră:»", "«Trimite acum»", "Spam"],
        "Retrimite declarația celor care nu au semnat": ["«Retrimite declarația tuturor care nu au semnat»", "Spam"],
        "Alege tu cine primește un loc eliberat": ["«Locurile din lista de așteptare se alocă automat»", "«Trimite-i oferta»", "«Dă-i un loc»"],
        "Ce NU se poate face": ["fără semnătura lui", "«Dă-i un loc»"],
      },
      en: {
        "The Mailgun plan, before and after a race": ["«Hourly limit»", "«How emails leave: Mailgun or the club's Gmail»", "«What it costs»"],
        "Emails are late, or Mailgun refused": ["«Sent in the last hour:»", "«Send now»", "Spam"],
        "Resend the declaration to those who have not signed": ["«Resend the declaration to everyone who has not signed»", "Spam"],
        "Choose who gets a freed place": ["«Places from the waiting list are allocated automatically»", "«Send them the offer»", "«Give a place»"],
        "What cannot be done": ["without their own signature", "«Give a place»"],
      },
    } as const;
    for (const [locale, catalogue] of Object.entries(locales) as ["ro" | "en", Catalogue][]) {
      const tasks = guideOf(catalogue).sections.flatMap((section) => section.tasks);
      for (const [title, words] of Object.entries(jobs[locale])) {
        const job = tasks.find((task) => task.title === title);
        expect(job, `${locale}: ${title}`).toBeDefined();
        const text = job!.steps.join(" ");
        for (const word of words) expect(text, `${locale}: ${title}`).toContain(word);
        // An Administrator's job: no «Rol necesar» line in front of it.
        expect(job!.steps[0].startsWith("Rol necesar") || job!.steps[0].startsWith("Role needed"), `${locale}: ${title}`).toBe(false);
      }
    }
  });

  it("keeps the family section the page appends its pending line to (§389)", () => {
    for (const catalogue of Object.values(locales)) {
      expect(guideOf(catalogue).sections.filter((section) => section.key === "family")).toHaveLength(1);
    }
  });
});
