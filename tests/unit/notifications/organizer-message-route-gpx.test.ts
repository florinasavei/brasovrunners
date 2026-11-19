import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import { readOrganizerIncludeRouteGpx } from "@/modules/notifications/domain/organizer-message";
import { isRelayMessage } from "@/modules/notifications/domain/relay";
import { emailSampleData, emailSampleEventFacts, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { buildOutgoingEmail, buildTemplateContent, type TemplateData } from "@/modules/notifications/templates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §987 — «Atașează traseul (GPX)» on «Trimite un mesaj participanților» (the owner, 2026-11-19, two days
 * before the race: «vreau să pot pune în mail și traseul cursei GPX»; BR-REQ-080-01), the twin of §958's «Include
 * programul evenimentului». The pure half: the row's flag; the event's GPX as its page offers it; and the line in the
 * message — one a half, under the organizers' words, each in its own language, with the link to the file under the
 * file's own name, saying the file is attached only when it is — nothing else of the message moved. The send, the
 * attachment, the store, the preview and the screens are `tests/integration/notifications/participant-message-route-gpx.test.ts`
 * and `…-route-gpx-page.test.ts`.
 */

const storage = vi.hoisted(() => ({ configured: true }));
vi.mock("@/modules/media/storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isStorageConfigured: () => storage.configured,
}));
const { offeredRouteGpx } = await import("@/modules/content/events/route-gpx");

const GPX = { key: "test/route-gpx/0123abcd-0123-4abc-8def-0123456789ab/traseu-tampa-2026.gpx", name: "Traseu Tâmpa 2026.gpx", size: 2048, uploadedAt: "2026-11-18T10:00:00.000Z" };
const URL_OF_FILE = `https://example.test/api/media/${GPX.key}`;

/** The line each half says, as the templates write it. */
const LINE = {
  ro: { attached: "Traseul e atașat acestui email, ca fișier GPX. Îl poți descărca și de aici:", linkOnly: "Traseul, ca fișier GPX, îl descarci de aici:" },
  en: { attached: "The route is attached to this email as a GPX file. You can also download it here:", linkOnly: "Download the route as a GPX file here:" },
};

const WORDS = {
  subject: { ro: "Ultimele detalii pentru {eventTitle}", en: "The last details for {eventTitle}" },
  body: { ro: "Salut, {participantName}!\n\nNe vedem sâmbătă la start.", en: "Hi, {participantName}!\n\nSee you on Saturday at the start." },
};

const DATA: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul de toamnă",
  eventTitleOther: "The autumn cross",
  eventLocationName: "Parcul Tractorul",
  eventStartsAtFormatted: "sâmbătă, 21 nov. 2026, 10:00",
  eventStartsAtFormattedOther: "Saturday, 21 Nov 2026, 10:00",
  eventUrl: "https://example.test/ro/evenimente/crosul-de-toamna",
  eventsUrl: "https://example.test/ro/evenimente",
  contactUrl: "https://example.test/ro/contact",
  myRegistrationsUrl: "https://example.test/ro/inscrieri/ale-mele",
  cannotComeUrl: "https://example.test/ro/EXAMPLE#cancel",
  bibNumber: 42,
  organizerSubject: WORDS.subject.ro,
  organizerSubjectOther: WORDS.subject.en,
  organizerBody: WORDS.body.ro,
  organizerBodyOther: WORDS.body.en,
  eventFacts: emailSampleEventFacts("ro"),
  eventFactsOther: emailSampleEventFacts("en"),
};
/** What the renderer adds for a row whose send ticked the box, the store having given the file. */
const ATTACHED: TemplateData = { ...DATA, organizerRouteGpx: { url: URL_OF_FILE, fileName: "traseu-tampa-2026.gpx", attached: true } };
/** …and when it gave none: the link alone. */
const LINK_ONLY: TemplateData = { ...DATA, organizerRouteGpx: { url: URL_OF_FILE, fileName: "traseu-tampa-2026.gpx", attached: false } };

const render = (locale: "ro" | "en", data: TemplateData, messageType: (typeof emailMessageType.enumValues)[number] = "ORGANIZER_MESSAGE") =>
  buildOutgoingEmail({ to: "ana@example.ro", locale, idempotencyKey: `test:organizer-route-gpx:${messageType}:${locale}`, messageType, data, actionUrl: DATA.eventUrl });

/** Every line of the route's kind in a message, whole. */
const lines = (html: string) => [...html.matchAll(/<p data-email-part="route-gpx"[^>]*>[^]*?<\/p>/g)].map((match) => match[0]);
/** A message without them — what is left must be the message of a send that did not tick (the card joins its parts with a line break). */
const withoutLines = (html: string) => html.replace(/<p data-email-part="route-gpx"[^>]*>[^]*?<\/p>\n/g, "");

describe("§987 the row's flag", () => {
  it("reads the flag from the row's payload, and nothing else as a yes", () => {
    expect(readOrganizerIncludeRouteGpx({ subject: {}, body: {}, includeRouteGpx: true })).toBe(true);
    expect(readOrganizerIncludeRouteGpx({ includeRouteGpx: true, clubCopy: true })).toBe(true);
    for (const payload of [null, undefined, {}, { includeRouteGpx: "true" }, { includeRouteGpx: 1 }, { includeRouteGpx: "1" }, { includeProgramme: true }, { routeGpx: true }, "includeRouteGpx", ["includeRouteGpx"]]) {
      expect(readOrganizerIncludeRouteGpx(payload), JSON.stringify(payload)).toBe(false);
    }
  });
});

describe("§987 the event's GPX as its page offers it", () => {
  it("is the stored file while the environment has a store, and none without one, or for a value that is no GPX", () => {
    storage.configured = true;
    expect(offeredRouteGpx(GPX)).toEqual(GPX);
    for (const stored of [null, undefined, {}, { key: "test/route-gpx/x/y.gpx" }, { key: "test/media/0123abcd-0123-4abc-8def-0123456789ab/web.webp" }, "x.gpx", [GPX]]) {
      expect(offeredRouteGpx(stored), JSON.stringify(stored)).toBeNull();
    }
    // No store, as on a deployed environment whose bucket is not set up: the page draws no file, and nothing is offered.
    storage.configured = false;
    expect(offeredRouteGpx(GPX)).toBeNull();
    storage.configured = true;
  });
});

describe("§987 the line in the organizers' message: under the words, with the link to the file", () => {
  it("draws one line a half, each in its own language, the link under the file's own name — in the HTML and in the text", () => {
    const email = render("ro", ATTACHED);
    const found = lines(email.html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(LINE.ro.attached);
    expect(found[1]).toContain(LINE.en.attached);
    for (const part of found) expect(part).toContain(`<a href="${URL_OF_FILE}" style="color:`);
    for (const part of found) expect(part).toContain(">traseu-tampa-2026.gpx</a></p>");
    const [romanian, english] = email.text.split("\n— — —\n");
    expect(romanian).toContain(`${LINE.ro.attached} ${URL_OF_FILE}`);
    expect(english).toContain(`${LINE.en.attached} ${URL_OF_FILE}`);
    expect(romanian).not.toContain(LINE.en.attached);
    expect(english).not.toContain(LINE.ro.attached);
  });

  it("reads English first for an English registration", () => {
    const email = render("en", { ...ATTACHED, organizerBody: WORDS.body.en, organizerBodyOther: WORDS.body.ro, organizerSubject: WORDS.subject.en, organizerSubjectOther: WORDS.subject.ro });
    const found = lines(email.html);
    expect(found[0]).toContain(LINE.en.attached);
    expect(found[1]).toContain(LINE.ro.attached);
  });

  it("says the file is attached only when it is: the link alone otherwise", () => {
    const email = render("ro", LINK_ONLY);
    const found = lines(email.html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(LINE.ro.linkOnly);
    expect(found[1]).toContain(LINE.en.linkOnly);
    expect(email.html).not.toContain(LINE.ro.attached);
    expect(email.html).not.toContain(LINE.en.attached);
    expect(email.text).toContain(`${LINE.ro.linkOnly} ${URL_OF_FILE}`);
    expect(email.text).toContain(`${LINE.en.linkOnly} ${URL_OF_FILE}`);
    for (const part of found) expect(part).toContain(`<a href="${URL_OF_FILE}"`);
  });

  it("stands after the organizers' words and the number and code lines, above the QR and the buttons", () => {
    const code = "K7Q2XRABCD";
    const qr = `https://example.test/api/registrations/qr/${code}.png`;
    const email = render("ro", { ...ATTACHED, organizerQr: { checkinCode: code, qrUrl: qr }, organizerProgramme: true });
    const at = (needle: string) => email.html.indexOf(needle);
    const line = at('data-email-part="route-gpx"');
    expect(line).toBeGreaterThan(at("Ne vedem sâmbătă la start."));
    expect(line).toBeGreaterThan(at('data-email-part="highlight"'));
    expect(line).toBeLessThan(at('data-email-part="event-facts"'));
    expect(line).toBeLessThan(at(`<img src="${qr}"`));
    expect(line).toBeLessThan(at(">Vezi pagina evenimentului</a>"));
    expect(line).toBeLessThan(at('data-email-part="cannot-come"'));
  });

  it("escapes what it is handed", () => {
    const email = render("ro", { ...DATA, organizerRouteGpx: { url: 'https://example.test/a"b&c', fileName: "<b>traseu</b>.gpx", attached: true } });
    const [part] = lines(email.html);
    expect(part).toContain('href="https://example.test/a&quot;b&amp;c"');
    expect(part).toContain("&lt;b&gt;traseu&lt;/b&gt;.gpx");
    expect(part).not.toContain("<b>traseu</b>");
  });
});

describe("§987 nothing else of the organizers' message changes with the tick", () => {
  it("builds the very same message outside the line: the facts line, every link, the buttons, the closing", () => {
    for (const locale of ["ro", "en"] as const) {
      const ticked = buildTemplateContent("ORGANIZER_MESSAGE", locale, ATTACHED, DATA.eventUrl);
      const plain = buildTemplateContent("ORGANIZER_MESSAGE", locale, DATA, DATA.eventUrl);
      // One more paragraph, the line, and nothing else.
      expect(ticked.paragraphs.length, locale).toBe(plain.paragraphs.length + 1);
      const added = ticked.paragraphs.findIndex((part) => typeof part !== "string" && part.html.includes('data-email-part="route-gpx"'));
      expect(added, locale).toBeGreaterThan(-1);
      expect(ticked.paragraphs.filter((_, index) => index !== added), locale).toEqual(plain.paragraphs);
      expect({ ...ticked, paragraphs: plain.paragraphs }, locale).toEqual(plain);
    }
  });

  it("as it leaves: the ticked message with its lines taken out is the unticked message, byte for byte in the HTML", () => {
    for (const locale of ["ro", "en"] as const) {
      const ticked = render(locale, ATTACHED);
      const plain = render(locale, DATA);
      expect(lines(plain.html), locale).toHaveLength(0);
      expect(plain.text, locale).not.toContain("GPX");
      expect(ticked.subject, locale).toBe(plain.subject);
      expect(withoutLines(ticked.html), locale).toBe(plain.html);
      // The template attaches nothing itself: the file is the renderer's.
      expect(ticked.attachments, locale).toBeUndefined();
    }
  });

  it("draws nothing without the field — the samples of «Setări» → «Emailuri» carry none", () => {
    for (const locale of ["ro", "en"] as const) {
      for (const data of [emailSampleFor("ORGANIZER_MESSAGE", locale), emailSampleData(locale)]) {
        expect(data.organizerRouteGpx).toBeUndefined();
        expect(lines(render(locale, data).html)).toHaveLength(0);
      }
    }
  });
});

describe("§987 the club's copy, and every other message", () => {
  it("the club's copy keeps the line with the link — the copy of one message or the send's one copy — and never says the file is attached", () => {
    for (const copy of [{ clubCopy: true }, { clubCopy: true, clubCopyRecipients: 12, participantName: "" }]) {
      // Even handed `attached: true`, a copy has no file (§320): the template says the link alone.
      const email = render("ro", { ...ATTACHED, ...copy });
      expect(email.subject.startsWith("[Copie club] ")).toBe(true);
      const found = lines(email.html);
      expect(found).toHaveLength(2);
      expect(found[0]).toContain(LINE.ro.linkOnly);
      expect(found[1]).toContain(LINE.en.linkOnly);
      expect(email.html).not.toContain(LINE.ro.attached);
      for (const part of found) expect(part).toContain(`<a href="${URL_OF_FILE}"`);
      expect(email.html).not.toContain('data-email-part="cannot-come"');
      expect(lines(render("ro", { ...DATA, ...copy }).html)).toHaveLength(0);
    }
  });

  it("is drawn by no other message, whatever it is handed: every type renders the same with the field and without", () => {
    for (const messageType of emailMessageType.enumValues) {
      // A relayed message has no template (the relay composes it): nothing of this file's reaches it.
      if (messageType === "ORGANIZER_MESSAGE" || isRelayMessage(messageType)) continue;
      for (const locale of ["ro", "en"] as const) {
        const sample = emailSampleFor(messageType, locale);
        const flagged = render(locale, { ...sample, organizerRouteGpx: { url: URL_OF_FILE, fileName: "traseu.gpx", attached: true } }, messageType);
        const plain = render(locale, sample, messageType);
        expect(flagged.html, `${messageType} (${locale})`).toBe(plain.html);
        expect(flagged.text, `${messageType} (${locale})`).toBe(plain.text);
      }
    }
  });
});

describe("§987 the tick's words, in both catalogues and in the email", () => {
  const wordsOf = (catalogue: typeof ro) => catalogue.Admin.participantMessages;

  it("names the tick, says what it does in one plain sentence, and the question's line — each within 200 characters", () => {
    expect(wordsOf(ro).includeRouteGpx).toBe("Atașează traseul (GPX)");
    expect(wordsOf(en).includeRouteGpx).toBe("Attach the route (GPX)");
    expect(wordsOf(ro).includeRouteGpxHelp).toBe("Fiecare email are atașat fișierul GPX de pe pagina evenimentului și, sub cuvintele tale, un link spre el.");
    expect(wordsOf(en).includeRouteGpxHelp).toBe("Every email has the GPX file from the event's page attached and, under your words, a link to it.");
    expect(wordsOf(ro).confirmRouteGpx).toBe("Emailul are atașat traseul, ca fișier GPX.");
    expect(wordsOf(en).confirmRouteGpx).toBe("The email has the route attached as a GPX file.");
    for (const catalogue of [ro, en]) {
      for (const text of [wordsOf(catalogue).includeRouteGpx, wordsOf(catalogue).includeRouteGpxHelp, wordsOf(catalogue).confirmRouteGpx]) {
        expect(text.length, text).toBeLessThanOrEqual(200);
        expect(text, text).not.toMatch(/platform|de obicei|în general|usually|generally/i);
      }
    }
  });

  it("is a step of the guide's task, by the tick's own label", () => {
    for (const catalogue of [ro, en]) {
      const steps = catalogue.Admin.guide.sections.flatMap((section) => section.tasks.flatMap((task) => task.steps));
      expect(steps.filter((step) => step.includes(`«${wordsOf(catalogue).includeRouteGpx}»`))).toHaveLength(1);
    }
  });

  it("the email's sentences are the templates' own, in both languages, and name no host", () => {
    const templates = readFileSync(path.join(process.cwd(), "src/modules/notifications/templates.ts"), "utf8");
    for (const sentence of [LINE.ro.attached, LINE.ro.linkOnly, LINE.en.attached, LINE.en.linkOnly]) expect(templates).toContain(`"${sentence}"`);
    const own = templates.slice(templates.indexOf("function organizerRouteGpxLines"), templates.indexOf("function anotherPersonEmphasis"));
    expect(own).not.toMatch(/https?:\/\//);
  });
});

/**
 * The structural half of «the flag decides a file and a line of an email, and nothing else» (§987), as for §958: the files
 * that name the flag, its reader or the template's field are a reviewed list — none of the allocator's, the capacity
 * formula's, a state's or a deadline's is on it.
 */
describe("§987 the flag decides a file and a line of an email, and nothing else", () => {
  const ROOT = process.cwd();
  const NAMES_THE_FLAG = /\bincludeRouteGpx\b|readOrganizerIncludeRouteGpx|\borganizerRouteGpx\b/;
  const READERS = [
    // The tick on the form, the action that reads it, and the page that hands the composer its words and the question's line.
    "src/app/[locale]/admin/events/[id]/mesaje/actions.ts",
    "src/app/[locale]/admin/events/[id]/mesaje/page.tsx",
    "src/modules/notifications/ui/ParticipantMessageComposer.tsx",
    // The reader, the send that sets the flag on every row, and the renderer that reads the file and hands the line over.
    "src/modules/notifications/domain/organizer-message.ts",
    "src/modules/notifications/participant-messages.ts",
    "src/modules/notifications/render.ts",
    // The template that draws the line.
    "src/modules/notifications/templates.ts",
  ];

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, acc);
      else if (/\.tsx?$/.test(entry)) acc.push(full);
    }
    return acc;
  }

  it("is named by no file but the reviewed ones — never the allocator, the capacity formula, a state or a deadline", () => {
    const naming = sourceFiles(path.join(ROOT, "src"))
      .filter((file) => NAMES_THE_FLAG.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).replaceAll("\\", "/"))
      .sort();
    expect(naming, "a new reader of the flag must be a reviewed edit of this list").toEqual([...READERS].sort());
    for (const file of naming) {
      expect(file.startsWith("src/modules/registrations/"), file).toBe(false);
      expect(file.startsWith("src/modules/deadlines/"), file).toBe(false);
      expect(file.startsWith("src/db/"), file).toBe(false);
    }
  });

  it("the file is attached by the renderer alone, and never on a club copy", () => {
    const renderer = readFileSync(path.join(ROOT, "src/modules/notifications/render.ts"), "utf8");
    expect(renderer).toContain("if (routeGpxAttachment && !clubCopy) attachments = [...(attachments ?? []), routeGpxAttachment];");
    expect(renderer).toContain("attachments: clubCopy ? undefined : attachments,");
  });
});
